/**
 * El hilo abre en los últimos 50 y carga los anteriores al subir.
 *
 * El reporte: en chats largos los mensajes **más nuevos** no se veían — el hilo
 * traía los 200 primeros. Ahora abre en el final y sube por páginas, y lo que
 * se afirma acá es lo que el asesor percibe: qué se ve, qué se pide y que la
 * vista no salte al anteponer.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => useSearchParamsFingido(),
}));

import { InboxClient } from "./inbox-client";
import {
  chat,
  emitirWa,
  entrante,
  irA,
  mensaje,
  montarRed,
  OP,
  OPERACION,
  router,
  scrollTo,
  useSearchParamsFingido,
  type RedFingida,
} from "./inbox-harness";

let red: RedFingida;
const CHAT = "c-larga";

/** El mensaje n del hilo, un segundo después del anterior. */
const m = (n: number) =>
  mensaje({
    id: `m-${n}`,
    direction: n % 2 ? "in" : "out",
    body: `mensaje ${n}`,
    createdAt: new Date(Date.UTC(2026, 9, 28, 10, 0, 0) + n * 1000).toISOString(),
  });
const rango = (desde: number, hasta: number) =>
  Array.from({ length: hasta - desde }, (_, i) => m(desde + i));

/**
 * La geometría del hilo, que jsdom no tiene: cada hijo mide 20 px y se ven
 * 400. Con eso anteponer cambia el alto de verdad y el ancla se puede medir.
 */
const ALTO_FILA = 20;
const posiciones = new WeakMap<Element, number>();
function instalarGeometria() {
  const esHilo = (el: Element) => el.getAttribute("role") === "log";
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return esHilo(this) ? this.children.length * ALTO_FILA : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return esHilo(this) ? 400 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return posiciones.get(this) ?? 0;
    },
    set(this: HTMLElement, v: number) {
      posiciones.set(this, v);
    },
  });
}
function quitarGeometria() {
  for (const p of ["scrollHeight", "clientHeight", "scrollTop"]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[p];
  }
}

/** Retiene las respuestas de `?before=` hasta que la prueba las suelte. */
function retenerAnteriores() {
  const original = globalThis.fetch;
  let soltar = () => {};
  const retenida = new Promise<void>((r) => (soltar = r));
  vi.stubGlobal("fetch", async (u: RequestInfo | URL, i?: RequestInit) => {
    if (String(u).includes("before=")) await retenida;
    return original(u, i);
  });
  return () => act(async () => soltar());
}

beforeEach(() => {
  red = montarRed();
  instalarGeometria();
});

afterEach(() => {
  quitarGeometria();
  vi.unstubAllGlobals();
});

async function abrir() {
  irA(`/inbox?c=${CHAT}`);
  render(
    <InboxClient
      initial={[chat({ id: CHAT })]}
      approvedTemplates={[]}
      query=""
      op={OP}
      operationId={OPERACION}
      bandeja={null}
      sellerName={null}
      currentUserId="u-katherine"
    />,
  );
  const ultimo = red.hilos[CHAT]!.messages.at(-1)!.body as string;
  await screen.findByText(ultimo);
  return screen.getByRole("log", { name: "Mensajes de la conversación" });
}

const pedidosAnteriores = () =>
  red.llamadas.filter((c) => c.url.includes("before="));

function subirHasta(hilo: HTMLElement, top: number) {
  hilo.scrollTop = top;
  fireEvent.scroll(hilo);
}

/** 120 mensajes: abre en el 70..119, y arriba hay dos páginas más. */
function hiloDe120() {
  red.hilos[CHAT] = {
    messages: rango(70, 120),
    hasMore: true,
    anteriores: {
      "m-70": { messages: rango(20, 70), hasMore: true },
      "m-20": { messages: rango(0, 20), hasMore: false },
    },
  };
}

describe("al abrir", () => {
  it("se ven los últimos 50 y la vista arranca al pie", async () => {
    hiloDe120();
    const hilo = await abrir();
    expect(screen.getByText("mensaje 70")).toBeInTheDocument();
    expect(screen.queryByText("mensaje 69")).not.toBeInTheDocument();
    expect(hilo.scrollTop).toBe(hilo.scrollHeight);
    expect(pedidosAnteriores()).toHaveLength(0);
  });

  it("un hilo corto que no llena la pantalla pide lo anterior solo", async () => {
    red.hilos[CHAT] = {
      messages: rango(115, 120),
      hasMore: true,
      anteriores: { "m-115": { messages: rango(100, 115), hasMore: false } },
    };
    await abrir();
    expect(await screen.findByText("mensaje 100")).toBeInTheDocument();
    expect(pedidosAnteriores()).toHaveLength(1);
  });
});

describe("al subir", () => {
  it("cerca del tope pide los 50 anteriores, avisa mientras cargan y no mueve lo que se lee", async () => {
    hiloDe120();
    const hilo = await abrir();
    const soltar = retenerAnteriores();
    scrollTo.mockClear();

    subirHasta(hilo, 40);
    expect(
      await screen.findByText("Cargando mensajes anteriores…"),
    ).toBeInTheDocument();
    const alto = hilo.scrollHeight;

    // El arnés anota la llamada cuando la respuesta sale, no cuando se retiene.
    await soltar();
    expect(pedidosAnteriores().map((c) => c.url)).toEqual([
      `/api/conversations/${CHAT}/messages?before=m-70`,
    ]);
    expect(await screen.findByText("mensaje 20")).toBeInTheDocument();
    expect(
      screen.queryByText("Cargando mensajes anteriores…"),
    ).not.toBeInTheDocument();
    // Lo que estaba a 40 px del tope sigue a 40 px de la vista: el contenido
    // creció por arriba y la vista bajó lo mismo.
    expect(hilo.scrollTop).toBe(40 + (hilo.scrollHeight - alto));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("sube página por página hasta el primer mensaje", async () => {
    hiloDe120();
    const hilo = await abrir();
    subirHasta(hilo, 0);
    await screen.findByText("mensaje 20");
    subirHasta(hilo, 0);
    await screen.findByText("mensaje 0");
    subirHasta(hilo, 0);
    expect(pedidosAnteriores().map((c) => c.url)).toEqual([
      `/api/conversations/${CHAT}/messages?before=m-70`,
      `/api/conversations/${CHAT}/messages?before=m-20`,
    ]);
    expect(screen.getByText("120 mensajes")).toBeInTheDocument();
  });

  it("no pide dos veces el mismo cursor aunque el scroll siga", async () => {
    hiloDe120();
    const hilo = await abrir();
    const soltar = retenerAnteriores();
    for (const top of [70, 50, 30, 10, 0]) subirHasta(hilo, top);
    await soltar();
    await screen.findByText("mensaje 20");
    expect(pedidosAnteriores()).toHaveLength(1);
  });

  it("tras un error no entra en bucle, y se puede reintentar", async () => {
    hiloDe120();
    red.hilos[CHAT]!.anteriores!["m-70"] = null;
    const hilo = await abrir();

    subirHasta(hilo, 10);
    expect(
      await screen.findByText(/No se pudieron cargar los mensajes anteriores/),
    ).toBeInTheDocument();
    subirHasta(hilo, 5);
    subirHasta(hilo, 0);
    expect(pedidosAnteriores()).toHaveLength(1);

    red.hilos[CHAT]!.anteriores!["m-70"] = {
      messages: rango(20, 70),
      hasMore: true,
    };
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("mensaje 20")).toBeInTheDocument();
    expect(pedidosAnteriores()).toHaveLength(2);
  });
});

describe("lo que llega mientras se lee arriba", () => {
  it("un mensaje nuevo no borra lo cargado hacia arriba", async () => {
    hiloDe120();
    const hilo = await abrir();
    subirHasta(hilo, 0);
    await screen.findByText("mensaje 20");

    // Llega el 120: la ventana reciente ahora es del 71 al 120.
    red.hilos[CHAT]!.messages = rango(71, 121);
    emitirWa(entrante(CHAT, { messageId: "m-120" }));

    expect(await screen.findByText("mensaje 120")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("mensaje 20")).toBeInTheDocument(),
    );
    expect(screen.getByText("mensaje 70")).toBeInTheDocument();
  });
});
