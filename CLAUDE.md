# PM Compass v2 — Dark Premium Redesign

**This is a separate fork** of PM Compass with a dark premium aesthetic (Linear/Vercel/Raycast style). The original project lives at `/Users/kiransanjeevan/AI/productcompass` — do NOT modify it from this project.

## What This Product Does

AI-powered knowledge assistant for Product Managers. Connects to Google Workspace (Drive + Calendar) and provides:

1. **Natural language document search** — Semantic search across Google Drive with AI-synthesized answers
2. **AI meeting briefs** — Auto-generated context for upcoming calendar events using relevant Drive docs

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui (Radix primitives) |
| State | React Context (auth) + React Query (server data) + React Hook Form + Zod |
| Backend | Supabase (PostgreSQL + Edge Functions in Deno) |
| Auth | Supabase Auth → Google OAuth 2.0 (4 readonly scopes) |
| Vector DB | pgvector (1536-dim, HNSW index, cosine similarity) |
| Embeddings | OpenAI `text-embedding-3-small` |
| LLM | Claude Haiku 4.5 (search) + Claude Sonnet 4.5 (meeting briefs) |
| Hosting | Vercel (frontend) + Supabase Cloud (backend) |

## Project Structure

```
src/
  pages/          → Landing, Dashboard, Search, MeetingPrep, Settings, Onboarding
  components/     → layout/, search/, ui/ (PM-branded wrappers over shadcn)
  contexts/       → AuthContext (user, session, loading, signOut)
  integrations/   → Supabase client + generated types
  lib/            → google-auth.ts, utils.ts (cn, getUserDisplayName)
  hooks/          → use-mobile, use-toast

supabase/
  functions/      → 5 Edge Functions (Deno/TypeScript):
    store-oauth-tokens/   → Save Google tokens after OAuth
    index-documents/      → Drive → chunk → embed → pgvector
    search-documents/     → Query embed → vector search → Claude synthesis
    prepare-meeting/      → Meeting context → doc search → Claude brief
    sync-calendar/        → Google Calendar → meetings table
  migrations/     → SQL schema migrations (15+ files)

evals/            → RAG evaluation framework
  run-evals.ts    → Eval harness (Deno) — measures recall, precision, MRR, factual containment
  golden-dataset.json → Test queries with ground truth doc IDs
  results/        → Timestamped eval output (gitignored)
```

## Database Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `profiles` | User metadata | user_id, display_name, email, avatar_url |
| `oauth_tokens` | Google tokens | user_id, access_token, refresh_token, expires_at, scopes |
| `document_chunks` | Indexed docs + embeddings | user_id, document_id, document_title, chunk_text, embedding(1536), metadata(jsonb) |
| `meetings` | Calendar events + AI briefs | user_id, calendar_event_id, title, attendees(jsonb), brief, relevant_document_ids |
| `feedback` | User search feedback | user_id, query, feedback_text |

**Key RPC:** `match_documents(query_embedding, match_count, match_threshold, user_uuid)` — pgvector cosine similarity search.

All tables have RLS policies scoped to `auth.uid() = user_id`.

## RAG Pipeline

### Indexing (index-documents)
Drive files → export text/CSV → chunk (prose: paragraph-boundary 1600/400 overlap; tabular: row-boundary with header) → OpenAI embed (batch 20) → upsert document_chunks

### Search (search-documents)
Query → OpenAI embed → match_documents RPC (top 10, threshold 0.3) → dedup by document_id → Claude Haiku synthesis (temp=0, 500 tokens)

### Meeting Brief (prepare-meeting)
Title + attendees → embed → match_documents (top 10, threshold 0.2) → Claude Sonnet brief (temp=0, 1000 tokens)

## Routes

| Path | Page | Auth |
|------|------|------|
| `/` | Landing | Public |
| `/onboarding` | Onboarding | Public |
| `/auth/callback` | AuthCallback | Public |
| `/dashboard` | Dashboard | Protected |
| `/search?q=...` | Search | Protected |
| `/meeting-prep/:meetingId` | MeetingPrep | Protected |
| `/settings` | Settings | Protected |

## Google OAuth Scopes (all readonly)
`drive.metadata.readonly`, `drive.readonly`, `documents.readonly`, `calendar.readonly`

## Environment Variables

**Frontend (.env):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`

**Supabase Secrets:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

## Commands

```bash
npm run dev           # Vite dev server
npm run build         # Production build → dist/
npm run test          # Vitest
npm run lint          # ESLint

# Edge functions
supabase functions serve              # Local dev
supabase functions deploy <name>      # Deploy one function

# Evals
deno run --allow-net --allow-read --allow-write --allow-env evals/run-evals.ts
```

## Conventions

- **Semicolons**: Yes. **Indentation**: 2 spaces.
- **Naming**: camelCase (vars/functions), PascalCase (components/types), SCREAMING_SNAKE (constants)
- **Components**: Functional + hooks only. PM-themed wrappers (PMButton, PMCard, PMBadge) over shadcn-ui base.
- **API calls**: `supabase.functions.invoke("name", { body })` for edge functions
- **Error UX**: try-catch + `toast.error()` for user-facing errors
- **Animations**: Framer Motion for page transitions
- **Icons**: Lucide React exclusively

## External References

- **GitHub**: https://github.com/kirans2015/productcompass
- **Supabase project**: ehihqgkkuualltuqwmfz
- **Production**: https://productcompass-puce.vercel.app

## Guardrails

- Do NOT change Google OAuth scopes without discussion (readonly by design)
- Do NOT use `supabase.auth.admin` from frontend code
- Do NOT add npm dependencies without stating why the existing stack can't handle it
- Do NOT use class components — hooks-only codebase
- Do NOT commit .env files or API keys
