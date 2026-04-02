import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { GitHubHandler } from "./github-handler";

export interface Env {
  OAUTH_KV: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  TREK_API_TOKEN: string;
  TREK_MCP_URL?: string; // Optional: override TREK instance URL
}

// Default TREK MCP endpoint (can be overridden via TREK_MCP_URL env var)
const DEFAULT_TREK_MCP_URL = "https://travel.malinov.ski/mcp";

async function proxyToTrek(request: Request, trekToken: string, trekUrl: string): Promise<Response> {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${trekToken}`);
  
  for (const [key, value] of request.headers) {
    const lowerKey = key.toLowerCase();
    if (lowerKey !== "authorization" && 
        lowerKey !== "host" &&
        lowerKey !== "content-length" &&
        lowerKey !== "cookie") {
      headers.set(key, value);
    }
  }
  
  let body: string | undefined;
  if (request.method === "POST" || request.method === "PUT") {
    body = await request.text();
  }
  
  const proxyRequest = new Request(trekUrl, {
    method: request.method,
    headers,
    body,
  });
  
  const response = await fetch(proxyRequest);
  
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

class TrekMCPAPIHandler {
  private env: Env;
  
  constructor(env: Env) {
    this.env = env;
  }
  
  async fetch(request: Request): Promise<Response> {
    const trekUrl = this.env.TREK_MCP_URL || DEFAULT_TREK_MCP_URL;
    return proxyToTrek(request, this.env.TREK_API_TOKEN, trekUrl);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const apiHandler = new TrekMCPAPIHandler(env);
    
    const oauthProvider = new OAuthProvider({
      apiHandler: apiHandler as any,
      apiRoute: "/mcp",
      authorizeEndpoint: "/authorize",
      clientRegistrationEndpoint: "/register",
      defaultHandler: GitHubHandler as any,
      tokenEndpoint: "/token",
    });
    
    return oauthProvider.fetch(request, env, ctx);
  }
};