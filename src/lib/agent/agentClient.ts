import OpenAI from "openai";
import { LinearClient, LinearDocument as L } from "@linear/sdk";
import type { ChatCompletionMessageParam } from "openai/resources/index";
import { SYSTEM_PROMPT } from "./prompt";
import { Content, UnreachableCaseError } from "../types";

const KILO_BASE_URL = "https://api.kilo.ai/api/gateway";
const MAX_ITERATIONS = 15;

/**
 * Agent client that bridges Linear's Agent Session system with Kilo.ai's LLM gateway.
 *
 * Receives user prompts from Linear webhooks, processes them through Kilo.ai's
 * OpenAI-compatible API, and communicates results back via Linear Agent Activities.
 */
export class AgentClient {
  private linearClient: LinearClient;
  private kilo: OpenAI;
  private model: string;

  constructor(linearAccessToken: string, kiloApiKey: string, model: string) {
    this.linearClient = new LinearClient({
      accessToken: linearAccessToken,
    });

    // Kilo.ai gateway is OpenAI-compatible, so we use the OpenAI SDK
    this.kilo = new OpenAI({
      apiKey: kiloApiKey,
      baseURL: KILO_BASE_URL,
    });

    this.model = model;
  }

  /**
   * Handle a user prompt within an agent session.
   * Emits a thought immediately, then processes the request through the LLM loop.
   */
  public async handleUserPrompt(
    agentSessionId: string,
    userPrompt: string,
    promptContext?: string
  ): Promise<void> {
    // Acknowledge immediately with a thought (must be within 10 seconds)
    await this.linearClient.createAgentActivity({
      agentSessionId,
      content: {
        type: "thought",
        body: "Analyzing the request...",
      },
    });

    // Build conversation history from previous activities in this session
    const previousActivities =
      await this.generateMessagesFromPreviousActivities(agentSessionId);

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    // Include the prompt context (issue details, guidance, etc.) if available
    if (promptContext) {
      messages.push({
        role: "system",
        content: `Here is the full context for this session:\n\n${promptContext}`,
      });
    }

    // Add conversation history
    messages.push(...previousActivities);

    // Add the current user prompt
    if (userPrompt) {
      messages.push({ role: "user", content: userPrompt });
    }

    // Agent loop: iterate until the task is complete or max iterations
    let taskComplete = false;
    let iterations = 0;

    while (!taskComplete && iterations < MAX_ITERATIONS) {
      iterations++;

      try {
        const response = await this.callKilo(messages);
        const content = this.mapResponseToActivityContent(response);

        switch (content.type) {
          case L.AgentActivityType.Thought: {
            await this.linearClient.createAgentActivity({
              agentSessionId,
              content,
            });
            messages.push({ role: "assistant", content: response });
            await delay(1000);
            break;
          }

          case L.AgentActivityType.Action: {
            // Report that the agent is performing an action
            await this.linearClient.createAgentActivity({
              agentSessionId,
              content,
            });
            messages.push({ role: "assistant", content: response });

            // For now, actions are informational — add a note and continue
            messages.push({
              role: "user",
              content:
                "Action noted. Please continue with your analysis and provide a final response.",
            });
            await delay(1000);
            break;
          }

          case L.AgentActivityType.Response: {
            await this.linearClient.createAgentActivity({
              agentSessionId,
              content,
            });
            taskComplete = true;
            break;
          }

          case L.AgentActivityType.Elicitation: {
            await this.linearClient.createAgentActivity({
              agentSessionId,
              content,
            });
            taskComplete = true;
            break;
          }

          case L.AgentActivityType.Error: {
            await this.linearClient.createAgentActivity({
              agentSessionId,
              content,
            });
            taskComplete = true;
            break;
          }

          default:
            throw new UnreachableCaseError(content);
        }
      } catch (error) {
        const errorMessage = `Agent error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        await this.linearClient.createAgentActivity({
          agentSessionId,
          content: { type: "error", body: errorMessage },
        });
        taskComplete = true;
      }
    }

    if (!taskComplete && iterations >= MAX_ITERATIONS) {
      await this.linearClient.createAgentActivity({
        agentSessionId,
        content: {
          type: "error",
          body: "The agent reached the maximum number of iterations. Please refine your request and try again.",
        },
      });
    }
  }

  /**
   * Call the Kilo.ai gateway and return the assistant's text response.
   */
  private async callKilo(
    messages: ChatCompletionMessageParam[]
  ): Promise<string> {
    try {
      const response = await this.kilo.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: 4096,
        temperature: 0.7,
      });

      return response.choices[0]?.message?.content || "No response generated.";
    } catch (error) {
      throw new Error(
        `Kilo.ai API error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Parse the LLM response and map it to a Linear Agent Activity content type.
   *
   * The LLM is expected to prefix responses with a keyword:
   * - THINKING: ... -> thought activity
   * - ACTION: toolName(params) -> action activity
   * - RESPONSE: ... -> final response activity
   * - QUESTION: ... -> elicitation activity
   * - ERROR: ... -> error activity
   *
   * If no prefix is detected, defaults to a response activity.
   */
  private mapResponseToActivityContent(response: string): Content {
    const typeToKeyword = {
      [L.AgentActivityType.Thought]: "THINKING:",
      [L.AgentActivityType.Action]: "ACTION:",
      [L.AgentActivityType.Response]: "RESPONSE:",
      [L.AgentActivityType.Elicitation]: "QUESTION:",
      [L.AgentActivityType.Error]: "ERROR:",
    } as const;

    const mappedType = Object.entries(typeToKeyword).find(([_, keyword]) =>
      response.toUpperCase().trimStart().startsWith(keyword)
    );

    // Default to response if no keyword prefix is found
    const type = mappedType?.[0]
      ? (mappedType[0] as L.AgentActivityType)
      : L.AgentActivityType.Response;

    const keyword =
      type in typeToKeyword
        ? typeToKeyword[type as keyof typeof typeToKeyword]
        : "";
    const body = keyword
      ? response.replace(new RegExp(`^\\s*${escapeRegExp(keyword)}\\s*`, "i"), "").trim()
      : response.trim();

    switch (type) {
      case L.AgentActivityType.Thought:
      case L.AgentActivityType.Response:
      case L.AgentActivityType.Elicitation:
      case L.AgentActivityType.Error:
        return { type, body };

      case L.AgentActivityType.Action: {
        const actionMatch = response.match(/ACTION:\s*(\w+)\(([^)]*)\)/i);
        if (actionMatch) {
          const [, action, params] = actionMatch;
          return {
            type,
            action: action!,
            parameter: params || null,
          };
        }
        // Fallback: treat as thought if action can't be parsed
        return { type: L.AgentActivityType.Thought, body };
      }

      default:
        throw new UnreachableCaseError(type);
    }
  }

  /**
   * Reconstruct conversation history from previous Agent Activities in the session.
   * Uses prompt and response activities to build an accurate message history.
   */
  private async generateMessagesFromPreviousActivities(
    agentSessionId: string
  ): Promise<ChatCompletionMessageParam[]> {
    const agentSession =
      await this.linearClient.agentSession(agentSessionId);

    const allActivities = [];
    let activitiesConnection = await agentSession.activities();
    let hasNextPage = activitiesConnection.pageInfo.hasNextPage;

    allActivities.push(...activitiesConnection.nodes);

    while (hasNextPage && activitiesConnection.pageInfo.endCursor) {
      activitiesConnection = await agentSession.activities({
        after: activitiesConnection.pageInfo.endCursor,
      });
      allActivities.push(...activitiesConnection.nodes);
      hasNextPage = activitiesConnection.pageInfo.hasNextPage;
    }

    const messages: ChatCompletionMessageParam[] = [];
    for (const activity of allActivities
      .filter(
        (a) =>
          a.content.type === L.AgentActivityType.Prompt ||
          a.content.type === L.AgentActivityType.Response
      )
      .reverse()) {
      const role =
        activity.content.type === L.AgentActivityType.Prompt
          ? "user"
          : "assistant";
      const typedContent = activity.content as
        | L.AgentActivityPromptContent
        | L.AgentActivityResponseContent;
      const content = typedContent.body;
      messages.push({ role, content });
    }

    return messages;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
