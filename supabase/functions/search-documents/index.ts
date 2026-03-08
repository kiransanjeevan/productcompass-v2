import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid query" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    // 1. Generate query embedding
    const embRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: query,
        model: "text-embedding-3-small",
      }),
    });

    if (!embRes.ok) {
      console.error("OpenAI embedding error:", embRes.status);
      return new Response(JSON.stringify({ error: "Failed to generate query embedding" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const embData = await embRes.json();
    const queryEmbedding = embData.data[0].embedding;

    // 2. Vector similarity search via RPC
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: matches, error: matchError } = await serviceClient.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_count: 10,
      match_threshold: 0.3,
      user_uuid: user.id,
    });

    if (matchError) {
      console.error("Match error:", matchError);
      return new Response(JSON.stringify({ error: "Search failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!matches || matches.length === 0) {
      return new Response(JSON.stringify({
        answer: "I couldn't find any relevant documents matching your query.",
        sources: [],
        query,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Deduplicate: keep highest-similarity chunk per document
    const seenDocs = new Map();
    for (const m of matches) {
      if (!seenDocs.has(m.document_id) || m.similarity > seenDocs.get(m.document_id).similarity) {
        seenDocs.set(m.document_id, m);
      }
    }
    const uniqueMatches = Array.from(seenDocs.values());

    // 4. Build context for Claude
    const chunksContext = uniqueMatches
      .map((m: any) => `[Document: ${m.document_title}]\n${m.chunk_text}`)
      .join("\n\n---\n\n");

    // 5. Call Claude for synthesis
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        temperature: 0,
        system: "You are a helpful document search assistant for Product Managers. Answer the user's question based ONLY on the provided document chunks. If the information is not in the chunks, say 'I couldn't find this in your documents.' Always cite which document each piece of information comes from. Be concise and direct.",
        messages: [
          {
            role: "user",
            content: `Based on the following document chunks, answer this question: "${query}"\n\n${chunksContext}`,
          },
        ],
      }),
    });

    let answer = "I couldn't generate an answer at this time.";
    if (claudeRes.ok) {
      const claudeData = await claudeRes.json();
      answer = claudeData.content?.[0]?.text || answer;
    } else {
      console.error("Claude API error:", claudeRes.status, await claudeRes.text());
    }

    // 6. Build sources
    const sources = uniqueMatches.map((m: any) => ({
      document_id: m.document_id,
      document_title: m.document_title,
      document_type: m.document_type,
      document_url: m.document_url,
      document_owner: m.document_owner,
      similarity: m.similarity,
      chunk_text: m.chunk_text.slice(0, 200),
    }));

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
