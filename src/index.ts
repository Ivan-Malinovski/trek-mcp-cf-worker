import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";

interface Env {
	OAUTH_KV: KVNamespace;
	MCP_OBJECT: DurableObjectStub<MyMCP>;
	PERPLEXITY_API_KEY: string;
}

type Props = {
	login: string;
	name: string;
	email: string;
	accessToken: string;
};

const ALLOWED_USERNAMES = new Set<string>(["Ivan-Malinovski"]);

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Perplexity MCP Server",
		version: "1.0.0",
	});

	async init() {
		this.server.tool(
			"perplexity_search",
			"Search the web using Perplexity. Returns ranked search results with titles, URLs, snippets, and metadata.",
			{
				query: z.string().describe("The search query"),
				max_results: z
					.number()
					.min(1)
					.max(100)
					.default(10)
					.describe("Maximum number of results to return"),
				source: z
					.enum(["web", "news", "reddit", "youtube", "quora", "wikipedia", "academic"])
					.default("web")
					.describe("Data source for the search"),
				recency_days: z
					.number()
					.min(1)
					.max(365)
					.optional()
					.describe("Limit results to within the specified number of days"),
			},
			async (args) => {
				if (!ALLOWED_USERNAMES.has(this.props!.login)) {
					return {
						content: [
							{
								text: "Access denied. Your GitHub username is not authorized to use this tool.",
								type: "text",
							},
						],
						isError: true,
					};
				}

				const body: Record<string, unknown> = {
					query: args.query,
					max_results: args.max_results ?? 10,
					source: args.source ?? "web",
				};

				if (args.recency_days) {
					body.recency_days = args.recency_days;
				}

				let response: Response;
				try {
					response = await fetch("https://api.perplexity.ai/search", {
						method: "POST",
						headers: {
							Authorization: `Bearer ${this.env.PERPLEXITY_API_KEY}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(body),
					});
				} catch (err) {
					return {
						content: [
							{
								text: `Network error: ${err instanceof Error ? err.message : String(err)}`,
								type: "text",
							},
						],
						isError: true,
					};
				}

				if (!response.ok) {
					const errorText = await response.text();
					return {
						content: [
							{
								text: `Perplexity API error (${response.status}): ${errorText}`,
								type: "text",
							},
						],
						isError: true,
					};
				}

				const data = (await response.json()) as {
					results?: Array<{
						title?: string;
						url?: string;
						snippet?: string;
						source?: string;
						published_date?: string;
					}>;
					response?: string;
				};

				const resultsText = formatSearchResults(data);
				return {
					content: [{ text: resultsText, type: "text" }],
					structuredContent: data,
				};
			},
		);

		this.server.tool(
			"perplexity_ask",
			"Ask a conversational question using Perplexity Sonar Pro. Returns a text answer with citations.",
			{
				query: z.string().describe("The question to ask"),
				search_recency_filter: z
					.enum(["hour", "day", "week", "month", "year"])
					.optional()
					.describe("Limit results to within the specified time period"),
				search_domain_filter: z.array(z.string()).optional().describe("Limit search to specific domains"),
				search_context_size: z.enum(["low", "medium", "high"]).optional().describe("Amount of search context to use"),
			},
			async (args) => {
				if (!ALLOWED_USERNAMES.has(this.props!.login)) {
					return {
						content: [
							{
								text: "Access denied. Your GitHub username is not authorized to use this tool.",
								type: "text",
							},
						],
						isError: true,
					};
				}

				const body: Record<string, unknown> = {
					model: "sonar-pro",
					messages: [{ role: "user", content: args.query }],
				};

				if (args.search_recency_filter) {
					body.search_recency_filter = args.search_recency_filter;
				}
				if (args.search_domain_filter) {
					body.search_domain_filter = args.search_domain_filter;
				}
				if (args.search_context_size) {
					body.web_search_options = { search_context_size: args.search_context_size };
				}

				let response: Response;
				try {
					response = await fetch("https://api.perplexity.ai/chat/completions", {
						method: "POST",
						headers: {
							Authorization: `Bearer ${this.env.PERPLEXITY_API_KEY}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(body),
					});
				} catch (err) {
					return {
						content: [
							{
								text: `Network error: ${err instanceof Error ? err.message : String(err)}`,
								type: "text",
							},
						],
						isError: true,
					};
				}

				if (!response.ok) {
					const errorText = await response.text();
					return {
						content: [
							{
								text: `Perplexity API error (${response.status}): ${errorText}`,
								type: "text",
							},
						],
						isError: true,
					};
				}

				const data = (await response.json()) as {
					choices?: Array<{
						message?: { content?: string };
					}>;
					citations?: string[];
				};

				const answer = data.choices?.[0]?.message?.content ?? "No answer returned.";
				let text = answer;
				if (data.citations && data.citations.length > 0) {
					text += "\n\n## Citations\n" + data.citations.join("\n");
				}
				return {
					content: [{ text, type: "text" }],
					structuredContent: data,
				};
			},
		);

		this.server.tool(
			"perplexity_research",
			"Conduct deep research using Perplexity Sonar Deep Research model. Returns comprehensive results with citations.",
			{
				query: z.string().describe("The research query"),
				reasoning_effort: z
					.enum(["minimal", "low", "medium", "high"])
					.optional()
					.describe("Depth of reasoning effort"),
				strip_thinking: z.boolean().default(false).describe("Remove thinking tags from response"),
				search_recency_filter: z
					.enum(["hour", "day", "week", "month", "year"])
					.optional()
					.describe("Limit results to within the specified time period"),
			},
			async (args) => {
				if (!ALLOWED_USERNAMES.has(this.props!.login)) {
					return {
						content: [
							{
								text: "Access denied. Your GitHub username is not authorized to use this tool.",
								type: "text",
							},
						],
						isError: true,
					};
				}

				const body: Record<string, unknown> = {
					model: "sonar-deep-research",
					messages: [
						{
							role: "system",
							content:
								"You are a research assistant. Provide comprehensive, well-cited responses.",
						},
						{ role: "user", content: args.query },
					],
					max_tokens: 8192,
				};

				if (args.reasoning_effort) {
					body.reasoning_effort = args.reasoning_effort;
				}
				if (args.search_recency_filter) {
					body.search_recency_filter = args.search_recency_filter;
				}

				let response: Response;
				try {
					response = await fetch("https://api.perplexity.ai/chat/completions", {
						method: "POST",
						headers: {
							Authorization: `Bearer ${this.env.PERPLEXITY_API_KEY}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(body),
					});
				} catch (err) {
					return {
						content: [
							{
								text: `Network error: ${err instanceof Error ? err.message : String(err)}`,
								type: "text",
							},
						],
						isError: true,
					};
				}

				if (!response.ok) {
					const errorText = await response.text();
					return {
						content: [
							{
								text: `Perplexity API error (${response.status}): ${errorText}`,
								type: "text",
							},
						],
						isError: true,
					};
				}

				const data = (await response.json()) as {
					choices?: Array<{
						message?: { content?: string };
					}>;
					citations?: string[];
				};

				let answer = data.choices?.[0]?.message?.content ?? "No answer returned.";
				if (args.strip_thinking) {
					answer = answer.replace(/<[^>]*think[^>]*>[\s\S]*?<\/[^>]*>/gi, "");
				}
				let text = answer;
				if (data.citations && data.citations.length > 0) {
					text += "\n\n## Citations\n" + data.citations.join("\n");
				}
				return {
					content: [{ text, type: "text" }],
					structuredContent: data,
				};
			},
		);

		this.server.tool(
			"perplexity_reason",
			"Advanced reasoning and problem-solving using Perplexity Sonar Reasoning Pro. Returns step-by-step reasoning with the answer.",
			{
				query: z.string().describe("The problem or question to reason through"),
				strip_thinking: z.boolean().default(false).describe("Remove thinking tags from response"),
				search_recency_filter: z
					.enum(["hour", "day", "week", "month", "year"])
					.optional()
					.describe("Limit results to within the specified time period"),
				search_domain_filter: z.array(z.string()).optional().describe("Limit search to specific domains"),
				search_context_size: z.enum(["low", "medium", "high"]).optional().describe("Amount of search context to use"),
			},
			async (args) => {
				if (!ALLOWED_USERNAMES.has(this.props!.login)) {
					return {
						content: [
							{
								text: "Access denied. Your GitHub username is not authorized to use this tool.",
								type: "text",
							},
						],
						isError: true,
					};
				}

				const body: Record<string, unknown> = {
					model: "sonar-reasoning-pro",
					messages: [{ role: "user", content: args.query }],
				};

				if (args.search_recency_filter) {
					body.search_recency_filter = args.search_recency_filter;
				}
				if (args.search_domain_filter) {
					body.search_domain_filter = args.search_domain_filter;
				}
				if (args.search_context_size) {
					body.web_search_options = { search_context_size: args.search_context_size };
				}

				let response: Response;
				try {
					response = await fetch("https://api.perplexity.ai/chat/completions", {
						method: "POST",
						headers: {
							Authorization: `Bearer ${this.env.PERPLEXITY_API_KEY}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(body),
					});
				} catch (err) {
					return {
						content: [
							{
								text: `Network error: ${err instanceof Error ? err.message : String(err)}`,
								type: "text",
							},
						],
						isError: true,
					};
				}

				if (!response.ok) {
					const errorText = await response.text();
					return {
						content: [
							{
								text: `Perplexity API error (${response.status}): ${errorText}`,
								type: "text",
							},
						],
						isError: true,
					};
				}

				const data = (await response.json()) as {
					choices?: Array<{
						message?: { content?: string };
					}>;
				};

				let answer = data.choices?.[0]?.message?.content ?? "No answer returned.";
				if (args.strip_thinking) {
					answer = answer.replace(/<[^>]*think[^>]*>[\s\S]*?<\/[^>]*>/gi, "");
				}
				return {
					content: [{ text: answer, type: "text" }],
					structuredContent: data,
				};
			},
		);
	}
}

function formatSearchResults(data: {
	results?: Array<{
		title?: string;
		url?: string;
		snippet?: string;
		source?: string;
		published_date?: string;
	}>;
	response?: string;
}): string {
	if (!data) return "No results returned.";

	if (data.response) return data.response;

	if (data.results && data.results.length > 0) {
		const lines: string[] = [];
		for (const result of data.results) {
			const parts: string[] = [];
			if (result.title) parts.push(`Title: ${result.title}`);
			if (result.url) parts.push(`URL: ${result.url}`);
			if (result.snippet) parts.push(`Snippet: ${result.snippet}`);
			if (result.source) parts.push(`Source: ${result.source}`);
			if (result.published_date) parts.push(`Date: ${result.published_date}`);
			lines.push(parts.join("\n"));
			lines.push("");
		}
		return lines.join("\n").trim();
	}

	return "No results found.";
}

export default new OAuthProvider({
	apiHandler: MyMCP.serve("/mcp"),
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
});
