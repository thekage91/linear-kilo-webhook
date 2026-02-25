interface Env {
  // Linear OAuth
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
  LINEAR_WEBHOOK_SECRET: string;

  // Agent type selector
  // "kilo"        — general-purpose agent via Kilo.ai gateway (default)
  // "claude-code" — software engineering agent via Anthropic API directly
  AGENT_TYPE: string;

  // Kilo.ai Gateway (used when AGENT_TYPE=kilo)
  KILO_API_KEY: string;
  KILO_MODEL: string;

  // Kilo agent prompt mode
  // "general" — general-purpose assistant
  // "backend-developer" — Senior Java/Quarkus backend developer
  AGENT_PROMPT_MODE: string;

  // Anthropic API (used when AGENT_TYPE=claude-code)
  ANTHROPIC_API_KEY: string;
  // Claude model to use, e.g. "claude-opus-4-5-20251101" or "claude-sonnet-4-5-20251022"
  CLAUDE_MODEL: string;

  // Worker
  WORKER_URL: string;

  // Cloudflare KV for token storage
  AGENT_TOKENS: KVNamespace;
}
