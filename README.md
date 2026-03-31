# Cloudflare Remote MCP Template

A **template** for building authenticated remote MCP servers on Cloudflare Workers with GitHub OAuth. 

This template provides the boilerplate — you customize the tools and backend API.

## Features

- **GitHub OAuth** via `workers-oauth-provider` (OAuth 2.1 + PKCE)
- **MCP Protocol** via `agents` / `McpAgent`
- **Username Allowlist** to restrict access
- **Server-side API calls** — API keys never exposed to clients
- **Dynamic client registration** — works with any OAuth client

## Quick Start

### 1. Create from this template

```bash
# Clone or copy this folder, then:
cd cloudflare-remote-mcp-template

# Install dependencies
npm install
```

### 2. Configure

```bash
# Copy and edit .dev.vars
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your local OAuth App credentials
```

Generate a cookie encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Create GitHub OAuth Apps

**Local OAuth App** ([github.com/settings/applications/new](https://github.com/settings/applications/new)):

| Field | Value |
|-------|-------|
| Application name | `My MCP (local)` |
| Homepage URL | `http://localhost:8788` |
| Authorization callback URL | `http://localhost:8788/callback` |

**Production OAuth App** (create after deploy):

| Field | Value |
|-------|-------|
| Application name | `My MCP (prod)` |
| Homepage URL | `https://my-mcp.<account>.workers.dev` |
| Authorization callback URL | `https://my-mcp.<account>.workers.dev/callback` |

### 4. Customize

Edit `src/index.ts`:

1. **Change `Env` interface** — add your API key secrets:
```typescript
interface Env {
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectStub<MyMCP>;
  // Add your API keys here
  PERPLEXITY_API_KEY?: string;
  // OPENAI_API_KEY?: string;
}
```

2. **Change `ALLOWED_USERNAMES`**:
```typescript
const ALLOWED_USERNAMES = new Set<string>([
  "your-github-username",  // <-- CHANGE THIS
]);
```

3. **Add/Modify tools** in the `init()` method. See "Adding Tools" below.

4. **Change server name** in `new McpServer()`:
```typescript
server = new McpServer({
  name: "My MCP Server",  // <-- CHANGE THIS
  version: "1.0.0",
});
```

5. **Change approval dialog** in `src/github-handler.ts`:
```typescript
server: {
  name: "My MCP Server",           // <-- CHANGE THIS
  logo: "https://...",              // <-- CHANGE THIS
  description: "Your description",  // <-- CHANGE THIS
}
```

### 5. Test Locally

```bash
npm start
# Server runs at http://localhost:8788
```

Test with MCP Inspector:
```bash
npx @modelcontextprotocol/inspector@latest
```

### 6. Deploy

```bash
# 1. Create KV namespace
npx wrangler kv namespace create "OAUTH_KV"
# → Copy the ID into wrangler.jsonc's kvNamespaces[0].id

# 2. Set secrets
npx wrangler secret put GITHUB_CLIENT_ID --name <worker-name>
npx wrangler secret put GITHUB_CLIENT_SECRET --name <worker-name>
npx wrangler secret put COOKIE_ENCRYPTION_KEY --name <worker-name>
npx wrangler secret put YOUR_API_KEY --name <worker-name>

# 3. Deploy
npm run deploy
```

### 7. Connect to Claude

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "my-mcp": {
      "url": "https://my-mcp.<account>.workers.dev/mcp",
      "auth": {
        "type": "oauth",
        "clientId": "my-mcp-desktop"
      }
    }
  }
}
```

**Claude.ai (web)** — go to Settings → Connectors → Add custom connector, enter:
```
https://my-mcp.<account>.workers.dev/mcp
```

---

## Adding Tools

In `src/index.ts`, add tools in the `init()` method:

```typescript
this.server.tool(
  "my_tool_name",           // Tool name (snake_case)
  "Description of tool",    // Tool description
  {
    // Zod schema for tool input
    param1: z.string().describe("Description"),
    param2: z.number().optional(),
  },
  async (args) => {
    // Check allowlist
    if (!ALLOWED_USERNAMES.has(this.props!.login)) {
      return {
        content: [{ text: "Access denied.", type: "text" }],
        isError: true,
      };
    }

    // Call your API
    const response = await fetch("https://api.example.com/...", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.MY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });

    const data = await response.json();

    // Return result
    return {
      content: [{ text: JSON.stringify(data), type: "text" }],
      structuredContent: data,  // Optional: structured data for Claude
    };
  },
);
```

---

## Project Structure

```
src/
├── index.ts                  # MCP server + tools (CUSTOMIZE THIS)
├── github-handler.ts         # GitHub OAuth flow (mostly unchanged)
├── utils.ts                  # OAuth helpers (unchanged)
└── workers-oauth-utils.ts    # CSRF/session utilities (unchanged)
```

---

## Environment Variables

| Variable | Local (`.dev.vars`) | Production (`wrangler secret put`) | Description |
|----------|---------------------|----------------------------------|-------------|
| `GITHUB_CLIENT_ID` | Yes | Yes | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes | Yes | GitHub OAuth App client secret |
| `COOKIE_ENCRYPTION_KEY` | Yes | Yes | Random 64-char hex |
| `YOUR_API_KEY` | No | Yes | Your backend API key |

---

## Security

- Perplexity API key stored as Cloudflare Worker secret, never exposed to client
- GitHub OAuth via `workers-oauth-provider` (no hand-rolled OAuth)
- Both [GHSA-4pc9-x2fx-p7vj](https://github.com/cloudflare/workers-oauth-provider/security/advisories/GHSA-4pc9-x2fx-p7vj) (redirect_uri validation) and [GHSA-qgp8-v765-qxx9](https://github.com/cloudflare/workers-oauth-provider/security/advisories/GHSA-qgp8-v765-qxx9) (PKCE bypass) are patched in `workers-oauth-provider@^0.4.0`
- Username allowlist restricts tool access to authorized users only

---

## Based On

- [cloudflare/ai - remote-mcp-github-oauth](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth)
- [cloudflare/workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)
- [agents package](https://developers.cloudflare.com/agents/)
