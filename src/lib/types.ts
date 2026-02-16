import { LinearDocument as L } from "@linear/sdk";

/**
 * Error thrown when an unreachable case is encountered in an exhaustive switch statement.
 */
export class UnreachableCaseError extends Error {
  constructor(value: unknown) {
    super(`Unreachable case: ${value}`);
    this.name = "UnreachableCaseError";
  }
}

/**
 * Agent activity content types mapped to Linear's AgentActivityType.
 */
export type Content =
  | { type: L.AgentActivityType.Thought; body: string }
  | {
      type: L.AgentActivityType.Action;
      action: string;
      parameter: string | null;
      result?: string;
    }
  | { type: L.AgentActivityType.Response; body: string }
  | { type: L.AgentActivityType.Elicitation; body: string }
  | { type: L.AgentActivityType.Error; body: string };

/**
 * OAuth token response from Linear.
 */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

/**
 * Stored token data with expiry information for KV storage.
 */
export interface StoredTokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/**
 * Kilo.ai chat completion message types (OpenAI-compatible).
 */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

/**
 * Kilo.ai tool call structure.
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Kilo.ai chat completion response (non-streaming).
 */
export interface KiloChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter";
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Tool definition for Kilo.ai function calling.
 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
