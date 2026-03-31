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

    const { meeting_id } = await req.json();
    if (!meeting_id) {
      return new Response(JSON.stringify({ error: "Missing meeting_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch meeting (verify ownership)
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select("*")
      .eq("id", meeting_id)
      .single();

    if (meetingError || !meeting) {
      return new Response(JSON.stringify({ error: "Meeting not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    // Build search query from meeting title + attendee names
    const attendeeNames = (meeting.attendees as any[] || [])
      .map((a: any) => a.name || a.email || "")
      .filter(Boolean)
      .join(", ");
    const searchQuery = `${meeting.title} ${attendeeNames}`.trim();

    // Generate embedding for search query
    const embRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: searchQuery,
        model: "text-embedding-3-small",
      }),
    });

    let matches: any[] = [];
    if (embRes.ok) {
      const embData = await embRes.json();
      const queryEmbedding = embData.data[0].embedding;

      const { data: matchData } = await serviceClient.rpc("match_documents", {
        query_embedding: queryEmbedding,
        match_count: 10,
        match_threshold: 0.2,
        user_uuid: user.id,
        theme_filter: null,
      });

      matches = matchData || [];
    } else {
      const embErrText = await embRes.text();
      console.error("OpenAI embedding error:", embRes.status, embErrText);
    }

    // Build context for Claude
    const meetingContext = `Meeting: ${meeting.title}
Time: ${meeting.start_time} to ${meeting.end_time}
Attendees: ${(meeting.attendees as any[] || []).map((a: any) => `${a.name || a.email} (${a.role})`).join(", ")}
Description: ${meeting.description || "No description"}`;

    const docsContext = matches.length > 0
      ? matches.map((m: any) => `[Document: ${m.document_title}]\n${m.chunk_text}`).join("\n\n---\n\n")
      : "No relevant documents found.";

    // Call Claude for brief generation
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1000,
        temperature: 0,
        system: "You are a meeting preparation assistant for Product Managers. Generate a concise meeting brief based on the meeting details and relevant documents provided. Include: 1) Meeting overview (title, time, attendees), 2) Likely discussion topics based on the meeting title and recent documents, 3) Key context from relevant documents that the PM should review before the meeting. If no relevant documents are found, suggest what topics might come up based on the meeting title and attendees. Be concise and actionable.",
        messages: [
          {
            role: "user",
            content: `Generate a meeting brief for the following meeting:\n\n${meetingContext}\n\nRelevant documents:\n\n${docsContext}`,
          },
        ],
      }),
    });

    let brief = "Unable to generate brief at this time.";
    if (claudeRes.ok) {
      const claudeData = await claudeRes.json();
      brief = claudeData.content?.[0]?.text || brief;
    } else {
      console.error("Claude API error:", claudeRes.status, await claudeRes.text());
    }

    // Update meeting with brief
    const relevantDocIds = [...new Set(matches.map((m: any) => m.document_id))];

    await serviceClient
      .from("meetings")
      .update({
        brief,
        brief_generated_at: new Date().toISOString(),
        relevant_document_ids: relevantDocIds,
      })
      .eq("id", meeting_id);

    const relevantDocuments = matches
      .filter((m: any, i: number, arr: any[]) =>
        arr.findIndex((x: any) => x.document_id === m.document_id) === i
      )
      .map((m: any) => ({
        document_id: m.document_id,
        document_title: m.document_title,
        document_url: m.document_url,
        similarity: m.similarity,
      }));

    return new Response(
      JSON.stringify({
        meeting_id,
        title: meeting.title,
        start_time: meeting.start_time,
        attendees: meeting.attendees,
        brief,
        relevant_documents: relevantDocuments,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
