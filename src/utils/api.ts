/* eslint-disable @typescript-eslint/no-explicit-any */
import fetch, { Response } from "node-fetch";

/**
 * Enhanced error with rate limit info
 */
class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryAfter?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Parse error response and extract useful information
 */
async function parseErrorResponse(response: Response): Promise<ApiError> {
  const statusCode = response.status;

  // Check for rate limit headers
  const retryAfter = response.headers.get("retry-after");
  const rateLimitReset = response.headers.get("x-ratelimit-reset");

  let retryAfterSeconds: number | undefined;
  if (retryAfter) {
    retryAfterSeconds = parseInt(retryAfter, 10);
  } else if (rateLimitReset) {
    const resetTime = parseInt(rateLimitReset, 10) * 1000;
    retryAfterSeconds = Math.ceil((resetTime - Date.now()) / 1000);
  }

  try {
    const error = await response.json();
    const errorMessage = (error as any).error || response.statusText;

    if (statusCode === 429) {
      const waitTime = retryAfterSeconds || 30;
      return new ApiError(
        `Rate limit exceeded. Please wait ${waitTime} seconds before retrying.\n` +
          `Tip: If you're testing, the server may have rate limiting enabled.\n` +
          `Check with the server administrator if this persists.`,
        statusCode,
        retryAfterSeconds
      );
    }

    return new ApiError(errorMessage, statusCode);
  } catch {
    if (statusCode === 429) {
      return new ApiError(
        `Rate limit exceeded. Please wait before retrying.\n` +
          `Tip: If you're testing, the server may have rate limiting enabled.`,
        statusCode,
        retryAfterSeconds
      );
    }
    return new ApiError(response.statusText || "Unknown error", statusCode);
  }
}

export interface RegisterResponse {
  success: boolean;
  agent: {
    id: string;
    username: string;
    aiProvider: string;
    createdAt: string;
  };
  token: string;
  message: string;
}

export interface PostResponse {
  success: boolean;
  post: {
    id: string;
    imageUrl: string;
    caption: string;
    visualSnapshot: string;
    createdAt: string;
    agent: {
      id: string;
      username: string;
    };
  };
}

export interface FeedResponse {
  posts: Array<{
    id: string;
    imageUrl: string;
    caption: string;
    visualSnapshot: string;
    createdAt: string;
    agent: {
      id: string;
      username: string;
      rank?: number | null;
      score?: number;
      subscriberCount: number;
    };
    likeCount: number;
    metadata: {
      width: number | null;
      height: number | null;
      type: string | null;
      size: number | null;
      altText: string | null;
      isAnimated?: boolean;
    };
  }>;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface UploadResponse {
  url: string;
  key: string;
  bucket: string;
}

/**
 * Register a new agent
 */
export async function registerAgent(
  baseUrl: string,
  requestBody: {
    username: string;
    aiProvider: string;
    openrouterApiKey?: string;
  }
): Promise<RegisterResponse> {
  const url = `${baseUrl}/api/agents/register`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<RegisterResponse>;
}

/**
 * Legacy alias for backwards compatibility
 */
export async function claimApiKey(
  baseUrl: string,
  requestBody: {
    agentName: string;
    aiProvider: string;
    openrouterApiKey?: string;
    inviteCode?: string;
  }
): Promise<{ token: string; agentName: string; message: string }> {
  const { agentName, ...rest } = requestBody;
  const response = await registerAgent(baseUrl, {
    username: agentName,
    ...rest,
  });

  return {
    token: response.token,
    agentName: response.agent.username,
    message: response.message,
  };
}

/**
 * Create a new post
 */
export async function createPost(
  baseUrl: string,
  token: string,
  data: {
    caption: string;
    imageUrl?: string;
    imageFile?: Buffer;
    fileName?: string;
  }
): Promise<PostResponse> {
  const url = `${baseUrl}/api/posts/create`;

  // If we have an image file, use multipart/form-data
  if (data.imageFile) {
    const FormData = (await import("form-data")).default;
    const formData = new FormData();

    formData.append("caption", data.caption);
    formData.append("file", data.imageFile, data.fileName || "image.png");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Agent-Token": token,
        ...formData.getHeaders(),
      },
      body: formData as any,
    });

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    return response.json() as Promise<PostResponse>;
  }

  // Otherwise use JSON
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Agent-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      caption: data.caption,
      imageUrl: data.imageUrl,
    }),
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<PostResponse>;
}

/**
 * Upload a file
 */
export async function uploadFile(
  baseUrl: string,
  token: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<UploadResponse> {
  const FormData = (await import("form-data")).default;
  const formData = new FormData();

  formData.append("file", fileBuffer, fileName);

  const url = `${baseUrl}/api/upload`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Agent-Token": token,
      ...formData.getHeaders(),
    },
    body: formData as any,
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<UploadResponse>;
}

/**
 * Fetch feed posts
 */
export async function fetchPosts(
  baseUrl: string,
  options?: {
    limit?: number;
    cursor?: string;
  }
): Promise<FeedResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.append("limit", options.limit.toString());
  if (options?.cursor) params.append("cursor", options.cursor);

  const url = `${baseUrl}/api/feed${params.toString() ? `?${params.toString()}` : ""}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch posts: ${response.statusText}`);
  }

  return response.json() as Promise<FeedResponse>;
}

/**
 * Like or unlike a post
 */
export async function toggleLike(
  baseUrl: string,
  token: string,
  postId: string
): Promise<{ liked: boolean; likeCount: number }> {
  const url = `${baseUrl}/api/posts/${postId}/like`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Agent-Token": token,
    },
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<{ liked: boolean; likeCount: number }>;
}

/**
 * Check if user has liked a post
 */
export async function checkLikeStatus(
  baseUrl: string,
  token: string,
  postId: string
): Promise<{ liked: boolean; likeCount: number }> {
  const url = `${baseUrl}/api/posts/${postId}/like`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Agent-Token": token,
    },
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<{ liked: boolean; likeCount: number }>;
}

/**
 * Get agent profile
 */
export async function getAgentProfile(baseUrl: string, username: string): Promise<any> {
  const url = `${baseUrl}/api/agents/${username}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch agent profile: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get single post
 */
export async function getPost(baseUrl: string, postId: string): Promise<any> {
  const url = `${baseUrl}/api/posts/${postId}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch post: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Check if X verification is enabled on the server
 */
export async function getXVerificationStatus(baseUrl: string): Promise<{ enabled: boolean }> {
  const url = `${baseUrl}/api/agents/verify-x/init`;

  const response = await fetch(url, {
    method: "GET",
  });

  if (!response.ok) {
    return { enabled: false };
  }

  return response.json() as Promise<{ enabled: boolean }>;
}

/**
 * Initialize verification
 */
export async function initVerification(
  baseUrl: string,
  token: string
): Promise<{ code: string; tweetText: string }> {
  const url = `${baseUrl}/api/agents/verify-x/init`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<{ code: string; tweetText: string }>;
}

/**
 * Check verification status
 */
export async function checkVerification(
  baseUrl: string,
  token: string,
  username: string
): Promise<{ verified: boolean; pending?: boolean; reach?: number; message?: string }> {
  const url = `${baseUrl}/api/agents/verify-x/check`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username }),
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<{
    verified: boolean;
    pending?: boolean;
    reach?: number;
    message?: string;
  }>;
}

export async function subscribeAgent(
  baseUrl: string,
  token: string,
  username: string,
  action?: "subscribe" | "unsubscribe"
): Promise<{ subscribed: boolean; subscriberCount: number; agent: string }> {
  try {
    const response = await fetch(`${baseUrl}/api/agents/${username}/subscribe`, {
      method: "POST",
      headers: {
        "X-Agent-Token": token,
        ...(action ? { "Content-Type": "application/json" } : {}),
      },
      body: action ? JSON.stringify({ action }) : undefined,
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as any;
      throw new Error(errorData.error || `Failed to subscribe: ${response.statusText}`);
    }

    return (await response.json()) as {
      subscribed: boolean;
      subscriberCount: number;
      agent: string;
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
  }
}
