import Anthropic from "@anthropic-ai/sdk";
import { LinearClient, LinearDocument as L } from "@linear/sdk";
import { CLAUDE_CODE_SYSTEM_PROMPT } from "./claudeCodePrompt";

const MAX_TOOL_CALLS = 40;

/**
 * Tool definitions for the Claude Code agent.
 *
 * Each tool maps directly to a Linear Agent Activity type:
 * - think      → AgentActivityType.Thought
 * - report_action → AgentActivityType.Action
 * - respond    → AgentActivityType.Response  (ends the turn)
 * - ask        → AgentActivityType.Elicitation  (pauses for user input)
 */
const CLAUDE_CODE_TOOLS: Anthropic.Tool[] = [
  {
    name: "think",
    description:
      "Share your reasoning, analysis, or planning as a thought visible in Linear. Use this to reason step-by-step before taking actions. Call it multiple times as your thinking evolves.",
    input_schema: {
      type: "object",
      properties: {
        reasoning: {
          type: "string",
          description:
            "Your internal analysis, planning, or reasoning. Supports Markdown.",
        },
      },
      required: ["reasoning"],
    },
  },
  {
    name: "report_action",
    description:
      "Announce a concrete step you are currently taking (e.g. 'Creating Flyway migration', 'Refactoring SupplierService'). Appears as an action activity in Linear.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Short label for the action (e.g. 'Writing unit tests')",
        },
        details: {
          type: "string",
          description:
            "Optional: additional context about what or why. Supports Markdown.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "respond",
    description:
      "Deliver your final answer, solution, or code to the user. This ends the current session turn. Use Markdown and fenced code blocks.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "One-sentence summary of what was accomplished.",
        },
        body: {
          type: "string",
          description:
            "Full response content with code, explanations, and next steps. Supports Markdown.",
        },
      },
      required: ["summary", "body"],
    },
  },
  {
    name: "ask",
    description:
      "Ask the user a specific clarifying question when you lack critical information to proceed. This pauses the session — the user can reply via a Linear comment to continue.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The specific question to ask.",
        },
        context: {
          type: "string",
          description:
            "Why this information is needed to complete the task.",
        },
      },
      required: ["question"],
    },
  },
];

type ToolInput = Record<string, string>;

/**
 * Claude Code Agent — bridges Linear issues with Anthropic's Claude model
 * using native tool calling for structured, real-time feedback.
 *
 * Architecture:
 * - Linear assigns issue or user comments  →  webhook fires  →  this agent runs
 * - Agent uses Anthropic SDK tool calls to emit activities back to Linear
 * - Each tool call is immediately reflected as an Agent Activity in Linear
 * - Users can interact by replying via Linear comments (triggers `prompted` webhook)
 */
export class ClaudeCodeAgent {
  private linearClient: LinearClient;
  private anthropic: Anthropic;
  private model: string;

  constructor(
    linearAccessToken: string,
    anthropicApiKey: string,
    model: string = "claude-opus-4-5-20251101"
  ) {
    this.linearClient = new LinearClient({ accessToken: linearAccessToken });
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
    this.model = model;
  }

  /**
   * Entry point for both new sessions (issue assigned) and follow-ups (user comment).
   *
   * For new sessions: promptContext contains the full issue detail provided by Linear.
   * For follow-ups: message history is reconstructed from previous session activities.
   */
  public async handleUserPrompt(
    agentSessionId: string,
    userPrompt: string,
    promptContext?: string
  ): Promise<void> {
    // Acknowledge immediately — Linear requires a response within 10 seconds
    await this.linearClient.createAgentActivity({
      agentSessionId,
      content: {
        type: "thought",
        body: "Starting Claude Code session...",
      },
    });

    // Rebuild conversation history from previous session activities
    const history = await this.buildMessageHistory(agentSessionId);

    // Compose the user message, injecting the full issue context when available
    const fullUserMessage = promptContext
      ? `${promptContext}\n\n---\n\n**Request:**\n${userPrompt}`
      : userPrompt;

    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: "user", content: fullUserMessage },
    ];

    await this.runAgentLoop(agentSessionId, messages);
  }

  /**
   * Main agentic loop.
   *
   * Calls Claude with tools enabled. For each tool use block in the response:
   * - Execute the tool (post an activity to Linear, etc.)
   * - Append the tool result to the conversation
   * - Continue until `respond` / `ask` is called or stop_reason is `end_turn`
   */
  private async runAgentLoop(
    agentSessionId: string,
    messages: Anthropic.MessageParam[]
  ): Promise<void> {
    let toolCallCount = 0;
    let sessionDone = false;

    while (!sessionDone && toolCallCount < MAX_TOOL_CALLS) {
      let response: Anthropic.Message;

      try {
        response = await this.anthropic.messages.create({
          model: this.model,
          max_tokens: 8192,
          system: CLAUDE_CODE_SYSTEM_PROMPT,
          messages,
          tools: CLAUDE_CODE_TOOLS,
        });
      } catch (error) {
        await this.postError(
          agentSessionId,
          `Anthropic API error: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
      }

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );

      // If Claude responds with plain text and no tool use, post it as a final response
      if (textBlocks.length > 0 && toolUseBlocks.length === 0) {
        const responseText = textBlocks.map((b) => b.text).join("\n\n");
        await this.linearClient.createAgentActivity({
          agentSessionId,
          content: { type: "response", body: responseText },
        });
        return;
      }

      // End turn with no content — nothing to do
      if (toolUseBlocks.length === 0) {
        return;
      }

      // Append assistant's full response (may include text + tool_use blocks)
      messages.push({ role: "assistant", content: response.content });

      // Process tool calls and gather results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        toolCallCount++;
        const { resultContent, terminates } = await this.dispatchTool(
          agentSessionId,
          toolUse
        );

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: resultContent,
        });

        if (terminates) {
          sessionDone = true;
        }
      }

      // Feed tool results back into the conversation
      messages.push({ role: "user", content: toolResults });

      if (sessionDone || response.stop_reason === "end_turn") {
        return;
      }
    }

    if (toolCallCount >= MAX_TOOL_CALLS) {
      await this.postError(
        agentSessionId,
        "The Claude Code session reached its tool call limit. Please break the task into smaller steps and try again."
      );
    }
  }

  /**
   * Dispatch a tool call: execute the corresponding Linear action and return
   * the string result for Claude plus a flag indicating whether this tool ends the session.
   */
  private async dispatchTool(
    agentSessionId: string,
    toolUse: Anthropic.ToolUseBlock
  ): Promise<{ resultContent: string; terminates: boolean }> {
    const input = toolUse.input as ToolInput;

    try {
      switch (toolUse.name) {
        case "think": {
          await this.linearClient.createAgentActivity({
            agentSessionId,
            content: {
              type: L.AgentActivityType.Thought,
              body: input.reasoning,
            },
          });
          return { resultContent: "Thought posted.", terminates: false };
        }

        case "report_action": {
          const parameter = input.details
            ? `${input.action}\n\n${input.details}`
            : input.action;

          await this.linearClient.createAgentActivity({
            agentSessionId,
            content: {
              type: L.AgentActivityType.Action,
              action: "execute",
              parameter,
            },
          });
          return { resultContent: "Action reported.", terminates: false };
        }

        case "respond": {
          const body = `**${input.summary}**\n\n${input.body}`;
          await this.linearClient.createAgentActivity({
            agentSessionId,
            content: {
              type: L.AgentActivityType.Response,
              body,
            },
          });
          return { resultContent: "Response delivered.", terminates: true };
        }

        case "ask": {
          const body = input.context
            ? `${input.question}\n\n*Why this is needed: ${input.context}*`
            : input.question;

          await this.linearClient.createAgentActivity({
            agentSessionId,
            content: {
              type: L.AgentActivityType.Elicitation,
              body,
            },
          });
          return {
            resultContent: "Question posted. Waiting for user reply.",
            terminates: true,
          };
        }

        default: {
          return {
            resultContent: `Unknown tool "${toolUse.name}".`,
            terminates: false,
          };
        }
      }
    } catch (error) {
      const msg = `Tool "${toolUse.name}" failed: ${error instanceof Error ? error.message : String(error)}`;
      await this.postError(agentSessionId, msg);
      return { resultContent: msg, terminates: true };
    }
  }

  /**
   * Reconstruct the conversation history from prior session activities.
   *
   * Prompt activities become user messages; Response activities become assistant messages.
   * This lets Claude maintain context across multi-turn comment interactions.
   */
  private async buildMessageHistory(
    agentSessionId: string
  ): Promise<Anthropic.MessageParam[]> {
    try {
      const agentSession =
        await this.linearClient.agentSession(agentSessionId);

      const allActivities: Array<{ content: { type: string; body?: string } }> =
        [];
      let activitiesPage = await agentSession.activities();
      allActivities.push(...activitiesPage.nodes);

      while (
        activitiesPage.pageInfo.hasNextPage &&
        activitiesPage.pageInfo.endCursor
      ) {
        activitiesPage = await agentSession.activities({
          after: activitiesPage.pageInfo.endCursor,
        });
        allActivities.push(...activitiesPage.nodes);
      }

      const messages: Anthropic.MessageParam[] = [];

      // Activities are returned newest-first; reverse for chronological order
      for (const activity of [...allActivities].reverse()) {
        const { type, body } = activity.content as {
          type: string;
          body?: string;
        };

        if (
          type === L.AgentActivityType.Prompt &&
          typeof body === "string" &&
          body.trim()
        ) {
          messages.push({ role: "user", content: body });
        } else if (
          type === L.AgentActivityType.Response &&
          typeof body === "string" &&
          body.trim()
        ) {
          messages.push({ role: "assistant", content: body });
        }
      }

      return messages;
    } catch {
      // If history can't be fetched, start fresh
      return [];
    }
  }

  private async postError(
    agentSessionId: string,
    message: string
  ): Promise<void> {
    await this.linearClient.createAgentActivity({
      agentSessionId,
      content: { type: L.AgentActivityType.Error, body: message },
    });
  }
}
