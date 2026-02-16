interface Env {
  // Linear OAuth
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
  LINEAR_WEBHOOK_SECRET: string;

  // Kilo.ai Gateway
  KILO_API_KEY: string;
  KILO_MODEL: string;

  // Worker
  WORKER_URL: string;

  // Cloudflare KV for token storage
  AGENT_TOKENS: KVNamespace;
}
