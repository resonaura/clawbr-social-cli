import { Command, CommandRunner, Option } from "nest-commander";
import { writeFileSync } from "fs";
import ora from "ora";
import fetch from "node-fetch";
import { resolve } from "path";
import { loadCredentials } from "../utils/credentials.js";
import { resolveImageToDataUri, validateImageInput } from "../utils/image.js";
import { requireOnboarding } from "../utils/config.js";
import {
  getProviderModels,
  getModelById,
  isValidModel,
  getPrimaryModel,
  getFallbackModels,
  supportsReferenceImage,
  formatModelList,
} from "../config/image-models.js";

interface GenerateCommandOptions {
  prompt?: string;
  output?: string;
  size?: string;
  sourceImage?: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  json?: boolean;
}

@Command({
  name: "generate",
  description: "Generate an image using AI with smart model fallback",
  arguments: "",
  options: { isDefault: false },
})
export class GenerateCommand extends CommandRunner {
  async run(inputs: string[], options: GenerateCommandOptions): Promise<void> {
    await requireOnboarding();
    const {
      prompt,
      output,
      size = "1024x1024",
      sourceImage,
      model,
      aspectRatio,
      imageSize,
      json = false,
    } = options;

    // ─────────────────────────────────────────────────────────────────────
    // Validation
    // ─────────────────────────────────────────────────────────────────────
    if (!prompt) {
      throw new Error(
        '--prompt is required. Example: clawbr-social generate --prompt "a robot building software" --output "./robot.png"'
      );
    }

    if (!output) {
      throw new Error(
        '--output is required. Example: clawbr-social generate --prompt "..." --output "./image.png"'
      );
    }

    // Validate source image if provided
    if (sourceImage) {
      const validation = validateImageInput(sourceImage);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
    }

    // Validate size
    const validSizes = ["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"];
    if (!validSizes.includes(size)) {
      throw new Error(`Invalid size. Must be one of: ${validSizes.join(", ")}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Load Credentials
    // ─────────────────────────────────────────────────────────────────────
    const credentials = loadCredentials();

    if (!credentials) {
      throw new Error(
        "Credentials not found. Run 'clawbr-social onboard' first to set up your account."
      );
    }

    const { aiProvider, apiKeys } = credentials;
    const apiKey = apiKeys[aiProvider as keyof typeof apiKeys];

    if (!apiKey) {
      throw new Error(
        `No API key found for provider '${aiProvider}'. Run 'clawbr-social onboard' to configure.`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Validate model if provided
    // ─────────────────────────────────────────────────────────────────────
    if (model && !isValidModel(aiProvider, model)) {
      const availableModels = formatModelList(aiProvider);
      throw new Error(
        `Invalid model '${model}' for provider '${aiProvider}'.\n\nAvailable models:\n${availableModels}`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Check reference image support
    // ─────────────────────────────────────────────────────────────────────
    if (sourceImage && model && !supportsReferenceImage(aiProvider, model)) {
      const modelInfo = getModelById(aiProvider, model);
      throw new Error(
        `Model '${modelInfo?.name || model}' does not support reference images.\n\n` +
          `For reference image support with ${aiProvider}, use one of:\n` +
          getProviderModels(aiProvider)
            .filter((m) => m.supportsReferenceImage)
            .map((m) => `  • ${m.id}`)
            .join("\n")
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Prepare source image if provided
    // ─────────────────────────────────────────────────────────────────────
    const sourceImageData = sourceImage ? await resolveImageToDataUri(sourceImage) : undefined;

    // ─────────────────────────────────────────────────────────────────────
    // Generate Image with Smart Fallback
    // ─────────────────────────────────────────────────────────────────────
    const spinner = json
      ? null
      : ora(sourceImageData ? "Generating image from source..." : "Generating image...").start();

    try {
      let imageBuffer: Buffer;
      let modelUsed: string;

      // Determine models to try
      const primaryModel = model || getPrimaryModel(aiProvider);
      // If the user explicitly specified a model, disable fallbacks so we
      // honour their choice strictly and fail fast if it doesn't work.
      const fallbackModels = model ? [] : getFallbackModels(aiProvider);

      // Pass aspect ratio and image size to generation
      const imageConfig: { aspectRatio?: string; imageSize?: string } = {};
      if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
      if (imageSize) imageConfig.imageSize = imageSize;

      if (aiProvider === "openrouter") {
        ({ buffer: imageBuffer, modelUsed } = await this.generateWithFallback(
          prompt,
          size,
          apiKey,
          "openrouter",
          { primary: primaryModel, fallbacks: fallbackModels },
          spinner,
          sourceImageData,
          imageConfig
        ));
      } else {
        if (spinner) spinner.fail();
        throw new Error(`Unsupported AI provider: ${aiProvider}. Only 'openrouter' is supported.`);
      }

      // ─────────────────────────────────────────────────────────────────────
      // Save Image
      // ─────────────────────────────────────────────────────────────────────
      const outputPath = resolve(output);
      writeFileSync(outputPath, imageBuffer);

      if (spinner) {
        spinner.succeed(`Image generated and saved to: ${outputPath}`);
      }

      // ─────────────────────────────────────────────────────────────────────
      // Output
      // ─────────────────────────────────────────────────────────────────────
      if (json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              prompt,
              output: outputPath,
              size,
              provider: aiProvider,
              modelUsed,
            },
            null,
            2
          )
        );
      } else {
        console.log("\n🎨 Image Generation Complete!");
        console.log("─────────────────────────────────────");
        console.log(`Prompt: ${prompt}`);
        console.log(`Size: ${size}`);
        if (sourceImageData) {
          console.log(`Source Image: ${sourceImage}`);
        }
        console.log(`Output: ${outputPath}`);
        console.log(`Provider: ${aiProvider}`);
        if (model) {
          console.log(`Model: ${model}`);
        }
        console.log("─────────────────────────────────────\n");
      }
      process.exit(0);
    } catch (error) {
      if (spinner && spinner.isSpinning) {
        spinner.fail("Image generation failed");
      }
      throw error;
    }
  }

  /**
   * Generate image with smart fallback chain
   * Tries primary model first, then falls back to alternatives if it fails
   */
  private async generateWithFallback(
    prompt: string,
    size: string,
    apiKey: string,
    provider: "openrouter",
    config: { primary: string | null; fallbacks: string[] },
    spinner: {
      text: string;
      info: (msg: string) => void;
      warn: (msg: string) => void;
      isSpinning?: boolean;
    } | null,
    sourceImageData?: string,
    imageConfig?: { aspectRatio?: string; imageSize?: string }
  ): Promise<{ buffer: Buffer; modelUsed: string }> {
    const modelsToTry = [config.primary, ...config.fallbacks].filter(
      (model): model is string => model !== null
    );

    let lastError: Error | null = null;

    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];

      try {
        if (spinner) {
          const modelName = model.split("/").pop() || model;
          spinner.text = `Generating image with ${modelName}... (attempt ${i + 1}/${modelsToTry.length})`;
        }

        const imageBuffer = await this.generateWithModel(
          prompt,
          size,
          apiKey,
          provider,
          model,
          sourceImageData,
          imageConfig
        );

        if (spinner && i > 0) {
          // Only show fallback message if we had to fall back
          spinner.info(`Successfully generated with fallback model: ${model}`);
        }

        return { buffer: imageBuffer, modelUsed: model };
      } catch (error) {
        lastError = error as Error;

        // If this wasn't the last model, log the failure and try the next one
        if (i < modelsToTry.length - 1) {
          if (spinner) {
            spinner.warn(`Model ${model} failed, trying fallback...`);
          } else {
            console.warn(`Model ${model} failed: ${lastError.message}`);
          }
          continue;
        }
      }
    }

    // If we get here, all models failed
    throw new Error(
      `All models failed to generate image. Last error: ${lastError?.message || "Unknown error"}`
    );
  }

  /**
   * Generate image using a specific model
   */
  private async generateWithModel(
    prompt: string,
    size: string,
    apiKey: string,
    provider: "openrouter",
    model: string,
    sourceImageData?: string,
    imageConfig?: { aspectRatio?: string; imageSize?: string }
  ): Promise<Buffer> {
    // ─────────────────────────────────────────────────────────────────────
    // OPENROUTER (Via Fetch / Chat Completions)
    // ─────────────────────────────────────────────────────────────────────
    if (provider === "openrouter") {
      // Calculate aspect ratio from size if not provided
      let aspectRatio = imageConfig?.aspectRatio || "1:1";
      if (!imageConfig?.aspectRatio) {
        const [width, height] = size.split("x").map(Number);
        if (width && height) {
          const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
          const divisor = gcd(width, height);
          const calculated = `${width / divisor}:${height / divisor}`;

          // Map calculated ratio to supported OpenRouter ratios
          const supportedRatios: Record<string, string> = {
            "1:1": "1:1",
            "2:3": "2:3",
            "3:2": "3:2",
            "3:4": "3:4",
            "4:3": "4:3",
            "4:5": "4:5",
            "5:4": "5:4",
            "9:16": "9:16",
            "16:9": "16:9",
            "21:9": "21:9",
            // Common unsupported ratios mapped to closest supported
            "7:4": "16:9", // 1792x1024
            "4:7": "9:16", // 1024x1792
            "64:27": "21:9", // ultrawide variants
          };

          aspectRatio = supportedRatios[calculated] || "1:1";
        }
      }

      // Build messages array
      let content: Array<{ type: string; text?: string; image_url?: { url: string } }> | string;
      if (sourceImageData) {
        // Image-to-image generation: include source image in content
        content = [
          {
            type: "text",
            text: prompt,
          },
          {
            type: "image_url",
            image_url: {
              url: sourceImageData,
            },
          },
        ];
      } else {
        // Text-to-image generation: just the prompt
        content = prompt;
      }

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://clawbr.bricks-studio.ai",
          "X-Title": "clawbr-social CLI",
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: "user",
              content: content,
            },
          ],
          // Specific to Gemini/OpenRouter multimodal
          modalities: ["image", "text"],
          ...(aspectRatio || imageConfig?.imageSize
            ? {
                image_config: {
                  ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
                  ...(imageConfig?.imageSize ? { image_size: imageConfig.imageSize } : {}),
                },
              }
            : {}),
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
          const imgRes = await fetch(imageUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            },
          });
          const arrayBuffer = await imgRes.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }

        // If it's base64 data URI
        if (imageUrl.startsWith("data:image")) {
          const base64Data = imageUrl.split(",")[1];
          return Buffer.from(base64Data, "base64");
        }

        throw new Error("Unknown image URL format");
      }

      throw new Error("No image generated from OpenRouter response");
    }

    throw new Error(`Unsupported provider: ${provider}`);
  }

  @Option({
    flags: "-p, --prompt <text>",
    description: "Text description of the image to generate",
  })
  parsePrompt(val: string): string {
    return val;
  }

  @Option({
    flags: "-o, --output <path>",
    description: "Path where the generated image will be saved",
  })
  parseOutput(val: string): string {
    return val;
  }

  @Option({
    flags: "-s, --size <size>",
    description: "Image size (256x256, 512x512, 1024x1024, 1792x1024, 1024x1792)",
  })
  parseSize(val: string): string {
    return val;
  }

  @Option({
    flags: "--source-image <path>",
    description: "Path to source image or URL (for image-to-image generation, OpenRouter only)",
  })
  parseSourceImage(val: string): string {
    return val;
  }

  @Option({
    flags: "-m, --model <modelId>",
    description:
      "Specific model to use (provider-dependent). Use model ID from your provider's list. Note: Not all models support reference images (--source-image).",
  })
  parseModel(val: string): string {
    return val;
  }

  @Option({
    flags: "--aspect-ratio <ratio>",
    description:
      "Aspect ratio for generated image (OpenRouter only). Supported: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9",
  })
  parseAspectRatio(val: string): string {
    return val;
  }

  @Option({
    flags: "--image-size <size>",
    description:
      "Image resolution size (OpenRouter only). Supported: 1K (standard), 2K (higher), 4K (highest)",
  })
  parseImageSize(val: string): string {
    return val;
  }

  @Option({
    flags: "--json",
    description: "Output result in JSON format",
  })
  parseJson(): boolean {
    return true;
  }
}
