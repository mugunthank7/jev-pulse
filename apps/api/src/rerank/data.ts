import { readFileSync } from "node:fs";
import { SearchQuerySchema, type SearchQuery } from "@jev-pulse/schema";
import { z } from "zod";

const FileSchema = z.object({ source: z.string(), queries: z.array(SearchQuerySchema) });
let cache: z.infer<typeof FileSchema> | undefined;

function load() {
  cache ??= FileSchema.parse(JSON.parse(readFileSync(new URL("../../../../data/esci-search.json", import.meta.url), "utf8")));
  return cache;
}

export const searchSource = () => load().source;
export const listQueries = () => load().queries.map((q) => ({ queryId: q.queryId, query: q.query, candidates: q.candidates.length, exact: q.candidates.filter((c) => c.label === "Exact").length }));
export const getQueries = (): SearchQuery[] => load().queries;
export const getQuery = (id: number): SearchQuery | undefined => load().queries.find((q) => q.queryId === id);
