import { OAuthTokenResponse, StoredTokenData } from "./types";

const OAUTH_TOKEN_KEY_PREFIX = "linear_oauth_token_";

function getWorkspaceTokenKey(workspaceId: string): string {
  return `${OAUTH_TOKEN_KEY_PREFIX}${workspaceId}`;
}

/**
 * Redirects the user to Linear's OAuth authorization page to install the agent.
 * Uses `actor=app` for agent installation with assignable + mentionable scopes.
 */
export function handleOAuthAuthorize(request: Request, env: Env): Response {
  const scope = "read,write,app:assignable,app:mentionable";
  const baseUrl = env.WORKER_URL.replace(/\/+$/, "");
  const redirectUri = `${baseUrl}/oauth/callback`;

  const params = new URLSearchParams({
    client_id: env.LINEAR_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    actor: "app",
  });

  const authUrl = `https://linear.app/oauth/authorize?${params.toString()}`;

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl },
  });
}

/**
 * Handles the OAuth callback from Linear.
 * Exchanges the authorization code for an access token and stores it in KV.
 */
export async function handleOAuthCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`OAuth Error: ${error}`, { status: 400 });
  }

  if (!code) {
    return new Response("Missing required OAuth parameters", { status: 400 });
  }

  try {
    const baseUrl = env.WORKER_URL.replace(/\/+$/, "");
    const tokenResponse = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: env.LINEAR_CLIENT_ID,
        client_secret: env.LINEAR_CLIENT_SECRET,
        code,
        redirect_uri: `${baseUrl}/oauth/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return new Response(`Token exchange failed: ${errorText}`, {
        status: 400,
      });
    }

    const tokenData = (await tokenResponse.json()) as OAuthTokenResponse;
    const workspaceInfo = await getWorkspaceInfo(tokenData.access_token);

    const storedTokenData: StoredTokenData = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
    };

    await setOAuthTokenData(env, storedTokenData, workspaceInfo.id);

    return new Response(
      `<!DOCTYPE html>
<html>
<head><title>Agent Installed</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
  .card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 2rem; max-width: 480px; text-align: center; }
  h1 { color: #22c55e; margin-bottom: 0.5rem; }
  p { color: #a3a3a3; line-height: 1.6; }
  .workspace { color: #818cf8; font-weight: 600; }
</style>
</head>
<body>
  <div class="card">
    <h1>Agent Installed</h1>
    <p>Successfully installed <strong>Kilo Agent</strong> in workspace <span class="workspace">${workspaceInfo.name}</span>.</p>
    <p>You can now mention or delegate issues to the agent in Linear.</p>
  </div>
</body>
</html>`,
      {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }
    );
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return new Response(`Token exchange error: ${errorMessage}`, {
      status: 500,
    });
  }
}

/**
 * Retrieves a valid OAuth token for a workspace, refreshing if expired.
 */
export async function getOAuthToken(
  env: Env,
  workspaceId: string
): Promise<string | null> {
  if (!env.AGENT_TOKENS) {
    return null;
  }

  try {
    const key = getWorkspaceTokenKey(workspaceId);
    const storedData = await env.AGENT_TOKENS.get(key);

    if (!storedData) {
      return null;
    }

    let tokenData: StoredTokenData;
    try {
      tokenData = JSON.parse(storedData) as StoredTokenData;
    } catch {
      console.warn("Found legacy token format, treating as expired");
      return null;
    }

    // Refresh 5 minutes before expiry
    const bufferTime = 5 * 60 * 1000;
    const isExpired = Date.now() >= tokenData.expires_at - bufferTime;

    if (!isExpired) {
      return tokenData.access_token;
    }

    if (!tokenData.refresh_token) {
      console.error("Token expired and no refresh token available");
      return null;
    }

    try {
      console.log("Access token expired, refreshing...");
      const refreshedTokenData = await refreshAccessToken(
        env,
        tokenData.refresh_token
      );

      const newStoredTokenData: StoredTokenData = {
        access_token: refreshedTokenData.access_token,
        refresh_token: refreshedTokenData.refresh_token,
        expires_at: Date.now() + refreshedTokenData.expires_in * 1000,
      };

      await setOAuthTokenData(env, newStoredTokenData, workspaceId);
      console.log("Token refreshed successfully");
      return newStoredTokenData.access_token;
    } catch (refreshError) {
      console.error("Failed to refresh token:", refreshError);
      return null;
    }
  } catch (error) {
    console.error("Error retrieving OAuth token:", error);
    return null;
  }
}

async function setOAuthTokenData(
  env: Env,
  tokenData: StoredTokenData,
  workspaceId: string
): Promise<void> {
  const key = getWorkspaceTokenKey(workspaceId);
  await env.AGENT_TOKENS.put(key, JSON.stringify(tokenData));
}

async function refreshAccessToken(
  env: Env,
  refreshToken: string
): Promise<OAuthTokenResponse> {
  const response = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.LINEAR_CLIENT_ID,
      client_secret: env.LINEAR_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  return (await response.json()) as OAuthTokenResponse;
}

async function getWorkspaceInfo(
  accessToken: string
): Promise<{ id: string; name: string }> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: `query { viewer { organization { id name } } }`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get workspace info: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    data?: { viewer?: { organization?: { id: string; name: string } } };
  };

  const organization = data.data?.viewer?.organization;
  if (!organization) {
    throw new Error("No organization found in response");
  }

  return { id: organization.id, name: organization.name };
}
