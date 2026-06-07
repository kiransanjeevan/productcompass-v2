import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runSqlPath } from "./sql-path.ts";
import type { RegistryRow } from "./registry.ts";

// Day 10: text-to-SQL routing flags. All default OFF → /search behaves exactly
// as before until deliberately enabled.
const ENABLE_SQL_ROUTER = Deno.env.get("ENABLE_SQL_ROUTER") === "true";
const ENABLE_HYBRID = Deno.env.get("ENABLE_HYBRID") === "true";
// CSV of user_ids for gradual rollout; empty = all users (when the router is on).
const SQL_USER_ALLOWLIST = (Deno.env.get("SQL_USER_ALLOWLIST") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function sqlRoutingAllowed(userId: string): boolean {
  if (!ENABLE_SQL_ROUTER) return false;
  return SQL_USER_ALLOWLIST.length === 0 || SQL_USER_ALLOWLIST.includes(userId);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Prompt Registry ─────────────────────────────────────────────────────────

interface PromptTemplate {
  system_prompt: string | null;
  user_prompt_template: string;
  model: string;
  max_tokens: number;
  temperature: number;
}

// Hardcoded fallbacks (used when DB is unavailable)
const FALLBACK_PROMPTS: Record<string, PromptTemplate> = {
  search_synthesis: {
    system_prompt: "You are a helpful document search assistant for Product Managers. Answer the user's question based ONLY on the provided document chunks. If the information is not in the chunks, say 'I couldn't find this in your documents.' Always cite which document each piece of information comes from. Be concise and direct.",
    user_prompt_template: 'Based on the following document chunks, answer this question: "{{query}}"\n\n{{chunksContext}}',
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    temperature: 0,
  },
  query_expansion: {
    system_prompt: null,
    user_prompt_template: 'Generate 2 alternative phrasings of this search query for a product management knowledge base. Return ONLY a JSON array of 2 strings. No explanation.\nQuery: "{{query}}"',
    model: "claude-haiku-4-5-20251001",
    max_tokens: 60,
    temperature: 0,
  },
};

/** Load a prompt template from the DB. Falls back to hardcoded defaults on any error. */
async function getPrompt(
  slug: string,
  serviceClient: SupabaseClient<any, any, any>,
  version?: number,
): Promise<PromptTemplate> {
  try {
    let q = serviceClient
      .from("prompt_templates")
      .select("system_prompt, user_prompt_template, model, max_tokens, temperature");

    if (version !== undefined) {
      q = q.eq("slug", slug).eq("version", version);
    } else {
      q = q.eq("slug", slug).eq("is_active", true);
    }

    const { data, error } = await q.single();
    if (error || !data) throw new Error(error?.message || "No prompt found");
    return data as PromptTemplate;
  } catch (err) {
    console.error(`Failed to load prompt ${slug}${version !== undefined ? ` v${version}` : ""}, using fallback:`, err);
    return FALLBACK_PROMPTS[slug] || FALLBACK_PROMPTS.search_synthesis;
  }
}

/** Apply template variables to a prompt string. */
function applyTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// ─── Query Expansion ─────────────────────────────────────────────────────────

/** Generate alternative phrasings of a query to improve recall on paraphrases and vague queries. */
async function expandQuery(
  query: string,
  anthropicKey: string,
  prompt: PromptTemplate,
): Promise<string[]> {
  try {
    const userContent = applyTemplate(prompt.user_prompt_template, { query });

    const messages: any[] = [{ role: "user", content: userContent }];

    const body: any = {
      model: prompt.model,
      max_tokens: prompt.max_tokens,
      temperature: prompt.temperature,
      messages,
    };
    if (prompt.system_prompt) {
      body.system = prompt.system_prompt;
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return [query];

    const data = await res.json();
    const raw = data.content?.[0]?.text || "[]";
    const text = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const variants: string[] = JSON.parse(text);
    if (!Array.isArray(variants) || variants.length === 0) return [query];

    return [query, ...variants];
  } catch {
    return [query];
  }
}

/** Embed a single query string via OpenAI. */
async function embedQuery(query: string, openaiKey: string): Promise<number[] | null> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: query, model: "text-embedding-3-small" }),
  });

  if (!res.ok) {
    console.error("OpenAI embedding error:", res.status);
    return null;
  }

  const data = await res.json();
  return data.data[0].embedding;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { query, threshold, prompt_version, qe_version } = body;
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid query" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const matchThreshold = typeof threshold === "number" ? threshold : 0.5;

    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    // Load prompt templates (from DB or fallback)
    const promptServiceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Day 10: text-to-SQL routing. Flag-gated; on any miss (vector route, no
    // tables, error) it returns null and we fall through to the vector path.
    if (sqlRoutingAllowed(user.id)) {
      const { data: registryRows } = await promptServiceClient
        .from("sheet_registry")
        .select("table_name, document_title, row_count, columns")
        .eq("user_id", user.id);

      // Hybrid reconciliation needs a vector search over account_id-tagged chunks.
      const vectorSearch = async (q: string) => {
        const emb = await embedQuery(q, openaiKey);
        if (!emb) return [];
        const { data: matches } = await promptServiceClient.rpc("match_documents", {
          query_embedding: emb,
          match_count: 20,
          match_threshold: 0.2,
          user_uuid: user.id,
          theme_filter: null,
        });
        return (matches ?? [])
          .map((m: any) => ({
            chunk_text: m.chunk_text ?? "",
            account_ids: (m.metadata?.account_ids ?? []) as string[],
          }))
          .filter((c: { account_ids: string[] }) => c.account_ids.length > 0);
      };

      const sqlResult = await runSqlPath(
        query,
        user.id,
        (registryRows ?? []) as RegistryRow[],
        anthropicKey,
        ENABLE_HYBRID,
        vectorSearch,
      );
      if (sqlResult) {
        return new Response(JSON.stringify(sqlResult), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const [synthesisPrompt, expansionPrompt] = await Promise.all([
      getPrompt("search_synthesis", promptServiceClient, prompt_version),
      getPrompt("query_expansion", promptServiceClient, qe_version),
    ]);

    // 1. Expand query into original + variants
    const queries = await expandQuery(query, anthropicKey, expansionPrompt);
    console.log("Query expansion:", queries);

    // 2. Embed all query variants in parallel
    const embeddings = await Promise.all(queries.map((q) => embedQuery(q, openaiKey)));
    const validEmbeddings = embeddings.filter((e): e is number[] => e !== null);

    if (validEmbeddings.length === 0) {
      return new Response(JSON.stringify({ error: "Failed to generate query embedding" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Run vector search for all embeddings in parallel (reuse promptServiceClient)
    const serviceClient = promptServiceClient;

    // 3a. Vector search for all embeddings in parallel
    const allMatchResults = await Promise.all(
      validEmbeddings.map((embedding) =>
        serviceClient.rpc("match_documents", {
          query_embedding: embedding,
          match_count: 10,
          match_threshold: matchThreshold,
          user_uuid: user.id,
          theme_filter: null,
        })
      )
    );

    // 4. Collect all chunks, dedup by chunk ID (same chunk from multiple query variants)
    const seenChunks = new Map();
    for (const { data: matches, error: matchError } of allMatchResults) {
      if (matchError) {
        console.error("Match error:", matchError);
        continue;
      }
      if (!matches) continue;
      for (const m of matches) {
        if (!seenChunks.has(m.id) || m.similarity > seenChunks.get(m.id).similarity) {
          seenChunks.set(m.id, m);
        }
      }
    }

    // Top chunks → sent to LLM (capped by count and total context size)
    const MAX_LLM_CHUNKS = 7;
    const MAX_CONTEXT_CHARS = 6000;
    const sortedChunks = Array.from(seenChunks.values())
      .sort((a: any, b: any) => b.similarity - a.similarity);

    // Apply character cap on selected chunks
    const allChunks: any[] = [];
    let totalChars = 0;
    for (const chunk of sortedChunks) {
      if (allChunks.length >= MAX_LLM_CHUNKS) break;
      const chunkLen = (chunk.chunk_text || "").length;
      if (totalChars + chunkLen > MAX_CONTEXT_CHARS && allChunks.length > 0) break;
      allChunks.push(chunk);
      totalChars += chunkLen;
    }

    // Top 5 unique documents → sent to frontend
    const seenDocIds = new Set();
    const uniqueMatches: any[] = [];
    for (const chunk of allChunks) {
      if (!seenDocIds.has(chunk.document_id)) {
        seenDocIds.add(chunk.document_id);
        uniqueMatches.push(chunk);
      }
      if (uniqueMatches.length >= 5) break;
    }

    if (allChunks.length === 0) {
      return new Response(JSON.stringify({
        answer: "I couldn't find any relevant documents matching your query.",
        sources: [],
        query,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Build context for Claude (all chunks, not just unique docs)
    const chunksContext = allChunks
      .map((m: any) => `[Document: ${m.document_title}]\n${m.chunk_text}`)
      .join("\n\n---\n\n");

    // 6. Call Claude for synthesis (using loaded prompt template)
    const synthesisUserContent = applyTemplate(synthesisPrompt.user_prompt_template, {
      query,
      chunksContext,
    });

    const synthesisBody: any = {
      model: synthesisPrompt.model,
      max_tokens: synthesisPrompt.max_tokens,
      temperature: synthesisPrompt.temperature,
      messages: [{ role: "user", content: synthesisUserContent }],
    };
    if (synthesisPrompt.system_prompt) {
      synthesisBody.system = synthesisPrompt.system_prompt;
    }

    const synthesisController = new AbortController();
    const synthesisTimeout = setTimeout(() => synthesisController.abort(), 25000);

    let answer = "I couldn't generate an answer at this time.";
    try {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(synthesisBody),
        signal: synthesisController.signal,
      });

      if (claudeRes.ok) {
        const claudeData = await claudeRes.json();
        answer = claudeData.content?.[0]?.text || answer;
      } else {
        console.error("Claude API error:", claudeRes.status, await claudeRes.text());
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.error("Claude synthesis timed out after 25s");
        answer = "The search took too long to process. Please try a more specific query.";
      } else {
        throw err;
      }
    } finally {
      clearTimeout(synthesisTimeout);
    }

    // 7. Build sources (all chunks per doc for evals/judge, snippet for frontend)
    const docChunksMap = new Map();
    for (const c of allChunks) {
      if (!docChunksMap.has(c.document_id)) docChunksMap.set(c.document_id, []);
      docChunksMap.get(c.document_id).push(c);
    }

    const sources = uniqueMatches.map((m: any) => {
      const chunks = (docChunksMap.get(m.document_id) || [m])
        .sort((a: any, b: any) => a.chunk_index - b.chunk_index);
      const isSheet = (m.document_type || "").toLowerCase().includes("sheet") ||
                      (m.document_type || "").toLowerCase().includes("spreadsheet");
      const contentType = m.metadata?.content_type ?? (isSheet ? "tabular" : "prose");
      const snippetLength = contentType === "tabular" ? 500 : 200;
      return {
        document_id: m.document_id,
        document_title: m.document_title,
        document_type: m.document_type,
        document_url: m.document_url,
        document_owner: m.document_owner,
        similarity: m.similarity,
        chunk_text: chunks.map((c: any) => c.chunk_text).join("\n\n"),
        snippet: m.chunk_text.slice(0, snippetLength),
        content_type: contentType,
      };
    });

    return new Response(JSON.stringify({ answer, sources, query }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
