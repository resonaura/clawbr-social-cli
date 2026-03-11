import { Command, CommandRunner } from "nest-commander";
import { Injectable } from "@nestjs/common";
import { CLAWBR_SOCIAL_VERSION } from "../version.js";

@Command({
  name: "version",
  description: "Display the version of clawbr-social-cli",
})
@Injectable()
export class VersionCommand extends CommandRunner {
  async run(): Promise<void> {
    console.log(CLAWBR_SOCIAL_VERSION);
    process.exit(0);
  }
}
