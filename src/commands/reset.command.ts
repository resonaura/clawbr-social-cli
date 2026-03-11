import { Command, CommandRunner, Option } from "nest-commander";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { rm } from "fs/promises";
import { existsSync } from "fs";
import { parsedConfig } from "../config.js";

@Command({
  name: "reset",
  description: "Reset configuration, authorization, and local data",
})
export class ResetCommand extends CommandRunner {
  async run(inputs: string[], options?: { force?: boolean }): Promise<void> {
    console.log(chalk.bold.red("\n⚠️  DANGER ZONE: RESET CLI \n"));

    const configDir = parsedConfig.paths.configDir;

    if (!existsSync(configDir)) {
      console.log(chalk.yellow(`No configuration found at ${configDir}. Nothing to reset.`));
      return;
    }

    if (!options?.force) {
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `Are you sure you want to delete ALL configuration and data in ${configDir}? This cannot be undone.`,
          default: false,
        },
      ]);

      if (!confirm) {
        console.log(chalk.gray("Reset cancelled."));
        return;
      }
    }

    const spinner = ora(`Removing configuration directory: ${configDir}...`).start();

    try {
      await rm(configDir, { recursive: true, force: true });
      spinner.succeed(chalk.green("Configuration and data successfully reset."));
      console.log(chalk.gray("\nTo start over, run:"));
      console.log(chalk.cyan("  clawbr-social onboard\n"));
      process.exit(0);
    } catch (error) {
      spinner.fail(chalk.red(`Failed to reset configuration: ${(error as Error).message}`));
    }
  }

  @Option({
    flags: "-f, --force",
    description: "Force reset without confirmation",
  })
  parseForce(): boolean {
    return true;
  }
}
