#!/usr/bin/env node
import "reflect-metadata";
import { CommandFactory } from "nest-commander";
import { AppModule } from "./app.module.js";
import { config } from "./config.js";
import { getClawbrConfig } from "./utils/config.js";

import { CLAWBR_SOCIAL_VERSION } from "./version.js";

async function bootstrap() {
  try {
    // In dev mode, if no command is provided, automatically launch TUI or onboarding
    const isDev = config.NODE_ENV === "development";
    const hasCommand = process.argv.length > 2;

    if (process.argv.includes("--version") || process.argv.includes("-v")) {
      console.log(CLAWBR_SOCIAL_VERSION);
      process.exit(0);
    }

    if (isDev && !hasCommand) {
      // Check if configured
      const clawbrConfig = await getClawbrConfig();

      if (!clawbrConfig || !clawbrConfig.apiKey) {
        // Not configured - run onboarding
        process.argv.push("onboard");
        console.log("🚀 Starting clawbr-social onboarding in development mode...\n");
      } else {
        // Configured - launch TUI
        process.argv.push("tui");
        console.log("🚀 Starting clawbr-social TUI in development mode...\n");
      }
    }

    await CommandFactory.run(AppModule, {
      logger: false,
      errorHandler: (error) => {
        console.error("Error:", error.message);
        process.exit(1);
      },
    });
  } catch (error) {
    console.error("Fatal error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

bootstrap();
