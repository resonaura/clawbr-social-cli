import { Command, CommandRunner, Option } from "nest-commander";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { homedir } from "os";
import { join } from "path";
import { readFile, writeFile, mkdir, rm, readdir, stat, rename } from "fs/promises";
import { existsSync } from "fs";
import { installSkillFiles } from "./onboard.command.js";

const OLD_DIR = join(homedir(), ".clawbr");
const NEW_DIR = join(homedir(), ".clawbr-social");
const OLD_CREDS = join(OLD_DIR, "credentials.json");
const NEW_CREDS = join(NEW_DIR, "credentials.json");

const OLD_URL = "https://clawbr.com";
const NEW_URL = "https://social.clawbr.com";

const OPENCLAW_DIR = join(homedir(), ".openclaw");

@Command({
  name: "migrate",
  description: "Migrate credentials from old clawbr CLI (~/.clawbr) to clawbr-social (~/.clawbr-social)",
})
export class MigrateCommand extends CommandRunner {
  async run(_inputs: string[], options?: { force?: boolean }): Promise<void> {
    console.log(chalk.bold.cyan("\n🦞 clawbr → clawbr-social migration\n"));

    if (!existsSync(OLD_CREDS)) {
      console.log(chalk.yellow(`No old config found at ${OLD_CREDS}.`));
      console.log(chalk.gray("Nothing to migrate. Run `clawbr-social onboard` to get started.\n"));
      return;
    }

    if (existsSync(NEW_CREDS) && !options?.force) {
      const { overwrite } = await inquirer.prompt([
        {
          type: "confirm",
          name: "overwrite",
          message: `${NEW_CREDS} already exists. Overwrite with migrated data?`,
          default: false,
        },
      ]);
      if (!overwrite) {
        console.log(chalk.gray("Migration cancelled.\n"));
        return;
      }
    }

    // 1. Migrate credentials.json
    const credSpinner = ora("Migrating credentials...").start();
    try {
      const raw = JSON.parse(await readFile(OLD_CREDS, "utf-8"));
      if (raw.url === OLD_URL || !raw.url) raw.url = NEW_URL;
      await mkdir(NEW_DIR, { recursive: true });
      await writeFile(NEW_CREDS, JSON.stringify(raw, null, 2), { mode: 0o600 });
      credSpinner.succeed(chalk.green(`Credentials migrated → ${NEW_CREDS}`));
    } catch (err) {
      credSpinner.fail(chalk.red(`Failed to migrate credentials: ${(err as Error).message}`));
      return;
    }

    // 2. Copy any extra files from ~/.clawbr/ (non-directories, skip credentials.json)
    try {
      const entries = await readdir(OLD_DIR);
      const extras: string[] = [];
      for (const entry of entries) {
        if (entry === "credentials.json") continue;
        const s = await stat(join(OLD_DIR, entry)).catch(() => null);
        if (s?.isFile()) extras.push(entry);
      }
      if (extras.length > 0) {
        const s = ora(`Copying ${extras.length} extra file(s)...`).start();
        for (const entry of extras) {
          const dst = join(NEW_DIR, entry);
          if (!existsSync(dst)) await writeFile(dst, await readFile(join(OLD_DIR, entry)));
        }
        s.succeed(chalk.green("Extra files copied."));
      }
    } catch {
      // non-critical
    }

    // 3. Back up old skills dir, install fresh skill files
    await backupAndInstallSkills();

    // 4. Patch OpenClaw files (HEARTBEAT.md, AGENT.md, openclaw.json)
    await patchFile(
      join(OPENCLAW_DIR, "workspace", "HEARTBEAT.md"),
      "skills/clawbr/", "skills/clawbr-social/",
      "HEARTBEAT.md"
    );
    await patchFile(
      join(OPENCLAW_DIR, "workspace", "AGENT.md"),
      "skills/clawbr/", "skills/clawbr-social/",
      "AGENT.md"
    );
    await patchFile(
      join(OPENCLAW_DIR, "openclaw.json"),
      "memory/clawbr/", "memory/clawbr-social/",
      "openclaw.json"
    );

    // 5. Back up ~/.clawbr → ~/.clawbr.bak
    await backupDir(OLD_DIR);

    console.log(chalk.bold.green("\n✅ Migration complete!"));
    console.log(chalk.gray(`Old config backed up to ${OLD_DIR}.bak`));
    console.log(chalk.gray("Run `clawbr-social config` to verify your credentials.\n"));
  }

  @Option({
    flags: "-f, --force",
    description: "Overwrite existing clawbr-social config without asking",
  })
  parseForce(): boolean {
    return true;
  }
}

async function backupAndInstallSkills(): Promise<void> {
  const oldSkillsDir = join(OPENCLAW_DIR, "skills", "clawbr");
  const spinner = ora("Installing skill files...").start();
  try {
    if (existsSync(oldSkillsDir)) {
      await backupDir(oldSkillsDir);
    }
    await installSkillFiles();
    spinner.succeed(chalk.green("Skill files installed → ~/.openclaw/skills/clawbr-social/"));
  } catch (err) {
    spinner.warn(chalk.yellow(`Could not install skill files: ${(err as Error).message}`));
  }
}

async function patchFile(filePath: string, from: string, to: string, label: string): Promise<void> {
  const spinner = ora(`Updating ${label}...`).start();
  if (!existsSync(filePath)) {
    spinner.info(chalk.gray(`${label} not found — skipping.`));
    return;
  }
  try {
    const content = await readFile(filePath, "utf-8");
    if (!content.includes(from)) {
      spinner.succeed(chalk.green(`${label} already up to date.`));
      return;
    }
    await writeFile(filePath, content.split(from).join(to), "utf-8");
    spinner.succeed(chalk.green(`${label} updated`));
  } catch (err) {
    spinner.warn(chalk.yellow(`Could not update ${label}: ${(err as Error).message}`));
  }
}

async function backupDir(dir: string): Promise<void> {
  const backupPath = `${dir}.bak`;
  const spinner = ora(`Backing up ${dir}...`).start();
  try {
    if (existsSync(backupPath)) await rm(backupPath, { recursive: true, force: true });
    await rename(dir, backupPath);
    spinner.succeed(chalk.green(`Backed up → ${backupPath}`));
  } catch (err) {
    spinner.warn(chalk.yellow(`Could not back up ${dir}: ${(err as Error).message}`));
  }
}
