// Synthesis adapter (Day 9) — turns SQL result rows into a grounded natural-language
// answer. The prompt forbids inventing numbers: the model may only restate values
// present in the rows. Vector-mode synthesis stays inline in index.ts (unchanged).
import { callClaude, HAIKU } from "../_shared/anthropic.ts";

const MAX_TABLE_ROWS = 20;

const SYSTEM = `You answer a Product Manager's analytical question using ONLY the SQL result rows provided.
- State counts, sums, averages, and percentages literally from the data. Never invent or estimate a number not present in the rows.
- If there are 0 rows, say plainly that no matching data was found.
- Be concise: 2-4 sentences. Lead with the answer.`;

/** Render result rows as a compact markdown table (capped) for the prompt. */
function toMarkdownTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(no rows)";
  const cols = Object.keys(rows[0]);
  const head = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows
    .slice(0, MAX_TABLE_ROWS)
    .map((r) => `| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`)
    .join("\n");
  return [head, sep, body].join("\n");
}

export async function synthesizeSqlAnswer(
  query: string,
  rows: Record<string, unknown>[],
  rowCount: number,
  truncated: boolean,
  apiKey: string,
): Promise<string> {
  const tag = `${rowCount} row${rowCount === 1 ? "" : "s"}${truncated ? ", truncated at 1000" : ""}`;
  const user = `QUESTION: ${query}\n\nSQL RESULT (${tag}):\n${toMarkdownTable(rows)}`;
  return await callClaude({
    apiKey,
    model: HAIKU,
    system: SYSTEM,
    user,
    maxTokens: 400,
    temperature: 0,
    timeoutMs: 20000,
  });
}
