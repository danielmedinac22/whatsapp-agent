import {
  BufferJSON,
  initAuthCreds,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "baileys";
import { eq } from "@wa/db";
import { waSession } from "@wa/db";
import { db } from "../db";
import { decrypt, encrypt } from "../lib/crypto";
import { logger } from "../lib/logger";

type KeysObject = Record<string, Record<string, unknown>>;

interface StoredAuth {
  creds: AuthenticationCreds;
  keys: KeysObject;
}

function emptyAuth(): StoredAuth {
  return { creds: initAuthCreds(), keys: {} };
}

async function readAuth(): Promise<StoredAuth> {
  const [row] = await db
    .select()
    .from(waSession)
    .where(eq(waSession.id, 1))
    .limit(1);
  if (!row?.authState) return emptyAuth();
  try {
    const json = decrypt(row.authState);
    const parsed = JSON.parse(json, BufferJSON.reviver) as StoredAuth;
    if (!parsed.creds) return emptyAuth();
    parsed.keys = parsed.keys ?? {};
    return parsed;
  } catch (err) {
    logger.error({ err }, "failed to decrypt wa auth state — resetting");
    return emptyAuth();
  }
}

async function writeAuth(state: StoredAuth) {
  const json = JSON.stringify(state, BufferJSON.replacer);
  const enc = encrypt(json);
  await db
    .insert(waSession)
    .values({ id: 1, authState: enc, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: waSession.id,
      set: { authState: enc, updatedAt: new Date() },
    });
}

export interface DbAuthHandle {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clear: () => Promise<void>;
}

export async function useDbAuthState(): Promise<DbAuthHandle> {
  const stored = await readAuth();

  let writeQueue: Promise<void> = Promise.resolve();
  const flush = () => {
    writeQueue = writeQueue.then(() => writeAuth(stored)).catch((err) => {
      logger.error({ err }, "failed to persist wa auth state");
    });
    return writeQueue;
  };

  const state: AuthenticationState = {
    creds: stored.creds,
    keys: {
      get: async (type, ids) => {
        const out: Record<string, SignalDataTypeMap[typeof type]> = {};
        const bucket = stored.keys[type] ?? {};
        for (const id of ids) {
          if (id in bucket) {
            out[id] = bucket[id] as SignalDataTypeMap[typeof type];
          }
        }
        return out;
      },
      set: async (data) => {
        for (const _type of Object.keys(data) as (keyof typeof data)[]) {
          const type = _type as string;
          const bucket = (stored.keys[type] ??= {});
          const entries = data[_type] as Record<string, unknown> | undefined;
          if (!entries) continue;
          for (const id of Object.keys(entries)) {
            const value = entries[id];
            if (value === null || value === undefined) {
              delete bucket[id];
            } else {
              bucket[id] = value;
            }
          }
        }
        flush();
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      await flush();
    },
    clear: async () => {
      stored.creds = initAuthCreds();
      stored.keys = {};
      await flush();
    },
  };
}
