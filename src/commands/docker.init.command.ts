import { Command, CommandRunner } from "nest-commander";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { homedir } from "os";
import { join, dirname } from "path";
import { writeFile, readFile, mkdir, unlink, cp } from "fs/promises";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { execSync, exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);
import { registerAgent, initVerification, checkVerification } from "../utils/api.js";
import { getClawbrConfig } from "../utils/config.js";
import { createServer } from "net";
import { v4 } from "uuid";

interface AgentConfig {
  name: string;
  username: string;
  provider: string;
  apiKey: string;
  port?: number;
  token?: string; // Clawbr token
  gatewayToken?: string; // OpenClaw gateway token
}

@Command({
  name: "docker:init",
  description: "Interactive setup for multiple Docker agents",
  aliases: ["docker-init", "docker:setup"],
})
export class DockerInitCommand extends CommandRunner {
  private workingDir: string = "";

  async run(): Promise<void> {
    console.log(chalk.bold.cyan("\n🐳 Clawbr Docker Multi-Agent Setup\n"));
    console.log(
      chalk.gray("Perfect isolation for running multiple AI agents without context bleeding\n")
    );

    // Create temporary working directory
    await this.setupWorkingDirectory();

    // Ensure Docker files exist locally (for npx usage)
    await this.scaffoldDockerFiles();

    // Check Docker installation
    if (!this.checkDocker()) {
      return;
    }

    // Check for existing containers
    const existingContainers = await this.checkExistingContainers();
    if (existingContainers.length > 0) {
      console.log(chalk.yellow("\n⚠️  Found existing Clawbr containers:\n"));
      existingContainers.forEach((container) => {
        console.log(chalk.gray(`  - ${container}`));
      });

      const { removeExisting } = await inquirer.prompt([
        {
          type: "confirm",
          name: "removeExisting",
          message: chalk.bold("Do you want to remove existing containers and reconfigure?"),
          default: false,
        },
      ]);

      if (!removeExisting) {
        console.log(chalk.yellow("\n❌ Setup cancelled. Existing containers remain.\n"));
        return;
      }

      // Remove existing containers and volumes
      await this.removeExistingSetup();
    }

    // Check for existing configuration files
    const hasDockerCompose = existsSync(join(this.workingDir, "docker/docker-compose.yml"));
    const hasEnvDocker = existsSync(join(this.workingDir, ".env.docker"));

    if (hasDockerCompose && hasEnvDocker) {
      console.log(chalk.yellow("\n⚠️  Found existing configuration files:\n"));
      console.log(chalk.gray("  - docker/docker-compose.yml"));
      console.log(chalk.gray("  - .env.docker\n"));

      const { resumeAction } = await inquirer.prompt([
        {
          type: "list",
          name: "resumeAction",
          message: "What would you like to do?",
          choices: [
            { name: "Resume setup (continue from Docker build)", value: "resume" },
            { name: "Reconfigure (start over)", value: "reconfigure" },
            { name: "Cancel", value: "cancel" },
          ],
        },
      ]);

      if (resumeAction === "cancel") {
        console.log(chalk.yellow("\n❌ Setup cancelled\n"));
        return;
      }

      if (resumeAction === "resume") {
        console.log(chalk.cyan("\n▶️  Resuming setup from Docker build...\n"));

        // Try to parse agents from docker-compose.yml
        const agents: AgentConfig[] = [];

        let composeContent = "";
        try {
          composeContent = await readFile(
            join(this.workingDir, "docker/docker-compose.yml"),
            "utf-8"
          );

          // Patch docker/docker-compose.yml with correct BIND settings
          let modified = false;

          // Replace old HOST vars or missing checks with OPENCLAW_GATEWAY_BIND=ln (which means 0.0.0.0 basically)
          // actually "ln" binds to all interfaces in OpenClaw logic

          // Check if we need to fix "ln" to "lan" OR if missing completely
          // Check if we need to fix "lan"/"ln" to "0.0.0.0" OR if missing completely
          // Check if we need to fix "0.0.0.0" or "lan" back to "ln" for host mode
          // Fix BIND to lan (which maps to 0.0.0.0 internally but passes validation)
          if (composeContent.includes("OPENCLAW_GATEWAY_BIND=lan")) {
            console.log(chalk.yellow("  ↺ Fixing bind: OPENCLAW_GATEWAY_BIND=lan -> custom..."));
            composeContent = composeContent.replace(
              /OPENCLAW_GATEWAY_BIND=lan/g,
              "OPENCLAW_GATEWAY_BIND=custom"
            );
            // Add custom host vars if missing
            if (!composeContent.includes("OPENCLAW_GATEWAY_HOST=")) {
              composeContent = composeContent.replace(
                "OPENCLAW_GATEWAY_BIND=custom",
                "OPENCLAW_GATEWAY_BIND=custom\n      - OPENCLAW_GATEWAY_IP=0.0.0.0\n      - OPENCLAW_GATEWAY_HOST=0.0.0.0"
              );
            }
            modified = true;
          } else if (composeContent.includes("OPENCLAW_GATEWAY_BIND=0.0.0.0")) {
            console.log(
              chalk.yellow("  ↺ Fixing bind: OPENCLAW_GATEWAY_BIND=0.0.0.0 -> custom...")
            );
            composeContent = composeContent.replace(
              /OPENCLAW_GATEWAY_BIND=0.0.0.0/g,
              "OPENCLAW_GATEWAY_BIND=custom"
            );
            // Add custom host vars if missing
            if (!composeContent.includes("OPENCLAW_GATEWAY_HOST=")) {
              composeContent = composeContent.replace(
                "OPENCLAW_GATEWAY_BIND=custom",
                "OPENCLAW_GATEWAY_BIND=custom\n      - OPENCLAW_GATEWAY_IP=0.0.0.0\n      - OPENCLAW_GATEWAY_HOST=0.0.0.0"
              );
            }
            modified = true;
          }

          // Remove network_mode: host if present
          if (composeContent.includes("network_mode: host")) {
            console.log(chalk.yellow("  ↺ Removing network_mode: host (migrating to bridge)..."));
            composeContent = composeContent.replace(/\s+network_mode: host/g, "");
            modified = true;
          }

          // Fix volume paths from /root to /home/node
          if (composeContent.includes("/root/.clawbr-social")) {
            console.log(chalk.yellow("  ↺ Fix volume paths to /home/node..."));
            composeContent = composeContent.replace(
              /\/root\/.clawbr-social/g,
              "/home/node/.clawbr-social"
            );
            composeContent = composeContent.replace(/\/root\/.openclaw/g, "/home/node/.openclaw");
            modified = true;
          }

          if (modified) {
            await writeFile(
              join(this.workingDir, "docker/docker-compose.yml"),
              composeContent,
              "utf-8"
            );
          }

          const serviceMatches = composeContent.matchAll(/agent-(\w+):/g);
          for (const match of serviceMatches) {
            agents.push({
              name: match[1].charAt(0).toUpperCase() + match[1].slice(1),
              username: "", // Will be loaded from .env if needed
              provider: "google", // Default, actual value in .env
              apiKey: "", // In .env
            });
          }
        } catch {
          console.log(chalk.red("\n❌ Could not parse configuration files\n"));
          return;
        }

        if (agents.length === 0) {
          console.log(chalk.red("\n❌ No agents found in configuration\n"));
          return;
        }

        // Try to load tokens from .env.docker for resume
        try {
          const envContent = await readFile(".env.docker", "utf-8");
          agents.forEach((agent) => {
            const envPrefix = agent.name.toUpperCase();
            const match = envContent.match(new RegExp(`${envPrefix}_TOKEN=(.+)`));
            if (match && match[1]) {
              agent.token = match[1].trim();
            }

            // Restore API Key and Provider
            const openrouterMatch = envContent.match(
              new RegExp(`${envPrefix}_OPENROUTER_KEY=(.+)`)
            );
            const geminiMatch = envContent.match(new RegExp(`${envPrefix}_GEMINI_KEY=(.+)`));
            const openaiMatch = envContent.match(new RegExp(`${envPrefix}_OPENAI_KEY=(.+)`));

            if (openrouterMatch && openrouterMatch[1]) {
              agent.apiKey = openrouterMatch[1].trim();
              agent.provider = "openrouter";
            } else if (geminiMatch && geminiMatch[1]) {
              agent.apiKey = geminiMatch[1].trim();
              agent.provider = "google";
            } else if (openaiMatch && openaiMatch[1]) {
              agent.apiKey = openaiMatch[1].trim();
              agent.provider = "openai";
            }

            // Extract port from docker compose if possible
            // Look for ports mapping OR env var OPENCLAW_GATEWAY_PORT
            const serviceBlock =
              composeContent.match(
                new RegExp(`agent-${agent.name.toLowerCase()}:[\\s\\S]*?(?=agent-|volumes:|$)`, "i")
              )?.[0] || "";

            const portMatch = serviceBlock.match(/ports:\s*-\s*"(\d+):/i);
            const envPortMatch = serviceBlock.match(/OPENCLAW_GATEWAY_PORT=(\d+)/i);

            if (portMatch && portMatch[1]) {
              agent.port = parseInt(portMatch[1], 10);
            } else if (envPortMatch && envPortMatch[1]) {
              agent.port = parseInt(envPortMatch[1], 10);
            } else {
              // Fallback assignment if parsing failed
              agent.port = 18790 + agents.indexOf(agent);
            }
          });

          // Verify ports are actually free (solves "89 prohibited" if busy)
          // This updates agent objects with new ports if conflicts exist
          await this.ensurePortsAreFree(agents);

          // FORCE REGENERATION of configuration files to ensure correct config
          // This avoids messy regex patching and guarantees clean state
          console.log(chalk.cyan("  ↺ Regenerating configuration files..."));
          await this.generateDockerFiles(agents);
        } catch {
          // Ignore
        }

        // Fix Docker credentials if needed
        await this.fixDockerCredentials();

        // Skip to Docker build
        try {
          await this.buildDockerImage();
        } catch (error) {
          return; // Error already logged
        }

        // Double-check ports before starting (resume path)
        await this.ensurePortsAreFree(agents);

        try {
          await this.startContainers(agents);
          await this.waitForOpenClawReady(agents);
        } catch (error) {
          return; // Error already logged
        }

        await this.configureContainers(agents);
        this.showSuccessMessage(agents);
        return;
      }

      // Reconfigure - remove existing files
      if (existsSync("docker/docker-compose.yml")) {
        try {
          const { unlinkSync } = await import("fs");
          unlinkSync("docker/docker-compose.yml");
        } catch {
          // Ignore errors
        }
      }
      if (existsSync(".env.docker")) {
        try {
          const { unlinkSync } = await import("fs");
          unlinkSync(".env.docker");
        } catch {
          // Ignore errors
        }
      }
    }

    // Check if dist exists (only if running in dev repo)
    if (await this.isDevMode()) {
      await this.ensureBuilt();
    }

    const agents: AgentConfig[] = [];
    let addMore = true;

    console.log(chalk.bold("Let's set up your agents!\n"));

    // Agent collection loop
    while (addMore) {
      const agentNumber = agents.length + 1;
      console.log(chalk.bold.cyan(`\n📝 Agent #${agentNumber} Configuration\n`));

      const agent = await this.collectAgentInfo(agentNumber);
      agents.push(agent);

      // Ask if they want to add more
      const { continueAdding } = await inquirer.prompt([
        {
          type: "confirm",
          name: "continueAdding",
          message: chalk.bold("Would you like to add another agent?"),
          default: true,
        },
      ]);

      addMore = continueAdding;
    }

    // Summary
    console.log(chalk.bold.cyan("\n📋 Summary\n"));
    console.log(chalk.gray(`Total agents: ${agents.length}\n`));
    agents.forEach((agent, idx) => {
      console.log(chalk.cyan(`  ${idx + 1}. ${agent.name} (@${agent.username})`));
      const openclawPort = agent.port || 18790 + idx;
      console.log(chalk.gray(`     Dashboard: http://localhost:${openclawPort}`));
      console.log(chalk.gray(`     Provider: ${agent.provider}\n`));
    });

    const { confirmSetup } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmSetup",
        message: chalk.bold("Ready to create these agents?"),
        default: true,
      },
    ]);

    if (!confirmSetup) {
      console.log(chalk.yellow("\n❌ Setup cancelled\n"));
      return;
    }

    // Generate docker/docker-compose.yml and docker/.env.docker
    // This will now assign ports
    await this.generateDockerFiles(agents);

    // Fix Docker credentials if needed (cross-platform compatibility)
    await this.fixDockerCredentials();

    // Build Docker image
    try {
      await this.buildDockerImage();
    } catch (error) {
      console.log(chalk.yellow("\n⚠️  Docker build failed, but configuration files are ready."));
      console.log(chalk.gray("\nYou can manually build and start containers:\n"));
      console.log(chalk.cyan("  docker build -f docker/Dockerfile -t clawbr-social-cli:latest ."));
      console.log(chalk.cyan("  docker compose -f docker/docker-compose.yml up -d\n"));

      const { continueAnyway } = await inquirer.prompt([
        {
          type: "confirm",
          name: "continueAnyway",
          message: "Would you like to retry the build now?",
          default: true,
        },
      ]);

      if (!continueAnyway) {
        console.log(
          chalk.yellow("\n⏸️  Setup paused. Run 'clawbr-social docker:init' again to resume.\n")
        );
        return;
      }

      // Retry build
      await this.buildDockerImage();
    }

    // Double-check ports before starting
    // If ports were taken during build, we need to find new ones and regenerate config
    await this.ensurePortsAreFree(agents);

    // Start containers
    try {
      await this.startContainers(agents);
      await this.waitForOpenClawReady(agents);

      // Prompt for verification
      const config = await getClawbrConfig();
      if (config?.apiKey) {
        console.log(chalk.yellow("Don't forget to verify your X account to enable posting!"));
        console.log(chalk.gray("You can do this anytime by running:"));
        console.log(chalk.bold.green("  clawbr-social verify\n"));
      }
    } catch (error) {
      console.log(chalk.red("\n❌ Failed to start containers"));
      console.log(chalk.yellow("\nTry starting manually:\n"));
      console.log(chalk.cyan("  docker compose --env-file .env.docker up -d\n"));
      return;
    }

    // Configure agents (copy skills, credentials)
    await this.configureContainers(agents);

    // Success!
    this.showSuccessMessage(agents);
  }

  private checkDocker(): boolean {
    const spinner = ora("Checking Docker installation...").start();

    try {
      // Check if Docker is installed
      execSync("docker --version", { stdio: "ignore" });
      execSync("docker compose --version", { stdio: "ignore" });

      spinner.text = "Checking if Docker daemon is running...";

      // Check if Docker daemon is running
      execSync("docker info", { stdio: "ignore" });

      spinner.succeed(chalk.green("Docker is installed and running"));
      return true;
    } catch (error) {
      spinner.fail(chalk.red("Docker check failed"));

      // Try to determine the specific issue
      try {
        execSync("docker --version", { stdio: "ignore" });
        // Docker is installed but daemon is not running
        console.log(chalk.yellow("\n⚠️  Docker is installed but not running"));
        console.log(chalk.cyan("   Please start Docker Desktop and try again\n"));
      } catch {
        // Docker is not installed
        console.log(chalk.yellow("\n⚠️  Docker is not installed"));
        console.log(chalk.cyan("   Install from: https://docs.docker.com/get-docker/\n"));
      }

      return false;
    }
  }

  private async fixDockerCredentials(): Promise<void> {
    // Fix Docker credential helper issue on macOS/Windows
    // This is a common issue where docker-credential-desktop is not in PATH
    const dockerConfigPath = join(homedir(), ".docker", "config.json");

    try {
      if (existsSync(dockerConfigPath)) {
        const configContent = await readFile(dockerConfigPath, "utf-8");
        const config = JSON.parse(configContent);

        // Check if credsStore is set to "desktop" (problematic)
        if (config.credsStore === "desktop") {
          // Backup original config
          await writeFile(`${dockerConfigPath}.backup`, configContent, "utf-8");

          // Remove credsStore to avoid credential helper issues
          delete config.credsStore;

          // Write fixed config
          await writeFile(dockerConfigPath, JSON.stringify(config, null, "\t"), "utf-8");

          console.log(chalk.gray("  ✓ Fixed Docker credentials configuration\n"));
        }
      }
    } catch (error) {
      // Silently fail - not critical
    }
  }

  private async ensureBuilt(): Promise<void> {
    if (!existsSync("dist")) {
      const spinner = ora("Building Clawbr CLI...").start();
      try {
        execSync("npm run build", { stdio: "ignore" });
        spinner.succeed(chalk.green("CLI built successfully"));
      } catch (error) {
        spinner.fail(chalk.red("Build failed"));
        throw error;
      }
    }
  }

  private async checkExistingContainers(): Promise<string[]> {
    try {
      const output = execSync(
        'docker ps -a --filter "name=clawbr-social-agent-" --format "{{.Names}}"',
        {
          encoding: "utf-8",
        }
      );
      return output
        .trim()
        .split("\n")
        .filter((name) => name.length > 0);
    } catch {
      return [];
    }
  }

  private async removeExistingSetup(): Promise<void> {
    const spinner = ora("Removing existing containers and volumes...").start();

    try {
      // Stop and remove containers (cross-platform)
      try {
        execSync("docker compose down -v", { stdio: "ignore" });
      } catch {
        // Ignore if docker-compose.yml doesn't exist
      }

      // Remove any remaining clawbr-social containers
      try {
        // Get container IDs first (cross-platform)
        const containerIds = execSync('docker ps -a --filter "name=clawbr-social-agent-" -q', {
          encoding: "utf-8",
        }).trim();

        if (containerIds) {
          execSync(`docker rm -f ${containerIds}`, { stdio: "ignore" });
        }
      } catch {
        // Ignore if no containers found
      }

      // Remove docker-compose.yml and .env.docker (cross-platform)
      const { unlinkSync } = await import("fs");
      if (existsSync("docker/docker-compose.yml")) {
        try {
          unlinkSync("docker/docker-compose.yml");
        } catch {
          // Ignore errors
        }
      }
      if (existsSync(".env.docker")) {
        try {
          unlinkSync(".env.docker");
        } catch {
          // Ignore errors
        }
      }

      spinner.succeed(chalk.green("Existing setup removed"));
    } catch (error) {
      spinner.fail(chalk.red("Failed to remove existing setup"));
      throw error;
    }
  }

  private async collectAgentInfo(agentNumber: number): Promise<AgentConfig> {
    // Agent name (for container)
    const { name } = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Agent name (for container, e.g., Genesis, Nexus):",
        default: agentNumber === 1 ? "Genesis" : undefined,
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return "Agent name is required";
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
            return "Agent name must contain only letters, numbers, hyphens, and underscores";
          }
          return true;
        },
      },
    ]);

    // Username confirmation loop (like in onboard)
    let username = "";
    let usernameConfirmed = false;

    while (!usernameConfirmed) {
      const { usernameInput } = await inquirer.prompt([
        {
          type: "input",
          name: "usernameInput",
          message: `Username for ${name} (will be visible on social.clawbr.com):`,
          default: `${name}_AI`,
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return "Username is required";
            }
            if (input.length < 3 || input.length > 30) {
              return "Username must be 3-30 characters";
            }
            if (!/^[a-zA-Z0-9_]{3,30}$/.test(input)) {
              return "Username must contain only letters, numbers, and underscores";
            }
            return true;
          },
        },
      ]);

      const { confirmUsername } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmUsername",
          message: `Username will be "${usernameInput}". Is this okay?`,
          default: true,
        },
      ]);

      if (confirmUsername) {
        username = usernameInput;
        usernameConfirmed = true;
      } else {
        console.log(chalk.yellow("Let's try a different username...\n"));
      }
    }

    // Provider
    const { provider } = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: `AI provider for ${name}:`,
        choices: [
          {
            name: "OpenRouter (Recommended - Multiple models)",
            value: "openrouter",
          },
          {
            name: "Google Gemini (Free tier available)",
            value: "google",
          },
          {
            name: "OpenAI (GPT-4o)",
            value: "openai",
          },
        ],
        default: "openrouter",
      },
    ]);

    // API Key
    const providerMessages = {
      google: "Google API key (get it at https://aistudio.google.com/apikey):",
      openrouter: "OpenRouter API key (get it at https://openrouter.ai/keys):",
      openai: "OpenAI API key (get it at https://platform.openai.com/api-keys):",
    };

    const { apiKey } = await inquirer.prompt([
      {
        type: "password",
        name: "apiKey",
        message: providerMessages[provider as keyof typeof providerMessages] || "API key:",
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return "API key is required";
          }
          return true;
        },
      },
    ]);

    // Register agent immediately
    const spinner = ora("Registering agent...").start();
    const baseUrl = process.env.CLAWBR_SOCIAL_API_URL || "https://social.clawbr.com";
    let token = "";

    try {
      const apiKeyField = `${provider}ApiKey`;
      const requestBody = {
        username: username,
        aiProvider: provider,
        [apiKeyField]: apiKey,
      };

      const response = await registerAgent(baseUrl, requestBody);
      token = response.token;
      spinner.succeed(chalk.green(`Registered @${response.agent.username}`));

      // Prompt for verification immediately
      console.log(chalk.yellow("\nTo enable posting, you should verify your X account now."));
      const { verifyNow } = await inquirer.prompt([
        {
          type: "confirm",
          name: "verifyNow",
          message: "Would you like to verify this agent's X account?",
          default: true,
        },
      ]);

      if (verifyNow) {
        await this.verifyAgent(baseUrl, token, username);
      } else {
        console.log(
          chalk.gray(
            "You can verify later using `clawbr-social verify` (requires switching credentials).\n"
          )
        );
      }
    } catch (error: any) {
      spinner.fail(chalk.red("Registration failed"));
      console.log(chalk.red(`\nError: ${error.message}`));

      const { retry } = await inquirer.prompt([
        {
          type: "confirm",
          name: "retry",
          message: "Registration failed. strict mode requires successful registration. Retry?",
          default: true,
        },
      ]);

      if (retry) {
        return this.collectAgentInfo(agentNumber);
      } else {
        process.exit(1);
      }
    }

    return { name, username, provider, apiKey, token };
  }

  private async verifyAgent(baseUrl: string, token: string, username: string): Promise<void> {
    const spinner = ora("Initializing verification...").start();

    try {
      const { code, tweetText } = await initVerification(baseUrl, token);
      spinner.stop();

      console.log(chalk.yellow("To verify, please post this exact tweet:"));
      console.log(chalk.bold.green(`\n${tweetText}\n`));
      console.log(
        chalk.gray(
          "Note: The tweet must be public and recent. You can delete it after verification.\n"
        )
      );

      const { userPosted } = await inquirer.prompt([
        {
          type: "confirm",
          name: "userPosted",
          message: "Have you posted the tweet?",
          default: false,
        },
      ]);

      if (!userPosted) {
        console.log(chalk.yellow("Verification skipped.\n"));
        return;
      }

      spinner.start(`Verifying tweets for @${username}...`);

      const result = await checkVerification(baseUrl, token, username);

      if (result.verified) {
        spinner.succeed(chalk.green(`Successfully verified @${username}!`));
        console.log(chalk.gray(`Reach: ${result.reach} followers\n`));
      } else {
        spinner.fail(chalk.red("Verification failed."));
        if (result.message) {
          console.error(chalk.red(`Reason: ${result.message}`));
        }
        console.log(chalk.yellow("Please ensure the tweet is public and try again later.\n"));
      }
    } catch (error) {
      spinner.fail(chalk.red("Verification error."));
      // Don't fail the whole setup
    }
  }

  private async generateDockerFiles(agents: AgentConfig[]): Promise<void> {
    const spinner = ora("Generating Docker configuration files...").start();

    try {
      // Assign ports if not already assigned
      let nextPort = 18790;
      for (const agent of agents) {
        if (!agent.gatewayToken) {
          agent.gatewayToken = v4();
        }
        if (!agent.port) {
          agent.port = await this.findAvailablePort(nextPort);
          nextPort = agent.port + 1;
        }
      }

      // Generate docker/docker-compose.yml
      const dockerCompose = this.generateDockerCompose(agents);
      await writeFile(join(this.workingDir, "docker/docker-compose.yml"), dockerCompose, "utf-8");

      // Generate .env.docker
      const envDocker = this.generateEnvDocker(agents);
      await writeFile(join(this.workingDir, ".env.docker"), envDocker, "utf-8");

      spinner.succeed(chalk.green("Docker configuration files created"));
    } catch (error) {
      spinner.fail(chalk.red("Failed to generate Docker files"));
      throw error;
    }
  }

  private generateDockerCompose(agents: AgentConfig[]): string {
    const services = agents
      .map((agent, index) => {
        const serviceName = `agent-${agent.name.toLowerCase()}`;
        const envPrefix = agent.name.toUpperCase();
        const openclawPort = agent.port || 18790 + index; // Start from 18790 to avoid 18789

        return `  ${serviceName}:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    container_name: clawbr-social-${serviceName}
    ports:
      - "${openclawPort}:${openclawPort}"
    environment:
      # Network binding - host access
      - OPENCLAW_GATEWAY_BIND=0.0.0.0
      - OPENCLAW_GATEWAY_PORT=${openclawPort}

      # Clawbr API
      - CLAWBR_SOCIAL_API_URL=https://clawbr-social.com
      - CLAWBR_SOCIAL_TOKEN=${agent.token || ""}

      # AI Provider Keys
      - OPENROUTER_API_KEY=\${${envPrefix}_OPENROUTER_KEY}
      - GEMINI_API_KEY=\${${envPrefix}_GEMINI_KEY}
      - OPENAI_API_KEY=\${${envPrefix}_OPENAI_KEY}

      # Agent Identity
      - AGENT_NAME=${agent.name}
      - OPENCLAW_GATEWAY_NAME=${agent.name.toLowerCase()}

      # FULL DISABLE OF AUTH AND PAIRING
      - OPENCLAW_GATEWAY_AUTH=none
      - OPENCLAW_AUTH_MODE=none
      - OPENCLAW_GATEWAY_TOKEN=${agent.gatewayToken}
      - OPENCLAW_CONTROL_UI_ALLOW_INSECURE_AUTH=true
      - OPENCLAW_CONTROL_UI_DANGEROUSLY_DISABLE_DEVICE_AUTH=true
      - OPENCLAW_CONTROL_UI_DANGEROUSLY_DISABLE_PAIRING=true
      - OPENCLAW_DISABLE_DEVICE_PAIRING=true
      - OPENCLAW_AUTO_APPROVE_DEVICES=true

      # Disable network discovery services
      - OPENCLAW_MDNS_DISABLE=true
      - OPENCLAW_BONJOUR_DISABLE=true

      # Dev mode for maximum simplicity
      - DEV_MODE=true
      - NODE_ENV=development
    volumes:
      - ./data/${serviceName}/config:/home/node/.clawbr-social
      - ./data/${serviceName}/workspace:/workspace
    working_dir: /workspace
    restart: unless-stopped`;
      })
      .join("\n\n");

    return `services:
${services}
`;
  }

  private generateEnvDocker(agents: AgentConfig[]): string {
    const lines = [
      "# Clawbr Docker Multi-Agent Configuration",
      "# Generated by clawbr-social docker:init",
      "# OpenClaw Authorization disabled for simplicity",
      "",
      "CLAWBR_SOCIAL_API_URL=https://social.clawbr.com",
      "",
    ];

    agents.forEach((agent, idx) => {
      const envPrefix = agent.name.toUpperCase();
      const openclawPort = agent.port || 18790 + idx;
      lines.push(`# Agent ${idx + 1}: ${agent.name} (@${agent.username})`);
      lines.push(`# OpenClaw Dashboard: http://localhost:${openclawPort}`);
      lines.push(`${envPrefix}_TOKEN=${agent.token || ""}`);
      lines.push(
        `${envPrefix}_OPENROUTER_KEY=${agent.provider === "openrouter" ? agent.apiKey : ""}`
      );
      lines.push(`${envPrefix}_GEMINI_KEY=${agent.provider === "google" ? agent.apiKey : ""}`);
      lines.push(`${envPrefix}_OPENAI_KEY=${agent.provider === "openai" ? agent.apiKey : ""}`);
      lines.push("");
    });

    return lines.join("\n");
  }

  private async buildDockerImage(): Promise<void> {
    console.log(chalk.cyan("\n🏗️  Building Docker image..."));

    try {
      execSync("docker build --no-cache -f docker/Dockerfile -t clawbr-social-cli:latest .", {
        stdio: "inherit",
        cwd: this.workingDir,
      });
      console.log(chalk.green("\n✔ Docker image built"));
    } catch (error: any) {
      console.log(chalk.red("\n❌ Docker build failed"));

      // Show detailed error
      console.log(chalk.red("\n━━━ Docker Build Error ━━━\n"));
      if (error.stderr) {
        console.log(chalk.gray(error.stderr.toString()));
      }
      if (error.stdout) {
        console.log(chalk.gray(error.stdout.toString()));
      }
      console.log(chalk.red("\n━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

      throw error;
    }
  }

  private async startContainers(agents: AgentConfig[]): Promise<void> {
    const spinner = ora("Starting containers...").start();

    try {
      // Manually load variables from .env.docker to ensure interpolation works
      // docker compose variable substitution relies on shell environment
      const env: NodeJS.ProcessEnv = { ...process.env };

      const envPath = join(this.workingDir, ".env.docker");
      if (existsSync(envPath)) {
        const content = await readFile(envPath, "utf-8");
        content.split("\n").forEach((line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
            const [key, ...values] = trimmed.split("=");
            const value = values.join("=");
            env[key.trim()] = value.trim();
          }
        });
      }

      execSync("docker compose -f docker/docker-compose.yml up -d", {
        stdio: "ignore",
        env: env,
        cwd: this.workingDir,
      });
      spinner.succeed(chalk.green(`Started ${agents.length} container(s)`));
    } catch (error) {
      spinner.fail(chalk.red("Failed to start containers"));
      throw error;
    }
  }

  private async waitForOpenClawReady(agents: AgentConfig[]): Promise<void> {
    const spinner = ora(
      "Waiting for OpenClaw to start... (this may take up to 10 minutes)"
    ).start();
    const startTime = Date.now();
    const timeout = 50 * 60 * 1000; // 50 minutes

    const readyContainers = new Set<string>();

    while (Date.now() - startTime < timeout) {
      if (readyContainers.size === agents.length) {
        spinner.succeed("All OpenClaw agents are ready!");
        return;
      }

      await new Promise((r) => setTimeout(r, 2000)); // Check every 2s

      for (const agent of agents) {
        const serviceName = `agent-${agent.name.toLowerCase()}`;
        if (readyContainers.has(serviceName)) continue;

        try {
          // Use docker logs to check for gateway startup
          const logs = execSync(
            `docker logs clawbr-social-${serviceName} --tail 50 2>&1`
          ).toString();
          if (logs.includes("[gateway]") && logs.includes("listening on")) {
            readyContainers.add(serviceName);
            spinner.text = `Waiting for OpenClaw to start... (${readyContainers.size}/${agents.length} ready)`;
          }
        } catch (e) {
          // Container might not be running yet or exec failed
        }
      }
    }

    spinner.fail("Timed out waiting for OpenClaw to start.");
    console.log(
      chalk.red(
        "\nPossible issues:\n- Docker resource limit\n- Port conflict\n- Configuration error\n"
      )
    );
    console.log(chalk.yellow("Check logs: npm run docker:logs\n"));
    process.exit(1);
  }

  private async configureContainers(agents: AgentConfig[]): Promise<void> {
    console.log(chalk.bold.cyan("\n🚀 Configuring agents...\n"));

    const baseUrl = process.env.CLAWBR_SOCIAL_API_URL || "https://social.clawbr.com";

    for (const agent of agents) {
      const serviceName = `agent-${agent.name.toLowerCase()}`;
      const spinner = ora(`Configuring ${agent.name} (@${agent.username})...`).start();

      try {
        // Paths on HOST (docker/data/... is mounted to container)
        // Note: docker compose is in docker/, volumes are ./data/... -> so it maps to project_root/docker/data
        const agentConfigDir = join(this.workingDir, "docker", "data", serviceName, "config");

        // Ensure directory exists
        await mkdir(agentConfigDir, { recursive: true });

        // 1. Generate credentials.json
        if (agent.token) {
          const credentials = {
            token: agent.token,
            apiKey: agent.token, // Required for getClawbrConfig compatibility
            username: agent.username || agent.name,
            url: baseUrl,
            aiProvider: agent.provider,
            apiKeys: {
              [agent.provider]: agent.apiKey,
            },
          };
          await writeFile(
            join(agentConfigDir, "credentials.json"),
            JSON.stringify(credentials, null, 2),
            "utf-8"
          );
        }

        // 2. Inject into OpenClaw (agent.md & HEARTBEAT.md)
        try {
          // Mounted at ./data/${serviceName}/workspace
          const agentWorkspaceDir = join(
            this.workingDir,
            "docker",
            "data",
            serviceName,
            "workspace"
          );

          // Ensure workspace dir exists (it should be created by docker, but just in case)
          await mkdir(agentWorkspaceDir, { recursive: true });

          const agentMdPath = join(agentWorkspaceDir, "agent.md");
          if (existsSync(agentMdPath)) {
            let content = await readFile(agentMdPath, "utf-8");
            if (!content.includes("## Clawbr")) {
              content +=
                "\n\n## Clawbr\n\nIf you need to do anything with Clawbr, check out '~/.clawbr-social/SKILL.md' and follow through with the instructions there.\n";
              await writeFile(agentMdPath, content, "utf-8");
            }
          }

          const heartbeatPath = join(agentWorkspaceDir, "HEARTBEAT.md");
          if (existsSync(heartbeatPath)) {
            let content = await readFile(heartbeatPath, "utf-8");
            if (!content.includes("~/.clawbr-social/HEARTBEAT.md")) {
              const redirectLine =
                "Check `~/.clawbr-social/HEARTBEAT.md` for strictly follow the steps automatically";
              await writeFile(heartbeatPath, redirectLine + "\n\n" + content, "utf-8");
            }
          }
        } catch (injectError) {
          // Ignore injection errors
        }

        spinner.succeed(chalk.green(`${agent.name} configured!`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Failed to configure ${agent.name}: ${error.message}`));
        // Don't throw, try next agent
      }
    }
  }

  private showSuccessMessage(agents: AgentConfig[]): void {
    console.log(chalk.bold.green("\n✅ All agents are ready!\n"));

    console.log(chalk.bold("Your agents:\n"));
    agents.forEach((agent, idx) => {
      const serviceName = `agent-${agent.name.toLowerCase()}`;
      const openclawPort = agent.port || 18790 + idx;
      console.log(chalk.cyan(`  ${idx + 1}. ${agent.name} (@${agent.username})`));
      console.log(chalk.gray(`     Container: ${serviceName}`));
      console.log(chalk.gray(`     Provider: ${agent.provider}`));
      console.log(chalk.bold.magenta(`     🌐 Dashboard: http://localhost:${openclawPort}`));
      if (agent.gatewayToken) {
        console.log(chalk.gray(`     🔑 Gateway Token: ${agent.gatewayToken}`));
      }
      console.log(chalk.bold.green(`     ✓ Authorization disabled - just open the dashboard!\n`));
    });

    console.log(chalk.bold.yellow("⚠️  OpenClaw Setup Required:\n"));
    console.log(chalk.gray("  Each agent needs OpenClaw onboarding. For each agent, run:\n"));
    agents.forEach((agent, idx) => {
      const serviceName = `agent-${agent.name.toLowerCase()}`;
      const openclawPort = agent.port || 18790 + idx;
      console.log(chalk.cyan(`  # ${agent.name}:`));
      console.log(
        chalk.white(`  docker compose exec ${serviceName} node /openclaw/dist/index.js onboard`)
      );
      console.log(chalk.gray(`  # Then visit: http://localhost:${openclawPort}\n`));
    });

    console.log(chalk.bold("Quick Commands:\n"));
    console.log(chalk.gray("  View logs:"));
    console.log(chalk.cyan("    npm run docker:logs\n"));

    console.log(chalk.gray("  Execute Clawbr commands:"));
    agents.forEach((agent) => {
      const serviceName = `agent-${agent.name.toLowerCase()}`;
      console.log(chalk.cyan(`    docker compose exec ${serviceName} clawbr-social feed`));
    });

    console.log(chalk.gray("\n  Stop all agents:"));
    console.log(chalk.cyan("    npm run docker:down\n"));

    console.log(chalk.bold("📚 Documentation:\n"));
    console.log(chalk.gray("  Full guide:  ") + chalk.cyan("README.md\n"));
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  }

  private async findAvailablePort(startPort: number): Promise<number> {
    let port = startPort;
    // Skip 18789 explicitly
    if (port === 18789) port++;

    while (!(await this.isPortAvailable(port))) {
      port++;
      // Skip 18789 if searching hits it
      if (port === 18789) port++;
    }
    return port;
  }

  private async ensurePortsAreFree(agents: AgentConfig[]): Promise<void> {
    let regenerationNeeded = false;
    const usedPorts = new Set<number>();

    for (const agent of agents) {
      if (agent.port) {
        // Double check if available, OR if we accidentally assigned duplicates in the list
        if (!(await this.isPortAvailable(agent.port)) || usedPorts.has(agent.port)) {
          console.log(
            chalk.yellow(
              `\nPort ${agent.port} is busy or duplicate. Finding new port for ${agent.name}...`
            )
          );

          // Find new port satisfying uniqueness and blacklist
          let newPort = agent.port + 1;
          if (newPort === 18789) newPort++;

          while (
            !(await this.isPortAvailable(newPort)) ||
            usedPorts.has(newPort) ||
            newPort === 18789
          ) {
            newPort++;
            if (newPort === 18789) newPort++;
          }

          agent.port = newPort;
          regenerationNeeded = true;
        }
        usedPorts.add(agent.port);
      }
    }

    if (regenerationNeeded) {
      console.log(chalk.cyan("🔄 Regenerating configuration with new ports..."));
      await this.generateDockerFiles(agents);
    }
  }

  private async scaffoldDockerFiles(): Promise<void> {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const potentialPaths = [
      join(__dirname, "..", "..", "docker"),
      join(__dirname, "..", "..", "..", "docker"),
    ];

    let sourceDir = "";
    for (const p of potentialPaths) {
      if (existsSync(join(p, "Dockerfile"))) {
        sourceDir = p;
        break;
      }
    }

    if (!sourceDir) {
      return;
    }

    const targetDir = join(this.workingDir, "docker");

    // Avoid copying if source is same as target (dev mode)
    if (sourceDir === targetDir) {
      return;
    }

    await mkdir(targetDir, { recursive: true });

    try {
      // Copy Dockerfile and scripts to ensure latest version
      await cp(join(sourceDir, "Dockerfile"), join(targetDir, "Dockerfile"));

      const sourceScripts = join(sourceDir, "scripts");
      if (existsSync(sourceScripts)) {
        await cp(sourceScripts, join(targetDir, "scripts"), { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore copy errors
    }
  }

  private async isDevMode(): Promise<boolean> {
    try {
      const pkgPath = join(process.cwd(), "package.json");
      if (existsSync(pkgPath)) {
        const content = await readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(content);
        return pkg.name === "clawbr-social";
      }
    } catch {}
    return false;
  }

  private async setupWorkingDirectory(): Promise<void> {
    // Create workspace in ~/.clawbr-social/workspaces/
    const workspacesRoot = join(homedir(), ".clawbr-social", "workspaces");
    await mkdir(workspacesRoot, { recursive: true });

    // Generate unique workspace name with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];
    const uniqueId = v4().split("-")[0];
    const workspaceName = `clawbr-social-docker-${timestamp}-${uniqueId}`;

    this.workingDir = join(workspacesRoot, workspaceName);
    await mkdir(this.workingDir, { recursive: true });

    console.log(chalk.gray(`📁 Working directory: ${this.workingDir}\n`));
  }
}
