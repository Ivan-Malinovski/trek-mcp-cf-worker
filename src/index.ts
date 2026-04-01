import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";

// ============================================================
// CUSTOMIZE: Environment interface
// Add your API key secrets here (set via `wrangler secret put KEY --name worker-name`)
// IMPORTANT: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and COOKIE_ENCRYPTION_KEY
// are also required — they are injected by Cloudflare Workers automatically.
// ============================================================
export interface Env {
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectStub<MyMCP>;
  // Required secrets — do not remove
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  // CUSTOMIZE: Add your own API keys below
  // MY_API_KEY?: string;
  // ANOTHER_API_KEY?: string;
}

// Props from GitHub OAuth (available in all tool calls)
type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
};

// ============================================================
// CUSTOMIZE: Allowed usernames
// Only these GitHub users can access the tools
// ============================================================
const ALLOWED_USERNAMES = new Set<string>([
  "your-github-username", // <-- CHANGE THIS
]);

// ============================================================
// MCP SERVER + TOOLS
// Add your tools in the init() method below
// ============================================================
export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "My MCP Server",
    version: "1.0.0",
  });

  async init() {
    // --------------------------------------------------------
    // EXAMPLE TOOL: my_tool
    // Replace this with your own tools
    // --------------------------------------------------------
    this.server.tool(
      "my_tool",
      "A brief description of what this tool does",
      {
        query: z.string().describe("The input parameter description"),
      },
      async (args) => {
        // Check allowlist
        if (!ALLOWED_USERNAMES.has(this.props!.login)) {
          return {
            content: [{ text: "Access denied. Your GitHub username is not authorized.", type: "text" }],
            isError: true,
          };
        }

        // Call your API
        // const response = await fetch("https://api.example.com", {
        //   method: "POST",
        //   headers: {
        //     Authorization: `Bearer ${this.env.MY_API_KEY}`,
        //     "Content-Type": "application/json",
        //   },
        //   body: JSON.stringify(args),
        // });

        // Example response
        return {
          content: [{ text: JSON.stringify({ query: args.query, result: "example" }), type: "text" }],
          structuredContent: { query: args.query, result: "example" },
        };
      },
    );

    // --------------------------------------------------------
    // ADD MORE TOOLS HERE
    // --------------------------------------------------------
  }
}

// ============================================================
// OAUTH PROVIDER SETUP
// Handles GitHub OAuth automatically
// ============================================================
export default new OAuthProvider({
  apiHandler: MyMCP.serve("/mcp"),
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: GitHubHandler as any,
  tokenEndpoint: "/token",
});
