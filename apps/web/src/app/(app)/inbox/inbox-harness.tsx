/**
 * El andamio con el que se prueba la bandeja.
 *
 * No es una prueba: es lo que hace falta para montar la pantalla fuera del
 * navegador. Cuatro cosas que jsdom no trae completas y la bandeja sí usa —el
 * router de Next, la dirección que `useSearchParams` lee, `EventSource` y
 * `fetch`— y una conversación de mentira con la que escribir los casos.
 *
 * La regla de qué se finge: **el transporte, y nada más**. El stream de eventos,
 * la red y la dirección se fingen porque son cables; lo que decide qué se ve
 * —el filtro, la conversación abierta, el parche de la fila, el orden de la
 * lista, el scroll del hilo— es el componente de verdad, sin tocar.
 */
import { useSyncExternalStore } from "react";
import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { ConversationSnapshot, WaEvent } from "@wa/shared";
import type { ChatItem } from "./inbox-client";

/**
 * **La dirección de la pestaña**, que en el navegador la lleva la History API y
 * Next sincroniza con `useSearchParams`.
 *
 * Se finge por lo mismo que el stream y la red: es transporte. Lo que decide
 * qué se ve —qué conversación está abierta, qué filtra la lista— es el
 * componente de verdad, leyendo esta dirección igual que leería la del
 * navegador.
 */
let direccionActual = "/inbox";
let pila: string[] = ["/inbox"];
const oyentesDeLaDireccion = new Set<() => void>();

function avisarDeLaDireccion() {
  for (const fn of [...oyentesDeLaDireccion]) fn();
}

function suscribirALaDireccion(fn: () => void) {
  oyentesDeLaDireccion.add(fn);
  return () => {
    oyentesDeLaDireccion.delete(fn);
  };
}

const leerLaDireccion = () => direccionActual;

/** `useSearchParams` de Next, sobre la dirección de mentira. */
export function useSearchParamsFingido(): URLSearchParams {
  const url = useSyncExternalStore(
    suscribirALaDireccion,
    leerLaDireccion,
    leerLaDireccion,
  );
  return new URLSearchParams(url.split("?")[1] ?? "");
}

/** Aterrizar en una dirección: es lo que hace recargar, o abrir un enlace. */
export function irA(url: string) {
  direccionActual = url;
  pila = [url];
  avisarDeLaDireccion();
}

/** La dirección en la que quedó la pestaña. */
export function direccion(): string {
  return direccionActual;
}

/** El botón Atrás del navegador. */
export function atras() {
  if (pila.length < 2) return;
  pila.pop();
  direccionActual = pila[pila.length - 1]!;
  act(() => {
    avisarDeLaDireccion();
  });
}

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
 * `abiertas` es lo que hace verificable que la pestaña abra **una sola**
 * conexión: hasta PRO-12 eran dos contra el mismo stream, y la del hilo se
 * cerraba y reabría con cada cambio de conversación. `emitirWa` se lo entrega a
 * todas las abiertas, que es exactamente lo que hace el servidor.
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

/** La operación que mira la pestaña en las pruebas. */
export const OPERACION = "op-guatemala";

/**
 * La misma operación, con lo que la línea de contexto dibuja.
 *
 * Es Guatemala y no un nombre cualquiera **a propósito**: la pantalla desde la
 * que salen los mensajes es la de una operación guatemalteca, y el bug que la
 * línea de contexto viene a cerrar es que en ningún sitio lo decía.
 */
export const OP = { name: "Vorare Store Guatemala", countryCode: "GT" };

/**
 * Un `message.created` **como el que emite el worker**: con la operación y con
 * el resumen de la fila pegado.
 *
 * Que el resumen viaje es lo que le permite al panel repintar la fila en vez de
 * pedir la pantalla entera (PRO-6, en producción). Un fixture sin él describiría
 * un evento que el worker no emite.
 */
export function entrante(
  conversationId: string,
  over: Partial<ConversationSnapshot> & {
    messageId?: string;
    operationId?: string | null;
  } = {},
): WaEvent {
  const { messageId, operationId, ...instantanea } = over;
  return {
    type: "message.created",
    operationId: operationId === undefined ? OPERACION : operationId,
    conversationId,
    messageId: messageId ?? "m-nuevo",
    conversation: {
      lastMessagePreview: "un mensaje nuevo",
      unreadCount: 1,
      lastActivityAt: new Date().toISOString(),
      ...instantanea,
    },
  };
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

  // La pestaña arranca en el Inbox sin parámetros. `pushState` y `replaceState`
  // son las dos únicas puertas por las que la bandeja escribe la dirección, y
  // acá hacen lo mismo que en el navegador: mover la dirección y avisar.
  direccionActual = "/inbox";
  pila = ["/inbox"];
  window.history.pushState = ((_estado: unknown, _titulo: string, url: string) => {
    direccionActual = String(url);
    pila.push(direccionActual);
    avisarDeLaDireccion();
  }) as typeof window.history.pushState;
  window.history.replaceState = ((
    _estado: unknown,
    _titulo: string,
    url: string,
  ) => {
    direccionActual = String(url);
    pila[pila.length - 1] = direccionActual;
    avisarDeLaDireccion();
  }) as typeof window.history.replaceState;

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
