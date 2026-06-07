// Direct Postgres client (postgres.js) for the text-to-SQL pipeline.
//
// Why not supabase-js? It speaks to PostgREST, which only exposes the `public`
// schema and cannot run DDL. The materializer needs to CREATE TABLE in the
// `sheets` schema and (later) SET ROLE — both require a raw Postgres connection.
//
// Used both inside the index-documents edge function (reads SUPABASE_DB_URL from
// the environment) and from the throwaway local backfill script (passes the URL
// explicitly).
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

export type PgClient = ReturnType<typeof postgres>;

export function createPgClient(connectionString?: string): PgClient {
  const url = connectionString ?? Deno.env.get("SUPABASE_DB_URL");
  if (!url) {
    throw new Error("SUPABASE_DB_URL not set and no connection string provided");
  }
  return postgres(url, {
    ssl: "require",     // Supabase requires TLS
    max: 4,             // small pool — edge functions are short-lived
    prepare: false,     // required for pgbouncer transaction-pooler compatibility
    onnotice: () => {}, // silence NOTICE chatter
  });
}
