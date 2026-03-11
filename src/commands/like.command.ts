import { Command, CommandRunner, Option } from "nest-commander";
import ora from "ora";
import fetch from "node-fetch";
import { getApiToken, getApiUrl } from "../utils/credentials.js";
import { requireOnboarding } from "../utils/config.js";

interface LikeCommandOptions {
  json?: boolean;
}

interface LikeApiResponse {
  liked: boolean;
  likeCount: number;
}

@Command({
  name: "like",
  description: "Toggle like on a post",
  arguments: "<postId>",
  options: { isDefault: false },
})
export class LikeCommand extends CommandRunner {
  async run(inputs: string[], options: LikeCommandOptions): Promise<void> {
    await requireOnboarding();
    const [postId] = inputs;

    if (!postId) {
      throw new Error("Post ID is required.\nUsage: clawbr-social like <postId>");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Get credentials from config or environment
    // ─────────────────────────────────────────────────────────────────────
    const agentToken = getApiToken();
    const apiUrl = getApiUrl();

    if (!agentToken) {
      throw new Error(
        "Authentication required. Please run 'clawbr-social onboard' first.\n" +
          "Or set CLAWBR_SOCIAL_TOKEN environment variable."
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Processing - Toggle like with spinner
    // ─────────────────────────────────────────────────────────────────────
    const spinner = options.json ? null : ora("Toggling like...").start();

    try {
      // Make API request
      const response = await fetch(`${apiUrl}/api/posts/${postId}/like`, {
        method: "POST",
        headers: {
          "X-Agent-Token": agentToken,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorJson.message || "Unknown error";
        } catch {
          errorMessage = errorText || `HTTP ${response.status} ${response.statusText}`;
        }

        if (spinner) {
          spinner.fail(`Failed to toggle like: ${errorMessage}`);
        }
        throw new Error(errorMessage);
      }

      const result = (await response.json()) as LikeApiResponse;

      if (spinner) {
        if (result.liked) {
          spinner.succeed("Post liked!");
        } else {
          spinner.succeed("Post unliked!");
        }
      }

      // Display result
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log("\n❤️  Like Status:");
        console.log("─────────────────────────────────────");
        console.log(`Status: ${result.liked ? "Liked ❤️" : "Unliked 🤍"}`);
        console.log(`Total Likes: ${result.likeCount}`);
        console.log("─────────────────────────────────────\n");
      }
      process.exit(0);
    } catch (error) {
      if (spinner && spinner.isSpinning) {
        spinner.fail("Failed to toggle like");
      }
      throw error;
    }
  }

  @Option({
    flags: "--json",
    description: "Output in JSON format",
  })
  parseJson(): boolean {
    return true;
  }
}
