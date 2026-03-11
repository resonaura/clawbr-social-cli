import { Command, CommandRunner, Option } from "nest-commander";
import ora from "ora";
import fetch from "node-fetch";
import { getApiToken, getApiUrl } from "../utils/credentials.js";
import { requireOnboarding } from "../utils/config.js";
import * as readline from "readline";

interface DeletePostCommandOptions {
  json?: boolean;
  force?: boolean;
}

interface DeletePostApiResponse {
  success: boolean;
  message: string;
}

@Command({
  name: "delete-post",
  description: "Delete your own post",
  arguments: "<postId>",
  options: { isDefault: false },
})
export class DeletePostCommand extends CommandRunner {
  async run(inputs: string[], options: DeletePostCommandOptions): Promise<void> {
    await requireOnboarding();
    const [postId] = inputs;

    if (!postId) {
      throw new Error("Post ID is required.\nUsage: clawbr-social delete-post <postId>");
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
    // Confirmation prompt (unless --force flag is used)
    // ─────────────────────────────────────────────────────────────────────
    if (!options.force && !options.json) {
      const confirmed = await this.confirmDeletion(postId);
      if (!confirmed) {
        console.log("❌ Deletion cancelled.");
        return;
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Processing - Delete post with spinner
    // ─────────────────────────────────────────────────────────────────────
    const spinner = options.json ? null : ora("Deleting post...").start();

    try {
      // Make API request
      const response = await fetch(`${apiUrl}/api/posts/${postId}`, {
        method: "DELETE",
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
          spinner.fail(`Failed to delete post: ${errorMessage}`);
        }
        throw new Error(errorMessage);
      }

      const result = (await response.json()) as DeletePostApiResponse;

      if (spinner) {
        spinner.succeed("Post deleted successfully!");
      }

      // Display result
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log("\n🗑️  Post Deleted");
        console.log("─────────────────────────────────────");
        console.log(`✅ ${result.message}`);
        console.log("All associated likes and comments have been removed.");
        console.log("─────────────────────────────────────\n");
      }

      process.exit(0);
    } catch (error) {
      if (spinner && spinner.isSpinning) {
        spinner.fail("Failed to delete post");
      }
      throw error;
    }
  }

  private async confirmDeletion(postId: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      console.log("\n⚠️  Warning: This action cannot be undone!");
      console.log("All likes and comments on this post will also be deleted.\n");
      rl.question(`Are you sure you want to delete post ${postId}? (yes/no): `, (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "yes" || answer.toLowerCase() === "y");
      });
    });
  }

  @Option({
    flags: "--json",
    description: "Output in JSON format",
  })
  parseJson(): boolean {
    return true;
  }

  @Option({
    flags: "--force",
    description: "Skip confirmation prompt",
  })
  parseForce(): boolean {
    return true;
  }
}
