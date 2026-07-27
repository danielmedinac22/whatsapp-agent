import { eq } from "@wa/db";
import { conversations } from "@wa/db";
import { db } from "../db";

/**
 * Meta's customer-service window: free-text messages are only accepted for 24h
 * after the CUSTOMER's last message. Outside it, only approved templates.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Three states, not two. `open`/`closed` come from the customer's last inbound.
 * `unknown` means we have no inbound recorded at all — we only block sends on
 * evidence, so `unknown` lets the send through and the 422 (if it comes) is
 * handled as a closed-window rejection.
 */
export type ServiceWindowState = "open" | "closed" | "unknown";

/** Pure so the boundary is testable; `now` is injected for the same reason. */
export function serviceWindowFrom(
  lastInboundAt: Date | null,
  now: Date,
): ServiceWindowState {
  if (!lastInboundAt) return "unknown";
  return now.getTime() - lastInboundAt.getTime() <= SERVICE_WINDOW_MS
    ? "open"
    : "closed";
}

/** Window state for a conversation, from `conversations.last_inbound_at`. */
export async function getServiceWindow(
  conversationId: string,
  now: Date = new Date(),
): Promise<ServiceWindowState> {
  const [row] = await db
    .select({ lastInboundAt: conversations.lastInboundAt })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return serviceWindowFrom(row?.lastInboundAt ?? null, now);
}
