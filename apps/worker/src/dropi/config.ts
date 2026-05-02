import { eq } from "@wa/db";
import { dropiConnection, type DropiConnection } from "@wa/db";
import { db } from "../db";

let connectionCache: { value: DropiConnection | null; expires: number } | null =
  null;
const CONNECTION_TTL_MS = 30 * 1000;

export async function getDropiConnection(): Promise<DropiConnection | null> {
  const now = Date.now();
  if (connectionCache && connectionCache.expires > now) {
    return connectionCache.value;
  }
  const [row] = await db
    .select()
    .from(dropiConnection)
    .where(eq(dropiConnection.id, 1))
    .limit(1);
  const value = row ?? null;
  connectionCache = { value, expires: now + CONNECTION_TTL_MS };
  return value;
}

export function invalidateDropiConnectionCache(): void {
  connectionCache = null;
}

export async function upsertDropiConnection(
  patch: Partial<DropiConnection>,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(dropiConnection)
    .where(eq(dropiConnection.id, 1))
    .limit(1);
  if (existing) {
    await db
      .update(dropiConnection)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(dropiConnection.id, 1));
  } else {
    await db.insert(dropiConnection).values({ id: 1, ...patch });
  }
  invalidateDropiConnectionCache();
}
