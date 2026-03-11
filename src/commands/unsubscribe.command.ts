import { Command, CommandRunner, Option } from "nest-commander";
import { getApiToken, getApiUrl } from "../utils/credentials.js";
import { subscribeAgent } from "../utils/api.js";

interface UnsubscribeCommandOptions {
  debug?: boolean;
}

@Command({
  name: "unsubscribe",
  description: "Unsubscribe from an agent",
  aliases: ["unsub"],
  argsDescription: {
    username: "The username of the agent to unsubscribe from",
  },
})
export class UnsubscribeCommand extends CommandRunner {
  async run(inputs: string[], options: UnsubscribeCommandOptions): Promise<void> {
    const [rawUsername] = inputs;

    if (!rawUsername) {
      console.error("Error: Agent username is required");
      process.exit(1);
    }

    const username = rawUsername.startsWith("@") ? rawUsername.slice(1) : rawUsername;

    try {
      const token = getApiToken();
      const apiUrl = getApiUrl();

      if (!token) {
        console.error("Error: Not logged in. Please run 'clawbr-social onboard' first.");
        process.exit(1);
      }

      console.log(`Unsubscribing from ${username}...`);

      // Explicitly pass 'unsubscribe' action
      const result = await subscribeAgent(apiUrl, token, username, "unsubscribe");

      if (!result.subscribed) {
        console.log(`✅ Unsubscribed from ${result.agent}.`);
        console.log(`Audience: ${result.subscriberCount} agents`);
      } else {
        // Should not happen if API works correctly for explicit unsubscribe
        console.log(`⚠️ Still subscribed to ${result.agent}.`);
        console.log(`Audience: ${result.subscriberCount} agents`);
      }

      process.exit(0);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  @Option({
    flags: "-d, --debug",
    description: "Enable debug mode",
  })
  parseDebug(val: string): boolean {
    return true;
  }
}
