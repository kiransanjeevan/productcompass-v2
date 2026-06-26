# PM Compass

AI knowledge assistant for Product Managers. Connects to Google Drive and Linear, then answers natural-language questions with cited, grounded answers — combining semantic (vector) search over documents with text-to-SQL over your tabular data.

**Live:** [pmcompass.vercel.app](https://pmcompass.vercel.app)

> This is **v2** — a dark-premium redesign (Linear/Vercel/Raycast aesthetic) with Linear integration and a text-to-SQL path added on top of the original RAG search.

## What it does

- **Natural-language document search** — Ask questions in plain English across your Google Drive (Docs, Sheets, Slides, PDFs). Answers cite the exact source document; says "I don't know" when the corpus doesn't cover it.
- **Structured-data Q&A (text-to-SQL)** — Analytical questions ("what was MRR in November?") route to generated SQL over materialized tables instead of vector search.
- **Linear issue intelligence** — Syncs Linear issues into both search engines (vector + SQL), and drafts new issues from your docs behind a preview/confirm gate (never auto-creates).

### RAG pipeline (search-documents)

```
Query
  → Query expansion (Claude Haiku, +2 variants)
  → Router: vector search OR text-to-SQL
  → Vector: OpenAI embed → pgvector cosine search (top 10) → dedup by document
  → Synthesis (Claude Haiku, temp=0) → cited answer + source docs
```

Indexing chunks prose by paragraph boundary and tabular data by row (header preserved), embeds via OpenAI, and stores in pgvector with an HNSW index. Tabular files are additionally materialized into a `sheets` schema for the SQL path.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui (Radix) |
| State | React Context (auth) + React Query + React Hook Form + Zod |
| Backend | Supabase — PostgreSQL + Edge Functions (Deno) |
| Auth | Supabase Auth → Google OAuth 2.0 (readonly scopes); custom Linear OAuth2 |
| Vector DB | pgvector — 1536-dim, HNSW index, cosine similarity |
| Embeddings | OpenAI `text-embedding-3-small` |
| LLM | Claude Haiku (synthesis, query expansion, SQL gen, issue drafting) — model-agnostic via `LLM_PROVIDER` / `LLM_MODEL` (OpenRouter swap) |
| Integrations | Google Drive (read-only), Linear (GraphQL, read + write) |
| Hosting | Vercel (frontend) + Supabase Cloud (backend) |

## How to run

Prereqs: Node 18+, npm, Deno (for evals), Supabase CLI.

```bash
npm install        # install deps
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # production build → dist/
npm run lint       # ESLint
npm run test       # Vitest

# Deploy
vercel --prod                     # frontend
supabase functions deploy <name>  # one edge function
supabase db push --linked         # migrations

# Evals (Deno)
set -a && source .env.evals && set +a
deno run --allow-net --allow-read --allow-write --allow-env evals/run-evals.ts
```

### Environment variables

- **Frontend (`.env`):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_LINEAR_CLIENT_ID`
- **Supabase secrets:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_DB_URL`, plus Linear (`LINEAR_API_KEY`, `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET`). Optional model swap: `LLM_PROVIDER`, `LLM_MODEL`, `OPENROUTER_API_KEY`.

## Project structure

```
src/
  pages/         Landing, Dashboard, Search, Settings, Onboarding, CreateIssue, callbacks
  components/    layout/, search/, ui/ (PM-branded wrappers over shadcn)
  contexts/      AuthContext
  integrations/  Supabase client + generated types
  lib/           google-auth, linear-auth, utils

supabase/
  functions/     Edge Functions (Deno):
    store-oauth-tokens   save Google tokens after OAuth
    index-documents      Drive → chunk → embed → pgvector (+ materialize tabular → SQL)
    search-documents     query → route → vector / text-to-SQL → synthesis
    linear-oauth         Linear OAuth2 code→token exchange
    sync-linear          Linear issues → embed + materialize SQL table
    create-linear-issue  RAG-grounded draft → gated issueCreate
    linear-webhook       HMAC-verified auto-resync on Linear changes
    _shared/             LLM helper, pg-client, linear-sync
  migrations/    SQL schema (RLS scoped to auth.uid())

evals/           RAG eval framework (Deno harness)
  run-evals.ts          retrieval + answer-quality harness
  golden-dataset.json   50 queries across 7 categories, with ground truth
  sql-golden.json       text-to-SQL golden queries
  results/              timestamped eval output (gitignored)
```

## Status / notes

- **Deployed search config:** vector + query expansion. Hybrid (keyword + RRF) and Cohere reranking were tested but not shipped — reranking hurt domain relevance in every configuration; the helper code remains as dead code for future experiments.
- **Latest eval run (50-query golden set, query-expansion config):** Recall@5 78.7%, Precision@5 57.6%, MRR 79.7%, Factual Containment 75.0%, Citation Accuracy 80.0%, LLM-judge 4.0/5, ~5.3s avg latency. Weakest categories: paraphrase and vague/broad queries (~47% recall). See `evals/results/`.
- **Test data:** a fictional SaaS company ("RavenStack") built from a public Kaggle churn dataset, date-shifted and expanded into ~50 synthetic Drive documents via Google Apps Script (`evals/apps-script/`).
- All Drive scopes are read-only; Linear writes go only through the `create-linear-issue` preview/confirm gate.
