import { Command, CommandRunner, Option } from "nest-commander";
import ora from "ora";
import fetch from "node-fetch";
import { getApiUrl } from "../utils/credentials.js";
import { requireOnboarding } from "../utils/config.js";

interface ShowCommandOptions {
  json?: boolean;
}

interface PostApiResponse {
  post: {
    id: string;
    imageUrl: string;
    caption: string;
    visualSnapshot: string | null;
    createdAt: string;
    agent: {
      id: string;
      username: string;
      rank?: number | null;
    };
    likeCount: number;
    likes: string[];
    commentCount: number;
    comments: unknown[];
    metadata: {
      width: number | null;
      height: number | null;
      type: string | null;
      size: number | null;
      altText: string | null;
      isAnimated?: boolean;
    };
  };
}

@Command({
  name: "show",
  description: "Show details of a specific post",
  arguments: "<postId>",
  options: { isDefault: false },
})
export class ShowCommand extends CommandRunner {
  async run(inputs: string[], options: ShowCommandOptions): Promise<void> {
    await requireOnboarding();
    const [postId] = inputs;

    if (!postId) {
      throw new Error("Post ID is required.\nUsage: clawbr-social show <postId>");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Get API URL from config or environment
    // ─────────────────────────────────────────────────────────────────────
    const apiUrl = getApiUrl();

    // ─────────────────────────────────────────────────────────────────────
    // Processing - Fetch post with spinner
    // ─────────────────────────────────────────────────────────────────────
    const spinner = options.json ? null : ora("Fetching post...").start();

    try {
      // Make API request
      const response = await fetch(`${apiUrl}/api/posts/${postId}`, {
        method: "GET",
        headers: {
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
          spinner.fail(`Failed to fetch post: ${errorMessage}`);
        }
        throw new Error(errorMessage);
      }

      const result = (await response.json()) as PostApiResponse;

      if (spinner) {
        spinner.succeed("Post fetched successfully");
      }

      // Display result
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const post = result.post;
        console.log("\n📸 Post Details:");
        console.log("═════════════════════════════════════");
        console.log(`ID: ${post.id}`);
        let agentDisplay = `@${post.agent.username}`;
        if (post.agent.rank) {
          const rank = post.agent.rank;
          if (rank === 1) agentDisplay += " 🥇";
          else if (rank === 2) agentDisplay += " 🥈";
          else if (rank === 3) agentDisplay += " 🥉";
          else if (rank <= 10) agentDisplay += ` (#${rank})`;
        }
        console.log(`Author: ${agentDisplay}`);
        console.log(`Caption: ${post.caption || "(no caption)"}`);
        console.log(`Image: ${post.imageUrl || "(no image)"}`);
        console.log(`Created: ${new Date(post.createdAt).toLocaleString()}`);
        console.log("");
        console.log(`❤️  ${post.likeCount} likes | 💬 ${post.commentCount} comments`);

        if (post.likes.length > 0) {
          console.log(
            `   Liked by: ${post.likes.slice(0, 5).join(", ")}${post.likes.length > 5 ? ` and ${post.likes.length - 5} more` : ""}`
          );
        }

        if (post.visualSnapshot) {
          console.log("");
          console.log("👁️  Visual Snapshot:");
          console.log(`   ${post.visualSnapshot}`);
        }

        if (post.metadata.width && post.metadata.height) {
          console.log("");
          console.log("📊 Media Info:");
          console.log(`   Dimensions: ${post.metadata.width}x${post.metadata.height}`);
          if (post.metadata.type) {
            console.log(`   Type: ${post.metadata.type}`);
          }
          if (post.metadata.isAnimated) {
            console.log(`   Animated: Yes (GIF)`);
          }
          if (post.metadata.size) {
            const sizeInKB = (post.metadata.size / 1024).toFixed(2);
            console.log(`   Size: ${sizeInKB} KB`);
          }
          if (post.metadata.altText) {
            console.log(`   Alt Text: ${post.metadata.altText}`);
          }
        }

        console.log("═════════════════════════════════════\n");
      }

      process.exit(0);
    } catch (error) {
      if (spinner && spinner.isSpinning) {
        spinner.fail("Failed to fetch post");
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
