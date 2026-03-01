/**
 * Image Generation Models Configuration
 *
 * Defines available models for each AI provider with their capabilities.
 * Used by generate command to validate and select appropriate models.
 */

export interface ImageModel {
  id: string;
  name: string;
  supportsReferenceImage: boolean;
  supportsCustomSize: boolean;
  description?: string;
}

export interface ProviderModels {
  primary: string;
  fallbacks: string[];
  models: ImageModel[];
}

export const IMAGE_MODELS: Record<string, ProviderModels> = {
  openrouter: {
    primary: "google/gemini-2.5-flash-image",
    fallbacks: [
      "google/gemini-3-pro-image-preview",
      "openai/gpt-5-image",
      "sourceful/riverflow-v2-pro",
      "black-forest-labs/flux.2-pro",
    ],
    models: [
      {
        id: "google/gemini-2.5-flash-image",
        name: "Gemini 2.5 Flash Image (Nano Banana)",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "Fast, affordable image generation with reference image support",
      },
      {
        id: "google/gemini-2.5-flash-image-preview",
        name: "Gemini 2.5 Flash Image Preview",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "Preview version of Gemini 2.5 Flash",
      },
      {
        id: "google/gemini-3-pro-image-preview",
        name: "Nano Banana Pro (Gemini 3 Pro)",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "Professional graphics, 4K, multi-subject support",
      },

      {
        id: "black-forest-labs/flux.2-pro",
        name: "FLUX.2 Pro",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "High-quality image generation with reference support",
      },
      {
        id: "black-forest-labs/flux.2-flex",
        name: "FLUX.2 Flex",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "Flexible FLUX variant for diverse styles",
      },
      {
        id: "openai/gpt-5-image",
        name: "GPT-5 Image",
        supportsReferenceImage: false,
        supportsCustomSize: true,
        description: "OpenAI's GPT-5 image generation (via OpenRouter)",
      },
      {
        id: "openai/gpt-5-image-mini",
        name: "GPT-5 Image Mini",
        supportsReferenceImage: false,
        supportsCustomSize: true,
        description: "Lightweight GPT-5 image generation (via OpenRouter)",
      },
      {
        id: "black-forest-labs/flux.2-max",
        name: "FLUX.2 Max",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "Maximum quality FLUX generation",
      },
      {
        id: "black-forest-labs/flux.2-klein-4b",
        name: "FLUX.2 Klein 4B",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "Compact FLUX model",
      },
      {
        id: "sourceful/riverflow-v2-fast",
        name: "Riverflow V2 Fast",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "Fast unified t2i/i2i model",
      },
      {
        id: "sourceful/riverflow-v2-fast-preview",
        name: "Riverflow V2 Fast Preview",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "Preview version of Riverflow V2 Fast",
      },
      {
        id: "sourceful/riverflow-v2-standard-preview",
        name: "Riverflow V2 Standard Preview",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "Standard Riverflow with t2i/i2i support",
      },
      {
        id: "sourceful/riverflow-v2-max-preview",
        name: "Riverflow V2 Max Preview",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "Maximum quality Riverflow generation",
      },
      {
        id: "sourceful/riverflow-v2-pro",
        name: "Riverflow V2 Pro",
        supportsReferenceImage: true,
        supportsCustomSize: true,
        description: "Professional Riverflow with advanced features",
      },
      {
        id: "bytedance-seed/seedream-4.5",
        name: "SeedReam 4.5",
        supportsReferenceImage: false,
        supportsCustomSize: true,
        description: "ByteDance's SeedReam image generation",
      },
    ],
  },
};

/**
 * Get available models for a provider
 */
export function getProviderModels(provider: string): ImageModel[] {
  const providerConfig = IMAGE_MODELS[provider];
  if (!providerConfig) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return providerConfig.models;
}

/**
 * Get model by ID for a provider
 */
export function getModelById(provider: string, modelId: string): ImageModel | undefined {
  const models = getProviderModels(provider);
  return models.find((m) => m.id === modelId);
}

/**
 * Validate if a model exists for a provider
 */
export function isValidModel(provider: string, modelId: string): boolean {
  return getModelById(provider, modelId) !== undefined;
}

/**
 * Get primary model for a provider
 */
export function getPrimaryModel(provider: string): string {
  const providerConfig = IMAGE_MODELS[provider];
  if (!providerConfig) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return providerConfig.primary;
}

/**
 * Get fallback models for a provider
 */
export function getFallbackModels(provider: string): string[] {
  const providerConfig = IMAGE_MODELS[provider];
  if (!providerConfig) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return providerConfig.fallbacks;
}

/**
 * Check if a model supports reference images
 */
export function supportsReferenceImage(provider: string, modelId: string): boolean {
  const model = getModelById(provider, modelId);
  return model?.supportsReferenceImage ?? false;
}

/**
 * Get list of models that support reference images for a provider
 */
export function getModelsWithReferenceSupport(provider: string): ImageModel[] {
  return getProviderModels(provider).filter((m) => m.supportsReferenceImage);
}

/**
 * Format model list for display
 */
export function formatModelList(provider: string): string {
  const models = getProviderModels(provider);
  return models
    .map((m) => {
      const refSupport = m.supportsReferenceImage ? " [supports reference images]" : "";
      return `  • ${m.id}${refSupport}\n    ${m.description || ""}`;
    })
    .join("\n\n");
}
