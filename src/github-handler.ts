import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { Octokit } from "octokit";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, type Props } from "./utils";
import {
  addApprovedClient,
  bindStateToSession,
  createOAuthState,
  generateCSRFProtection,
  isClientApproved,
  OAuthError,
  renderApprovalDialog,
  validateCSRFToken,
  validateOAuthState,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

// ============================================================
// AUTHORIZE ENDPOINT
// Shows approval dialog or auto-approves known clients
// ============================================================
async function ensureClientRegistered(clientId: string, redirectUri: string, helpers: OAuthHelpers): Promise<void> {
  const existing = await helpers.lookupClient(clientId);
  if (existing) return;

  await helpers.createClient({
    clientId,
    redirectUris: [redirectUri],
    tokenEndpointAuthMethod: "none",
  });
}

app.get("/authorize", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id") || "";
  const redirectUri = url.searchParams.get("redirect_uri") || "";

  // Auto-register unknown clients for dynamic client registration
  if (clientId && redirectUri) {
    await ensureClientRegistered(clientId, redirectUri, c.env.OAUTH_PROVIDER);
  }

  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const actualClientId = oauthReqInfo.clientId;

  if (!actualClientId) {
    return c.text("Invalid request", 400);
  }

  // Skip approval if client was previously approved
  if (await isClientApproved(c.req.raw, actualClientId, env.COOKIE_ENCRYPTION_KEY)) {
    const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);
    return redirectToGithub(c.req.raw, stateToken, { "Set-Cookie": sessionBindingCookie });
  }

  // Show approval dialog
  const { token: csrfToken, setCookie } = generateCSRFProtection();

  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(actualClientId),
    csrfToken,
    server: {
      // ============================================================
      // CUSTOMIZE: Server name and logo shown in approval dialog
      // ============================================================
      name: "My MCP Server",
      logo: "https://avatars.githubusercontent.com/u/314135?s=200&v=4",
      description: "Remote MCP server authenticated via GitHub OAuth.",
    },
    setCookie,
    state: { oauthReqInfo },
  });
});

app.post("/authorize", async (c) => {
  try {
    const formData = await c.req.raw.formData();
    validateCSRFToken(formData, c.req.raw);

    const encodedState = formData.get("state");
    if (!encodedState || typeof encodedState !== "string") {
      return c.text("Missing state in form data", 400);
    }

    let state: { oauthReqInfo?: AuthRequest };
    try {
      state = JSON.parse(atob(encodedState));
    } catch (_e) {
      return c.text("Invalid state data", 400);
    }

    if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
      return c.text("Invalid request", 400);
    }

    // Add client to approved list
    const approvedClientCookie = await addApprovedClient(
      c.req.raw,
      state.oauthReqInfo.clientId,
      c.env.COOKIE_ENCRYPTION_KEY,
    );

    const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    const headers = new Headers();
    headers.append("Set-Cookie", approvedClientCookie);
    headers.append("Set-Cookie", sessionBindingCookie);

    return redirectToGithub(c.req.raw, stateToken, Object.fromEntries(headers));
  } catch (error: any) {
    console.error("POST /authorize error:", error);
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return c.text(`Internal server error: ${error.message}`, 500);
  }
});

async function redirectToGithub(
  request: Request,
  stateToken: string,
  headers: Record<string, string> = {},
) {
  return new Response(null, {
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: new URL("/callback", request.url).href,
        scope: "read:user",
        state: stateToken,
        upstream_url: "https://github.com/login/oauth/authorize",
      }),
    },
    status: 302,
  });
}

// ============================================================
// OAUTH CALLBACK ENDPOINT
// Handles GitHub OAuth callback
// ============================================================
app.get("/callback", async (c) => {
  let oauthReqInfo: AuthRequest;
  let clearSessionCookie: string;

  try {
    const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
    oauthReqInfo = result.oauthReqInfo;
    clearSessionCookie = result.clearCookie;
  } catch (error: any) {
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return c.text("Internal server error", 500);
  }

  if (!oauthReqInfo.clientId) {
    return c.text("Invalid OAuth request data", 400);
  }

  // Exchange code for access token from GitHub
  const [accessToken, errResponse] = await fetchUpstreamAuthToken({
    client_id: c.env.GITHUB_CLIENT_ID,
    client_secret: c.env.GITHUB_CLIENT_SECRET,
    code: c.req.query("code"),
    redirect_uri: new URL("/callback", c.req.url).href,
    upstream_url: "https://github.com/login/oauth/access_token",
  });
  if (errResponse) return errResponse;

  // Get user info from GitHub
  const user = await new Octokit({ auth: accessToken }).rest.users.getAuthenticated();
  const { login, name, email } = user.data;

  // Complete the OAuth authorization
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    metadata: { label: name },
    props: {
      accessToken,
      email,
      login,
      name,
    } as Props,
    request: oauthReqInfo,
    scope: oauthReqInfo.scope,
    userId: login,
  });

  const respHeaders = new Headers({ Location: redirectTo });
  if (clearSessionCookie) {
    respHeaders.set("Set-Cookie", clearSessionCookie);
  }

  return new Response(null, { status: 302, headers: respHeaders });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

export { app as GitHubHandler };
