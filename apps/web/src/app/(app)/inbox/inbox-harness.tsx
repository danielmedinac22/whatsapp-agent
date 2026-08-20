/**
 * El andamio con el que se prueba la bandeja.
 *
 * No es una prueba: es lo que hace falta para montar la pantalla fuera del
 * navegador. Tres cosas que jsdom no trae y la bandeja sí usa —el router de
 * Next, `EventSource` y `fetch`— y una conversación de mentira con la que
 * escribir los casos.
 *
 * La regla de qué se finge: **el transporte, y nada más**. El stream de eventos
 * y la red se fingen porque son cables; lo que decide qué se ve —el filtro, la
 * selección, el parche de la fila, el scroll del hilo— es el componente de
 * verdad, sin tocar.
 */
import { vi } from "vitest";
import type { ChatItem } from "./inbox-client";

/** Lo que el hilo le pide al navegador para bajar la vista. */
export const scrollTo = vi.fn();

/** El router de Next, con los métodos que la bandeja llama. */
export const router = {
  refresh: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

/**
 * `EventSource` de mentira, con la manija para soltarle un evento a mano.
 *
 * La bandeja abre dos —una la lista y otra el hilo— y las dos escuchan el mismo
 * `wa`. `emitirWa` se lo entrega a todas las abiertas, que es exactamente lo
 * que hace el servidor.
 */
export class FakeEventSource {
  static abiertas: FakeEventSource[] = [];
  private oyentes: Array<(e: MessageEvent) => void> = [];
  cerrada = false;

  constructor(public url: string) {
    FakeEventSource.abiertas.push(this);
  }

  addEventListener(tipo: string, fn: (e: MessageEvent) => void) {
    if (tipo === "wa") this.oyentes.push(fn);
  }

  close() {
    this.cerrada = true;
    FakeEventSource.abiertas = FakeEventSource.abiertas.filter((s) => s !== this);
  }

  recibir(dato: unknown) {
    const e = { data: JSON.stringify(dato) } as MessageEvent;
    for (const fn of this.oyentes) fn(e);
  }
}

/** Suelta un evento `wa` por el stream, como lo haría el worker. */
export function emitirWa(dato: unknown) {
  for (const s of [...FakeEventSource.abiertas]) s.recibir(dato);
}

/** Lo que el hilo va a encontrar cuando pida los mensajes de la conversación. */
export type HiloServido = {
  messages: Array<Record<string, unknown>>;
  events?: unknown[];
  sellerName?: string;
};

export type RedFingida = {
  /** Lo que el hilo devuelve, por id de conversación. Se puede cambiar en vivo. */
  hilos: Record<string, HiloServido>;
  /** Lo que contesta cada POST, por trozo de URL. */
  respuestas: Array<{ url: string; body: unknown; ok?: boolean }>;
  /** Todo lo que se pidió, en orden. */
  llamadas: Array<{ url: string; method: string; body: unknown }>;
};

/**
 * Instala `fetch`, `EventSource` y `alert`. Devuelve la red para inspeccionarla
 * y para cambiar lo que contesta a mitad de una prueba.
 */
export function montarRed(): RedFingida {
  const red: RedFingida = { hilos: {}, respuestas: [], llamadas: [] };

  FakeEventSource.abiertas = [];
  router.refresh.mockClear();
  router.replace.mockClear();

  // jsdom no implementa scroll de ningún tipo. Sin esto no hay dónde poner el
  // espía, y sin el espía «la vista no se movió» no se puede afirmar.
  scrollTo.mockClear();
  Object.defineProperty(Element.prototype, "scrollTo", {
    value: scrollTo,
    writable: true,
    configurable: true,
  });

  vi.stubGlobal("EventSource", FakeEventSource);
  // jsdom no implementa `alert` y lo que hace es escupir un error por consola.
  // Acá estorba: los casos que fallan a propósito ya se afirman por lo que se ve.
  vi.stubGlobal("alert", vi.fn());

  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      red.llamadas.push({ url, method, body });

      const hilo = url.match(/\/api\/conversations\/([^/]+)\/messages/);
      if (hilo) {
        return respuesta(red.hilos[hilo[1]!] ?? { messages: [], events: [] });
      }

      const guionada = red.respuestas.find((r) => url.includes(r.url));
      if (guionada) return respuesta(guionada.body, guionada.ok ?? true);

      return respuesta({ ok: true });
    }),
  );

  return red;
}

function respuesta(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

/**
 * Una conversación de la lista, con lo mínimo puesto y el resto en su valor
 * limpio.
 *
 * El teléfono y el nombre salen del id y no de un contador: una prueba que
 * afirma «sigue abierto el chat de +50255500c-dos» tiene que decir lo mismo
 * corriendo sola que corriendo la quinta.
 */
export function chat(over: Partial<ChatItem> = {}): ChatItem {
  const id = over.id ?? "c-una";
  return {
    id,
    contactId: over.contactId ?? `k-${id}`,
    to: `502555${id}`,
    name: `Cliente ${id}`,
    lastInboundAt: new Date().toISOString(),
    novedadReason: null,
    orderNumber: null,
    producto: null,
    agentMode: false,
    deliveryFailed: false,
    preview: "hola",
    unread: 0,
    confirmationStatus: "unknown",
    confirmationSource: null,
    lastAt: new Date().toISOString(),
    dropiStatus: null,
    dropiHasNovedad: false,
    dropiGuide: null,
    dropiCarrier: null,
    dropiPdfUrl: null,
    assignedTo: null,
    sinResponder: false,
    mark: null,
    ...over,
  };
}

/** Un mensaje del hilo, como lo sirve `/api/conversations/:id/messages`. */
export function mensaje(over: Record<string, unknown> = {}) {
  return {
    id: `m${Math.random().toString(36).slice(2, 8)}`,
    direction: "out",
    body: "texto",
    fromAgent: false,
    status: "sent",
    deliveryError: null,
    mediaUrl: null,
    mediaMime: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}
