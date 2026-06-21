// Phase 5 — Linear webhook: keep both engines fresh when issues change in Linear.
//
// Linear POSTs here on Issue create/update/remove. We verify the HMAC-SHA256
// signature, then re-run the full sync for the connected user (idempotent, and
// cheap at this data size). No Supabase JWT is present (Linear can't send one),
// so this function MUST be deployed with --no-verify-jwt; the webhook secret is
// the auth boundary instead.
//
// Secrets: LINEAR_WEBHOOK_SECRET (from the Linear webhook config), LINEAR_API_KEY,
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL, OPENAI_API_KEY.
// Optional: LINEAR_WEBHOOK_USER_ID (fallback if no Linear OAuth token row exists).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPgClient } from "../_shared/pg-client.ts";
import { syncLinearForUser } from "../_shared/linear-sync.ts";

async function verifySignature(secret: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time-ish compare (lengths are fixed hex digests).
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

async function resolveUserId(admin: any): Promise<string | null> {
  // 1) the Linear-OAuth-connected user, if any
  const { data: tok } = await admin
    .from("oauth_tokens").select("user_id").eq("provider", "linear").limit(1).maybeSingle();
  if (tok?.user_id) return tok.user_id;
  // 2) explicit override
  const envUser = Deno.env.get("LINEAR_WEBHOOK_USER_ID");
  if (envUser) return envUser;
  // 3) single-tenant fallback: the sole app user (sync runs on the personal
  //    LINEAR_API_KEY, so OAuth isn't required). For multi-tenant, map the
  //    webhook's organizationId → user instead.
  const { data: chunk } = await admin
    .from("document_chunks").select("user_id").limit(1).maybeSingle();
  return chunk?.user_id ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const rawBody = await req.text();
    const secret = Deno.env.get("LINEAR_WEBHOOK_SECRET");
    if (!secret) return json({ error: "LINEAR_WEBHOOK_SECRET not configured" }, 500);

    const sig = req.headers.get("linear-signature");
    if (!(await verifySignature(secret, rawBody, sig))) {
      return json({ error: "Invalid signature" }, 401);
    }

    const event = JSON.parse(rawBody);
    // Only Issue events touch our indexes; ack everything else fast.
    if (event.type !== "Issue") return json({ ok: true, skipped: event.type });

    const linearKey = Deno.env.get("LINEAR_API_KEY");
    if (!linearKey) return json({ error: "LINEAR_API_KEY not configured" }, 500);
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // bypasses RLS — webhook has no user JWT
    );
    const userId = await resolveUserId(admin);
    if (!userId) return json({ error: "No connected Linear user to sync" }, 200);

    const sql = createPgClient();
    try {
      const result = await syncLinearForUser({ supabase: admin, sql, userId, linearAuth: linearKey, openaiKey });
      return json({ ok: true, action: event.action, ...result });
    } finally {
      await sql.end();
    }
  } catch (err) {
    console.error("linear-webhook error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
