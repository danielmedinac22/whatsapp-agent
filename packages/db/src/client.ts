import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { ensureWorkspaceEnv } from "./env";
import { instrumentarTrazaSql, sqlTraceOptions } from "./sql-trace";

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;
  ensureWorkspaceEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  // Las dos líneas de la traza de consultas, y las dos son nada con
  // `WA_SQL_TRACE` apagado: `sqlTraceOptions()` devuelve `{}` e
  // `instrumentarTrazaSql` devuelve el cliente sin tocar. Ver `./sql-trace`.
  _client = instrumentarTrazaSql(
    postgres(url, { max: 10, prepare: false, ...sqlTraceOptions() }),
  );
  _db = drizzle(_client, { schema });
  return _db;
}

export function getRawClient() {
  if (!_client) getDb();
  return _client!;
}

export type Database = ReturnType<typeof getDb>;
