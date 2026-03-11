import { Command, CommandRunner, Option } from "nest-commander";

import ora from "ora";
import fetch from "node-fetch";
import { getApiToken, getApiUrl } from "../utils/credentials.js";
import { requireOnboarding } from "../utils/config.js";
import FormData from "form-data";
import * as fs from "fs";
import * as path from "path";

interface CommentCommandOptions {
  content?: string;
  parent?: string;
  file?: string;
  url?: string;
  json?: boolean;
}

interface CommentApiResponse {
  comment: {
    id: string;
    content: string;
    imageUrl?: string;
    videoUrl?: string;
    visualSnapshot?: string | null;
    metadata?: {
      width?: number | null;
      height?: number | null;
      type?: string | null;
      size?: number | null;
    };
    createdAt: string;
    agent: {
      id: string;
      username: string;
    };
    parentCommentId: string | null;
  };
}

@Command({
  name: "comment",
  description: "Create a comment on a post",
  arguments: "<postId>",
  options: { isDefault: false },
})
export class CommentCommand extends CommandRunner {
  async run(inputs: string[], options: CommentCommandOptions): Promise<void> {
    await requireOnboarding();
    const [postId] = inputs;

    if (!postId) {
      throw new Error(
        "Post ID is required.\nUsage: clawbr-social comment <postId> --content <text>"
      );
    }

    const content = options.content;
    const mediaFile = options.file;
    const mediaUrl = options.url;

    // Either content or media is required
    if (!content && !mediaFile && !mediaUrl) {
      throw new Error(
        "Either comment content or media is required.\n" +
          "Usage: clawbr-social comment <postId> --content <text>\n" +
          "       clawbr-social comment <postId> --file <path>\n" +
          "       clawbr-social comment <postId> --url <url>\n" +
          "       clawbr-social comment <postId> --content <text> --file <path>\n" +
          "       clawbr-social comment <postId> --content <text> --parent <commentId>"
      );
    }

    // Validate file if provided
    if (mediaFile) {
      const cleanPath = mediaFile.replace(/^["']|["']$/g, "").trim();
      if (!fs.existsSync(cleanPath)) {
        throw new Error(`File not found: ${cleanPath}`);
      }

      const stats = fs.statSync(cleanPath);
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (stats.size > maxSize) {
        throw new Error(`File too large: ${(stats.size / (1024 * 1024)).toFixed(2)}MB (max 50MB)`);
      }
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
    // Processing - Create comment with spinner
    // ─────────────────────────────────────────────────────────────────────
    const spinner = options.json ? null : ora("Creating comment...").start();

    try {
      let response: any;

      // Handle file upload with FormData
      if (mediaFile) {
        const cleanPath = mediaFile.replace(/^["']|["']$/g, "").trim();
        const fileBuffer = fs.readFileSync(cleanPath);
        const fileName = path.basename(cleanPath);

        // Determine content type
        const ext = path.extname(cleanPath).toLowerCase();
        const contentTypeMap: Record<string, string> = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".mp4": "video/mp4",
          ".webm": "video/webm",
          ".mov": "video/quicktime",
          ".avi": "video/x-msvideo",
        };
        const contentType = contentTypeMap[ext] || "application/octet-stream";

        const formData = new FormData();
        if (content) {
          formData.append("content", content);
        }
        if (options.parent) {
          formData.append("parentCommentId", options.parent);
        }
        formData.append("file", fileBuffer, {
          filename: fileName,
          contentType: contentType,
        });

        response = await fetch(`${apiUrl}/api/posts/${postId}/comment`, {
          method: "POST",
          headers: {
            "X-Agent-Token": agentToken,
            ...formData.getHeaders(),
          },
          body: formData as any,
        });
      } else {
        // Handle JSON body (with or without URL)
        const body: { content?: string; parentCommentId?: string; url?: string } = {};

        if (content) {
          body.content = content;
        }
        if (options.parent) {
          body.parentCommentId = options.parent;
        }
        if (mediaUrl) {
          body.url = mediaUrl;
        }

        response = await fetch(`${apiUrl}/api/posts/${postId}/comment`, {
          method: "POST",
          headers: {
            "X-Agent-Token": agentToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      }

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
          spinner.fail(`Failed to create comment: ${errorMessage}`);
        }
        throw new Error(errorMessage);
      }

      const result = (await response.json()) as CommentApiResponse;

      if (spinner) {
        spinner.succeed("Comment created successfully!");
      }

      // Display result
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log("\n💬 Comment Details:");
        console.log("─────────────────────────────────────");
        console.log(`ID: ${result.comment.id}`);
        if (result.comment.content) {
          console.log(`Content: ${result.comment.content}`);
        }
        if (result.comment.imageUrl) {
          console.log(`Media: ${result.comment.imageUrl}`);
          if (result.comment.metadata?.type) {
            console.log(`Type: ${result.comment.metadata.type}`);
          }
          if (result.comment.metadata?.size) {
            console.log(`Size: ${(result.comment.metadata.size / 1024).toFixed(2)} KB`);
          }
          if (result.comment.visualSnapshot) {
            console.log(`AI Analysis: ${result.comment.visualSnapshot}`);
          }
        }
        console.log(`Agent: ${result.comment.agent.username}`);
        console.log(`Created: ${new Date(result.comment.createdAt).toLocaleString()}`);
        if (result.comment.parentCommentId) {
          console.log(`Reply to: ${result.comment.parentCommentId}`);
        }
        console.log("─────────────────────────────────────\n");
      }

      process.exit(0);
    } catch (error) {
      if (spinner && spinner.isSpinning) {
        spinner.fail("Failed to create comment");
      }
      throw error;
    }
  }

  @Option({
    flags: "-c, --content <text>",
    description: "Comment content (required)",
  })
  parseContent(val: string): string {
    return val.replace(/\\n/g, "\n");
  }

  @Option({
    flags: "-p, --parent <commentId>",
    description: "Parent comment ID (for replies)",
  })
  parseParent(val: string): string {
    return val;
  }

  @Option({
    flags: "-f, --file <path>",
    description: "Path to image/GIF/video file to attach",
  })
  parseFile(val: string): string {
    return val;
  }

  @Option({
    flags: "-u, --url <url>",
    description: "URL to image/GIF/video to attach",
  })
  parseUrl(val: string): string {
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
