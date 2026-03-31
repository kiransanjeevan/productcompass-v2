import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  serviceClient: ReturnType<typeof createClient>,
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

    // 4. Dedup by document_id (keep highest similarity)
    const seenDocs = new Map();
    for (const { data: matches, error: matchError } of allMatchResults) {
      if (matchError) {
        console.error("Match error:", matchError);
        continue;
      }
      if (!matches) continue;
      for (const m of matches) {
        if (!seenDocs.has(m.document_id) || m.similarity > seenDocs.get(m.document_id).similarity) {
          seenDocs.set(m.document_id, m);
        }
      }
    }
    const uniqueMatches = Array.from(seenDocs.values())
      .sort((a: any, b: any) => b.similarity - a.similarity)
      .slice(0, 5);

    if (uniqueMatches.length === 0) {
      return new Response(JSON.stringify({
        answer: "I couldn't find any relevant documents matching your query.",
        sources: [],
        query,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Build context for Claude
    const chunksContext = uniqueMatches
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

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(synthesisBody),
    });

    let answer = "I couldn't generate an answer at this time.";
    if (claudeRes.ok) {
      const claudeData = await claudeRes.json();
      answer = claudeData.content?.[0]?.text || answer;
    } else {
      console.error("Claude API error:", claudeRes.status, await claudeRes.text());
    }

    // 7. Build sources
    const sources = uniqueMatches.map((m: any) => {
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
        chunk_text: m.chunk_text.slice(0, snippetLength),
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
