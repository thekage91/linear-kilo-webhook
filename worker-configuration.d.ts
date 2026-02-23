interface Env {
  // Linear OAuth
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
  LINEAR_WEBHOOK_SECRET: string;

  // Kilo.ai Gateway
  KILO_API_KEY: string;
  KILO_MODEL: string;

  // Agent configuration
  // "general" — general-purpose assistant
  // "backend-developer" — Senior Java/Quarkus backend developer
  AGENT_PROMPT_MODE: string;

  // Worker
  WORKER_URL: string;

  // Cloudflare KV for token storage
  AGENT_TOKENS: KVNamespace;
}
