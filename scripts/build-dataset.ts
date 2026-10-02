/**
 * Builds data/github-issues.json: REAL GitHub issues whose ground-truth class is the label a
 * maintainer applied (bug / feature / question). No synthetic data.
 *
 *   npm run dataset            (set GITHUB_TOKEN for a higher rate limit)
 *
 * Only issues carrying exactly ONE of the three classes are kept, and pull requests are dropped.
 */
import { writeFileSync } from "node:fs";

const REPOS: Record<string, Record<"bug" | "feature" | "question", string[]>> = {
  "pandas-dev/pandas": { bug: ["Bug"], feature: ["Enhancement"], question: ["Usage Question"] },
  "numpy/numpy": { bug: ["00 - Bug"], feature: ["01 - Enhancement"], question: ["33 - Question"] },
  "scikit-learn/scikit-learn": { bug: ["Bug"], feature: ["Enhancement", "New Feature"], question: ["Question"] },
  "microsoft/vscode": { bug: ["bug"], feature: ["feature-request"], question: ["*question"] },
};
const PER_CELL = 30; // issues per (repo, class)
const classes = ["bug", "feature", "question"] as const;

const headers: Record<string, string> = { "user-agent": "jev-pulse-dataset", accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

type Issue = { number: number; title: string; body: string | null; html_url: string; labels: { name: string }[]; pull_request?: unknown; state: string };

const clean = (s: string) =>
  s.replace(/<!--[\s\S]*?-->/g, " ").replace(/```[\s\S]*?```/g, " [code] ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

const out: object[] = [];
for (const [repo, map] of Object.entries(REPOS)) {
  const all = new Set(Object.values(map).flat().map((l) => l.toLowerCase()));
  for (const cls of classes) {
    const label = map[cls][0]!; // the API ANDs multiple labels, so query one and keep the rest as aliases
    const url = `https://api.github.com/repos/${repo}/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${repo} ${cls}: ${res.status} ${await res.text()}`);
    const rows = ((await res.json()) as Issue[]).filter((i) => !i.pull_request);
    let kept = 0;
    for (const i of rows) {
      const names = i.labels.map((l) => l.name.toLowerCase());
      const matched = classes.filter((c) => map[c].some((l) => names.includes(l.toLowerCase())));
      if (matched.length !== 1 || matched[0] !== cls) continue; // ambiguous ground truth -> drop
      const body = clean(i.body ?? "");
      if (i.title.length < 8 || body.length < 20) continue;
      out.push({ id: `${repo}#${i.number}`, repo, number: i.number, url: i.html_url, title: i.title.trim(), body: body.slice(0, 700), label: cls, sourceLabel: label });
      if (++kept >= PER_CELL) break;
    }
    console.log(`${repo.padEnd(28)} ${cls.padEnd(9)} kept ${kept}  (labels: ${[...all].length})`);
  }
}
writeFileSync(new URL("../data/github-issues.json", import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), note: "Public GitHub issues; ground truth = the maintainer-applied label. Not synthetic.", items: out }, null, 1));
console.log(`wrote ${out.length} issues`);
