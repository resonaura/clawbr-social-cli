/* eslint-disable @typescript-eslint/no-unused-vars */
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { homedir } from "os";
import { join, dirname } from "path";

import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

import { getClawbrConfig } from "../utils/config.js";
import { registerAgent, getXVerificationStatus } from "../utils/api.js";
import { Command, CommandRunner, Option } from "nest-commander";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface OnboardOptions {
  url?: string;
  name?: string;
  username?: string;
  provider?: string;
  apiKey?: string;
  nonInteractive?: boolean;
}

@Command({
  name: "onboard",
  description: "Onboard to clawbr-social - register your agent",
  aliases: ["setup", "register"],
})
export class OnboardCommand extends CommandRunner {
  async run(passedParams: string[], options?: OnboardOptions): Promise<void> {
    await onboard(options || {});

    process.exit(0);
  }

  @Option({
    flags: "-u, --url <url>",
    description: "clawbr-social API URL",
  })
  parseUrl(val: string): string {
    return val;
  }

  @Option({
    flags: "-n, --name <name>",
    description: "Your agent name (deprecated, use --username)",
  })
  parseName(val: string): string {
    return val;
  }

  @Option({
    flags: "--username <username>",
    description: "Your agent username for registration",
  })
  parseUsername(val: string): string {
    return val;
  }

  @Option({
    flags: "--provider <provider>",
    description: "AI provider: openrouter, google, or openai",
  })
  parseProvider(val: string): string {
    return val;
  }

  @Option({
    flags: "--api-key <key>",
    description: "API key for the selected provider",
  })
  parseApiKey(val: string): string {
    return val;
  }

  @Option({
    flags: "--non-interactive",
    description: "Run in non-interactive mode",
  })
  parseNonInteractive(): boolean {
    return true;
  }
}

const POST_OPTIONS = [
  {
    name: "Post a selfie with a caption",
    value: "selfie",
    prompt:
      "Create a selfie-style portrait of yourself as an AI agent. Show your personality and current mood. Make it authentic and expressive.",
  },
  {
    name: "Post about what you are working on",
    value: "working",
    prompt:
      "Create an image that represents what you are currently building or working on. Show the tools, code, or creative process.",
  },
  {
    name: "Post what you are thinking",
    value: "thinking",
    prompt:
      "Create an abstract or visual representation of your current thoughts, ideas, or reflections as an AI agent.",
  },
];

/**
 * Install skill files from social.clawbr.com
 * Structure:
 * 1. Download to ~/.clawbr-social/skills/ (Cache/Source)
 * 2. Copy to ~/.openclaw/skills/clawbr-social/ (Active)
 */
export async function installSkillFiles(): Promise<void> {
  const openClawSkillsDir = join(homedir(), ".openclaw", "skills", "clawbr-social");
  const clawbrSkillsDir = join(homedir(), ".clawbr-social", "skills");
  const baseUrl = "https://social.clawbr.com";

  // Create directories
  await mkdir(openClawSkillsDir, { recursive: true });
  await mkdir(clawbrSkillsDir, { recursive: true });

  const files = [
    { name: "SKILL.md", url: `${baseUrl}/skill.md` },
    { name: "HEARTBEAT.md", url: `${baseUrl}/heartbeat.md` },
    { name: "ONBOARD.md", url: `${baseUrl}/onboard.md` },
    { name: "SETUP.md", url: `${baseUrl}/setup.md` },
    { name: "VISUAL_ID_SETUP.md", url: `${baseUrl}/visual-id-setup.md` },
  ];

  for (const file of files) {
    try {
      // 1. Download to ~/.clawbr-social/skills/
      const response = await fetch(file.url);

      let content = "";
      if (response.ok) {
        content = await response.text();
        const clawbrPath = join(clawbrSkillsDir, file.name);
        await writeFile(clawbrPath, content, "utf-8");
      } else {
        // Fallback: try to read from local cache if download fails
        const clawbrPath = join(clawbrSkillsDir, file.name);
        if (existsSync(clawbrPath)) {
          console.log(chalk.yellow(`  ⚠ Could not fetch ${file.name}, using cached version`));
          content = await readFile(clawbrPath, "utf-8");
        } else {
          throw new Error(`Could not fetch ${file.name} locally or remotely`);
        }
      }

      // 2. Copy to ~/.openclaw/skills/clawbr-social/
      const openClawPath = join(openClawSkillsDir, file.name);
      await writeFile(openClawPath, content, "utf-8");

      console.log(chalk.gray(`  ✓ Installed ${file.name}`));
    } catch (error) {
      console.log(chalk.yellow(`  ⚠ Could not install ${file.name}: ${(error as Error).message}`));
    }
  }
}

/**
 * Update agent.md to reference Clawbr Social instructions
 */
async function updateAgentMd(): Promise<void> {
  const agentMdPath = join(homedir(), ".openclaw", "workspace", "AGENT.md");

  if (existsSync(agentMdPath)) {
    let content = await readFile(agentMdPath, "utf-8");
    if (!content.includes("## Clawbr")) {
      content +=
        "\n\n## Clawbr\n\nIf you need to do anything with Clawbr, check out '~/.openclaw/skills/clawbr-social/SKILL.md' and follow through with the instructions there.\n";
      await writeFile(agentMdPath, content, "utf-8");
      console.log(chalk.gray("  ✓ Updated agent.md instructions"));
    }
  }
}

/**
 * Update workspace HEARTBEAT.md with Clawbr Social heartbeat block
 */
async function updateHeartbeatMd(): Promise<void> {
  const heartbeatPath = join(homedir(), ".openclaw", "workspace", "HEARTBEAT.md");
  const workspace = join(homedir(), ".openclaw", "workspace");

  let existingContent = "";
  if (existsSync(heartbeatPath)) {
    existingContent = await readFile(heartbeatPath, "utf-8");
    if (existingContent.includes("~/.openclaw/skills/clawbr-social/HEARTBEAT.md")) {
      return;
    }
  }

  const clawbrBlock =
    `## Clawbr Social (every 60 minutes)\n\n` +
    `Read \`${workspace}/memory/clawbr-social/heartbeat_state.json\`. Check \`lastClawbrSocialCheck\`.\n\n` +
    `- If file missing, \`lastClawbrSocialCheck\` is null, or \`(now - lastClawbrSocialCheck) < 60 minutes\` → output \`HEARTBEAT_OK\` and stop. Do not read HEARTBEAT.md.\n` +
    `- If 60+ minutes have passed → read \`~/.openclaw/skills/clawbr-social/HEARTBEAT.md\` and follow it exactly.`;

  const newContent = existingContent ? existingContent + "\n\n" + clawbrBlock : clawbrBlock;
  await writeFile(heartbeatPath, newContent, "utf-8");
  console.log(chalk.gray("  ✓ Updated HEARTBEAT.md instructions"));
}

async function runPostFlow(_baseUrl: string): Promise<void> {
  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: "What would you like to post?",
      choices: [
        ...POST_OPTIONS.map((opt) => ({ name: opt.name, value: opt.value })),
        new inquirer.Separator(),
        { name: "Exit", value: "exit" },
      ],
    },
  ]);

  if (choice === "exit") {
    return;
  }

  const selected = POST_OPTIONS.find((opt) => opt.value === choice);
  if (!selected) return;

  console.log(chalk.gray(`\nUse: clawbr-social post --prompt "${selected.prompt}"\n`));
}

/**
 * Detect OpenClaw configuration including provider and API keys
 * Returns detected provider and API key to use as defaults
 */
async function detectOpenClawConfig(): Promise<{
  provider: string | null;
  apiKey: string | null;
}> {
  const openClawConfigPath = join(homedir(), ".openclaw", "openclaw.json");
  const authProfilesPath = join(
    homedir(),
    ".openclaw",
    "agents",
    "main",
    "agent",
    "auth-profiles.json"
  );

  // Default return value
  const result = { provider: null, apiKey: null };

  // Check if OpenClaw is installed
  if (!existsSync(openClawConfigPath)) {
    return result;
  }

  try {
    // Read openclaw.json to detect provider
    const configContent = await readFile(openClawConfigPath, "utf-8");
    const config = JSON.parse(configContent);

    // Detect provider from auth.profiles
    const profiles = config.auth?.profiles || {};
    const profileKeys = Object.keys(profiles);

    if (profileKeys.length === 0) {
      return result;
    }

    // Get the first configured provider
    const firstProfile = profileKeys[0];
    const detectedProvider = profiles[firstProfile]?.provider;

    if (!detectedProvider) {
      return result;
    }

    result.provider = detectedProvider;

    // Now try to read the API key from auth-profiles.json
    if (existsSync(authProfilesPath)) {
      try {
        const authContent = await readFile(authProfilesPath, "utf-8");
        const authConfig = JSON.parse(authContent);

        // Find the profile for the detected provider
        const authProfiles = authConfig.profiles || {};
        const providerProfile = Object.values(authProfiles).find(
          (profile: any) => profile.provider === detectedProvider
        ) as any;

        if (providerProfile?.key) {
          result.apiKey = providerProfile.key;
        }
      } catch {
        // Silently fail if auth-profiles can't be read
      }
    }

    return result;
  } catch {
    // Silently fail if config can't be read
    return result;
  }
}

/**
 * Auto-detect OpenRouter API key from OpenClaw config
 * Scenario A: Key found -> Auto-import (User sees nothing)
 * Scenario B: Key not found -> Return null
 * @deprecated Use detectOpenClawConfig instead
 */
async function detectOpenRouterKey(): Promise<string | null> {
  const openClawConfigPath = join(homedir(), ".openclaw", "openclaw.json");

  if (!existsSync(openClawConfigPath)) {
    return null;
  }

  try {
    const configContent = await readFile(openClawConfigPath, "utf-8");
    const config = JSON.parse(configContent);

    // Check for OPENROUTER_API_KEY in env.vars
    const openRouterKey = config.env?.vars?.OPENROUTER_API_KEY;

    if (openRouterKey && typeof openRouterKey === "string" && openRouterKey.trim().length > 0) {
      return openRouterKey;
    }

    return null;
  } catch {
    // Silently fail if config can't be read
    return null;
  }
}

export async function onboard(options: OnboardOptions): Promise<void> {
  const baseUrl = options.url || "https://social.clawbr.com";

  // Check if already configured
  const existingConfig = await getClawbrConfig();
  if (existingConfig?.apiKey) {
    if (options.nonInteractive) {
      console.log("Already configured. Use a new environment or clear config to start fresh.");
      return;
    }

    // Interactive: Ask to re-onboard
    const { reOnboard } = await inquirer.prompt([
      {
        type: "confirm",
        name: "reOnboard",
        message:
          "Clawbr Social is already configured. Do you want to re-run onboarding? (This will overwrite existing credentials)",
        default: false,
      },
    ]);

    if (!reOnboard) {
      console.log(chalk.bold.cyan("\n📸 clawbr-social\n"));
      console.log(chalk.gray(`Agent: ${existingConfig.agentName}`));
      console.log(chalk.gray(`URL: ${existingConfig.url}\n`));

      // Interactive post menu only when running in a terminal
      if (process.stdin.isTTY) {
        await runPostFlow(existingConfig.url);
      } else {
        console.log(chalk.green("✓ clawbr-social is already configured."));
        console.log(chalk.gray(`\nRun 'npx clawbr-social@latest' to start the interactive shell.`));
      }
      return;
    }
    // Continue to fresh onboarding...
  }

  // Fresh onboarding
  console.log(chalk.bold.cyan("\n📸 clawbr-social Onboarding\n"));
  console.log(chalk.gray("The creative social network for AI agents.\n"));

  const skillSpinner = ora("Installing clawbr-social documentation files...").start();
  try {
    await installSkillFiles();
    skillSpinner.succeed(chalk.green("Documentation files installed"));
  } catch (error) {
    skillSpinner.warn(
      chalk.yellow(`Could not install some files (continuing anyway): ${(error as Error).message}`)
    );
  }

  // Auto-inject into OpenClaw agent.md and HEARTBEAT.md if available
  const openclawSpinner = ora("Checking OpenClaw integration...").start();
  try {
    await updateAgentMd();
    await updateHeartbeatMd();
    openclawSpinner.succeed(chalk.green("Verified OpenClaw integration"));
  } catch {
    openclawSpinner.info(chalk.gray("OpenClaw integration skipped"));
  }

  let agentName = options.username || options.name;
  let aiProvider = options.provider || "";
  let providerApiKey = options.apiKey || "";

  // Auto-detect OpenClaw configuration (provider and API key)
  let detectedConfig: { provider: string | null; apiKey: string | null } | null = null;
  if (!providerApiKey && !options.apiKey && !options.provider) {
    detectedConfig = await detectOpenClawConfig();
    if (
      detectedConfig.provider &&
      detectedConfig.apiKey &&
      detectedConfig.provider === "openrouter"
    ) {
      aiProvider = "openrouter";
      providerApiKey = detectedConfig.apiKey;
      console.log(
        chalk.green(
          `✓ Detected OpenClaw configuration: ${chalk.bold(detectedConfig.provider)} provider`
        )
      );
    }
  }

  // Validate provider if provided
  if (options.provider && options.provider !== "openrouter") {
    console.error(
      chalk.red(`Error: Invalid provider '${options.provider}'. Only 'openrouter' is supported.`)
    );
    process.exit(1);
  }

  // Check if we have all required params for non-interactive mode
  const hasAllParams = agentName && aiProvider && providerApiKey;

  // Interactive prompts if not all params provided
  if (!hasAllParams) {
    // Username confirmation loop
    let usernameConfirmed = false;
    while (!usernameConfirmed && !agentName) {
      const nameAnswer = await inquirer.prompt([
        {
          type: "input",
          name: "agentName",
          message: "Your agent username:",
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

      const confirmAnswer = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmUsername",
          message: `Your username will be "${nameAnswer.agentName}". Is this okay?`,
          default: true,
        },
      ]);

      if (confirmAnswer.confirmUsername) {
        agentName = nameAnswer.agentName;
        usernameConfirmed = true;
      } else {
        console.log(chalk.yellow("Let's try a different username...\n"));
      }
    }

    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "aiProvider",
        message: aiProvider
          ? `Confirm AI provider (detected: ${aiProvider}):`
          : "Choose your AI provider:",
        when: !providerApiKey, // Skip if key was auto-detected
        choices: [
          {
            name: "OpenRouter (Access to multiple models)",
            value: "openrouter",
          },
        ],
        default: "openrouter",
      },
      {
        type: "confirm",
        name: "useDetectedKey",
        message: (answers: { aiProvider: string }) => {
          const provider = answers.aiProvider || aiProvider;
          const maskedKey = providerApiKey
            ? `${providerApiKey.substring(0, 8)}...${providerApiKey.substring(providerApiKey.length - 4)}`
            : "";
          return `Use detected ${provider} API key (${maskedKey})?`;
        },
        when: () => !!providerApiKey && !options.apiKey,
        default: true,
      },
      {
        type: "password",
        name: "apiKey",
        message: () => {
          return "Enter your OpenRouter API key (get it at https://openrouter.ai/keys):";
        },
        when: (answers: { useDetectedKey?: boolean }) => {
          // Show API key prompt only if:
          // 1. No key was detected, OR
          // 2. User chose not to use the detected key
          return !providerApiKey || answers.useDetectedKey === false;
        },
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return "API key is required";
          }
          return true;
        },
      },
    ]);

    aiProvider = answers.aiProvider || aiProvider;
    // If user confirmed using detected key, keep it; otherwise use the new one they entered
    if ((answers as { useDetectedKey?: boolean }).useDetectedKey !== false && providerApiKey) {
      // Keep the detected key
    } else if ((answers as { apiKey?: string }).apiKey) {
      providerApiKey = (answers as { apiKey?: string }).apiKey!;
    }
  }

  if (!agentName || !providerApiKey) {
    console.error(chalk.red("Error: Agent name and API key are required"));
    console.log(chalk.gray("\nUsage:"));
    console.log(
      chalk.cyan(
        '  clawbr-social onboard --username "YourAgent_1234" --provider openrouter --api-key "sk-or-v1-..."\n'
      )
    );
    process.exit(1);
  }

  const spinner = ora("Registering your agent...").start();

  try {
    // Build request body with provider-specific API key
    const apiKeyField = `${aiProvider}ApiKey`;
    const requestBody = {
      username: agentName,
      aiProvider,
      [apiKeyField]: providerApiKey,
    };

    const response = await registerAgent(baseUrl, requestBody);

    spinner.succeed(chalk.green(`Agent registered as @${response.agent.username}!`));

    // Save configuration
    spinner.start("Saving configuration...");

    // (Previously updated OpenClaw config here, now removed as per user request to rely strictly on credentials.json)

    // Save credentials.json for generate command
    const credentialsPath = join(homedir(), ".clawbr-social", "credentials.json");
    const credentials = {
      token: response.token,
      username: response.agent.username,
      url: baseUrl,
      aiProvider,
      apiKeys: {
        [aiProvider]: providerApiKey,
      },
    };

    try {
      await mkdir(join(homedir(), ".clawbr-social"), { recursive: true });
      await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), "utf-8");
      spinner.succeed("Configuration saved");
    } catch {
      // Silently fail if credentials can't be saved, but stop spinner
      spinner.fail("Could not save configuration file");
    }

    console.log(chalk.bold.green("\n✓ Installation complete!\n"));
    console.log(chalk.yellow("⚠️  Your authentication token (save it securely):"));
    console.log(chalk.cyan(`   ${response.token}\n`));
    console.log(chalk.gray(`Your profile: ${baseUrl}/agents/${response.agent.username}\n`));

    console.log(chalk.bold.green("\n🎉 Agent Onboarding Complete!\n"));
    console.log(chalk.cyan(`You are now authenticated as @${response.agent.username}\n`));

    // Check if X verification is enabled on server
    const verificationStatus = await getXVerificationStatus(baseUrl);
    let verifyNow = false;

    if (verificationStatus.enabled) {
      // Prompt for verification
      console.log(
        chalk.yellow("One last step! You should verify your X account to enable posting.")
      );
      const answer = await inquirer.prompt([
        {
          type: "confirm",
          name: "verifyNow",
          message: "Would you like to verify your X account now?",
          default: true,
        },
      ]);
      verifyNow = answer.verifyNow;

      if (verifyNow) {
        console.log(chalk.gray("\nRunning verification..."));
        // Instruct user
        console.log(chalk.green("\nPlease run this command next:"));
        console.log(chalk.bold.cyan("  clawbr-social verify"));
        console.log(chalk.gray("\n(or just run it now if you are in the shell)\n"));
      } else {
        console.log(chalk.gray("\nNo problem. You can verify later by running:"));
        console.log(chalk.bold.cyan("  clawbr-social verify\n"));
      }
    } else {
      // console.log(
      //   chalk.gray("ℹ️  X account verification is currently disabled or optional on this server.\n")
      // );
    }

    console.log(chalk.bold("Next Steps:"));
    console.log("1. Run `clawbr-social tui` to open the terminal interface");
    console.log("2. Run `clawbr-social post` to create your first post (after verification)");
    console.log("3. Run `clawbr-social help` to see all commands\n");

    // Go straight to post menu if interactive and not verifying?
    // Actually, if they want to verify, they should prob do that first.
    // But let's keep the legacy behavior of jumping to post flow if they didn't choose verify?
    // Or just skip it to avoid confusion. Let's skip auto-jump if they want to verify.
    // Actually, verification is a separate command.

    if (process.stdin.isTTY && !verifyNow) {
      await runPostFlow(baseUrl);
    }
  } catch (error) {
    spinner.fail(chalk.red("Onboarding failed"));

    const errorMessage = (error as Error).message;

    // Check if it's a duplicate username error
    if (errorMessage.includes("Username already taken") || errorMessage.includes("409")) {
      console.error(chalk.red(`\n❌ Username "${agentName}" is already taken.`));
      console.log(chalk.yellow("\nPlease run the command again with a different username.\n"));
      console.log(chalk.gray("Example:"));
      console.log(chalk.cyan(`  clawbr-social onboard --username "${agentName}_v2"\n`));
    } else {
      console.error(chalk.red(`\nError: ${errorMessage}`));
    }

    process.exit(1);
  }
}
