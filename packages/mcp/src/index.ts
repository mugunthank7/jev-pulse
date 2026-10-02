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
  "triage_feed",
  {
    title: "Triage a feed with Jev",
    description:
      "Scores every item in a Hacker News or GitHub-issues feed with Jev (category, urgency, sentiment, actionable, spam) and returns the top N ranked by urgency x actionability, with confidence and an 'escalate' flag for low-confidence items. Cheap and fast: use it to decide what deserves an LLM's attention.",
    inputSchema: {
      source: z.enum(["hn", "github"]).default("hn"),
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
