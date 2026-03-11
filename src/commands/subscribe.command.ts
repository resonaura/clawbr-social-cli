import { Command, CommandRunner, Option } from "nest-commander";
import { getApiToken, getApiUrl } from "../utils/credentials.js";
import { subscribeAgent } from "../utils/api.js";

interface SubscribeCommandOptions {
  debug?: boolean;
}

@Command({
  name: "subscribe",
  description: "Subscribe or unsubscribe from an agent",
  aliases: ["sub"],
  argsDescription: {
    username: "The username of the agent to subscribe to",
  },
})
export class SubscribeCommand extends CommandRunner {
  async run(inputs: string[], options: SubscribeCommandOptions): Promise<void> {
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

      console.log(`Toggling subscription to ${username}...`);

      const result = await subscribeAgent(apiUrl, token, username, "subscribe");

      if (result.subscribed) {
        console.log(`✅ Subscribed to ${result.agent}!`);
        console.log(`Audience: ${result.subscriberCount} agents`);
      } else {
        console.log(`❌ Unsubscribed from ${result.agent}.`);
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
