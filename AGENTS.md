# Generic OAuth MCP Template

## Overview

This is a **template** for building authenticated remote MCP servers on Cloudflare Workers with GitHub OAuth. It provides the complete boilerplate — you customize the tools, backend APIs, and allowed users.

## Quick Start

### 1. Install and configure

```bash
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your OAuth App credentials
```

### 2. Customize

**`src/index.ts`** — Three things to change:

```typescript
// 1. Add your API key secrets
interface Env {
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectStub<MyMCP>;
  YOUR_API_KEY?: string;  // Add your keys here
}

// 2. Set allowed GitHub usernames
const ALLOWED_USERNAMES = new Set<string>(["your-username"]);

// 3. Add your MCP tools in init()
this.server.tool("my_tool", "Description", { schema }, async (args) => {
  // Your tool logic here
  const response = await fetch("https://api.example.com", {
    headers: { Authorization: `Bearer ${this.env.YOUR_API_KEY}` }
  });
  return { content: [{ text: await response.text() }] };
});
```

**`src/github-handler.ts`** — Change server name in approval dialog:
```typescript
server: {
  name: "My MCP Server",
  logo: "https://your-logo.png",
  description: "Your description",
}
```

**`wrangler.jsonc`** — Update worker name and KV namespace ID.

### 3. Deploy

```bash
# Create KV namespace
npx wrangler kv namespace create "OAUTH_KV"
# Paste the ID into wrangler.jsonc's kvNamespaces[0].id

# Set secrets
npx wrangler secret put GITHUB_CLIENT_ID --name <worker-name>
npx wrangler secret put GITHUB_CLIENT_SECRET --name <worker-name>
npx wrangler secret put COOKIE_ENCRYPTION_KEY --name <worker-name>
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put YOUR_API_KEY --name <worker-name>

# Deploy
npm run deploy
```

## Architecture

- **Host**: Cloudflare Workers
- **Auth**: GitHub OAuth via `workers-oauth-provider` (OAuth 2.1 + PKCE)
- **MCP**: Model Context Protocol via `agents` / `McpAgent`
- **KV**: OAuth state storage (KV namespace)
- **Pattern**: Single-user / allowlist-based access control

## File Map

| File | Purpose | Customizable |
|------|---------|--------------|
| `src/index.ts` | MCP server + tools | Yes |
| `src/github-handler.ts` | GitHub OAuth flow | Server name/logo |
| `src/utils.ts` | OAuth helpers | No |
| `src/workers-oauth-utils.ts` | CSRF, session, approval dialog | No |
| `wrangler.jsonc` | Worker config | Yes (name, KV ID) |
| `package.json` | Dependencies | No |

## Adding Tools

In `src/index.ts`, add tools in the `init()` method:

```typescript
this.server.tool(
  "tool_name",
  "Description for Claude",
  {
    param1: z.string().describe("What this param does"),
    param2: z.number().optional(),
  },
  async (args) => {
    // Check allowlist first
    if (!ALLOWED_USERNAMES.has(this.props!.login)) {
      return { content: [{ text: "Access denied", type: "text" }], isError: true };
    }

    // Call your API with server-side key
    const result = await fetch("https://api.example.com", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.env.YOUR_API_KEY}` },
      body: JSON.stringify(args),
    });

    return {
      content: [{ text: JSON.stringify(await result.json()), type: "text" }],
      structuredContent: await result.json(),
    };
  },
);
```

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `GITHUB_CLIENT_ID` | `.dev.vars` + secrets | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | `.dev.vars` + secrets | GitHub OAuth App client secret |
| `COOKIE_ENCRYPTION_KEY` | `.dev.vars` + secrets | Random hex: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `YOUR_API_KEY` | secrets only | Your backend API key (e.g., Perplexity) |

## Security

- API keys stored as Cloudflare Worker secrets, never exposed to clients
- GitHub OAuth handled by `workers-oauth-provider` (not hand-rolled)
- Username allowlist restricts tool access
- Both GHSA-4pc9-x2fx-p7vj and GHSA-qgp8-v765-qxx9 are patched in `workers-oauth-provider@^0.4.0`

## Deployment URLs

After deploying, you'll get a URL like:
```
https://<worker-name>.<account>.workers.dev/mcp
```

For Claude Desktop, add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "my-mcp": {
      "url": "https://<worker-name>.<account>.workers.dev/mcp",
      "auth": { "type": "oauth", "clientId": "my-mcp-desktop" }
    }
  }
}
```

## Troubleshooting

**OAuth fails with "Failed to discover OAuth metadata"**
- Ensure the Worker is deployed and responding
- Check `/.well-known/oauth-authorization-server` returns valid JSON

**"Invalid client" error**
- The client needs to be registered. This happens automatically on first authorize request if using dynamic registration.

**Tools not showing in Claude**
- Restart Claude Desktop after deploying updates
- Verify the `/mcp` endpoint returns 401 (expected — means MCP is working, needs auth)
