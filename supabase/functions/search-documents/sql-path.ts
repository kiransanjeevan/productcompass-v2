// Text-to-SQL orchestration (Day 10) — ties router → generator → executor →
// synthesis into one call for /search. Returns a full response object when it
// handled the query, or null to tell the caller "fall back to the vector path".
//
// It owns its own Postgres connection (created lazily, closed in finally) so the
// vector path pays nothing when the router picks vector.
import { createPgClient } from "../_shared/pg-client.ts";
import { type RegistryRow, buildRegistrySummary, buildSchemaPrompt } from "./registry.ts";
import { routeQuery } from "./router.ts";
import { generateSql } from "./sql-generator.ts";
import { runSql } from "./sql-executor.ts";
import { synthesizeSqlAnswer } from "./synthesis.ts";

const SONNET_CONFIDENCE_GATE = 0.7;

export interface SqlPathResult {
  answer: string;
  sources: unknown[];
  query: string;
  trace: {
    mode: string;
    router_reason: string;
    router_confidence: number;
    sql?: string;
    tables_used?: string[];
    row_count?: number;
    truncated?: boolean;
    model?: string;
    exec_ms?: number;
  };
}

export async function runSqlPath(
  query: string,
  userId: string,
  registryRows: RegistryRow[],
  anthropicKey: string,
  enableHybrid: boolean,
): Promise<SqlPathResult | null> {
  if (!registryRows.length) return null; // no tables → vector

  const summary = buildRegistrySummary(registryRows);
  const decision = await routeQuery(query, summary, anthropicKey);

  // vector, or hybrid-while-disabled, both fall back to the existing path.
  if (decision.mode === "vector") return null;
  if (decision.mode === "hybrid" && !enableHybrid) return null;

  const allowed = registryRows.map((r) => r.table_name);
  const schema = buildSchemaPrompt(registryRows);
  const useSonnet = decision.confidence < SONNET_CONFIDENCE_GATE;

  const pg = createPgClient();
  try {
    const gen = await generateSql(query, schema, anthropicKey, useSonnet);
    const exec = await runSql(pg, userId, gen.sql, allowed);

    // Executor rejected or DB errored → fall back to vector rather than show
    // the user an empty/confusing result.
    if (exec.error) {
      console.error(`SQL path error (${gen.model}): ${exec.error} | sql: ${gen.sql}`);
      return null;
    }

    const answer = await synthesizeSqlAnswer(
      query,
      exec.rows ?? [],
      exec.row_count ?? 0,
      exec.truncated ?? false,
      anthropicKey,
    );

    return {
      answer,
      sources: [],
      query,
      trace: {
        mode: decision.mode,
        router_reason: decision.reason,
        router_confidence: decision.confidence,
        sql: exec.sql_executed,
        tables_used: gen.tables_used,
        row_count: exec.row_count,
        truncated: exec.truncated,
        model: gen.model,
        exec_ms: exec.elapsed_ms,
      },
    };
  } catch (e) {
    console.error(`SQL path threw, falling back to vector: ${(e as Error).message}`);
    return null;
  } finally {
    await pg.end();
  }
}
