// Thin wrapper over the Anthropic Messages API (raw fetch — matches the existing
// edge-function style; no SDK in this Deno project). Used by the text-to-SQL
// router, generator, and synthesis steps.
export const HAIKU = "claude-haiku-4-5-20251001";
export const SONNET = "claude-sonnet-4-6";

export interface ClaudeOpts {
  apiKey: string;
  model: string;
  user: string;
  system?: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
}

/** Single-turn Messages API call. Returns the assistant text. Throws on non-2xx or timeout. */
export async function callClaude(opts: ClaudeOpts): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature ?? 0,
    messages: [{ role: "user", content: opts.user }],
  };
  if (opts.system) body.system = opts.system;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Streaming variant of callClaude. Calls `onDelta` with each text chunk as it
 * arrives and resolves with the full concatenated text. Used for answer-token
 * streaming in the SSE search path.
 */
export async function callClaudeStream(
  opts: ClaudeOpts,
  onDelta: (text: string) => void,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature ?? 0,
    stream: true,
    messages: [{ role: "user", content: opts.user }],
  };
  if (opts.system) body.system = opts.system;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep the trailing partial line
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            full += ev.delta.text;
            onDelta(ev.delta.text);
          }
        } catch { /* ignore partial/non-JSON lines */ }
      }
    }
    return full;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse JSON from an LLM response, tolerating ```json fences AND trailing prose
 * after the object (small models sometimes append an explanation). Falls back to
 * extracting the first `{ … }` span. Throws if still unparseable.
 */
export function parseJsonLoose<T>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/); // first '{' to last '}'
    if (!match) throw new Error("no JSON object found in response");
    return JSON.parse(match[0]) as T;
  }
}
