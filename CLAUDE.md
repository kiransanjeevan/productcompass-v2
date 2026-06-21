# PM Compass v2 — Dark Premium Redesign

**This is a separate fork** of PM Compass with a dark premium aesthetic (Linear/Vercel/Raycast style). The original project lives at `/Users/kiransanjeevan/AI/productcompass` — do NOT modify it from this project.

## What This Product Does

AI-powered knowledge assistant for Product Managers. Connects to Google Drive and provides:

1. **Natural language document search** — Semantic search across Google Drive with AI-synthesized answers
2. **Structured data Q&A** — Text-to-SQL over tabular data (spreadsheets, Linear issues) for analytical questions
3. **Linear issue intelligence** — Sync Linear issues into search, and create new issues drafted from your docs (gated preview/confirm)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui (Radix primitives) |
| State | React Context (auth) + React Query (server data) + React Hook Form + Zod |
| Backend | Supabase (PostgreSQL + Edge Functions in Deno) |
| Auth | Supabase Auth → Google OAuth 2.0 (3 readonly scopes) |
| Vector DB | pgvector (1536-dim, HNSW index, cosine similarity) |
| Embeddings | OpenAI `text-embedding-3-small` |
| LLM | Claude Haiku 4.5 (search synthesis, text-to-SQL, Linear drafting) — model-agnostic via `LLM_PROVIDER`/`LLM_MODEL` (OpenRouter swap) |
| Integrations | Google Drive (read-only) + Linear (GraphQL, read + write) |
| Hosting | Vercel (frontend) + Supabase Cloud (backend) |

## Project Structure

```
src/
  pages/          → Landing, Dashboard, Search, Settings, Onboarding, CreateIssue
  components/     → layout/, search/, ui/ (PM-branded wrappers over shadcn)
  contexts/       → AuthContext (user, session, loading, signOut)
  integrations/   → Supabase client + generated types
  lib/            → google-auth.ts, linear-auth.ts, utils.ts (cn, getUserDisplayName)
  hooks/          → use-mobile, use-toast

supabase/
  functions/      → Edge Functions (Deno/TypeScript):
    store-oauth-tokens/   → Save Google tokens after OAuth
    index-documents/      → Drive → chunk → embed → pgvector (+ materialize tabular → SQL)
    search-documents/     → Query → route → vector search OR text-to-SQL → Claude synthesis
    linear-oauth/         → Linear OAuth2 code→token exchange (custom flow)
    sync-linear/          → Linear issues → embed (chunks) + materialize SQL table
    create-linear-issue/  → RAG-grounded AI draft + issueCreate (preview/confirm)
    linear-webhook/       → HMAC-verified auto-resync on Linear issue changes
    _shared/              → anthropic.ts (LLM helper), pg-client.ts, linear-sync.ts
  migrations/     → SQL schema migrations

evals/            → RAG evaluation framework
  run-evals.ts    → Eval harness (Deno) — measures recall, precision, MRR, factual containment
  golden-dataset.json → Test queries with ground truth doc IDs
  results/        → Timestamped eval output (gitignored)
```

## Database Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `profiles` | User metadata | user_id, display_name, email, avatar_url |
| `oauth_tokens` | Google + Linear tokens | user_id, provider, access_token, refresh_token, expires_at, scopes — **UNIQUE(user_id, provider)** |
| `document_chunks` | Indexed docs + Linear issues + embeddings | user_id, document_id, document_title, document_type, chunk_text, embedding(1536), metadata(jsonb) |
| `sheet_registry` | Text-to-SQL registry of materialized tables (incl. Linear issues) | user_id, table_name, columns(jsonb — type + enum value-hints) |
| `feedback` | User search feedback | user_id, query, feedback_text |

**Key RPC:** `match_documents(query_embedding, match_count, match_threshold, user_uuid)` — pgvector cosine similarity search.

All tables have RLS policies scoped to `auth.uid() = user_id`. Materialized text-to-SQL tables live in the `sheets` schema (e.g. `sheets.u_<uid>_linear_issues`), also RLS-scoped.

## RAG Pipeline

### Indexing (index-documents)
Drive files → export text/CSV → chunk (prose: paragraph-boundary 1600/400 overlap; tabular: row-boundary with header) → OpenAI embed (batch 20) → upsert document_chunks

### Search (search-documents)
Query → OpenAI embed → match_documents RPC (top 10, threshold 0.3) → dedup by document_id → Claude Haiku synthesis (temp=0, 500 tokens)

## Linear Integration (Architecture A)

**Read (sync-linear / linear-webhook):** Linear GraphQL → for each issue, two destinations: (a) embed identifier+title+description+comments → `document_chunks` (`document_type "linear_issue"`) for vector search, AND (b) structured fields → CSV → materialize `sheets.u_<uid>_linear_issues` + `sheet_registry` for text-to-SQL. One pull feeds both engines; the existing router/SQL/vector code is unchanged. Idempotent re-sync. Shared impl in `_shared/linear-sync.ts`.

**Write (create-linear-issue):** two gated steps — `draft` (embed instruction → `match_documents` grounding → `callClaude` drafts {title, description, priority, project}; **no write**) then `create` (issueCreate mutation). Drafting uses `callClaude` (honors the `LLM_PROVIDER`/`LLM_MODEL` swap), **not** Linear's MCP connector (Anthropic-only, would break the swap). Write credential prefers the user's Linear OAuth token (Bearer), falls back to the `LINEAR_API_KEY` secret (raw header).

**Webhook (linear-webhook):** HMAC-SHA256 verifies Linear's `linear-signature`, then runs a full re-sync on Issue events. Deployed `--no-verify-jwt` (Linear can't send a Supabase JWT) — the signature is the auth boundary.

## Routes

| Path | Page | Auth |
|------|------|------|
| `/` | Landing | Public |
| `/onboarding` | Onboarding | Public |
| `/auth/callback` | AuthCallback | Public |
| `/auth/linear/callback` | LinearCallback | Public |
| `/dashboard` | Dashboard | Protected |
| `/search?q=...` | Search | Protected |
| `/create-issue` | CreateIssue | Protected |
| `/settings` | Settings | Protected |

## Google OAuth Scopes (all readonly)
`drive.metadata.readonly`, `drive.readonly`, `documents.readonly`

## Linear OAuth
Custom OAuth2 authorization-code flow (Linear isn't a Supabase social provider) — scopes `read,write`, handled by the `linear-oauth` function. Sync + issue creation also work via the server-side `LINEAR_API_KEY` personal key, independent of per-user OAuth.

## Environment Variables

**Frontend (.env):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_LINEAR_CLIENT_ID`

**Supabase Secrets:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `LINEAR_API_KEY`, `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET`, `SUPABASE_DB_URL` (materialize/text-to-SQL). Optional model swap: `LLM_PROVIDER`, `LLM_MODEL`, `OPENROUTER_API_KEY`.

## Commands

```bash
npm run dev           # Vite dev server
npm run build         # Production build → dist/
npm run test          # Vitest
npm run lint          # ESLint

# Deploy frontend
vercel --prod                         # Deploy to pmcompass.vercel.app

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

- **GitHub**: https://github.com/kiransanjeevan/productcompass-v2
- **Supabase project**: umxpfhudmrqcwpeuveuq
- **Production**: https://pmcompass.vercel.app

## Guardrails

- Do NOT change Google OAuth scopes without discussion (readonly by design)
- Linear writes go ONLY through create-linear-issue's preview/confirm gate — never auto-create issues
- Keep Linear drafting on `callClaude` (model-agnostic); do NOT switch to Linear's MCP connector (Anthropic-only, breaks the LLM swap)
- Do NOT use `supabase.auth.admin` from frontend code
- Do NOT add npm dependencies without stating why the existing stack can't handle it
- Do NOT use class components — hooks-only codebase
- Do NOT commit .env files or API keys
