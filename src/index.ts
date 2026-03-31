import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";

// ============================================================
// CUSTOMIZE THESE VALUES
// ============================================================

interface Env {
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectStub<MyMCP>;
  // ADD YOUR API KEYS HERE AS OPTIONAL STRINGS
  // They will be set via `npx wrangler secret put KEY_NAME --name worker-name`
  PERPLEXITY_API_KEY?: string;
  // Example for adding more API keys:
  // OPENAI_API_KEY?: string;
  // ANTHROPIC_API_KEY?: string;
}

type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
};

// ============================================================
// ALLOWED USERNAMES - Only these GitHub users can access the tools
// ============================================================
const ALLOWED_USERNAMES = new Set<string>([
  // Add GitHub usernames that should have access
  // Example: 'octocat', 'yourusername'
  "Ivan-Malinovski", // <-- CHANGE THIS
]);

// ============================================================
// MCP SERVER + TOOLS
// Add your tools in the init() method
// ============================================================
export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "Remote MCP Server",
    version: "1.0.0",
  });

  async init() {
    // --------------------------------------------------------
    // EXAMPLE TOOL: perplexity_search
    // This is an example of how to call a backend API
    // --------------------------------------------------------
    this.server.tool(
      "perplexity_search",
      "Search the web using Perplexity",
      {
        query: z.string().describe("The search query"),
        max_results: z
          .number()
          .min(1)
          .max(100)
          .default(10)
          .describe("Maximum number of results to return"),
      },
      async (args) => {
        // Check allowlist
        if (!ALLOWED_USERNAMES.has(this.props!.login)) {
          return {
            content: [
              {
                text: "Access denied. Your GitHub username is not authorized.",
                type: "text",
              },
            ],
            isError: true,
          };
        }

        // Check API key exists
        if (!this.env.PERPLEXITY_API_KEY) {
          return {
            content: [{ text: "Server configuration error: PERPLEXITY_API_KEY not set", type: "text" }],
            isError: true,
          };
        }

        // Call your backend API
        const response = await fetch("https://api.perplexity.ai/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.env.PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: args.query,
            max_results: args.max_results ?? 10,
            source: "web",
          }),
        });

        if (!response.ok) {
          return {
            content: [{ text: `API error: ${response.status}`, type: "text" }],
            isError: true,
          };
        }

        const data = await response.json();
        return {
          content: [{ text: JSON.stringify(data, null, 2), type: "text" }],
          structuredContent: data,
        };
      },
    );

    // --------------------------------------------------------
    // ADD MORE TOOLS HERE
    // --------------------------------------------------------
    // Example:
    // this.server.tool("my_tool", "Description", { ... schema ... }, async (args) => { ... });
  }
}

// ============================================================
// OAUTH PROVIDER SETUP
// This handles GitHub OAuth automatically
// ============================================================
export default new OAuthProvider({
  apiHandler: MyMCP.serve("/mcp"),
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: GitHubHandler as any,
  tokenEndpoint: "/token",
});
