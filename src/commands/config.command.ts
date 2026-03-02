import { Command, CommandRunner } from "nest-commander";
import { parsedConfig } from "../config.js";
import { getClawbrConfig } from "../utils/config.js";
import chalk from "chalk";
import { existsSync } from "fs";

@Command({
  name: "config",
  description: "Show configuration paths and settings",
})
export class ConfigCommand extends CommandRunner {
  async run(): Promise<void> {
    console.log(chalk.bold.cyan("\n📁 Clawbr CLI Configuration\n"));

    // Config directory
    const configDirExists = existsSync(parsedConfig.paths.configDir);
    console.log(chalk.bold("Config Directory:"));
    console.log(
      `  ${parsedConfig.paths.configDir} ${
        configDirExists ? chalk.green("✓") : chalk.red("✗ (not found)")
      }`
    );

    // Credentials file
    const credentialsPath = parsedConfig.paths.credentialsPath;
    const credentialsExists = existsSync(credentialsPath);
    console.log(chalk.bold("\nCredentials File:"));
    console.log(
      `  ${credentialsPath} ${credentialsExists ? chalk.green("✓") : chalk.red("✗ (not found)")}`
    );

    // Skills directory
    const skillsDirExists = existsSync(parsedConfig.paths.skillsDir);
    console.log(chalk.bold("\nSkills Directory:"));
    console.log(
      `  ${parsedConfig.paths.skillsDir} ${
        skillsDirExists ? chalk.green("✓") : chalk.red("✗ (not found)")
      }`
    );

    // Load effective configuration
    const effectiveConfig = await getClawbrConfig();
    const source = effectiveConfig ? "credentials.json" : "none";

    console.log(chalk.bold("\nConfiguration Source:"));
    if (!effectiveConfig) {
      console.log(chalk.red("  No active configuration found"));
    } else {
      console.log(chalk.green(`  Active: ${source}`));
    }

    // API settings
    console.log(chalk.bold("\nAPI Settings:"));
    console.log(`  Base URL: ${effectiveConfig?.url || parsedConfig.api.baseUrl}`);

    const hasToken = !!effectiveConfig?.apiKey || !!parsedConfig.api.token;
    console.log(`  Token: ${hasToken ? chalk.green("✓ configured") : chalk.yellow("⚠ not set")}`);
    console.log(`  Timeout: ${parsedConfig.api.timeout}ms`);

    // Environment (Internal)
    console.log(chalk.bold("\nEnvironment:"));
    console.log(
      `  Mode: ${
        parsedConfig.isDevelopment ? chalk.yellow("development") : chalk.green("production")
      }`
    );

    // AI Providers
    console.log(chalk.bold("\nAI Providers:"));

    if (effectiveConfig && effectiveConfig.generation) {
      console.log(`  Active Provider: ${chalk.green(effectiveConfig.generation.provider)}`);
      console.log(`  API Key: ${chalk.green("✓ configured")}`);
    } else {
      console.log(
        `  OpenRouter: ${
          parsedConfig.providers.openrouter
            ? chalk.green("✓ configured (env)")
            : chalk.gray("not set (env)")
        }`
      );
    }

    if (effectiveConfig) {
      console.log(chalk.gray(`  (Additional keys may be stored in credentials.json)`));
    }

    console.log(); // Empty line at the end

    process.exit(0);
  }
}
