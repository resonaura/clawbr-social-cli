import fetch from "node-fetch";

/**
 * AI provider types
 */
export type AIProvider = "openrouter" | "google" | "openai";

/**
 * Vision analysis configuration
 */
export interface VisionConfig {
  provider: AIProvider;
  apiKey: string;
  model?: string;
}

/**
 * Default models for each provider
 */
const DEFAULT_MODELS = {
  openrouter: "anthropic/claude-3.5-sonnet",
  google: "gemini-2.5-flash",
  openai: "gpt-4o",
};

/**
 * Analyze image using OpenRouter
 */
async function analyzeWithOpenRouter(
  imageData: string,
  prompt: string,
  apiKey: string,
  model?: string
): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://clawbr.bricks-studio.ai",
      "X-Title": "clawbr-social CLI",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.openrouter,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
            {
              type: "image_url",
              image_url: {
                url: imageData,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error: ${errorText}`);
  }

  const result = (await response.json()) as any;
  return result.choices?.[0]?.message?.content || "No response";
}

/**
 * Analyze image using Google Gemini
 */
async function analyzeWithGoogle(
  imageData: string,
  prompt: string,
  apiKey: string,
  model?: string
): Promise<string> {
  const modelName = model || DEFAULT_MODELS.google;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
              {
                inline_data: {
                  mime_type: imageData.startsWith("data:image")
                    ? imageData.split(";")[0].split(":")[1]
                    : "image/jpeg",
                  data: imageData.startsWith("data:image") ? imageData.split(",")[1] : imageData,
                },
              },
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API error: ${errorText}`);
  }

  const result = (await response.json()) as any;
  return result.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
}

/**
 * Analyze image using OpenAI
 */
async function analyzeWithOpenAI(
  imageData: string,
  prompt: string,
  apiKey: string,
  model?: string
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.openai,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
            {
              type: "image_url",
              image_url: {
                url: imageData,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${errorText}`);
  }

  const result = (await response.json()) as any;
  return result.choices?.[0]?.message?.content || "No response";
}

/**
 * Analyze image using configured AI provider
 */
export async function analyzeImage(
  config: VisionConfig,
  imageData: string,
  prompt: string = "Describe this image in detail."
): Promise<string> {
  const { provider, apiKey, model } = config;

  switch (provider) {
    case "openrouter":
      return analyzeWithOpenRouter(imageData, prompt, apiKey, model);
    case "google":
      return analyzeWithGoogle(imageData, prompt, apiKey, model);
    case "openai":
      return analyzeWithOpenAI(imageData, prompt, apiKey, model);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}
