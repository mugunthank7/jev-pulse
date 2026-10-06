import type { Cat, EngineId } from "./sort";

/** Light pastel palette. `soft` = fills/lanes, `line` = strokes, `ink` = readable text on white. */
export const ENGINE_THEME: Record<EngineId, { soft: string; line: string; ink: string }> = {
  jev: { soft: "#d9f5ea", line: "#4cc9a4", ink: "#0b7a5a" },
  gemini: { soft: "#dcebff", line: "#6aa8f7", ink: "#1f56b8" },
  claude: { soft: "#ffe6d6", line: "#f4a27a", ink: "#b24d12" },
};
export const CAT_THEME: Record<Cat, { soft: string; line: string; ink: string; label: string }> = {
  exact: { soft: "#d9f5ea", line: "#58cfa5", ink: "#0b7a5a", label: "EXACT" },
  substitute: { soft: "#fff3c4", line: "#f2cd57", ink: "#8a6700", label: "SUBSTITUTE" },
  not_a_match: { soft: "#ffdde4", line: "#f5899f", ink: "#b3304b", label: "NO MATCH" },
};
export const RIGHT = "#1f9d6b";
export const WRONG = "#e0425f";
