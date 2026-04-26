import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { events as bus } from "../lib/events";
import { getStatus } from "../baileys/session";

export const events = new Hono();

events.get("/", (c) =>
  streamSSE(c, async (stream) => {
    let id = 0;
    const send = async (data: unknown) => {
      await stream.writeSSE({
        id: String(id++),
        event: "wa",
        data: JSON.stringify(data),
      });
    };

    // initial snapshot
    const snap = getStatus();
    await send({ type: "status", status: snap.status });
    if (snap.qr) await send({ type: "qr", qr: snap.qr });

    const off = bus.onEvent((ev) => {
      void send(ev);
    });

    const heartbeat = setInterval(() => {
      stream.writeSSE({
        id: String(id++),
        event: "ping",
        data: String(Date.now()),
      });
    }, 25_000);

    stream.onAbort(() => {
      off();
      clearInterval(heartbeat);
    });

    // keep open until client disconnects
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
  }),
);
