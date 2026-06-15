// Phase 4 — create a Linear issue grounded in the indexed docs.
//
// Two actions (gated preview/confirm — the model never writes without a human OK):
//   • "draft":  instruction → embed → match_documents (RAG) → callClaude drafts a
//               structured issue {title, description, priority, project}. Returns the
//               draft + the real project list + the docs it was grounded in. NO write.
//   • "create": the (user-reviewed/edited) fields → Linear issueCreate mutation. Writes.
//
// Write credential: prefer the user's stored Linear OAuth token (issue attributed to
// them), else fall back to the LINEAR_API_KEY secret. Drafting uses callClaude, so it
// honors the LLM_PROVIDER/LLM_MODEL swap (NOT MCP, which would be Anthropic-only).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude, parseJsonLoose, HAIKU } from "../_shared/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LINEAR_GQL = "https://api.linear.app/graphql";
const PRIORITIES = [
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
  { value: 0, label: "No priority" },
];

// Linear personal keys go in `Authorization: lin_api_…`; OAuth tokens use `Bearer …`.
async function getLinearAuth(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase
    .from("oauth_tokens")
    .select("access_token")
    .eq("user_id", userId)
    .eq("provider", "linear")
    .maybeSingle();
  if (data?.access_token) return `Bearer ${data.access_token}`;
  const key = Deno.env.get("LINEAR_API_KEY");
  if (!key) throw new Error("No Linear credential (connect Linear or set LINEAR_API_KEY)");
  return key;
}

async function linearGql(auth: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(LINEAR_GQL, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error("Linear: " + JSON.stringify(j.errors));
  return j.data;
}

async function fetchTeamContext(auth: string): Promise<{ teamId: string; projects: { id: string; name: string }[] }> {
  const d = await linearGql(auth, `query{ teams(first:1){ nodes{ id projects(first:50){ nodes{ id name } } } } }`);
  const team = d.teams.nodes[0];
  if (!team) throw new Error("No Linear team found for this account");
  return { teamId: team.id, projects: team.projects.nodes };
}

async function embedQuery(text: string, key: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: text, model: "text-embedding-3-small" }),
  });
  if (!res.ok) throw new Error("OpenAI embeddings " + res.status);
  return (await res.json()).data[0].embedding;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No auth header" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const action = body.action;
    const linearAuth = await getLinearAuth(supabase, user.id);

    // ───────────────────────── DRAFT (no write) ─────────────────────────
    if (action === "draft") {
      const instruction: string = (body.instruction ?? "").trim();
      if (!instruction) return json({ error: "Missing instruction" }, 400);

      const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
      const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

      // RAG grounding: pull the most relevant indexed chunks (docs + existing issues).
      const emb = await embedQuery(instruction, openaiKey);
      const { data: matches } = await supabase.rpc("match_documents", {
        query_embedding: emb, match_count: 6, match_threshold: 0.2, user_uuid: user.id, theme_filter: null,
      });
      const ctx = (matches ?? []) as any[];
      const grounding = dedupeByDoc(ctx).map((m) => ({ title: m.document_title, url: m.document_url ?? null }));
      const contextBlock = ctx.map((m) => `### ${m.document_title}\n${m.chunk_text}`).join("\n\n").slice(0, 8000);

      const { teamId, projects } = await fetchTeamContext(linearAuth);
      const projectNames = projects.map((p) => p.name);

      const system =
        "You are a product operations assistant that drafts well-formed Linear issues from a PM's request, grounded in their indexed documents. " +
        "Write a concise, action-oriented title (no trailing period) and a description in markdown that cites concrete facts/metrics from the context when relevant. " +
        "Pick the single best-fit project from the provided list, or null if none fits. Choose a priority. " +
        'Respond with ONLY a JSON object: {"title": string, "description": string, "priority": 0|1|2|3|4, "project": string|null}. ' +
        "Priority: 1=Urgent, 2=High, 3=Medium, 4=Low, 0=No priority.";
      const userPrompt =
        `Request: ${instruction}\n\n` +
        `Available projects: ${projectNames.length ? projectNames.join(", ") : "(none)"}\n\n` +
        `Context from indexed documents:\n${contextBlock || "(no relevant documents found)"}`;

      const raw = await callClaude({
        apiKey: anthropicKey, model: HAIKU, user: userPrompt, system,
        maxTokens: 700, temperature: 0, timeoutMs: 20000,
      });
      const parsed = parseJsonLoose<{ title: string; description: string; priority: number; project: string | null }>(raw);

      const matchedProject = parsed.project
        ? projects.find((p) => p.name.toLowerCase() === parsed.project!.toLowerCase()) ?? null
        : null;

      return json({
        draft: {
          title: parsed.title,
          description: parsed.description,
          priority: [0, 1, 2, 3, 4].includes(parsed.priority) ? parsed.priority : 0,
          projectId: matchedProject?.id ?? null,
        },
        teamId,
        projects,
        priorities: PRIORITIES,
        grounding,
      });
    }

    // ───────────────────────── CREATE (write) ─────────────────────────
    if (action === "create") {
      const { title, description, priority, projectId, teamId } = body;
      if (!title || !teamId) return json({ error: "Missing title or teamId" }, 400);

      const input: Record<string, unknown> = { teamId, title, description: description ?? "" };
      if (typeof priority === "number") input.priority = priority;
      if (projectId) input.projectId = projectId;

      const d = await linearGql(
        linearAuth,
        `mutation($in:IssueCreateInput!){ issueCreate(input:$in){ success issue{ identifier title url } } }`,
        { in: input },
      );
      if (!d.issueCreate?.success) return json({ error: "Linear rejected the issue" }, 502);
      return json({ success: true, issue: d.issueCreate.issue });
    }

    return json({ error: "Unknown action (expected 'draft' or 'create')" }, 400);
  } catch (err) {
    console.error("create-linear-issue error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function dedupeByDoc(rows: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of rows) {
    if (seen.has(r.document_id)) continue;
    seen.add(r.document_id);
    out.push(r);
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
