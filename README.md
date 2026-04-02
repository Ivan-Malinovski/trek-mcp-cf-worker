# TREK MCP OAuth Proxy

A Cloudflare Worker that provides GitHub OAuth authentication for [TREK](https://github.com/mauriceboe/TREK) MCP, allowing you to use TREK with Claude.ai and Claude Desktop.

## Why This Exists

TREK's MCP server uses bearer token authentication (`Authorization: Bearer trek_xxx`). This works with `mcp-remote` for local Claude Desktop, but **Claude.ai requires OAuth authentication** - it doesn't support static tokens.

This proxy:
- Authenticates users via GitHub OAuth
- Proxies all MCP requests to your TREK instance
- Automatically adds your TREK bearer token
- Restricts access to authorized GitHub usernames

**Important:** This is only a proxy. It contains no MCP implementation - all tools and resources come from your TREK instance.

## Architecture

```
Claude.ai/Claude Desktop → GitHub OAuth → Cloudflare Worker → TREK MCP Server
                                                      ↓
                                              (adds bearer token)
```

## Prerequisites

1. A deployed [TREK](https://github.com/mauriceboe/TREK) instance with MCP enabled
2. A Cloudflare account (free tier works)
3. A GitHub account for OAuth

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/Ivan-Malinovski/trek-mcp-cf-worker.git
cd trek-mcp-cf-worker
npm install
```

### 2. Create GitHub OAuth App

Go to [github.com/settings/applications/new](https://github.com/settings/applications/new):

| Field | Value |
|-------|-------|
| Application name | `TREK MCP Proxy` |
| Homepage URL | `https://your-worker-name.your-subdomain.workers.dev` |
| Authorization callback URL | `https://your-worker-name.your-subdomain.workers.dev/callback` |

Save the Client ID and Client Secret.

### 3. Set Allowed Usernames

Edit `src/github-handler.ts`:

```typescript
const ALLOWED_USERNAMES = new Set<string>([
  "your-github-username",  // <-- CHANGE THIS
]);
```

Only these GitHub users can access your TREK MCP.

### 4. Deploy to Cloudflare Workers

```bash
# Create KV namespace for OAuth state
npx wrangler kv namespace create "OAUTH_KV"
# Copy the ID output

# Update wrangler.jsonc with the KV namespace ID
# "id": "your_kv_namespace_id_here"

# Set name in wrangler.jsonc (change "trek" to your preferred name)
# "name": "your-worker-name"

# Set secrets
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY  # Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put TREK_API_TOKEN  # Your TREK bearer token (trek_xxx)

# Deploy
npm run deploy
```

### 5. Connect Claude

#### Claude.ai (web)

1. Go to Settings → Connectors → Add custom connector
2. Enter your worker URL: `https://your-worker-name.your-subdomain.workers.dev/mcp`
3. Complete GitHub OAuth
4. Done! TREK tools are now available

The connector will also appear in Claude mobile app automatically.

#### Claude Desktop

Add to `claude_desktop_config.json`:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "trek": {
      "url": "https://your-worker-name.your-subdomain.workers.dev/mcp",
      "auth": {
        "type": "oauth",
        "clientId": "trek-desktop"
      }
    }
  }
}
```

Restart Claude Desktop and complete OAuth in browser.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth App client secret |
| `COOKIE_ENCRYPTION_KEY` | Yes | 64-char hex key for session encryption |
| `TREK_API_TOKEN` | Yes | Your TREK bearer token (`trek_xxx`) |
| `TREK_MCP_URL` | No | Override TREK instance URL (default: `https://travel.malinov.ski/mcp`) |

## Security

- **TREK bearer token** stored as Cloudflare Worker secret, never exposed to clients
- **GitHub OAuth** via `workers-oauth-provider` (OAuth 2.1 + PKCE)
- **Username allowlist** restricts access to authorized users only
- **Session handling** properly forwards `mcp-session-id` for TREK's session management

## Troubleshooting

### "Access Denied" after OAuth

Your GitHub username is not in the allowlist. Update `src/github-handler.ts` and redeploy.

### "Session limit reached"

TREK limits concurrent MCP sessions (default: 5). Close other sessions or wait 1 hour for timeout.

### Tools not appearing

1. Complete OAuth flow in browser
2. Restart Claude
3. Check logs: `npx wrangler tail`

## How It Works

1. Client initiates OAuth flow → redirected to GitHub
2. User authorizes → redirected back to worker
3. Worker checks if GitHub username is in allowlist
4. If authorized, all MCP requests proxied to TREK with bearer token
5. Session IDs forwarded between client and TREK for stateful operations

## License

MIT