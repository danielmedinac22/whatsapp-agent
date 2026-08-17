import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { WaEvent } from "@wa/shared";
import { panelOperation } from "@wa/db";
import { events as bus } from "../lib/events";
import { getKapsoConnection } from "../kapso/connection";

export const events = new Hono();

events.post("/notify", async (c) => {
  const ev = (await c.req.json().catch(() => null)) as WaEvent | null;
  if (!ev || typeof ev !== "object" || !("type" in ev)) {
    return c.json({ error: "invalid event" }, 400);
  }
  bus.emitEvent(ev);
  return c.json({ ok: true });
});

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

    // initial snapshot — connection state now lives in kapso_connection.
    // El panel todavía muestra una sola conexión: `panelOperation()` resuelve la
    // única activa y falla con dos, en vez de mostrar siempre la de Guatemala.
    // Aquí el fallo se traga a propósito: un SSE de estado que no puede resolver
    // la operación reporta "disconnected", no rompe la pantalla entera.
    const conn = await panelOperation()
      .then((op) => getKapsoConnection(op))
      .catch(() => null);
    await send({
      type: "status",
      status: conn?.phoneNumberId ? "connected" : "disconnected",
      phone: conn?.displayPhoneNumber ?? undefined,
    });

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
