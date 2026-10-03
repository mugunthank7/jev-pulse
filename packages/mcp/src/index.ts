import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.JEV_PULSE_URL ?? "http://localhost:8787";

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, init);
  const body = await res.text();
  if (!res.ok) throw new Error(`Jev Pulse API ${res.status}: ${body.slice(0, 300)}`);
  return body;
}

const server = new McpServer({ name: "jev-pulse", version: "0.1.0" });

server.registerTool(
  "rerank",
  {
    title: "Rerank documents for a query with Jev",
    description:
      "Reorders candidate documents (search results, RAG chunks, products) by relevance to a query using Jev: one typed decision per document, scored in parallel, ranked by expected relevance (exact > substitute > complement > irrelevant). Fast and very cheap, so use it to cut 50-100 retrieved candidates down before spending an LLM on the survivors. It returns no explanations.",
    inputSchema: {
      query: z.string().min(1).max(300),
      documents: z.array(z.object({ id: z.string().optional(), text: z.string().max(400) })).min(1).max(100),
    },
  },
  async ({ query, documents }) => ({
    content: [{ type: "text", text: await call("/api/rank", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, documents }) }) }],
  }),
);

server.registerTool(
  "triage_feed",
  {
    title: "Triage a feed with Jev",
    description:
      "Scores GitHub issues with Jev (category bug/feature/question, urgency, sentiment, actionable, spam) and returns the top N ranked by urgency x actionability, with confidence and an 'escalate' flag for low-confidence items. Sources: the bundled maintainer-labeled dataset, or any public repo's open issues. Cheap and fast: use it to decide what deserves an LLM's attention.",
    inputSchema: {
      source: z.enum(["dataset", "github"]).default("github"),
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional().describe("owner/name, required when source=github"),
      limit: z.number().int().min(1).max(500).default(60).describe("how many items to score"),
      top: z.number().int().min(1).max(50).default(10).describe("how many ranked results to return"),
    },
  },
  async ({ source, repo, limit, top }) => {
    const q = new URLSearchParams({ source, limit: String(limit), top: String(top), ...(repo ? { repo } : {}) });
    return { content: [{ type: "text", text: await call(`/api/triage?${q}`) }] };
  },
);

server.registerTool(
  "score_items",
  {
    title: "Score text items with Jev",
    description: "Scores arbitrary text snippets with Jev's typed questions. Returns calibrated probabilities per item.",
    inputSchema: { items: z.array(z.object({ id: z.string(), text: z.string().max(4000) })).min(1).max(200) },
  },
  async ({ items }) => {
    const body = JSON.stringify({ items: items.map((i) => ({ ...i, source: "mcp" })) });
    return { content: [{ type: "text", text: await call("/api/score", { method: "POST", headers: { "content-type": "application/json" }, body }) }] };
  },
);

await server.connect(new StdioServerTransport());
