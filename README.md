# PM Compass

AI-powered knowledge assistant for Product Managers. Connects to Google Drive and provides semantic search with cited, grounded answers across your documents.

**Live:** [pmcompass.vercel.app](https://pmcompass.vercel.app)

## What It Does

- **Natural language document search** — Ask questions in plain English across all your Google Drive documents (Docs, Sheets, PDFs, Slides)
- **Cited AI answers** — Every answer shows exactly which document and passage it came from. Says "I don't know" when unsure.
- **Multi-format intelligence** — Paragraph-boundary chunking for prose, header-preserved row chunking for spreadsheets
- **Meeting prep** — Auto-generated context for upcoming calendar events using relevant Drive docs

## RAG Pipeline

Every search runs through a multi-stage pipeline:

```
User Query
  → Query Expansion (Haiku 4.5, 1 + 2 variants = 3 queries)
  → Embed (OpenAI text-embedding-3-small, 1536-dim, x3 in parallel)
  → Vector Search (pgvector, 3 x 10 chunks, cosine similarity > 0.5)
  → Dedup (~15-25 unique candidate chunks)
  → Select (top 7 by similarity, max 6,000 chars)
  → Synthesis (Claude Haiku 4.5, 500 tokens, temp=0)
  → Cited Answer + Source Documents
```

### Indexing

Google Drive files are exported as text/CSV, chunked (800 chars with 200 overlap for prose, row-boundary for tabular), embedded via OpenAI, and stored in pgvector with HNSW indexing.

## Eval Metrics

Measured across a 50-query golden dataset spanning 7 categories:

| Metric | Score |
|--------|-------|
| Recall@5 | 78.8% |
| Precision@5 | 63.4% |
| MRR | 81.2% |
| Factual Containment | 83.7% |
| Faithfulness (LLM judge) | 4.8 / 5 |
| Avg Latency | ~6s |

### By Category (Recall@5)

| Category | n | Recall |
|----------|---|--------|
| Exact Lookup | 6 | 100% |
| Factual Extraction | 12 | 92% |
| Tabular / Statistical | 8 | 85% |
| Cross-Document | 9 | 71% |
| Negative (no answer) | 5 | 100% |
| Vague / Broad | 5 | 47% |
| Paraphrase | 5 | 37% |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| State | React Context + React Query + React Hook Form + Zod |
| Backend | Supabase (PostgreSQL + Edge Functions in Deno) |
| Auth | Supabase Auth → Google OAuth 2.0 (readonly scopes) |
| Vector DB | pgvector (1536-dim, HNSW index, cosine similarity) |
| Embeddings | OpenAI `text-embedding-3-small` |
| LLM | Claude Haiku 4.5 (search synthesis + query expansion) |
| Hosting | Vercel (frontend) + Supabase Cloud (backend) |

## Project Structure

```
src/
  pages/          Landing, Dashboard, Search, MeetingPrep, Settings
  components/     layout/, search/, ui/ (PM-branded wrappers over shadcn)
  contexts/       AuthContext
  lib/            google-auth, utils

supabase/
  functions/      Edge Functions (Deno/TypeScript):
    search-documents/     Query → expand → embed → vector search → synthesis
    index-documents/      Drive → chunk → embed → pgvector
    prepare-meeting/      Calendar event → doc search → AI brief
    sync-calendar/        Google Calendar → meetings table
    store-oauth-tokens/   Save Google tokens after OAuth
  migrations/     SQL schema (15+ files)

evals/
  run-evals.ts          Eval harness (Deno)
  golden-dataset.json   50 queries with ground truth
  results/              Timestamped eval outputs
```

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Deploy frontend
vercel --prod

# Deploy edge functions
supabase functions deploy <name>

# Run evals
deno run --allow-net --allow-read --allow-write --allow-env evals/run-evals.ts
```

### Environment Variables

**Frontend (.env):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`

**Supabase Secrets:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

## Google OAuth Scopes

All readonly: `drive.metadata.readonly`, `drive.readonly`, `documents.readonly`, `calendar.readonly`
