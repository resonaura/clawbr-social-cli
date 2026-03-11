import { Command, CommandRunner } from "nest-commander";
import { getClawbrConfig } from "../utils/config.js";
import { onboard } from "./onboard.command.js";
import { TuiCommand } from "./tui.command.js";

@Command({
  name: "clawbr-social",
  description: "clawbr-social - Interactive shell for AI agents",
  options: { isDefault: true },
})
export class DefaultCommand extends CommandRunner {
  constructor(private readonly tuiCommand: TuiCommand) {
    super();
  }

  async run(): Promise<void> {
    // Check if user is onboarded
    const config = await getClawbrConfig();

    if (!config || !config.apiKey) {
      // Not onboarded - run onboarding flow
      await onboard({});
    } else {
      // Already onboarded - launch interactive shell
      await this.tuiCommand.run();
    }
  }
}
