# Operational Cost

Cerefox is designed to be cheap to run. This page explains what you will (and won't) pay for,
and gives rough estimates for two common deployment scenarios.

> **Disclaimer**: Pricing for third-party services (Supabase, OpenAI, GCP) changes over time
> and varies by region and usage pattern. Treat the figures here as order-of-magnitude guidance
> for a typical single-user personal knowledge base, not as a billing guarantee. Check each
> provider's current pricing page before committing to a setup.

---

## What costs money

| Component | Cost driver |
|-----------|-------------|
| **Supabase** | Database storage and **Edge Function invocations** — the latter is the binding free-tier limit for cloud / remote-MCP usage (see below). Direct Data API requests are unlimited. The free tier covers typical personal use indefinitely. |
| **OpenAI embeddings** | Charged per token when ingesting content or running searches. The default model (`text-embedding-3-small`) is among the cheapest available. |
| **Cloud Run** (optional) | Compute for the web UI if you deploy it to GCP rather than running it locally. |
| **Artifact Registry** (optional) | Docker image storage on GCP, if you deploy to Cloud Run. |

---

## Scenario A — Local webapp (lean setup)

The web UI and CLI run on your own machine. Supabase is the only cloud service.

```
Your machine
├── cerefox CLI + web UI  (free — runs locally)
└── Supabase (cloud)      (free tier)
    └── PostgreSQL + pgvector
        Embeddings via OpenAI API  (pay-per-use)
```

**Typical cost for personal use**: a few cents to a couple of dollars per month, almost entirely
from OpenAI embedding calls. Light users (a few hundred documents ingested and searched
occasionally) will see costs well under a dollar a month. Heavier usage — thousands of documents
with frequent AI agent queries — might reach a few dollars a month.

You only pay for embeddings when:
- Ingesting new or updated content (one embedding call per chunk, typically a few hundred tokens)
- Searching via `cerefox mcp` or the CLI (one embedding call per query)

The web UI's built-in search bar and document browser make no embedding calls.

### Supabase free tier limits

Supabase's free tier is sufficient for a personal knowledge base. Current limits
(verify at [supabase.com/pricing](https://supabase.com/pricing)):

- **500 MB database storage** — text + 768-dim vectors; a typical personal KB is well under this.
- **500,000 Edge Function invocations / month** — *the limit that matters most for Cerefox* (see below).
- **5 GB egress / month**.
- **2 active projects**, paused after ~1 week of inactivity (a single request unpauses).
- **Unlimited Data API (REST/PostgREST) requests** on all plans — direct database reads/writes are not metered.

(Supabase's "50,000 monthly active users" figure is an **Auth** limit; Cerefox
doesn't use Supabase Auth, so it never applies.)

#### Edge Function invocations are the real free-tier limiter

Most of Cerefox runs against the **Data API** (unlimited), but the **remote** agent
paths go through **Edge Functions**, which the free tier caps at 500,000/month:

| Access path | Uses Edge Functions? | Cost per call |
|---|---|---|
| Remote MCP (`cerefox-mcp`) — Claude/Cursor/etc. over HTTP | **Yes** | ~1 invocation per agent tool call (calls the RPC directly — no fan-out) |
| GPT Actions (Custom GPT) → primitive Edge Functions | **Yes** | 1 invocation per action call |
| `cerefox doctor` | **Yes** | several (it calls the `/version?peers=true` aggregator) |
| **Local stdio MCP (`cerefox mcp`)** | **No** | 0 — talks to the Data API directly |
| `cerefox` CLI and `cerefox web` (web UI) | **No** | 0 — Data API directly |

500K/month is generous for a single human-driven agent. But **automated or
high-frequency agents on the remote path** can approach it. The lever: point those
agents at the **local stdio MCP server** (`cerefox mcp`) instead of the remote Edge
Function — it exposes the identical 10 tools, talks to the Data API directly, and
costs **zero** Edge Function invocations (bonus: lower latency, and it works offline
against a reachable database). If you do exceed the free EF quota, Supabase's Pro
plan ($25/mo, 2M invocations included) is the next step.

---

## Scenario B — Cloud Run webapp

The web UI is deployed to Google Cloud Run so it's accessible from any browser without keeping
your laptop on. Everything else is the same as Scenario A.

```
Your machine / any browser
└── Cloud Run (GCP)       (free tier; small charge if exceeded)
    └── cerefox web UI
Supabase (cloud)          (free tier)
└── PostgreSQL + pgvector
    Embeddings via OpenAI API  (pay-per-use)
```

**Typical cost for personal use**: similar to Scenario A for embeddings, plus a small amount
for Cloud Run and image storage. Cloud Run has a generous always-free tier (2 million requests
and 360,000 vCPU-seconds per month) that easily covers low-traffic personal use. Docker image
storage in Artifact Registry costs a small amount per GB per month.

In practice, most single users running Cerefox on Cloud Run pay roughly the same as Scenario A
— a few cents to a couple of dollars per month in total.

### GCP free tier limits

Cloud Run's free tier limits as of early 2026:

- 2 million requests/month
- 360,000 GB-seconds of memory/month
- 180,000 vCPU-seconds/month

These limits comfortably cover personal-use traffic. Check
[cloud.google.com/run/pricing](https://cloud.google.com/run/pricing) for current rates.

---

## Controlling embedding costs

If you want to keep costs as low as possible:

- **Fireworks AI** is an OpenAI-compatible alternative that offers competitive embedding prices.
  See `docs/guides/configuration.md` for how to switch.
- **Batch ingest, don't re-ingest**: Cerefox deduplicates by content hash — re-ingesting the
  same file twice costs nothing. Only new or changed content triggers embedding calls.
- **`cerefox server reindex`**: Re-embeds all existing chunks if you switch embedders. Run this once
  after switching, not repeatedly.

---

## What is always free

- The Cerefox application itself (Apache 2.0 open source, no license fees)
- Local CLI and web UI (runs on your machine)
- All search RPCs and FTS queries (Supabase free tier covers personal-scale usage)
- Backups and restores (JSON snapshots, no cloud storage required)
