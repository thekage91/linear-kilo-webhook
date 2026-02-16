# Linear Kilo Agent

A Linear AI Agent powered by [Kilo.ai Gateway](https://kilo.ai/docs/gateway), built with TypeScript and deployed on Cloudflare Workers.

The agent can be mentioned or delegated issues in Linear. It processes requests through Kilo.ai's unified AI gateway — giving access to hundreds of models (Claude, GPT, Gemini, etc.) through a single API key.

## Architecture

```
Linear Issue/Mention
        │
        ▼
  AgentSession Webhook (signed)
        │
        ▼
  Cloudflare Worker (src/index.ts)
        │
        ├─► OAuth token retrieval (KV)
        │
        ▼
  AgentClient (src/lib/agent/agentClient.ts)
        │
        ├─► Builds conversation from previous activities
        ├─► Calls Kilo.ai Gateway (OpenAI-compatible)
        │
        ▼
  Agent Activities → Linear UI
```

### Project Structure

```
src/
├── index.ts                    # Cloudflare Worker entry point
├── lib/
│   ├── agent/
│   │   ├── agentClient.ts      # Core agent logic + Kilo.ai integration
│   │   └── prompt.ts           # System prompt
│   ├── oauth.ts                # Linear OAuth2 flow (actor=app)
│   └── types.ts                # TypeScript type definitions
```

## Features

- **Linear Agent Protocol**: Full implementation of Linear's Agent Session lifecycle (`created`, `prompted` events)
- **Kilo.ai Gateway**: Uses the OpenAI-compatible API to access any model — swap models with a single config change
- **OAuth2 with actor=app**: Proper agent installation flow as a Linear app user (not a personal token)
- **Webhook Signature Verification**: Uses `@linear/sdk` webhook client for secure payload validation
- **Token Auto-Refresh**: OAuth tokens are automatically refreshed before expiry
- **Conversation History**: Reconstructs full conversation from Agent Activities for multi-turn interactions
- **Cloudflare Workers**: Edge deployment with KV storage for OAuth tokens

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Linear workspace](https://linear.app) with admin access
- [Kilo.ai account](https://app.kilo.ai) with API key
- Node.js 18+

## Setup

### 1. Clone and Install

```bash
git clone <repo-url>
cd linear-kilo-agent
npm install
```

### 2. Create a Linear OAuth Application

1. Go to [Linear Settings > API > Applications > New](https://linear.app/settings/api/applications/new)
2. Fill in:
   - **Name**: `Kilo Agent` (this is how it appears in Linear)
   - **Icon**: Upload an icon for the agent
   - **Redirect URI**: `https://<your-worker-url>/oauth/callback`
3. Enable **Webhooks** and set the endpoint to `https://<your-worker-url>/webhook`
4. Under webhook categories, select **Agent session events**
5. Copy the **Client ID**, **Client Secret**, and **Webhook Signing Secret**

### 3. Get a Kilo.ai API Key

1. Go to [Kilo.ai Dashboard](https://app.kilo.ai)
2. Generate an API key
3. Add credits if needed (or use free models)

### 4. Configure Cloudflare

Create a KV namespace for token storage:

```bash
npx wrangler kv namespace create "AGENT_TOKENS"
```

Copy the ID and update `wrangler.jsonc`:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "AGENT_TOKENS",
      "id": "<your-kv-namespace-id>"
    }
  ],
  "vars": {
    "LINEAR_CLIENT_ID": "<your-linear-client-id>",
    "WORKER_URL": "https://<your-worker>.workers.dev",
    "KILO_MODEL": "anthropic/claude-sonnet-4-20250514"
  }
}
```

Set secrets via Wrangler:

```bash
npx wrangler secret put LINEAR_CLIENT_SECRET
npx wrangler secret put LINEAR_WEBHOOK_SECRET
npx wrangler secret put KILO_API_KEY
```

### 5. Deploy

```bash
npm run deploy
```

### 6. Install the Agent in Linear

Visit `https://<your-worker-url>/oauth/authorize` in your browser. This initiates the OAuth flow and installs the agent in your Linear workspace.

## Usage

Once installed, the agent appears as a workspace member in Linear:

- **Delegate an issue**: Assign the issue to `Kilo Agent` — the agent will analyze the issue and respond
- **@mention in a comment**: Write `@Kilo Agent` in any issue comment to ask a question or request help
- **Follow-up prompts**: Reply in the same thread to continue the conversation

## Model Configuration

Change the model by updating `KILO_MODEL` in `wrangler.jsonc`:

| Model | ID |
|---|---|
| Claude Sonnet 4 | `anthropic/claude-sonnet-4-20250514` |
| GPT-4o | `openai/gpt-4o` |
| Gemini 2.5 Pro | `google/gemini-2.5-pro` |
| Auto (best for task) | `kilo/auto` |

See the full list at [Kilo.ai Models & Providers](https://kilo.ai/docs/gateway/models-and-providers).

## Development

### Local Development

```bash
npm run dev
```

This starts a local Wrangler dev server. Use a tunnel (e.g., `cloudflared tunnel`) to expose it to Linear's webhooks during development.

### Type Checking

```bash
npx tsc --noEmit
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Health check |
| `/oauth/authorize` | GET | Start OAuth installation flow |
| `/oauth/callback` | GET | OAuth callback handler |
| `/webhook` | POST | Linear webhook receiver |

## How It Works

1. **Installation**: A workspace admin visits `/oauth/authorize`, which redirects to Linear's OAuth page with `actor=app` and `app:assignable,app:mentionable` scopes. After approval, the callback stores the OAuth token in Cloudflare KV.

2. **Webhook Reception**: When a user mentions or delegates an issue to the agent, Linear sends an `AgentSessionEvent` webhook. The worker validates the signature using the Linear SDK.

3. **Agent Loop**: The `AgentClient` immediately sends a `thought` activity (required within 10 seconds), then builds the conversation context from the webhook payload and previous activities. It calls the Kilo.ai gateway and maps the LLM response to Linear Agent Activity types.

4. **Response Delivery**: The agent's response appears as an Agent Activity in the Linear issue, visible to all team members.

## References

- [Linear Agents Documentation](https://linear.app/docs/agents-in-linear)
- [Linear Developer Docs — Agent Interaction](https://linear.app/developers/agent-interaction)
- [Linear Weather Bot (reference implementation)](https://github.com/linear/weather-bot)
- [Kilo.ai Gateway Documentation](https://kilo.ai/docs/gateway)
- [Kilo.ai API Reference](https://kilo.ai/docs/gateway/api-reference)

## License

MIT
