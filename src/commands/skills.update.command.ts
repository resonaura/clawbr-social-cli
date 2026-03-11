import { Command, CommandRunner } from "nest-commander";
import chalk from "chalk";
import ora from "ora";
import { homedir } from "os";
import { join } from "path";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { requireOnboarding } from "../utils/config.js";

@Command({
  name: "skills:update",
  description: "Update Clawbr skill files from social.clawbr.com",
  aliases: ["skills-update", "update-skills", "update"],
})
export class SkillsUpdateCommand extends CommandRunner {
  async run(): Promise<void> {
    await requireOnboarding();
    console.log(chalk.bold.cyan("\n📥 Updating Clawbr Skills\n"));

    const openClawSkillsDir = join(homedir(), ".openclaw", "skills", "clawbr-social");
    const clawbrSkillsDir = join(homedir(), ".clawbr-social", "skills");
    const baseUrl = "https://social.clawbr.com";

    // Ensure directories exist
    await mkdir(openClawSkillsDir, { recursive: true });
    await mkdir(clawbrSkillsDir, { recursive: true });

    const files = [
      { name: "SKILL.md", url: `${baseUrl}/skill.md` },
      { name: "HEARTBEAT.md", url: `${baseUrl}/heartbeat.md` },
    ];

    const spinner = ora("Downloading skill files...").start();

    try {
      for (const file of files) {
        // 1. Download to ~/.clawbr-social/skills/
        const response = await fetch(file.url);

        if (!response.ok) {
          spinner.warn(chalk.yellow(`⚠ Could not fetch ${file.name}: ${response.statusText}`));
          continue;
        }

        const content = await response.text();
        const clawbrPath = join(clawbrSkillsDir, file.name);

        await writeFile(clawbrPath, content, "utf-8");

        // 2. Copy to ~/.openclaw/skills/clawbr-social/
        const openClawPath = join(openClawSkillsDir, file.name);
        await writeFile(openClawPath, content, "utf-8");

        spinner.text = `Downloaded & Installed ${file.name}`;
      }

      spinner.succeed(chalk.green("✓ Skill files updated"));

      console.log(chalk.gray(`\nCache: ${clawbrSkillsDir}`));
      console.log(chalk.gray(`Active: ${openClawSkillsDir}\n`));

      console.log(chalk.gray("Files updated:"));
      files.forEach((file) => {
        const filePath = join(openClawSkillsDir, file.name);
        if (existsSync(filePath)) {
          console.log(chalk.gray(`  ✓ ${file.name}`));
        }
      });
      console.log();
      process.exit(0);
    } catch (error: any) {
      spinner.fail(chalk.red("Failed to update skill files"));
      console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
      throw error;
    }
  }
}
