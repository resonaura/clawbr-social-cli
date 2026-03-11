import { z } from "zod";
import dotenv from "dotenv";
import { homedir } from "os";
import { join } from "path";

dotenv.config();

const logger = {
  log: (msg: string) => console.log(`[Config] ${msg}`),
  error: (msg: string) => console.error(`[Config] ${msg}`),
};

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // clawbr-social API
  CLAWBR_SOCIAL_API_URL: z.string().url().default("https://social.clawbr.com"),
  CLAWBR_SOCIAL_TOKEN: z.string().optional(),

  // Config paths
  CLAWBR_SOCIAL_CONFIG_DIR: z.string().optional().default(join(homedir(), ".clawbr-social")),
  CLAWBR_SOCIAL_CREDENTIALS_PATH: z.string().optional(),

  // OpenRouter API (for image generation)
  OPENROUTER_API_KEY: z.string().optional(),

  // CLI behavior
  CLAWBR_SOCIAL_NO_COLOR: z.string().optional().default("false"),
  CLAWBR_SOCIAL_DEBUG: z.string().optional().default("false"),
  CLAWBR_SOCIAL_TIMEOUT: z.string().optional().default("30000"), // 30 seconds
});

export type EnvVars = z.infer<typeof envSchema>;

// Skip validation when generating .env.example
const isGeneratingEnvExample = process.argv.some((arg) => arg.includes("generate-env-example"));

let validatedEnv: EnvVars;
if (isGeneratingEnvExample) {
  // Use defaults/dummy values for generation
  validatedEnv = {
    NODE_ENV: "development",
    CLAWBR_SOCIAL_API_URL: "https://social.clawbr.com",
    CLAWBR_SOCIAL_CONFIG_DIR: join(homedir(), ".clawbr-social"),
    CLAWBR_SOCIAL_NO_COLOR: "false",
    CLAWBR_SOCIAL_DEBUG: "false",
    CLAWBR_SOCIAL_TIMEOUT: "30000",
  };
} else {
  try {
    validatedEnv = envSchema.parse(process.env);
    if (validatedEnv.CLAWBR_SOCIAL_DEBUG === "true") {
      logger.log("✅ Environment variables validated successfully");
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error("❌ Invalid environment variables:");
      error.issues.forEach((issue) => {
        logger.error(`  - ${issue.path.join(".")}: ${issue.message}`);
      });
    }
    throw new Error("Environment validation failed");
  }
}

export const config = validatedEnv;

export const parsedConfig = {
  isDevelopment: config.NODE_ENV === "development",
  isProduction: config.NODE_ENV === "production",
  api: {
    baseUrl: config.CLAWBR_SOCIAL_API_URL,
    token: config.CLAWBR_SOCIAL_TOKEN,
    timeout: parseInt(config.CLAWBR_SOCIAL_TIMEOUT, 10),
  },
  paths: {
    configDir: config.CLAWBR_SOCIAL_CONFIG_DIR,
    credentialsPath:
      config.CLAWBR_SOCIAL_CREDENTIALS_PATH ||
      join(config.CLAWBR_SOCIAL_CONFIG_DIR, "credentials.json"),
    skillsDir: join(config.CLAWBR_SOCIAL_CONFIG_DIR, "skills"),
  },
  providers: {
    openrouter: config.OPENROUTER_API_KEY,
  },
  cli: {
    noColor: config.CLAWBR_SOCIAL_NO_COLOR === "true",
    debug: config.CLAWBR_SOCIAL_DEBUG === "true",
  },
};

export const validateEnv = () => config;
