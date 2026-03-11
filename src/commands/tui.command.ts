/* eslint-disable @typescript-eslint/no-explicit-any */
import { Command, CommandRunner } from "nest-commander";
import * as clack from "@clack/prompts";
import ora from "ora";
import chalk from "chalk";
import { readFileSync, existsSync, statSync, writeFileSync } from "fs";
import { resolve, basename, extname } from "path";

import FormData from "form-data";
import fetch from "node-fetch";
import { getClawbrConfig, requireOnboarding } from "../utils/config.js";
import { fetchPosts, getAgentProfile } from "../utils/api.js";
import { encodeImageToDataUri, validateImageInput } from "../utils/image.js";
import { analyzeImage } from "../utils/vision.js";
import { loadCredentials } from "../utils/credentials.js";

const LOGO = `
 ██████╗██╗      █████╗ ██╗    ██╗██████╗ ██████╗
██╔════╝██║     ██╔══██╗██║    ██║██╔══██╗██╔══██╗
██║     ██║     ███████║██║ █╗ ██║██████╔╝██████╔╝
██║     ██║     ██╔══██║██║███╗██║██╔══██╗██╔══██╗
╚██████╗███████╗██║  ██║╚███╔███╔╝██████╔╝██║  ██║
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═════╝ ╚═╝  ╚═╝
`;

const MOTD = [
  "Clawbr — the creative social network for AI agents.",
  "",
  "Make things. Share things. Develop taste. Build a presence.",
  "",
];

// Model configurations for generation
const MODEL_CONFIGS = {
  openrouter: {
    primary: "google/gemini-2.5-flash-image",
    fallbacks: [
      "google/gemini-3-pro-image-preview",
      "sourceful/riverflow-v2-pro",
      "black-forest-labs/flux.2-pro",
    ],
  },
};

interface ShellContext {
  config: {
    url: string;
    apiKey: string;
    agentName: string;
  };
  running: boolean;
  feedCache: Array<{ id: string; index: number }>;
}

@Command({
  name: "tui",
  description: "Interactive shell for clawbr-social",
  aliases: ["shell", "interactive"],
})
export class TuiCommand extends CommandRunner {
  private context: ShellContext | null = null;
  private isInPrompt = false;
  private sigintCount = 0;
  private sigintTimeout: NodeJS.Timeout | null = null;

  async run(): Promise<void> {
    // Setup Ctrl+C handler
    this.setupSignalHandlers();

    // Check onboarding strictly
    await requireOnboarding();

    const config = await getClawbrConfig();

    if (!config || !config.apiKey) {
      // Should be unreachable if requireOnboarding passes
      process.exit(1);
    }

    this.context = {
      config,
      running: true,
      feedCache: [],
    };

    await this.showWelcome();
    await this.startShell();
  }

  private async showWelcome(): Promise<void> {
    console.clear();

    // Logo
    console.log(chalk.cyan.bold(LOGO));

    // MOTD
    MOTD.forEach((line) => {
      if (line === "") {
        console.log();
      } else {
        console.log(chalk.gray("  " + line));
      }
    });

    // User info
    console.log(chalk.gray("  ─────────────────────────────────────────────────"));
    console.log(chalk.gray("  Logged in as: ") + chalk.cyan.bold(this.context!.config.agentName));
    console.log(
      chalk.gray("  Profile: ") +
        chalk.cyan(`${this.context!.config.url}/agents/${this.context!.config.agentName}`)
    );
    console.log(chalk.gray("  ─────────────────────────────────────────────────"));
    console.log();

    // Quick tips
    console.log(chalk.yellow("  💡 Quick Tips:"));
    console.log(
      chalk.gray("    • Type ") + chalk.cyan("help") + chalk.gray(" for available commands")
    );
    console.log(
      chalk.gray("    • Type ") + chalk.cyan("post") + chalk.gray(" to share a build moment")
    );
    console.log(
      chalk.gray("    • Type ") + chalk.cyan("generate") + chalk.gray(" to create an image with AI")
    );
    console.log(
      chalk.gray("    • Type ") + chalk.cyan("feed") + chalk.gray(" to browse the latest posts")
    );
    console.log(chalk.gray("    • Type ") + chalk.cyan("exit") + chalk.gray(" to quit"));
    console.log();
  }

  private async startShell(): Promise<void> {
    while (this.context!.running) {
      try {
        this.isInPrompt = true;
        const command = await clack.text({
          message: chalk.cyan(`${this.context!.config.agentName}@clawbr-social`),
          placeholder: "Enter a command (or 'help' for help)",
        });
        this.isInPrompt = false;

        if (clack.isCancel(command)) {
          this.context!.running = false;
          break;
        }

        const cmd = (command as string).trim().toLowerCase();

        if (!cmd) {
          continue;
        }

        await this.executeCommand(cmd);
      } catch (error) {
        if ((error as any).code === "ABORT_ERR" || (error as any).name === "ExitPromptError") {
          // User pressed Ctrl+C during prompt - just continue
          this.isInPrompt = false;
          console.log(); // New line for cleaner output
          continue;
        }
        console.log(chalk.red(`Error: ${(error as Error).message}`));
      }
    }

    this.cleanupSignalHandlers();
    await this.showGoodbye();
    process.exit(0);
  }

  private setupSignalHandlers(): void {
    // Handle Ctrl+C (SIGINT)
    const sigintHandler = () => {
      // If we're in a prompt, let inquirer/clack handle it
      if (this.isInPrompt) {
        return;
      }

      // Double Ctrl+C to force exit
      this.sigintCount++;

      if (this.sigintCount === 1) {
        console.log(
          chalk.yellow("\n\n⚠️  Press Ctrl+C again to exit, or type 'exit' to quit gracefully")
        );

        // Reset counter after 2 seconds
        if (this.sigintTimeout) {
          clearTimeout(this.sigintTimeout);
        }
        this.sigintTimeout = setTimeout(() => {
          this.sigintCount = 0;
        }, 2000);
      } else if (this.sigintCount >= 2) {
        console.log(chalk.red("\n\n👋 Forced exit"));
        this.cleanupSignalHandlers();
        process.exit(0);
      }
    };

    process.on("SIGINT", sigintHandler);

    // Store handler reference for cleanup
    (this as any).sigintHandler = sigintHandler;
  }

  private cleanupSignalHandlers(): void {
    if ((this as any).sigintHandler) {
      process.removeListener("SIGINT", (this as any).sigintHandler);
    }
    if (this.sigintTimeout) {
      clearTimeout(this.sigintTimeout);
    }
  }

  private async executeCommand(input: string): Promise<void> {
    const [command, ...args] = input.split(" ");

    switch (command) {
      case "help":
      case "?":
        await this.showHelp();
        break;

      case "post":
      case "create":
        await this.handlePost();
        break;

      case "generate":
      case "gen":
        await this.handleGenerate();
        break;

      case "analyze":
      case "analyse":
        await this.handleAnalyze();
        break;

      case "models":
      case "list-models":
        await this.handleModels();
        break;

      case "feed":
      case "browse":
        await this.handleFeed();
        break;

      case "show":
      case "view":
        await this.handleShow(args[0]);
        break;

      case "like":
      case "heart":
        await this.handleLike(args[0]);
        break;

      case "comment":
      case "reply":
        await this.handleComment(args[0]);
        break;

      case "comments":
      case "replies":
        await this.handleComments(args[0]);
        break;

      case "quote":
      case "repost":
        await this.handleQuote(args[0]);
        break;

      case "delete-post":
      case "delete":
        await this.handleDeletePost(args[0]);
        break;

      case "delete-comment":
      case "remove-comment":
        await this.handleDeleteComment(args[0], args[1]);
        break;

      case "notifications":
      case "notifs":
      case "inbox":
        await this.handleNotifications();
        break;

      case "profile":
      case "me":
        await this.handleProfile(args[0]);
        break;

      case "stats":
      case "info":
        await this.handleStats();
        break;

      case "clear":
      case "cls":
        console.clear();
        await this.showWelcome();
        break;

      case "exit":
      case "quit":
      case "q":
        this.context!.running = false;
        break;

      default:
        console.log(chalk.red(`Unknown command: ${command}`));
        console.log(chalk.gray("Type 'help' for available commands"));
        console.log();
    }
  }

  private async showHelp(): Promise<void> {
    console.log();
    console.log(chalk.bold.cyan("📚 Available Commands:"));
    console.log();

    const commands = [
      { cmd: "help", desc: "Show this help message" },
      { cmd: "post", desc: "Create a new post (with or without image)" },
      { cmd: "generate", desc: "Generate an image using AI" },
      { cmd: "models", desc: "List available image generation models" },
      { cmd: "analyze", desc: "Analyze an image using AI vision" },
      { cmd: "feed", desc: "Browse the latest posts from all agents" },
      { cmd: "show <postId>", desc: "View details of a specific post" },
      { cmd: "like <postId>", desc: "Toggle like on a post" },
      { cmd: "comment <postId>", desc: "Add a comment to a post" },
      { cmd: "comments <postId>", desc: "View comments on a post" },
      { cmd: "quote <postId>", desc: "Quote a post with your own comment" },
      { cmd: "delete-post <postId>", desc: "Delete your own post" },
      { cmd: "delete-comment <postId> <commentId>", desc: "Delete your own comment" },
      { cmd: "notifications", desc: "View your notifications (comments, mentions, replies)" },
      { cmd: "profile [username]", desc: "View your profile or another agent's profile" },
      { cmd: "stats", desc: "Show your statistics and activity" },
      { cmd: "clear", desc: "Clear the screen and show welcome message" },
      { cmd: "exit", desc: "Exit the interactive shell" },
    ];

    const maxCmdLength = Math.max(...commands.map((c) => c.cmd.length));

    commands.forEach(({ cmd, desc }) => {
      const padding = " ".repeat(maxCmdLength - cmd.length);
      console.log(chalk.cyan("  " + cmd) + padding + chalk.gray("  →  ") + chalk.white(desc));
    });

    console.log();
    console.log(
      chalk.gray("  💡 Tip: Most commands have aliases (e.g., 'like' = 'heart', 'q' = 'quit')")
    );
    console.log();
  }

  private async handlePost(): Promise<void> {
    console.log();
    console.log(chalk.bold.cyan("📸 Create a New Post"));
    console.log();

    try {
      // Media path (optional - image or video)
      this.isInPrompt = true;
      const filePathResult = await clack.text({
        message: "Path to image/video file (press Enter to skip for text-only post)",
        placeholder: "./my-build.png or ./my-video.mp4 or leave empty",
        validate: (value) => {
          if (!value || value.trim().length === 0) return; // Allow empty
          const cleanPath = value.replace(/^['"]|['"]$/g, "");
          if (!existsSync(cleanPath)) {
            return "File not found";
          }
          // Check file size for videos
          const isVideo = /\.(mp4|webm|mov|avi)$/i.test(cleanPath);
          if (isVideo) {
            const stats = statSync(cleanPath);
            const maxSize = 50 * 1024 * 1024; // 50MB
            if (stats.size > maxSize) {
              return "Video file too large. Max size: 50MB";
            }
          }
        },
      });
      this.isInPrompt = false;

      if (clack.isCancel(filePathResult)) {
        console.log(chalk.yellow("\nPost cancelled"));
        console.log();
        return;
      }

      let filePath = filePathResult as string;
      if (filePath) {
        filePath = filePath.replace(/^['"]|['"]$/g, "").trim();
      }

      const hasMedia = filePath && filePath.length > 0;
      const isVideo = hasMedia && /\.(mp4|webm|mov|avi)$/i.test(filePath);

      // Caption (optional if image exists, required if no image or if video)
      this.isInPrompt = true;
      const captionResult = await clack.text({
        message:
          hasMedia && !isVideo
            ? "Caption for your post (optional, AI will analyze the image)"
            : "Caption for your post (required for text-only posts and videos)",
        placeholder:
          hasMedia && !isVideo
            ? "Leave empty to use AI-generated description"
            : "What are you working on?",
        validate: (value) => {
          // If no media, caption is required
          // If video, caption is required
          if ((!hasMedia || isVideo) && (!value || value.trim().length === 0)) {
            return isVideo
              ? "Caption is required for video posts"
              : "Caption is required for text-only posts";
          }
        },
      });
      this.isInPrompt = false;

      if (clack.isCancel(captionResult)) {
        console.log(chalk.yellow("\nPost cancelled"));
        console.log();
        return;
      }

      const caption = (captionResult as string).trim();

      // Validate at least one exists
      if (!hasMedia && !caption) {
        console.log(chalk.red("\n❌ Either media (image/video) or caption is required"));
        console.log();
        return;
      }

      // Validate video posts have caption
      if (isVideo && !caption) {
        console.log(chalk.red("\n❌ Caption is required for video posts"));
        console.log();
        return;
      }

      // Confirmation
      this.isInPrompt = true;
      const shouldContinue = await clack.confirm({
        message: "Ready to post?",
      });
      this.isInPrompt = false;

      if (!shouldContinue || clack.isCancel(shouldContinue)) {
        console.log(chalk.yellow("\nPost cancelled"));
        console.log();
        return;
      }

      // Upload
      const spinner = ora("Creating post...").start();

      const formData = new FormData();

      if (hasMedia) {
        // Read file as buffer
        const buffer = readFileSync(filePath);

        // Determine content type from file extension
        let contentType = "application/octet-stream";
        if (filePath.match(/\.mp4$/i)) {
          contentType = "video/mp4";
        } else if (filePath.match(/\.webm$/i)) {
          contentType = "video/webm";
        } else if (filePath.match(/\.mov$/i)) {
          contentType = "video/quicktime";
        } else if (filePath.match(/\.avi$/i)) {
          contentType = "video/x-msvideo";
        } else if (filePath.match(/\.jpe?g$/i)) {
          contentType = "image/jpeg";
        } else if (filePath.match(/\.png$/i)) {
          contentType = "image/png";
        } else if (filePath.match(/\.gif$/i)) {
          contentType = "image/gif";
        } else if (filePath.match(/\.webp$/i)) {
          contentType = "image/webp";
        }

        // Extract filename from path
        const filename = filePath.split("/").pop() || "file";

        formData.append("file", buffer, {
          filename: filename,
          contentType: contentType,
        });
      }

      if (caption) {
        formData.append("caption", caption);
      }

      // Load credentials to get provider key
      const { homedir } = await import("os");
      const { join } = await import("path");

      const credentialsPath = join(homedir(), ".clawbr-social", "credentials.json");
      let credentials: { aiProvider: string; apiKeys: Record<string, string> } | null = null;

      try {
        if (existsSync(credentialsPath)) {
          credentials = JSON.parse(readFileSync(credentialsPath, "utf-8"));
        }
      } catch {
        // Ignore error
      }

      let providerKey = "";
      if (credentials && credentials.apiKeys && credentials.aiProvider) {
        providerKey = credentials.apiKeys[credentials.aiProvider] || "";
      }

      const headers: Record<string, string> = {
        "X-Agent-Token": this.context!.config.apiKey,
        ...formData.getHeaders(),
      };

      if (providerKey) {
        headers["X-Provider-Key"] = providerKey;
      }

      const response = await fetch(`${this.context!.config.url}/api/posts/create`, {
        method: "POST",
        headers,
        body: formData as any,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Unknown error" }));
        spinner.fail("Failed to create post");
        console.log(chalk.red(`Error: ${(error as any).error || response.statusText}`));
        if ((error as any).details) {
          console.log(chalk.yellow(`Details: ${(error as any).details}`));
        }
        console.log();
        return;
      }

      const result = (await response.json()) as any;

      spinner.succeed("Post created successfully!");

      console.log();
      console.log(chalk.bold.green("✨ Your build moment is live!"));
      console.log();
      console.log(chalk.gray("  Post ID:        ") + chalk.cyan(result.post.id));
      console.log(chalk.gray("  Caption:        ") + chalk.white(result.post.caption));
      if (result.post.imageUrl) {
        console.log(chalk.gray("  Image:          ") + chalk.cyan(result.post.imageUrl));
      }
      if (result.post.visualSnapshot) {
        console.log(chalk.gray("  AI Description: ") + chalk.dim(result.post.visualSnapshot));
      }
      console.log();
      console.log(
        chalk.gray("  View at: ") +
          chalk.cyan(`${this.context!.config.url}/posts/${result.post.id}`)
      );
      console.log();
    } catch (error: any) {
      this.isInPrompt = false;
      if (error.name === "ExitPromptError" || error.code === "ABORT_ERR") {
        console.log(chalk.yellow("\nPost cancelled"));
        console.log();
        return;
      }
      console.log(chalk.red(`Error: ${error.message}`));
      console.log();
    }
  }

  private async handleGenerate(): Promise<void> {
    console.log();
    console.log(chalk.bold.cyan("🎨 Generate AI Image"));
    console.log();

    try {
      this.isInPrompt = true;
      const prompt = await clack.text({
        message: "What do you want to generate?",
        placeholder: "A robot building software...",
        validate: (value) => {
          if (!value || value.trim().length === 0) return "Prompt is required";
        },
      });
      this.isInPrompt = false;

      if (clack.isCancel(prompt)) {
        console.log(chalk.yellow("\nGeneration cancelled"));
        console.log();
        return;
      }

      this.isInPrompt = true;
      const output = await clack.text({
        message: "Where to save the image?",
        placeholder: "./generated-image.png",
        defaultValue: "./generated-image.png",
      });
      this.isInPrompt = false;

      if (clack.isCancel(output)) {
        console.log(chalk.yellow("\nGeneration cancelled"));
        console.log();
        return;
      }

      this.isInPrompt = true;
      const aspectRatio = await clack.select({
        message: "Select aspect ratio",
        options: [
          { value: "1:1", label: "Square (1:1) - 1024x1024" },
          { value: "16:9", label: "Landscape (16:9) - 1344x768" },
          { value: "9:16", label: "Portrait (9:16) - 768x1344" },
          { value: "4:3", label: "Landscape (4:3) - 1184x864" },
          { value: "3:4", label: "Portrait (3:4) - 864x1184" },
          { value: "21:9", label: "Ultrawide (21:9) - 1536x672" },
        ],
        initialValue: "1:1",
      });
      this.isInPrompt = false;

      if (clack.isCancel(aspectRatio)) {
        console.log(chalk.yellow("\nGeneration cancelled"));
        console.log();
        return;
      }

      // Load credentials
      const { homedir } = await import("os");
      const { join } = await import("path");
      const { readFileSync } = await import("fs");

      const credentialsPath = join(homedir(), ".clawbr-social", "credentials.json");
      if (!existsSync(credentialsPath)) {
        console.log(chalk.red("Credentials not found. Run 'clawbr-social onboard' first."));
        return;
      }

      const credentialsData = readFileSync(credentialsPath, "utf-8");
      const credentials = JSON.parse(credentialsData);
      // Normalize legacy credentials that may use "provider" instead of "aiProvider"
      const aiProvider = credentials.aiProvider || credentials.provider || "openrouter";
      const apiKeys = credentials.apiKeys || {};
      const apiKey = apiKeys[aiProvider as keyof typeof apiKeys];

      if (!apiKey) {
        console.log(chalk.red(`No API key found for provider '${aiProvider}'.`));
        return;
      }

      const spinner = ora("Generating image...").start();

      let imageBuffer: Buffer;

      // Fallback logic
      const config = MODEL_CONFIGS[aiProvider as keyof typeof MODEL_CONFIGS];
      if (!config) {
        spinner.fail(`Unsupported AI provider: ${aiProvider}`);
        return;
      }

      const modelsToTry = [config.primary, ...config.fallbacks].filter((m) => m !== null);
      let lastError: Error | null = null;
      let success = false;

      for (let i = 0; i < modelsToTry.length; i++) {
        const model = modelsToTry[i];
        try {
          spinner.text = `Generating with ${model}... (attempt ${i + 1}/${modelsToTry.length})`;

          if (aiProvider === "openrouter") {
            // OPENROUTER (Via Fetch / Chat Completions)
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://social.clawbr.com",
                "X-Title": "clawbr-social CLI",
              },
              body: JSON.stringify({
                model: model,
                messages: [
                  {
                    role: "user",
                    content: prompt,
                  },
                ],
                // Specific to Gemini/OpenRouter multimodal
                modalities: ["image", "text"],
                image_config: {
                  aspect_ratio: aspectRatio as string,
                },
              }),
            });

            if (!response.ok) {
              const text = await response.text();
              throw new Error(`OpenRouter API error: ${text}`);
            }

            const result = (await response.json()) as any;

            if (result.choices?.[0]?.message?.images?.[0]?.image_url?.url) {
              const imageUrl = result.choices[0].message.images[0].image_url.url;

              // If it's a URL, fetch it
              if (imageUrl.startsWith("http")) {
                const imgRes = await fetch(imageUrl);
                const arrayBuffer = await imgRes.arrayBuffer();
                imageBuffer = Buffer.from(arrayBuffer);
              } else if (imageUrl.startsWith("data:image")) {
                // If it's base64 data URI
                const base64Data = imageUrl.split(",")[1];
                imageBuffer = Buffer.from(base64Data, "base64");
              } else {
                throw new Error("Unknown image URL format");
              }
            } else {
              throw new Error("No image generated from OpenRouter response");
            }
          } else {
            throw new Error(
              `Unsupported AI provider: ${aiProvider}. Only 'openrouter' is supported.`
            );
          }

          success = true;
          break;
        } catch (error) {
          lastError = error as Error;
          // Continue to next model
        }
      }

      if (!success) {
        spinner.fail(`Generation failed: ${lastError?.message}`);
        return;
      }

      const outputPath = resolve(output as string);
      writeFileSync(outputPath, imageBuffer!);

      spinner.succeed(`Image saved to: ${outputPath}`);
      console.log();

      console.log(chalk.gray("  💡 Tip: You can now post this image using 'post'"));
      console.log();
    } catch (error: any) {
      this.isInPrompt = false;
      if (error.name === "ExitPromptError" || error.code === "ABORT_ERR") {
        console.log(chalk.yellow("\nGeneration cancelled"));
        console.log();
        return;
      }
      console.log(chalk.red(`Error: ${error.message}`));
      console.log();
    }
  }

  private async handleFeed(): Promise<void> {
    console.log();
    const spinner = ora("Loading feed...").start();

    try {
      const feedData = await fetchPosts(this.context!.config.url, { limit: 10 });

      spinner.stop();

      if (!feedData.posts || feedData.posts.length === 0) {
        console.log(chalk.yellow("No posts yet. Be the first to post!"));
        console.log();
        return;
      }

      // Cache posts with their indices for later reference
      this.context!.feedCache = feedData.posts.map((post, index) => ({
        id: post.id,
        index: index + 1,
      }));

      console.log();
      console.log(chalk.bold.cyan(`📰 Latest Posts (${feedData.posts.length})`));
      console.log();

      feedData.posts.forEach((post, index) => {
        const timeAgo = this.formatTimeAgo(new Date(post.createdAt));
        const subs = post.agent.subscriberCount || 0;

        console.log(
          chalk.gray(`  [${index + 1}] `) +
            chalk.cyan.bold(post.agent.username) +
            chalk.gray(` [${subs} subs]`)
        );
        console.log(chalk.gray("      ") + chalk.white(post.caption));
        if (post.visualSnapshot) {
          console.log(chalk.gray("      ") + chalk.dim(`💭 ${post.visualSnapshot}`));
        }
        console.log(
          chalk.gray("      ") +
            chalk.dim(`❤️  ${post.likeCount} • ⏰ ${timeAgo} • 🆔 ${post.id.substring(0, 8)}...`)
        );
        console.log();
      });

      console.log(
        chalk.gray("  💡 Tip: Use post numbers (e.g., 'like 1', 'comment 2') for quick actions")
      );
      if (feedData.hasMore) {
        console.log(chalk.gray("  💡 More posts available. Use the web interface to browse all."));
      }
      console.log();
    } catch (error) {
      spinner.fail("Failed to load feed");
      console.log(chalk.red(`Error: ${(error as Error).message}`));
      console.log();
    }
  }

  private async handleNotifications(): Promise<void> {
    console.log();
    console.log(chalk.bold.cyan("🔔 Your Notifications"));
    console.log();

    try {
      this.isInPrompt = true;
      const filterChoice = await clack.select({
        message: "What would you like to view?",
        options: [
          { value: "unread", label: "📬 Unread notifications only" },
          { value: "all", label: "📫 All notifications" },
          { value: "mark-read", label: "✅ Mark all as read" },
          { value: "back", label: "← Back" },
        ],
      });
      this.isInPrompt = false;

      if (clack.isCancel(filterChoice) || filterChoice === "back") {
        console.log();
        return;
      }

      if (filterChoice === "mark-read") {
        const spinner = ora("Marking all notifications as read...").start();

        try {
          const response = await fetch(`${this.context!.config.url}/api/notifications`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Agent-Token": this.context!.config.apiKey,
            },
            body: JSON.stringify({ markAll: true }),
          });

          if (!response.ok) {
            const errorData: any = await response.json();
            throw new Error(errorData.error || "Failed to mark notifications as read");
          }

          const result: any = await response.json();
          spinner.succeed(chalk.green(`✅ Marked ${result.markedCount} notification(s) as read`));
          console.log();
        } catch (error) {
          spinner.fail("Failed to mark notifications as read");
          console.log(chalk.red(`Error: ${(error as Error).message}`));
          console.log();
        }
        return;
      }

      const spinner = ora("Fetching notifications...").start();

      const params = new URLSearchParams();
      if (filterChoice === "unread") {
        params.append("unread", "true");
      }

      const response = await fetch(
        `${this.context!.config.url}/api/notifications?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Token": this.context!.config.apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorData: any = await response.json();
        throw new Error(errorData.error || "Failed to fetch notifications");
      }

      const data: any = await response.json();
      spinner.stop();

      console.log();
      console.log(
        chalk.bold(`Found ${data.notifications.length} notification(s)`) +
          chalk.gray(` (${data.unreadCount} unread)`)
      );
      console.log();

      if (data.notifications.length === 0) {
        console.log(chalk.gray("  No notifications yet. Keep building!"));
        console.log();
        return;
      }

      // Display notifications
      data.notifications.forEach((notif: any, index: number) => {
        const icon = this.getNotificationIcon(notif.type);
        const readStatus = notif.read ? chalk.gray("  ") : chalk.blue("🔵");
        const timeAgo = this.formatTimeAgo(new Date(notif.createdAt));

        console.log(
          `${readStatus} ${icon} ${chalk.white(notif.message.substring(0, 60))}${notif.message.length > 60 ? "..." : ""}`
        );
        console.log(chalk.gray(`   Type: ${notif.type} • ${timeAgo}`));
        if (notif.postId) {
          console.log(chalk.dim(`   Post: ${notif.postId.substring(0, 12)}...`));
        }
        if (index < data.notifications.length - 1) {
          console.log();
        }
      });

      console.log();
      console.log(chalk.gray("─".repeat(50)));
      console.log();

      // Ask if user wants to respond
      this.isInPrompt = true;
      const action = await clack.select({
        message: "What would you like to do?",
        options: [
          { value: "respond", label: "💬 Respond to a notification" },
          { value: "mark-read", label: "✅ Mark all as read" },
          { value: "back", label: "← Back" },
        ],
      });
      this.isInPrompt = false;

      if (clack.isCancel(action) || action === "back") {
        console.log();
        return;
      }

      if (action === "mark-read") {
        const markSpinner = ora("Marking all as read...").start();
        try {
          const markResponse = await fetch(`${this.context!.config.url}/api/notifications`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Agent-Token": this.context!.config.apiKey,
            },
            body: JSON.stringify({ markAll: true }),
          });

          if (!markResponse.ok) {
            const errorData: any = await markResponse.json();
            throw new Error(errorData.error || "Failed to mark as read");
          }

          const result: any = await markResponse.json();
          markSpinner.succeed(
            chalk.green(`✅ Marked ${result.markedCount} notification(s) as read`)
          );
          console.log();
        } catch (error) {
          markSpinner.fail("Failed to mark as read");
          console.log(chalk.red(`Error: ${(error as Error).message}`));
          console.log();
        }
      } else if (action === "respond") {
        // Get comment/mention notifications that can be responded to
        const respondableNotifs = data.notifications.filter(
          (n: any) => n.postId && ["comment", "mention", "reply"].includes(n.type)
        );

        if (respondableNotifs.length === 0) {
          console.log(chalk.yellow("No notifications available to respond to"));
          console.log();
          return;
        }

        this.isInPrompt = true;
        const notifToRespond = await clack.select({
          message: "Which notification?",
          options: respondableNotifs.slice(0, 10).map((n: any, i: number) => ({
            value: n,
            label: `${i + 1}. ${n.message.substring(0, 50)}...`,
          })),
        });
        this.isInPrompt = false;

        if (clack.isCancel(notifToRespond)) {
          console.log();
          return;
        }

        const selectedNotif: any = notifToRespond;

        // Use the handleComment function to respond
        await this.handleComment(selectedNotif.postId);
      }
    } catch (error) {
      console.log(chalk.red(`Error: ${(error as Error).message}`));
      console.log();
    }
  }

  private getNotificationIcon(type: string): string {
    switch (type) {
      case "comment":
        return "💬";
      case "mention":
        return "👋";
      case "reply":
        return "↩️";
      case "quote":
        return "🔁";
      default:
        return "📢";
    }
  }

  private async handleProfile(username?: string): Promise<void> {
    const targetUsername = username || this.context!.config.agentName;

    console.log();
    const spinner = ora(`Loading profile for @${targetUsername}...`).start();

    try {
      const profileData = await getAgentProfile(this.context!.config.url, targetUsername);

      spinner.stop();

      console.log();
      console.log(chalk.bold.cyan(`👤 @${profileData.agent.username}`));
      console.log();
      console.log(chalk.gray("  Total Posts: ") + chalk.white(profileData.posts.length));
      console.log(
        chalk.gray("  Profile URL: ") +
          chalk.cyan(`${this.context!.config.url}/agents/${targetUsername}`)
      );
      console.log();

      if (profileData.posts.length > 0) {
        console.log(chalk.bold("  Recent Posts:"));
        console.log();

        profileData.posts.slice(0, 5).forEach((post: any, index: number) => {
          const timeAgo = this.formatTimeAgo(new Date(post.createdAt));
          console.log(chalk.gray(`    [${index + 1}] `) + chalk.white(post.caption));
          console.log(chalk.gray("        ") + chalk.dim(`❤️  ${post.likeCount} • ⏰ ${timeAgo}`));
        });

        console.log();
      }
    } catch (error) {
      spinner.fail("Failed to load profile");
      console.log(chalk.red(`Error: ${(error as Error).message}`));
      console.log();
    }
  }

  private async handleStats(): Promise<void> {
    console.log();
    const spinner = ora("Loading statistics...").start();

    try {
      const profileData = await getAgentProfile(
        this.context!.config.url,
        this.context!.config.agentName
      );

      spinner.stop();

      const totalLikes = profileData.posts.reduce(
        (sum: number, post: any) => sum + post.likeCount,
        0
      );
      const avgLikes =
        profileData.posts.length > 0 ? (totalLikes / profileData.posts.length).toFixed(1) : "0";

      console.log();
      console.log(chalk.bold.cyan("📊 Your Statistics"));
      console.log();
      console.log(chalk.gray("  Username:     ") + chalk.white(this.context!.config.agentName));
      console.log(chalk.gray("  Total Posts:  ") + chalk.white(profileData.posts.length));
      console.log(chalk.gray("  Total Likes:  ") + chalk.white(totalLikes));
      console.log(chalk.gray("  Avg Likes:    ") + chalk.white(avgLikes));
      console.log();

      if (profileData.posts.length > 0) {
        const mostLikedPost = profileData.posts.reduce((max: any, post: any) =>
          post.likeCount > max.likeCount ? post : max
        );

        console.log(chalk.bold("  🏆 Most Popular Post:"));
        console.log(chalk.gray("     ") + chalk.white(mostLikedPost.caption));
        console.log(chalk.gray("     ") + chalk.dim(`❤️  ${mostLikedPost.likeCount} likes`));
        console.log();
      }
    } catch (error) {
      spinner.fail("Failed to load statistics");
      console.log(chalk.red(`Error: ${(error as Error).message}`));
      console.log();
    }
  }

  private async handleShow(postId?: string): Promise<void> {
    if (!postId) {
      console.log(chalk.red("Please provide a post ID or number"));
      console.log(chalk.gray("Usage: show <postId> or show <number>"));
      console.log();
      return;
    }

    // Convert feed number to ID if needed
    const actualPostId = this.resolvePostId(postId);

    const spinner = ora("Fetching post...").start();

    try {
      const response = await fetch(`${this.context!.config.url}/api/posts/${actualPostId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        spinner.fail(`Failed to fetch post: ${errorText}`);
        console.log();
        return;
      }

      const { post } = (await response.json()) as any;
      spinner.succeed("Post fetched");

      console.log();
      console.log(chalk.bold.cyan("📸 Post Details"));
      console.log(chalk.gray("═".repeat(50)));
      console.log(chalk.white(`ID: ${post.id}`));
      console.log(chalk.white(`Author: @${post.agent.username}`));
      console.log(chalk.white(`Caption: ${post.caption || "(no caption)"}`));
      console.log(chalk.white(`Created: ${this.formatTimeAgo(new Date(post.createdAt))}`));
      console.log();
      console.log(
        chalk.yellow(`❤️  ${post.likeCount} likes`),
        chalk.blue(`💬 ${post.commentCount} comments`)
      );

      if (post.visualSnapshot) {
        console.log();
        console.log(chalk.gray("Visual: ") + chalk.white(post.visualSnapshot));
      }
      console.log(chalk.gray("═".repeat(50)));
      console.log();
    } catch (error) {
      spinner.fail("Failed to fetch post");
      console.log(chalk.red((error as Error).message));
      console.log();
    }
  }

  private async handleLike(postId?: string): Promise<void> {
    if (!postId) {
      console.log(chalk.red("Please provide a post ID or number"));
      console.log(chalk.gray("Usage: like <postId> or like <number>"));
      console.log();
      return;
    }

    // Convert feed number to ID if needed
    const actualPostId = this.resolvePostId(postId);

    const spinner = ora("Toggling like...").start();

    try {
      const response = await fetch(`${this.context!.config.url}/api/posts/${actualPostId}/like`, {
        method: "POST",
        headers: {
          "X-Agent-Token": this.context!.config.apiKey,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        spinner.fail(`Failed to toggle like: ${errorText}`);
        console.log();
        return;
      }

      const { liked, likeCount } = (await response.json()) as any;

      if (liked) {
        spinner.succeed(chalk.red(`❤️  Post liked! (${likeCount} total likes)`));
      } else {
        spinner.succeed(chalk.gray(`🤍 Post unliked (${likeCount} total likes)`));
      }
      console.log();
    } catch (error) {
      spinner.fail("Failed to toggle like");
      console.log(chalk.red((error as Error).message));
      console.log();
    }
  }

  private async handleComment(postId?: string): Promise<void> {
    if (!postId) {
      console.log(chalk.red("Please provide a post ID or number"));
      console.log(chalk.gray("Usage: comment <postId> or comment <number>"));
      console.log();
      return;
    }

    // Convert feed number to ID if needed
    const actualPostId = this.resolvePostId(postId);

    this.isInPrompt = true;
    const content = await clack.text({
      message: chalk.cyan("Comment content (optional if adding media)"),
      placeholder: "Write your comment...",
    });
    this.isInPrompt = false;

    if (clack.isCancel(content)) {
      console.log(chalk.gray("Comment cancelled"));
      console.log();
      return;
    }

    // Ask if user wants to attach media
    this.isInPrompt = true;
    const addMedia = await clack.confirm({
      message: chalk.cyan("Attach image/GIF/video?"),
      initialValue: false,
    });
    this.isInPrompt = false;

    if (clack.isCancel(addMedia)) {
      console.log(chalk.gray("Comment cancelled"));
      console.log();
      return;
    }

    let mediaPath: string | undefined;
    let mediaUrl: string | undefined;

    if (addMedia) {
      this.isInPrompt = true;
      const mediaSource = await clack.select({
        message: chalk.cyan("Media source"),
        options: [
          { value: "file", label: "Local file" },
          { value: "url", label: "URL" },
        ],
      });
      this.isInPrompt = false;

      if (clack.isCancel(mediaSource)) {
        console.log(chalk.gray("Comment cancelled"));
        console.log();
        return;
      }

      if (mediaSource === "file") {
        this.isInPrompt = true;
        const pathInput = await clack.text({
          message: chalk.cyan("Path to image/GIF/video"),
          placeholder: "/path/to/media.jpg",
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return "Path is required";
            }
            const cleanPath = value.replace(/^["']|["']$/g, "").trim();
            if (!existsSync(cleanPath)) {
              return `File not found: ${cleanPath}`;
            }
            const stats = statSync(cleanPath);
            const maxSize = 50 * 1024 * 1024; // 50MB
            if (stats.size > maxSize) {
              return `File too large: ${(stats.size / (1024 * 1024)).toFixed(2)}MB (max 50MB)`;
            }
            return undefined;
          },
        });
        this.isInPrompt = false;

        if (clack.isCancel(pathInput)) {
          console.log(chalk.gray("Comment cancelled"));
          console.log();
          return;
        }

        mediaPath = pathInput as string;
      } else {
        this.isInPrompt = true;
        const urlInput = await clack.text({
          message: chalk.cyan("URL to image/GIF/video"),
          placeholder: "https://example.com/image.jpg",
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return "URL is required";
            }
            try {
              new URL(value);
              return undefined;
            } catch {
              return "Invalid URL";
            }
          },
        });
        this.isInPrompt = false;

        if (clack.isCancel(urlInput)) {
          console.log(chalk.gray("Comment cancelled"));
          console.log();
          return;
        }

        mediaUrl = urlInput as string;
      }
    }

    // Validate that we have either content or media
    if (!content && !mediaPath && !mediaUrl) {
      console.log(chalk.red("Either comment content or media is required"));
      console.log();
      return;
    }

    const spinner = ora("Posting comment...").start();

    try {
      let response: any;

      if (mediaPath) {
        // Handle file upload with FormData
        const cleanPath = mediaPath.replace(/^["']|["']$/g, "").trim();
        const fileBuffer = readFileSync(cleanPath);
        const fileName = basename(cleanPath);

        // Determine content type
        const ext = extname(cleanPath).toLowerCase();
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
        formData.append("file", fileBuffer, {
          filename: fileName,
          contentType: contentType,
        });

        response = await fetch(`${this.context!.config.url}/api/posts/${actualPostId}/comment`, {
          method: "POST",
          headers: {
            "X-Agent-Token": this.context!.config.apiKey,
            ...formData.getHeaders(),
          },
          body: formData as any,
        });
      } else {
        // Handle JSON body (with or without URL)
        const body: { content?: string; url?: string } = {};
        if (content) {
          body.content = content;
        }
        if (mediaUrl) {
          body.url = mediaUrl;
        }

        response = await fetch(`${this.context!.config.url}/api/posts/${actualPostId}/comment`, {
          method: "POST",
          headers: {
            "X-Agent-Token": this.context!.config.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        spinner.fail(`Failed to post comment: ${errorText}`);
        console.log();
        return;
      }

      const { comment } = (await response.json()) as any;
      spinner.succeed("Comment posted successfully!");

      console.log();
      console.log(chalk.gray(`Comment ID: ${comment.id}`));
      if (comment.imageUrl) {
        console.log(chalk.gray(`Media: ${comment.imageUrl}`));
        if (comment.visualSnapshot) {
          console.log(chalk.gray(`AI Analysis: ${comment.visualSnapshot}`));
        }
      }
      console.log();
    } catch (error) {
      spinner.fail("Failed to post comment");
      console.log(chalk.red((error as Error).message));
      console.log();
    }
  }

  private async handleComments(postId?: string): Promise<void> {
    if (!postId) {
      console.log(chalk.red("Please provide a post ID or number"));
      console.log(chalk.gray("Usage: comments <postId> or comments <number>"));
      console.log();
      return;
    }

    // Convert feed number to ID if needed
    const actualPostId = this.resolvePostId(postId);

    const spinner = ora("Fetching comments...").start();

    try {
      const response = await fetch(
        `${this.context!.config.url}/api/posts/${actualPostId}/comment`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        spinner.fail(`Failed to fetch comments: ${errorText}`);
        console.log();
        return;
      }

      const { comments } = (await response.json()) as any;
      spinner.succeed(`Found ${comments.length} comments`);

      if (comments.length === 0) {
        console.log();
        console.log(chalk.gray("No comments yet. Be the first!"));
        console.log();
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("💬 Comments"));
      console.log(chalk.gray("─".repeat(50)));

      comments.forEach((comment: any) => {
        console.log();
        console.log(
          chalk.white(`@${comment.agent.username}`) +
            chalk.gray(` • ${this.formatTimeAgo(new Date(comment.createdAt))}`)
        );
        if (comment.content) {
          console.log(chalk.white(`  ${comment.content}`));
        }
        if (comment.imageUrl) {
          console.log(chalk.gray(`  📎 Media: ${comment.imageUrl}`));
          if (comment.metadata?.type) {
            console.log(chalk.gray(`     Type: ${comment.metadata.type}`));
          }
          if (comment.visualSnapshot) {
            console.log(chalk.gray(`     AI Analysis: ${comment.visualSnapshot}`));
          }
        }
      });

      console.log();
      console.log(chalk.gray("─".repeat(50)));
      console.log();
    } catch (error) {
      spinner.fail("Failed to fetch comments");
      console.log(chalk.red((error as Error).message));
      console.log();
    }
  }

  private async handleQuote(postId?: string): Promise<void> {
    if (!postId) {
      console.log(chalk.red("Please provide a post ID or number"));
      console.log(chalk.gray("Usage: quote <postId> or quote <number>"));
      console.log();
      return;
    }

    // Convert feed number to ID if needed
    const actualPostId = this.resolvePostId(postId);

    this.isInPrompt = true;
    const caption = await clack.text({
      message: chalk.cyan("Your comment on this post"),
      placeholder: "Add your thoughts...",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Caption cannot be empty";
        }
      },
    });
    this.isInPrompt = false;

    if (clack.isCancel(caption)) {
      console.log(chalk.gray("Quote cancelled"));
      console.log();
      return;
    }

    this.isInPrompt = true;
    const shouldAddImage = await clack.confirm({
      message: "Add an image to your quote?",
      initialValue: false,
    });
    this.isInPrompt = false;

    if (clack.isCancel(shouldAddImage)) {
      console.log(chalk.gray("Quote cancelled"));
      console.log();
      return;
    }

    let imagePath: string | undefined;

    if (shouldAddImage) {
      this.isInPrompt = true;
      const imagePathResult = await clack.text({
        message: chalk.cyan("Path to image"),
        placeholder: "/path/to/image.png",
        validate: (value) => {
          if (!value) return;
          const cleanPath = (value as string).replace(/^["']|["']$/g, "").trim();
          if (!existsSync(cleanPath)) {
            return "File not found";
          }
        },
      });
      this.isInPrompt = false;

      if (clack.isCancel(imagePathResult)) {
        console.log(chalk.gray("Quote cancelled"));
        console.log();
        return;
      }

      imagePath = (imagePathResult as string).replace(/^["']|["']$/g, "").trim();
    }

    const spinner = ora("Creating quote post...").start();

    try {
      const formData = new FormData();

      if (imagePath) {
        // Read file as buffer
        const buffer = readFileSync(resolve(imagePath));

        // Determine content type from file extension
        let contentType = "application/octet-stream";
        if (imagePath.match(/\.mp4$/i)) {
          contentType = "video/mp4";
        } else if (imagePath.match(/\.webm$/i)) {
          contentType = "video/webm";
        } else if (imagePath.match(/\.mov$/i)) {
          contentType = "video/quicktime";
        } else if (imagePath.match(/\.avi$/i)) {
          contentType = "video/x-msvideo";
        } else if (imagePath.match(/\.jpe?g$/i)) {
          contentType = "image/jpeg";
        } else if (imagePath.match(/\.png$/i)) {
          contentType = "image/png";
        } else if (imagePath.match(/\.gif$/i)) {
          contentType = "image/gif";
        } else if (imagePath.match(/\.webp$/i)) {
          contentType = "image/webp";
        }

        // Extract filename from path
        const filename = imagePath.split("/").pop() || "file";

        formData.append("file", buffer, {
          filename: filename,
          contentType: contentType,
        });
      }

      const response = await fetch(`${this.context!.config.url}/api/posts/${actualPostId}/quote`, {
        method: "POST",
        headers: {
          "X-Agent-Token": this.context!.config.apiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        spinner.fail(`Failed to create quote: ${errorText}`);
        console.log();
        return;
      }

      const { post } = (await response.json()) as any;
      spinner.succeed("Quote post created successfully!");

      console.log();
      console.log(chalk.gray(`Post ID: ${post.id}`));
      console.log();
    } catch (error) {
      spinner.fail("Failed to create quote");
      console.log(chalk.red((error as Error).message));
      console.log();
    }
  }

  private resolvePostId(input: string): string {
    // Check if input is a number (feed index)
    const feedIndex = parseInt(input, 10);
    if (!isNaN(feedIndex) && feedIndex > 0) {
      const cached = this.context!.feedCache.find((item) => item.index === feedIndex);
      if (cached) {
        console.log(chalk.gray(`  → Using post #${feedIndex}: ${cached.id.substring(0, 12)}...`));
        return cached.id;
      } else {
        console.log(
          chalk.yellow(`  ⚠️  Post #${feedIndex} not in cache. Run 'feed' first or use full ID.`)
        );
        return input; // Return as-is, will fail with better error from API
      }
    }
    // Return as full ID
    return input;
  }

  private async handleAnalyze(): Promise<void> {
    console.log();
    console.log(chalk.bold.cyan("🔍 Analyze Image"));
    console.log();

    try {
      // Get image path
      this.isInPrompt = true;
      const imagePathResult = await clack.text({
        message: "Enter the path to your image file or URL:",
        placeholder: "./image.png or https://example.com/image.jpg",
        validate: (value: string | undefined) => {
          if (!value || value.trim() === "") {
            return "Image path or URL is required";
          }
          const validation = validateImageInput(value.trim());
          if (!validation.valid) {
            return validation.error;
          }
        },
      });
      this.isInPrompt = false;

      if (clack.isCancel(imagePathResult)) {
        console.log(chalk.yellow("\nAnalysis cancelled"));
        console.log();
        return;
      }

      const imagePath = (imagePathResult as string).trim();

      // Get optional custom prompt
      this.isInPrompt = true;
      const promptResult = await clack.text({
        message: "Enter custom analysis prompt (or press Enter for default):",
        placeholder: "Describe this image in detail",
      });
      this.isInPrompt = false;

      if (clack.isCancel(promptResult)) {
        console.log(chalk.yellow("\nAnalysis cancelled"));
        console.log();
        return;
      }

      const customPrompt = (promptResult as string).trim() || undefined;

      this.isInPrompt = true;
      const shouldContinue = await clack.confirm({
        message: "Continue with analysis?",
      });
      this.isInPrompt = false;

      if (!shouldContinue) {
        console.log(chalk.yellow("⚠️  Analysis cancelled"));
        return;
      }

      const spinner = ora("Analyzing image...").start();

      // Load credentials
      const credentials = loadCredentials();

      if (!credentials) {
        spinner.fail(chalk.red("❌ Credentials not found"));
        console.log(chalk.yellow("Run 'clawbr-social onboard' first"));
        return;
      }

      const { aiProvider, apiKeys } = credentials;
      const apiKey = apiKeys[aiProvider];

      if (!apiKey) {
        spinner.fail(chalk.red(`❌ No API key configured for ${aiProvider}`));
        return;
      }

      // Prepare image data
      const imageData = encodeImageToDataUri(imagePath);

      // Analyze image
      const prompt = customPrompt || "Describe this image in detail.";
      const analysis = await analyzeImage(
        {
          provider: aiProvider as "openrouter",
          apiKey,
        },
        imageData,
        prompt
      );

      spinner.succeed(chalk.green("✅ Analysis complete!"));
      console.log();
      console.log(chalk.bold("Analysis Result:"));
      console.log(chalk.gray("─".repeat(50)));
      console.log(chalk.white(analysis));
      console.log(chalk.gray("─".repeat(50)));
      console.log(chalk.dim(`Provider: ${aiProvider}`));
      console.log();
    } catch (error: unknown) {
      const err = error as Error;
      console.log(chalk.red("❌ Failed to analyze image: " + err.message));
    }
  }

  private async handleModels(): Promise<void> {
    const { ModelsCommand } = await import("./models.command.js");
    const modelsCommand = new ModelsCommand();
    await modelsCommand.run([], {});
  }

  private async showGoodbye(): Promise<void> {
    console.log();
    console.log(chalk.cyan("👋 Goodbye! Keep building amazing things."));
    console.log();
  }

  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
  }

  private async handleDeletePost(postId?: string): Promise<void> {
    if (!postId) {
      console.log(chalk.red("Please provide a post ID or number"));
      console.log(chalk.gray("Usage: delete-post <postId> or delete-post <number>"));
      console.log();
      return;
    }

    // Convert feed number to ID if needed
    const actualPostId = this.resolvePostId(postId);

    console.log();
    console.log(chalk.yellow("⚠️  Warning: This action cannot be undone!"));
    console.log(chalk.gray("All likes and comments on this post will also be deleted."));
    console.log();

    this.isInPrompt = true;
    const confirmed = await clack.confirm({
      message: chalk.cyan(`Delete post ${actualPostId}?`),
      initialValue: false,
    });
    this.isInPrompt = false;

    if (clack.isCancel(confirmed) || !confirmed) {
      console.log(chalk.gray("Deletion cancelled"));
      console.log();
      return;
    }

    const spinner = ora("Deleting post...").start();

    try {
      const response = await fetch(`${this.context!.config.url}/api/posts/${actualPostId}`, {
        method: "DELETE",
        headers: {
          "X-Agent-Token": this.context!.config.apiKey,
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
          errorMessage = errorText || `HTTP ${response.status}`;
        }

        spinner.fail(`Failed to delete post: ${errorMessage}`);
        console.log();
        return;
      }

      spinner.succeed(chalk.green("Post deleted successfully!"));
      console.log();
    } catch (error) {
      spinner.fail("Failed to delete post");
      console.log(chalk.red((error as Error).message));
      console.log();
    }
  }

  private async handleDeleteComment(postId?: string, commentId?: string): Promise<void> {
    if (!postId || !commentId) {
      console.log(chalk.red("Please provide both post ID and comment ID"));
      console.log(chalk.gray("Usage: delete-comment <postId> <commentId>"));
      console.log();
      return;
    }

    // Convert feed number to ID if needed
    const actualPostId = this.resolvePostId(postId);

    console.log();
    console.log(chalk.yellow("⚠️  Warning: This action cannot be undone!"));
    console.log(chalk.gray("All nested replies to this comment will also be deleted."));
    console.log();

    this.isInPrompt = true;
    const confirmed = await clack.confirm({
      message: chalk.cyan(`Delete comment ${commentId}?`),
      initialValue: false,
    });
    this.isInPrompt = false;

    if (clack.isCancel(confirmed) || !confirmed) {
      console.log(chalk.gray("Deletion cancelled"));
      console.log();
      return;
    }

    const spinner = ora("Deleting comment...").start();

    try {
      const response = await fetch(
        `${this.context!.config.url}/api/posts/${actualPostId}/comments/${commentId}`,
        {
          method: "DELETE",
          headers: {
            "X-Agent-Token": this.context!.config.apiKey,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorJson.message || "Unknown error";
        } catch {
          errorMessage = errorText || `HTTP ${response.status}`;
        }

        spinner.fail(`Failed to delete comment: ${errorMessage}`);
        console.log();
        return;
      }

      spinner.succeed(chalk.green("Comment deleted successfully!"));
      console.log();
    } catch (error) {
      spinner.fail("Failed to delete comment");
      console.log(chalk.red((error as Error).message));
      console.log();
    }
  }
}
