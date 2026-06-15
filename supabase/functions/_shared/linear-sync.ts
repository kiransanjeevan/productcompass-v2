// Shared Linear → both-engines sync (Architecture A). Pulls issues via Linear
// GraphQL and lands them in:
//   • document_chunks (document_type "linear_issue") — embedded free text for vector search
//   • sheets.u_<uid>_linear_issues — structured fields for text-to-SQL
// Called by the sync-linear edge function (user-triggered) and the linear-webhook
// edge function (Linear-triggered). Idempotent: deletes + reinserts this user's
// linear_issue chunks and re-materializes the sheet each run.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { PgClient } from "./pg-client.ts";
import { materializeCsvAsTable } from "../index-documents/materialize-sql.ts";

const LINEAR_GQL = "https://api.linear.app/graphql";
export const PRIO_LABEL: Record<number, string> = { 0: "No priority", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };

export async function linearFetchIssues(auth: string): Promise<any[]> {
  const query = `query($after:String){ issues(first:100, after:$after){
    pageInfo{ hasNextPage endCursor }
    nodes{ id identifier title description priority url createdAt updatedAt completedAt
      state{ name type } assignee{ name } project{ name } labels{ nodes{ name } }
      comments{ nodes{ body } } } } }`;
  let after: string | null = null;
  const all: any[] = [];
  while (true) {
    const res: Response = await fetch(LINEAR_GQL, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { after } }),
    });
    const j: any = await res.json();
    if (j.errors) throw new Error("Linear: " + JSON.stringify(j.errors));
    all.push(...j.data.issues.nodes);
    if (!j.data.issues.pageInfo.hasNextPage) break;
    after = j.data.issues.pageInfo.endCursor;
  }
  return all;
}

async function embed(texts: string[], key: string): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: texts, model: "text-embedding-3-small" }),
  });
  if (!res.ok) throw new Error("OpenAI embeddings " + res.status + ": " + await res.text());
  const j = await res.json();
  return j.data.map((d: { embedding: number[] }) => d.embedding);
}

const csvCell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function buildIssuesCsv(issues: any[]): string {
  const headers = ["identifier", "title", "status", "status_type", "priority", "project", "assignee", "labels", "created_at", "updated_at", "completed_at", "url"];
  const lines = [headers.join(",")];
  for (const it of issues) {
    lines.push([
      it.identifier, it.title, it.state?.name ?? "", it.state?.type ?? "",
      PRIO_LABEL[it.priority] ?? "No priority", it.project?.name ?? "", it.assignee?.name ?? "",
      (it.labels?.nodes ?? []).map((l: any) => l.name).join("; "),
      it.createdAt ?? "", it.updatedAt ?? "", it.completedAt ?? "", it.url,
    ].map(csvCell).join(","));
  }
  return lines.join("\n");
}

export interface SyncResult {
  issue_count: number;
  table?: string;
  rows?: number;
}

/**
 * Full re-sync of every Linear issue for one user into both engines.
 * `supabase` may be a user-scoped client (RLS) or a service-role client (webhook);
 * either works because every row carries an explicit user_id.
 */
export async function syncLinearForUser(opts: {
  supabase: SupabaseClient;
  sql: PgClient;
  userId: string;
  linearAuth: string;
  openaiKey: string;
}): Promise<SyncResult> {
  const { supabase, sql, userId, linearAuth, openaiKey } = opts;

  const issues = await linearFetchIssues(linearAuth);
  if (issues.length === 0) return { issue_count: 0 };

  // ── VECTOR: embed issue text into document_chunks (source "linear") ──
  const texts = issues.map((it) => {
    const comments = (it.comments?.nodes ?? []).map((c: any) => c.body).join("\n");
    return `${it.identifier}: ${it.title}\n\n${it.description ?? ""}${comments ? "\n\nComments:\n" + comments : ""}`.trim();
  });
  const embeddings = await embed(texts, openaiKey);

  await supabase.from("document_chunks").delete()
    .eq("user_id", userId).eq("document_type", "linear_issue"); // idempotent re-sync

  const chunkRows = issues.map((it, idx) => ({
    user_id: userId,
    document_id: it.id,
    document_title: `${it.identifier} ${it.title}`,
    document_type: "linear_issue",
    document_url: it.url,
    chunk_index: 0,
    chunk_text: texts[idx],
    embedding: embeddings[idx] ? JSON.stringify(embeddings[idx]) : null,
    metadata: {
      source: "linear",
      content_type: "linear_issue",
      status: it.state?.name ?? null,
      priority: PRIO_LABEL[it.priority] ?? null,
      project: it.project?.name ?? null,
    },
  }));
  for (let i = 0; i < chunkRows.length; i += 100) {
    const { error } = await supabase.from("document_chunks").insert(chunkRows.slice(i, i + 100));
    if (error) throw new Error("chunk insert: " + error.message);
  }

  // ── SQL: materialize structured fields into sheets.u_<uid>_linear_issues ──
  const csv = buildIssuesCsv(issues);
  const tableInfo = await materializeCsvAsTable(
    sql,
    userId,
    { id: "linear_issues", title: "Linear Issues" } as any,
    csv,
  );

  return { issue_count: issues.length, table: tableInfo?.tableName, rows: tableInfo?.rowCount };
}
