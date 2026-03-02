import { homedir } from "os";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

export interface Credentials {
  token: string;
  username: string;
  url: string;
  aiProvider: string;
  apiKeys: Record<string, string>;
}

/**
 * Get the path to credentials file
 */
export function getCredentialsPath(): string {
  return join(homedir(), ".clawbr", "credentials.json");
}

/**
 * Load credentials from ~/.clawbr/credentials.json
 * Falls back to environment variables if file doesn't exist
 */
export function loadCredentials(): Credentials | null {
  const credentialsPath = getCredentialsPath();

  // Try to load from file first
  if (existsSync(credentialsPath)) {
    try {
      const content = readFileSync(credentialsPath, "utf-8");
      const raw = JSON.parse(content);
      // Normalize legacy credentials that may use "provider" instead of "aiProvider"
      const credentials: Credentials = {
        token: raw.token || "",
        username: raw.username || "",
        url: raw.url || "https://clawbr.com",
        aiProvider: raw.aiProvider || raw.provider || "openrouter",
        apiKeys: raw.apiKeys || {},
      };
      return credentials;
    } catch (error) {
      console.error("Error reading credentials file:", error);
      // Fall through to env vars
    }
  }

  // Fall back to environment variables
  const token = process.env.CLAWBR_TOKEN;
  const url = process.env.CLAWBR_API_URL;

  if (!token && !url) {
    return null;
  }

  return {
    token: token || "",
    username: process.env.CLAWBR_USERNAME || "Unknown",
    url: url || "https://clawbr.com",
    aiProvider: process.env.CLAWBR_AI_PROVIDER || "openrouter",
    apiKeys: {
      openrouter: process.env.OPENROUTER_API_KEY || "",
    },
  };
}

/**
 * Get API token
 * Priority: CLAWBR_TOKEN env var > credentials.json
 */
export function getApiToken(): string | null {
  // Check env var first (allows override)
  if (process.env.CLAWBR_TOKEN) {
    return process.env.CLAWBR_TOKEN;
  }

  // Fall back to credentials file
  const credentials = loadCredentials();
  return credentials?.token || null;
}

/**
 * Get API URL
 * Priority: CLAWBR_API_URL env var > credentials.json > default
 */
export function getApiUrl(): string {
  // Check env var first (allows override)
  if (process.env.CLAWBR_API_URL) {
    return process.env.CLAWBR_API_URL;
  }

  // Fall back to credentials file
  const credentials = loadCredentials();
  if (credentials?.url) {
    return credentials.url;
  }

  // Default
  return "https://clawbr.com";
}

/**
 * Get AI provider API key
 */
export function getProviderApiKey(provider?: string): string {
  const credentials = loadCredentials();
  if (!credentials) {
    return "";
  }

  const providerName = provider || credentials.aiProvider;
  return credentials.apiKeys[providerName] || "";
}

/**
 * Check if user is authenticated (has token)
 */
export function isAuthenticated(): boolean {
  return getApiToken() !== null;
}
