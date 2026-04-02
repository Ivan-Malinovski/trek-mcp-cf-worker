# TREK MCP OAuth Proxy

A Cloudflare Worker that provides GitHub OAuth authentication for [TREK](https://github.com/mauriceboe/TREK) MCP (Model Context Protocol), allowing you to use TREK's MCP with Claude mobile app or any OAuth-compatible MCP client.

## Why This Exists

TREK's MCP server uses bearer token authentication (`Authorization: Bearer trek_xxx`). This works well for Claude Desktop with `mcp-remote`, but the Claude mobile app doesn't support custom headers—it only supports OAuth.

This proxy:
- Authenticates users via GitHub OAuth
- Proxies all MCP requests to your TREK instance
- Automatically adds your TREK bearer token
- Restricts access to authorized GitHub usernames

## Architecture

```
Claude Mobile/App → GitHub OAuth → Cloudflare Worker → TREK MCP Server
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
git clone https://github.com/YOUR_USERNAME/trek-mcp-proxy.git
cd trek-mcp-proxy
npm install
```

### 2. Create GitHub OAuth Apps

You'll need **two** OAuth apps:

#### Development OAuth App
Go to [github.com/settings/applications/new](https://github.com/settings/applications/new):

| Field | Value |
|-------|-------|
| Application name | `TREK MCP (dev)` |
| Homepage URL | `http://localhost:8788` |
| Authorization callback URL | `http://localhost:8788/callback` |

#### Production OAuth App
After deploying, create another app:

| Field | Value |
|-------|-------|
| Application name | `TREK MCP Proxy` |
| Homepage URL | `https://your-worker-name.your-subdomain.workers.dev` |
| Authorization callback URL | `https://your-worker-name.your-subdomain.workers.dev/callback` |

Save the Client ID and Client Secret for both apps.

### 3. Configure Local Development

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```env
# GitHub OAuth (development app)
GITHUB_CLIENT_ID=your_dev_client_id
GITHUB_CLIENT_SECRET=your_dev_client_secret

# Cookie encryption key (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
COOKIE_ENCRYPTION_KEY=your_generated_hex_key

# Your TREK bearer token (from TREK Settings → MCP Configuration)
TREK_API_TOKEN=trek_your_token_here
```

### 4. Set Allowed Usernames

Edit `src/github-handler.ts` and update the allowlist:

```typescript
const ALLOWED_USERNAMES = new Set<string>([
  "your-github-username",  // <-- CHANGE THIS
  "another-username",       // <-- Add more as needed
]);
```

Only these GitHub users will be able to access your TREK MCP.

### 5. Test Locally

```bash
npm start
# Server runs at http://localhost:8788
```

Test with MCP Inspector:
```bash
npx @modelcontextprotocol/inspector@latest
```

Enter `http://localhost:8788/mcp` and complete OAuth flow.

### 6. Deploy to Cloudflare Workers

```bash
# Create KV namespace for OAuth state
npx wrangler kv namespace create "OAUTH_KV"
# Copy the ID from the output

# Update wrangler.jsonc with the KV namespace ID
# "id": "your_kv_namespace_id_here"

# Set production secrets
npx wrangler secret put GITHUB_CLIENT_ID --name trek
npx wrangler secret put GITHUB_CLIENT_SECRET --name trek
npx wrangler secret put COOKIE_ENCRYPTION_KEY --name trek
npx wrangler secret put TREK_API_TOKEN --name trek

# Deploy
npm run deploy
```

### 7. Connect Claude

**Important:** You must first connect from Claude.ai (web) or Claude Desktop, then it will automatically appear in Claude mobile.

#### Claude.ai (web)

1. Go to Settings → Connectors → Add custom connector
2. Enter your worker URL: `https://your-worker-name.your-subdomain.workers.dev/mcp`
3. Complete GitHub OAuth flow
4. Done! TREK tools are now available

The connector will then appear in Claude mobile app automatically.

#### Claude Desktop

Add to your `claude_desktop_config.json`:

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

Restart Claude Desktop and complete OAuth flow in browser when prompted.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth App client secret |
| `COOKIE_ENCRYPTION_KEY` | Yes | 64-char hex key for cookie encryption |
| `TREK_API_TOKEN` | Yes | Your TREK bearer token (`trek_xxx`) |
| `TREK_MCP_URL` | No | Override TREK instance URL (default: `https://travel.malinov.ski/mcp`) |

## Security

- **TREK bearer token** stored as Cloudflare Worker secret, never exposed to clients
- **GitHub OAuth** handled by `workers-oauth-provider` (OAuth 2.1 + PKCE)
- **Username allowlist** restricts access to authorized users only
- **Session handling** properly forwards `mcp-session-id` for TREK's session management

## How It Works

1. Client connects and initiates OAuth flow
2. User authenticates with GitHub
3. Worker checks if GitHub username is in allowlist
4. If authorized, Worker proxies all MCP requests to TREK
5. TREK bearer token is added automatically to each request
6. Session IDs are forwarded between client and TREK

## Troubleshooting

### "Access Denied" after OAuth

Your GitHub username is not in the allowlist. Edit `src/github-handler.ts` and add your username.

### "Session limit reached"

TREK has a limit of 5 concurrent MCP sessions. Close other sessions or wait 1 hour for timeout.

### "Missing mcp-session-id header"

This should be handled automatically by the proxy. Check that you're using the latest deployed version.

### Tools not showing in Claude

1. Complete the OAuth flow in the browser
2. Restart Claude mobile app
3. Check logs: `npx wrangler tail`

## Development

```bash
# Run locally
npm start

# Type check
npm run type-check

# View logs
npx wrangler tail
```

## License

MIT

## Credits

- Based on [cloudflare/workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)
- [TREK](https://github.com/mauriceboe/TREK) by mauriceboe