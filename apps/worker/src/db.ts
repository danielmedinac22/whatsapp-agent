import { getDb, type Database } from "@wa/db";

let _db: Database | null = null;

export const db = new Proxy({} as Database, {
  get(_t, prop) {
    if (!_db) _db = getDb();
    return Reflect.get(_db as unknown as object, prop);
  },
}) as Database;

export * from "@wa/db";
