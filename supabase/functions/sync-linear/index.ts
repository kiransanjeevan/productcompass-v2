// Phase 3 — user-triggered sync of Linear issues into BOTH engines (Architecture A).
// Thin wrapper over _shared/linear-sync.ts (shared with the linear-webhook fn).
// Uses the LINEAR_API_KEY secret (personal key) for Linear; user auth for user_id + RLS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPgClient } from "../_shared/pg-client.ts";
import { syncLinearForUser } from "../_shared/linear-sync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const linearKey = Deno.env.get("LINEAR_API_KEY");
    if (!linearKey) return json({ error: "LINEAR_API_KEY not configured" }, 500);
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;

    const sql = createPgClient();
    let result;
    try {
      result = await syncLinearForUser({ supabase, sql, userId: user.id, linearAuth: linearKey, openaiKey });
    } finally {
      await sql.end();
    }

    return json({ success: true, ...result });
  } catch (err) {
    console.error("sync-linear error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
