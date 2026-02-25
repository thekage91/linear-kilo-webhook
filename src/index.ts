import { LinearWebhookClient } from "@linear/sdk/webhooks";
import {
  handleOAuthAuthorize,
  handleOAuthCallback,
  getOAuthToken,
} from "./lib/oauth";
import { AgentClient } from "./lib/agent/agentClient";
import { ClaudeCodeAgent } from "./lib/agent/claudeCodeAgent";

/**
 * Linear Agent Worker
 *
 * Supports two agent types selected via the AGENT_TYPE environment variable:
 *
 * - "kilo"        (default) — general-purpose agent powered by Kilo.ai gateway
 * - "claude-code" — software engineering agent powered by Anthropic API directly,
 *                   with native tool calling and structured Linear feedback
 *
 * Both agents share the same OAuth installation flow and webhook endpoint.
 * Deploy separate Worker instances with different AGENT_TYPE values to run
 * both agents in parallel (each registered as a distinct Linear agent).
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const agentType = env.AGENT_TYPE || "kilo";

    // Health check
    if (url.pathname === "/") {
      return new Response(
        JSON.stringify({
          name: agentType === "claude-code" ? "Linear Claude Code Agent" : "Linear Kilo Agent",
          status: "healthy",
          version: "1.0.0",
          agentType,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // OAuth: initiate agent installation
    if (url.pathname === "/oauth/authorize") {
      return handleOAuthAuthorize(request, env);
    }

    // OAuth: handle callback after user authorizes
    if (url.pathname === "/oauth/callback") {
      return handleOAuthCallback(request, env);
    }

    // Webhook: receive Linear agent session events
    if (url.pathname === "/webhook" && request.method === "POST") {
      if (!env.LINEAR_WEBHOOK_SECRET) {
        return new Response("Webhook secret not configured", { status: 500 });
      }

      if (agentType === "claude-code") {
        if (!env.ANTHROPIC_API_KEY) {
          return new Response("Anthropic API key not configured", { status: 500 });
        }
      } else {
        if (!env.KILO_API_KEY) {
          return new Response("Kilo API key not configured", { status: 500 });
        }
      }

      return this.handleWebhook(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },

  /**
   * Handle incoming webhooks using the Linear SDK's webhook client.
   * Validates the signature and routes agent session events to the correct agent.
   */
  async handleWebhook(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    try {
      const webhookClient = new LinearWebhookClient(env.LINEAR_WEBHOOK_SECRET);
      const handler = webhookClient.createHandler();

      handler.on("AgentSessionEvent", async (payload) => {
        // Use waitUntil to process asynchronously — return 200 to Linear within 5 seconds
        ctx.waitUntil(this.handleAgentSessionEvent(payload, env));
      });

      return await handler(request);
    } catch (error) {
      console.error("Webhook handler error:", error);
      return new Response("Error handling webhook", { status: 500 });
    }
  },

  /**
   * Process an AgentSessionEvent webhook.
   *
   * Routes to either the Kilo agent or the Claude Code agent based on AGENT_TYPE.
   * Handles both 'created' (new session) and 'prompted' (follow-up via comment) events.
   */
  async handleAgentSessionEvent(webhook: any, env: Env): Promise<void> {
    const token = await getOAuthToken(env, webhook.organizationId);
    if (!token) {
      console.error(
        `No OAuth token found for organization ${webhook.organizationId}`
      );
      return;
    }

    const agentType = env.AGENT_TYPE || "kilo";
    const agentSessionId = webhook.agentSession.id;
    const action = webhook.action;

    if (agentType === "claude-code") {
      await this.handleWithClaudeCodeAgent(
        token,
        env,
        agentSessionId,
        action,
        webhook
      );
    } else {
      await this.handleWithKiloAgent(
        token,
        env,
        agentSessionId,
        action,
        webhook
      );
    }
  },

  /**
   * Route the session event to the Claude Code agent.
   *
   * Uses Anthropic API directly with native tool calling.
   * The agent emits structured activities (think / report_action / respond / ask)
   * that are immediately visible in Linear.
   */
  async handleWithClaudeCodeAgent(
    token: string,
    env: Env,
    agentSessionId: string,
    action: string,
    webhook: any
  ): Promise<void> {
    const model = env.CLAUDE_MODEL || "claude-opus-4-5-20251101";
    const agent = new ClaudeCodeAgent(token, env.ANTHROPIC_API_KEY, model);

    if (action === "created") {
      const userPrompt = this.buildUserPrompt(webhook);
      const promptContext = webhook.promptContext as string | undefined;
      await agent.handleUserPrompt(agentSessionId, userPrompt, promptContext);
    } else if (action === "prompted") {
      const followUpMessage = webhook.agentActivity?.body as string | undefined;
      if (followUpMessage) {
        await agent.handleUserPrompt(agentSessionId, followUpMessage);
      }
    }
  },

  /**
   * Route the session event to the existing Kilo agent.
   */
  async handleWithKiloAgent(
    token: string,
    env: Env,
    agentSessionId: string,
    action: string,
    webhook: any
  ): Promise<void> {
    const model = env.KILO_MODEL || "anthropic/claude-sonnet-4-20250514";
    const promptMode = env.AGENT_PROMPT_MODE || "general";
    const agentClient = new AgentClient(
      token,
      env.KILO_API_KEY,
      model,
      promptMode
    );

    if (action === "created") {
      const userPrompt = this.buildUserPrompt(webhook);
      const promptContext = webhook.promptContext as string | undefined;
      await agentClient.handleUserPrompt(
        agentSessionId,
        userPrompt,
        promptContext
      );
    } else if (action === "prompted") {
      const followUpMessage = webhook.agentActivity?.body as string | undefined;
      if (followUpMessage) {
        await agentClient.handleUserPrompt(agentSessionId, followUpMessage);
      }
    }
  },

  /**
   * Build the initial user prompt from the webhook payload.
   * Combines issue title, description, and optional comment body.
   */
  buildUserPrompt(webhook: any): string {
    const issue = webhook.agentSession.issue;
    const comment = webhook.agentSession.comment;

    const parts: string[] = [];

    if (issue?.title) {
      parts.push(`**Issue:** ${issue.title}`);
    }

    if (issue?.description) {
      parts.push(`**Description:**\n${issue.description}`);
    }

    if (comment?.body) {
      parts.push(`**User message:**\n${comment.body}`);
    }

    return parts.join("\n\n") || "No context provided.";
  },
};
