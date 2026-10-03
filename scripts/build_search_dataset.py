"""
Builds data/esci-search.json from Amazon's Shopping Queries Dataset (ESCI): REAL human relevance judgments.

    pip install pyarrow fsspec aiohttp    # once
    npm run dataset:search

Reads the Hugging Face Parquet shards of `tasksource/esci` (test split) with HTTP range requests, so only the
columns we need are transferred (no full 700 MB download):
  pass 1: tiny columns (query_id, label, locale, small_version) -> choose queries
  pass 2: title / brand / query text, only for the chosen queries
ESCI labels: Exact, Substitute, Complement, Irrelevant. A query is kept if it has 12-30 US products,
>=2 Exact and >=3 non-Exact (so reranking matters). Candidates are represented by title + brand.
"""
import json, os, random, sys, collections
from concurrent.futures import ThreadPoolExecutor
import fsspec, pyarrow as pa, pyarrow.compute as pc, pyarrow.parquet as pq

TARGET = int(os.environ.get("TARGET_QUERIES", "40"))
URLS = [f"https://huggingface.co/api/datasets/tasksource/esci/parquet/default/test/{i}.parquet" for i in range(4)]
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "esci-search.json")
fs = fsspec.filesystem("http")

import time as _time

def resolve(url):
    """The API URL 302s to a signed CDN URL (valid ~1h). Resolve ONCE and reuse it: re-hitting the API URL on
    every reconnect gets us rate-limited (429)."""
    for attempt in range(12):
        try:
            return fs.info(url)["url"]
        except Exception as e:
            wait = 20 * (attempt + 1) if "429" in str(e) else 3 * (attempt + 1)
            print(f"resolve retry {attempt} in {wait}s ({str(e)[:60]})", flush=True)
            _time.sleep(wait)
    raise RuntimeError(f"cannot resolve {url}")

def open_pf(url):
    # Small bytes-cache => exact column-chunk range requests (the default 8 MB readahead pulls ~10x more data).
    return pq.ParquetFile(fs.open(url, block_size=1 << 20, cache_type="bytes"))

# ---- pass 1: label/locale columns only --------------------------------------------------------------
by_query = collections.defaultdict(list)  # query_id -> [(shard, rg, row_in_rg, label)]
import time

class Shard:
    """A Parquet shard that reopens itself and retries when the CDN resets the connection."""
    def __init__(self, url):
        self.api = url
        self.url = resolve(url)
        self.pf = open_pf(self.url)
    def read(self, rg, columns):
        for attempt in range(8):
            try:
                return self.pf.read_row_group(rg, columns=columns).to_pydict()
            except Exception as e:  # ConnectionReset, timeouts, truncated reads
                time.sleep(1.5 * (attempt + 1))
                try: self.pf = open_pf(self.url)
                except Exception:
                    try: self.url = resolve(self.api); self.pf = open_pf(self.url)  # signed URL may have expired
                    except Exception: pass
        print(f"WARN skipping unreadable row group {rg} of {self.url[-12:]}", flush=True)
        return None  # a skipped group only drops some rows; labels of what we DO keep stay real


def scan(si):
    sh = Shard(URLS[si])  # own handle per thread
    pf = sh.pf
    found = []
    for rg in range(pf.num_row_groups):
        t = sh.read(rg, ["query_id", "esci_label", "small_version", "product_locale"])
        if t is None:
            continue
        for i, (q, l, sv, loc) in enumerate(zip(t["query_id"], t["esci_label"], t["small_version"], t["product_locale"])):
            if sv == 1 and loc == "us":
                found.append((q, si, rg, i, l))
        if rg % 40 == 0:
            print(f"pass1 shard {si}: row group {rg}/{pf.num_row_groups}", flush=True)
    return found

with ThreadPoolExecutor(2) as ex:
    for found in ex.map(scan, range(4)):
        for q, si, rg, i, l in found:
            by_query[q].append((si, rg, i, l))
print(f"pass1 done: {len(by_query)} queries", flush=True)

ok = []
for q, rows in by_query.items():
    exact = sum(1 for r in rows if r[3] == "Exact")
    if 12 <= len(rows) <= 30 and exact >= 2 and len(rows) - exact >= 3:
        ok.append(q)
random.Random(11).shuffle(ok)
chosen = set(ok[:TARGET])
print(f"{len(ok)} eligible queries, keeping {len(chosen)}", flush=True)

# ---- pass 2: text columns for chosen queries only ---------------------------------------------------
want = {}  # (shard, rg) -> set(row indexes)
for q in chosen:
    for si, rg, i, _ in by_query[q]:
        want.setdefault((si, rg), set()).add(i)
cols = ["query_id", "query", "product_id", "esci_label", "product_title", "product_brand"]
queries = collections.OrderedDict()
by_shard = collections.defaultdict(list)
for (si, rg), idxs in want.items():
    by_shard[si].append((rg, idxs))

def fetch(si):
    sh = Shard(URLS[si])
    rows = []
    for n, (rg, idxs) in enumerate(sorted(by_shard[si])):
        t = sh.read(rg, cols)
        if t is None:
            continue
        for i in sorted(idxs):
            rows.append({k: t[k][i] for k in cols})
        if n % 40 == 0:
            print(f"pass2 shard {si}: {n}/{len(by_shard[si])} row groups", flush=True)
    return rows

clean = lambda x, n: " ".join((x or "").split())[:n]
with ThreadPoolExecutor(2) as ex:
    for rows in ex.map(fetch, sorted(by_shard)):
        for r in rows:
            d = queries.setdefault(r["query_id"], {"queryId": r["query_id"], "query": clean(r["query"], 120), "candidates": []})
            d["candidates"].append({"id": r["product_id"], "title": clean(r["product_title"], 200), "brand": clean(r["product_brand"], 40), "bullets": "", "label": r["esci_label"]})

result = {
    "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "source": "Amazon Shopping Queries Dataset (ESCI), tasksource/esci test split, US locale, small version. Human relevance labels. Apache-2.0.",
    "gains": {"Exact": 1, "Substitute": 0.1, "Complement": 0.01, "Irrelevant": 0},
    "queries": [q for q in queries.values() if 12 <= len(q["candidates"]) <= 30],
}
with open(OUT, "w") as f:
    json.dump(result, f)
print(f"wrote {len(result['queries'])} queries to {os.path.relpath(OUT)}")
