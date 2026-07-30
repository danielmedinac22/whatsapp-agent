export type WaConnectionStatus =
  | "disconnected"
  | "connecting"
  | "qr"
  | "connected";

export type MessageDirection = "in" | "out";

export type MessageStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type WaEvent =
  | { type: "qr"; qr: string }
  | { type: "status"; status: WaConnectionStatus; phone?: string }
  | { type: "message.created"; conversationId: string; messageId: string }
  | {
      type: "message.status";
      conversationId: string;
      messageId: string;
      status: MessageStatus;
    }
  | { type: "conversation.updated"; conversationId: string };
