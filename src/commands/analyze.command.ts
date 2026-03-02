import { Command, CommandRunner, Option } from "nest-commander";
import ora from "ora";
import { loadCredentials } from "../utils/credentials.js";
import { resolveImageToDataUri, validateImageInput } from "../utils/image.js";
import { analyzeImage } from "../utils/vision.js";
import { requireOnboarding } from "../utils/config.js";

interface AnalyzeCommandOptions {
  image?: string;
  prompt?: string;
  json?: boolean;
}

@Command({
  name: "analyze",
  description: "Analyze an image using AI vision models",
  arguments: "",
  options: { isDefault: false },
})
export class AnalyzeCommand extends CommandRunner {
  async run(inputs: string[], options: AnalyzeCommandOptions): Promise<void> {
    await requireOnboarding();
    const { image, prompt, json = false } = options;

    // ─────────────────────────────────────────────────────────────────────
    // Validation
    // ─────────────────────────────────────────────────────────────────────
    if (!image) {
      throw new Error(
        '--image is required. Example: clawbr analyze --image "./photo.jpg" --prompt "Describe this image"'
      );
    }

    const validation = validateImageInput(image);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Load Credentials
    // ─────────────────────────────────────────────────────────────────────
    const credentials = loadCredentials();

    if (!credentials) {
      throw new Error("Credentials not found. Run 'clawbr onboard' first to set up your account.");
    }

    const { aiProvider, apiKeys } = credentials;
    const apiKey = apiKeys[aiProvider as keyof typeof apiKeys];

    if (!apiKey) {
      throw new Error(
        `No API key found for provider '${aiProvider}'. Run 'clawbr onboard' to configure.`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Prepare Image
    // ─────────────────────────────────────────────────────────────────────
    const imageData = await resolveImageToDataUri(image);

    // ─────────────────────────────────────────────────────────────────────
    // Analyze Image
    // ─────────────────────────────────────────────────────────────────────
    const spinner = json ? null : ora("Analyzing image...").start();

    try {
      const analysis = await analyzeImage(
        {
          provider: aiProvider as "openrouter",
          apiKey,
        },
        imageData,
        prompt || "Describe this image in detail."
      );

      if (spinner) {
        spinner.succeed("Image analyzed successfully!");
      }

      // ─────────────────────────────────────────────────────────────────────
      // Output
      // ─────────────────────────────────────────────────────────────────────
      if (json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              analysis,
              provider: aiProvider,
            },
            null,
            2
          )
        );
      } else {
        console.log("\n🔍 Image Analysis:");
        console.log("═════════════════════════════════════");
        console.log(analysis);
        console.log("─────────────────────────────────────");
        console.log(`Provider: ${aiProvider}`);
        console.log("─────────────────────────────────────\n");
      }
      process.exit(0);
    } catch (error) {
      if (spinner && spinner.isSpinning) {
        spinner.fail("Image analysis failed");
      }
      throw error;
    }
  }

  @Option({
    flags: "-i, --image <path>",
    description: "Path to the image file or URL",
  })
  parseImage(val: string): string {
    return val;
  }

  @Option({
    flags: "-p, --prompt <text>",
    description: 'Custom prompt for analysis (default: "Describe this image in detail.")',
  })
  parsePrompt(val: string): string {
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
