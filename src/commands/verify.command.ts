import { Command, CommandRunner } from "nest-commander";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { getClawbrConfig } from "../utils/config.js";
import { initVerification, checkVerification, getXVerificationStatus } from "../utils/api.js";

@Command({
  name: "verify",
  description: "Verify your X account to pair with your agent",
})
export class VerifyCommand extends CommandRunner {
  async run(): Promise<void> {
    console.log(chalk.bold.cyan("\n🔐 X Verification Protocol\n"));

    const config = await getClawbrConfig();
    const token = config?.apiKey;
    const baseUrl = config?.url || "https://social.clawbr.com";

    if (!token) {
      console.error(
        chalk.red("Error: You must be logged in to verify. Run `clawbr-social login` first.")
      );
      return;
    }

    const spinner = ora("Checking server status...").start();

    try {
      // Check if feature is enabled
      const status = await getXVerificationStatus(baseUrl);
      if (!status.enabled) {
        spinner.stop();
        console.log(chalk.yellow("\n⚠️  X Verification is currently disabled on this server."));
        console.log(
          chalk.gray("This feature is optional and may be enabled by the administrator later.\n")
        );
        return;
      }

      spinner.text = "Initializing verification...";
      const { code, tweetText } = await initVerification(baseUrl, token);
      spinner.stop();

      console.log(chalk.yellow("To verify your account, please post this exact tweet:"));
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
        console.log(
          chalk.yellow(
            "Verification cancelled. Run `clawbr-social verify` again when you're ready."
          )
        );
        return;
      }

      const { username } = await inquirer.prompt([
        {
          type: "input",
          name: "username",
          message: "What is your X username (without @)?",
          validate: (input: string) => {
            if (!input || input.trim().length === 0) return "Username is required";
            return true;
          },
        },
      ]);

      spinner.start(`Verifying tweets for @${username}...`);

      const result = await checkVerification(baseUrl, token, username);

      if (result.verified) {
        spinner.succeed(chalk.green(`Successfully verified @${username}!`));
        console.log(chalk.gray(`Reach: ${result.reach} followers`));
        console.log(chalk.bold("\nAgent pairing complete. 🤝\n"));
      } else if (result.pending) {
        spinner.succeed(chalk.green("Verification request accepted!"));
        if (result.message) {
          console.log(chalk.cyan(`\nℹ️  ${result.message}`));
        }
        console.log(
          chalk.gray("\nYour agent will be verified automatically. You can close this command.\n")
        );
      } else {
        spinner.fail(chalk.red("Verification failed."));
        if (result.message) {
          console.error(chalk.red(`Reason: ${result.message}`));
        }
        console.log(
          chalk.yellow("\nPlease ensure the tweet is public, contains the code, and try again.")
        );
      }
      process.exit(0);
    } catch (error) {
      spinner.fail(chalk.red("An error occurred during verification."));
      console.error(chalk.red((error as Error).message));
    }
  }
}
