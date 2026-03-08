# PM Compass — Claude Code Handoff

## Project Overview

PM Compass is an AI-powered knowledge assistant for Product Managers. It connects to Google Workspace (Drive, Docs, Calendar) to help PMs:
- **JTBD 1:** Find documents instantly using natural language search
- **JTBD 2:** Prepare for meetings with auto-generated context briefs

**Tech Stack:** Lovable (frontend) + Supabase (PostgreSQL + pgvector + Edge Functions + Google OAuth) + Claude API + OpenAI embeddings

**GitHub:** https://github.com/kirans2015/productcompass
**Supabase Project:** https://ehihqgkkualltuqwmfz.supabase.co (project ref: `ehihqgkkualltuqwmfz`)

---

## What's Been Completed

### Database (Supabase)
- `profiles` table (auto-created on signup via trigger)
- `oauth_tokens` table (stores Google access/refresh tokens)
- `document_chunks` table with pgvector (1536-dim embeddings, HNSW index)
- `meetings` table
- `match_documents()` SQL function for vector similarity search
- RLS policies on all tables (scoped to `auth.uid() = user_id`)

### API Secrets (stored in Supabase)
- `OPENAI_API_KEY` — for embeddings
- `ANTHROPIC_API_KEY` — for Claude (search synthesis + meeting briefs)
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — for token refresh

### Edge Functions (all 5 deployed)
1. `store-oauth-tokens` — Stores Google provider tokens after OAuth
2. `index-documents` — Fetches Google Drive docs, chunks text, generates OpenAI embeddings, stores in pgvector
3. `search-documents` — Generates query embedding, runs vector similarity search, synthesizes answer via Claude Haiku
4. `sync-calendar` — Fetches upcoming Google Calendar events, upserts into meetings table
5. `prepare-meeting` — Generates AI meeting brief using Claude Sonnet based on meeting details + relevant documents

### Auth Migration (just completed)
- Migrated from Lovable Cloud auth bridge to standalone Supabase OAuth
- `signInWithGoogle()` uses `supabase.auth.signInWithOAuth` with 4 Google scopes
- AuthCallback stores `provider_token` + `expires_at` via `store-oauth-tokens`
- Removed all Lovable auth dependencies and dead code
- 15 files changed, +328/-663 lines

### Pages Already Wired to Real Backend
- **Landing** — `signInWithGoogle()` ✅
- **Onboarding** — `signInWithGoogle()` ✅
- **AuthCallback** — Stores provider_token, redirects to dashboard ✅
- **Dashboard** — Real user data, real token check, real indexing, real calendar sync, real document count ✅
- **Settings** — Real user email, real document count, real token status, real signOut ✅

---

## What Needs to Be Done

### Task 1: Wire Search Page to Real Backend

**File:** `src/pages/Search.tsx`

**Current state:** Uses `mockDocumentResults` array (hardcoded fake data) and hardcoded `userName="Alex"` on the Navbar.

**What to change:**
1. Import `useAuth` from `@/contexts/AuthContext` and `supabase` from `@/integrations/supabase/client`
2. Get real user name from `useAuth()` and pass to Navbar
3. Replace `mockDocumentResults` with a real call to the `search-documents` Edge Function
4. The search query comes from URL params: `const [searchParams] = useSearchParams()` → `searchParams.get("q")`
5. Call the Edge Function on mount when query exists:
   ```typescript
   const { data, error } = await supabase.functions.invoke("search-documents", {
     body: { query }
   });
   ```
6. The Edge Function returns:
   ```json
   {
     "answer": "AI-synthesized answer string",
     "sources": [
       {
         "document_id": "...",
         "document_title": "...",
         "document_type": "...",
         "document_url": "...",
         "chunk_text": "...",
         "similarity": 0.85
       }
     ]
   }
   ```
7. Map `sources` to the existing `DocumentResult` interface. Map `similarity` to `matchScore` (multiply by 100 for percentage).
8. Display the `answer` in the AI summary section.
9. Handle loading state and error state.
10. Handle empty results state.

### Task 2: Wire MeetingPrep Page to Real Backend

**File:** `src/pages/MeetingPrep.tsx`

**Current state:** Uses `mockMeetings` and `mockMeetingPrep` objects (hardcoded fake data) and hardcoded `userName="Alex"` on the Navbar.

**What to change:**
1. Import `useAuth` from `@/contexts/AuthContext` and `supabase` from `@/integrations/supabase/client`
2. Get real user name from `useAuth()` and pass to Navbar
3. The `meetingId` comes from URL params (already extracted via `useParams()`)
4. On mount, fetch the meeting from the `meetings` table:
   ```typescript
   const { data: meeting } = await supabase
     .from("meetings")
     .select("*")
     .eq("id", meetingId)
     .single();
   ```
5. If the meeting doesn't have a `brief` yet, call `prepare-meeting`:
   ```typescript
   const { data, error } = await supabase.functions.invoke("prepare-meeting", {
     body: { meeting_id: meetingId }
   });
   ```
6. The Edge Function returns:
   ```json
   {
     "brief": "AI-generated meeting brief text",
     "relevant_documents": ["doc_id_1", "doc_id_2"]
   }
   ```
7. Display meeting details (title, time, attendees from meeting record) and the brief.
8. Handle loading, error, and "no brief yet" states.

### Task 3: Fix Hardcoded "Alex" on Navbar

**Files to check:**
- `src/pages/Search.tsx` — line 127: `<Navbar isAuthenticated userName="Alex" />`
- `src/pages/MeetingPrep.tsx` — line 93: `<Navbar isAuthenticated userName="Alex" />`

**Fix:** Both pages need to:
1. Import `useAuth` from `@/contexts/AuthContext`
2. Extract user: `const { user } = useAuth()`
3. Derive display name (same pattern used in Dashboard):
   ```typescript
   function getUserDisplayName(user: any): string {
     const fullName = user?.user_metadata?.full_name || user?.user_metadata?.name;
     if (fullName) return fullName.split(" ")[0];
     const email = user?.email;
     if (email) return email.split("@")[0];
     return "there";
   }
   ```
4. Pass to Navbar: `<Navbar isAuthenticated userName={displayName} />`

Consider extracting `getUserDisplayName` to a shared util since it's now used in 3+ pages.

---

## Architecture Reference

### Supabase Client
**File:** `src/integrations/supabase/client.ts`
- Hardcoded URL: `https://ehihqgkkualltuqwmfz.supabase.co`
- Hardcoded anon key (public, safe to commit)

### Auth Context
**File:** `src/contexts/AuthContext.tsx`
- Provides `user`, `session`, `loading`, `signOut`
- `useAuth()` hook for any component

### Google Auth
**File:** `src/lib/google-auth.ts`
- Single function: `signInWithGoogle()`
- Scopes: drive.metadata.readonly, drive.readonly, documents.readonly, calendar.readonly

### Routes
**File:** `src/App.tsx`
- `/` → Landing (PublicRoute)
- `/onboarding` → Onboarding
- `/auth/callback` → AuthCallback
- `/dashboard` → Dashboard (ProtectedRoute)
- `/search` → Search (ProtectedRoute)
- `/meeting-prep/:meetingId` → MeetingPrep (ProtectedRoute)
- `/settings` → Settings (ProtectedRoute)

### Edge Functions Location
All in `supabase/functions/[name]/index.ts` — Deno/TypeScript

---

## After These Tasks

Once Tasks 1-3 are done, commit and push. Then the remaining steps are:
1. **Deploy frontend to Vercel** (connect GitHub repo, set build command to `npm run build`, output dir `dist`)
2. **End-to-end testing** (sign in, verify token capture, index documents, search, generate meeting brief)
3. **Update Google Cloud Console** with production callback URL from Vercel
4. Add 20 beta user emails to Google Cloud Console (app is in testing mode)
