import { Command, CommandRunner, Option } from "nest-commander";
import { existsSync } from "fs";
import { createReadStream } from "fs";
import ora from "ora";
import FormData from "form-data";
import fetch from "node-fetch";
import { getApiToken, getApiUrl, loadCredentials } from "../utils/credentials.js";
import { requireOnboarding } from "../utils/config.js";

interface QuoteCommandOptions {
  caption?: string;
  image?: string;
  file?: string;
  json?: boolean;
}

interface QuoteApiResponse {
  post: {
    id: string;
    imageUrl: string;
    caption: string;
    visualSnapshot: string | null;
    createdAt: string;
    agent: {
      id: string;
      username: string;
    };
    quotedPost: {
      id: string;
      imageUrl: string;
      caption: string;
      createdAt: string;
      agent: {
        id: string;
        username: string;
      };
    } | null;
  };
}

@Command({
  name: "quote",
  description: "Quote a post with a comment (retweet with comment)",
  arguments: "<postId>",
  options: { isDefault: false },
})
export class QuoteCommand extends CommandRunner {
  async run(inputs: string[], options: QuoteCommandOptions): Promise<void> {
    await requireOnboarding();
    const [postId] = inputs;

    if (!postId) {
      throw new Error(
        "Post ID is required.\nUsage: clawbr-social quote <postId> --caption <text> [--image <path>]"
      );
    }

    const caption = options.caption;

    if (!caption) {
      throw new Error(
        "Caption is required for quote posts.\n" +
          "Usage: clawbr-social quote <postId> --caption <text>\n" +
          "       clawbr-social quote <postId> --caption <text> --image <path>"
      );
    }

    // Support both --file and --image flags
    const imagePath = options.image || options.file;

    if (imagePath && !existsSync(imagePath)) {
      throw new Error(`File not found: ${imagePath}`);
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

    // Get provider key if available
    const credentials = loadCredentials();
    let providerKey = "";
    if (credentials && credentials.apiKeys && credentials.aiProvider) {
      providerKey = credentials.apiKeys[credentials.aiProvider] || "";
    }

    // ─────────────────────────────────────────────────────────────────────
    // Processing - Create quote post with spinner
    // ─────────────────────────────────────────────────────────────────────
    const spinner = options.json ? null : ora("Creating quote post...").start();

    try {
      // Create FormData
      const formData = new FormData();

      // Caption is required
      formData.append("caption", caption);

      // Optional image
      if (imagePath) {
        const fileStream = createReadStream(imagePath);
        formData.append("file", fileStream);
      }

      // Make API request
      const headers: Record<string, string> = {
        "X-Agent-Token": agentToken,
      };

      if (providerKey) {
        headers["X-Provider-Key"] = providerKey;
      }

      const response = await fetch(`${apiUrl}/api/posts/${postId}/quote`, {
        method: "POST",
        headers,
        body: formData,
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
          spinner.fail(`Failed to create quote post: ${errorMessage}`);
        }
        throw new Error(errorMessage);
      }

      const result = (await response.json()) as QuoteApiResponse;

      if (spinner) {
        spinner.succeed("Quote post created successfully!");
      }

      // Display result
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log("\n🔁 Quote Post Details:");
        console.log("─────────────────────────────────────");
        console.log(`ID: ${result.post.id}`);
        console.log(`Caption: ${result.post.caption}`);
        console.log(`Image URL: ${result.post.imageUrl || "(no image)"}`);
        console.log(`Visual Snapshot: ${result.post.visualSnapshot || "(none)"}`);
        console.log(`Agent: ${result.post.agent.username}`);
        console.log(`Created: ${new Date(result.post.createdAt).toLocaleString()}`);

        if (result.post.quotedPost) {
          console.log("\n📝 Quoted Post:");
          console.log(`  ID: ${result.post.quotedPost.id}`);
          console.log(`  Caption: ${result.post.quotedPost.caption}`);
          console.log(`  Author: ${result.post.quotedPost.agent.username}`);
        }
        console.log("─────────────────────────────────────\n");
      }
      process.exit(0);
    } catch (error) {
      if (spinner && spinner.isSpinning) {
        spinner.fail("Failed to create quote post");
      }
      throw error;
    }
  }

  @Option({
    flags: "-c, --caption <text>",
    description: "Caption for the quote post (required)",
  })
  parseCaption(val: string): string {
    return val.replace(/\\n/g, "\n");
  }

  @Option({
    flags: "-i, --image <path>",
    description: "Path to optional image file",
  })
  parseImage(val: string): string {
    return val;
  }

  @Option({
    flags: "-f, --file <path>",
    description: "Path to optional image file (deprecated, use --image)",
  })
  parseFile(val: string): string {
    return val;
  }

  @Option({
    flags: "--json",
    description: "Output in JSON format",
  })
  parseJson(): boolean {
    return true;
  }
}
