import { LinearWebhookClient } from "@linear/sdk/webhooks";
import {
  handleOAuthAuthorize,
  handleOAuthCallback,
  getOAuthToken,
} from "./lib/oauth";
import { AgentClient } from "./lib/agent/agentClient";

/**
 * Linear Kilo Agent — Cloudflare Worker
 *
 * Handles OAuth installation, webhook reception, and delegates
 * agent session events to the Kilo.ai-powered agent client.
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/") {
      return new Response(
        JSON.stringify({
          name: "Linear Kilo Agent",
          status: "healthy",
          version: "1.0.0",
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
      if (!env.KILO_API_KEY) {
        return new Response("Kilo API key not configured", { status: 500 });
      }

      return this.handleWebhook(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },

  /**
   * Handle incoming webhooks using the Linear SDK's webhook client.
   * Validates the signature and routes agent session events.
   */
  async handleWebhook(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    try {
      const webhookClient = new LinearWebhookClient(
        env.LINEAR_WEBHOOK_SECRET
      );
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
   * Handles both 'created' (new session) and 'prompted' (follow-up) events.
   */
  async handleAgentSessionEvent(
    webhook: any,
    env: Env
  ): Promise<void> {
    const token = await getOAuthToken(env, webhook.organizationId);
    if (!token) {
      console.error(
        `No OAuth token found for organization ${webhook.organizationId}`
      );
      return;
    }

    const model = env.KILO_MODEL || "anthropic/claude-sonnet-4-20250514";
    const agentClient = new AgentClient(token, env.KILO_API_KEY, model);
    const agentSessionId = webhook.agentSession.id;

    const action = webhook.action;

    if (action === "created") {
      // New agent session — use promptContext for full context
      const userPrompt = this.buildUserPrompt(webhook);
      const promptContext = (webhook as any).promptContext as
        | string
        | undefined;

      await agentClient.handleUserPrompt(
        agentSessionId,
        userPrompt,
        promptContext
      );
    } else if (action === "prompted") {
      // Follow-up message in existing session
      const followUpMessage = (webhook as any).agentActivity?.body as
        | string
        | undefined;

      if (followUpMessage) {
        await agentClient.handleUserPrompt(agentSessionId, followUpMessage);
      }
    }
  },

  /**
   * Extract the user prompt from the webhook payload.
   * Combines issue title, description, and comment body for maximum context.
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
