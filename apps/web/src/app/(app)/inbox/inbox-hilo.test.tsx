/**
 * PRO-7 · El hilo deja de saltar al fondo con cada acuse.
 *
 * El reporte era «estoy leyendo la parte de arriba de un hilo y la vista me
 * arrastra al fondo sola, varias veces seguidas». Dos causas, y las dos se
 * afirman acá: cada acuse de entrega o de lectura pedía el hilo entero otra
 * vez, y el efecto que lo pinta bajaba al fondo pasara lo que pasara.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const MIO = "m-mio";

beforeEach(() => {
  red = montarRed();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Un hilo largo, abierto, con un mensaje nuestro esperando acuse. */
async function abrirHiloLargo() {
  red.hilos[CHAT] = {
    messages: [
      mensaje({ id: "m-viejo", direction: "in", body: "buenas, y la guía?" }),
      mensaje({ id: MIO, direction: "out", body: "ya te confirmo", status: "sent" }),
    ],
  };
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
  await screen.findByText("ya te confirmo");
  const hilo = screen.getByRole("log", { name: "Mensajes de la conversación" });
  // Lo que ya pasó al abrir no cuenta: se mide lo que pasa a partir de acá.
  scrollTo.mockClear();
  return hilo;
}

/** Pone la geometría del hilo: alto real, alto visible, y dónde va el cursor. */
function colocarLectura(hilo: HTMLElement, scrollTop: number) {
  Object.defineProperty(hilo, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(hilo, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(hilo, "scrollTop", { value: scrollTop, configurable: true });
  fireEvent.scroll(hilo);
}

/** El asesor se subió a leer lo de arriba. */
const subirALeer = (hilo: HTMLElement) => colocarLectura(hilo, 0);
/** El asesor va al pie, siguiendo la conversación en vivo. */
const quedarseAlPie = (hilo: HTMLElement) => colocarLectura(hilo, 1600);

const acuse = (status: string) => ({
  type: "message.status",
  conversationId: CHAT,
  messageId: MIO,
  status,
});

describe("leyendo la parte de arriba del hilo", () => {
  it("un acuse de entrega o de lectura no mueve la vista", async () => {
    const hilo = await abrirHiloLargo();
    subirALeer(hilo);

    emitirWa(acuse("delivered"));
    emitirWa(acuse("read"));

    // El chulo sí llega —es lo único que un acuse cambia—, y la vista no.
    expect(await screen.findByTitle("Leído por el cliente")).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("aguanta la ráfaga de acuses de varios mensajes sin moverse", async () => {
    const hilo = await abrirHiloLargo();
    subirALeer(hilo);

    // El hilo servido ya refleja los acuses: así, si algo volviera a pedirlo,
    // el chulo llegaría igual y lo único que separa un camino del otro es si
    // la vista se movió.
    red.hilos[CHAT]!.messages = red.hilos[CHAT]!.messages.map((m) =>
      m.id === MIO ? { ...m, status: "read" } : m,
    );

    // Lo que reportó el usuario: «varias veces seguidas».
    for (const s of ["sent", "delivered", "read"]) {
      emitirWa(acuse(s));
      emitirWa({ ...acuse(s), messageId: "m-viejo" });
    }

    await screen.findByTitle("Leído por el cliente");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("un acuse no vuelve a pedir el hilo, que era un viaje por mensaje enviado", async () => {
    const hilo = await abrirHiloLargo();
    subirALeer(hilo);
    const pedidosAntes = red.llamadas.filter((c) => c.url.includes("/messages")).length;

    emitirWa(acuse("delivered"));
    emitirWa(acuse("read"));

    await screen.findByTitle("Leído por el cliente");
    expect(
      red.llamadas.filter((c) => c.url.includes("/messages")),
    ).toHaveLength(pedidosAntes);
  });

  it("un mensaje nuevo estando arriba tampoco mueve la vista", async () => {
    const hilo = await abrirHiloLargo();
    subirALeer(hilo);

    red.hilos[CHAT]!.messages.push(
      mensaje({ id: "m-nuevo", direction: "in", body: "sigo esperando" }),
    );
    emitirWa(entrante(CHAT, { messageId: "m-nuevo" }));

    // El mensaje llega y se puede bajar a leerlo; lo que no pasa es que la
    // pantalla decida bajar sola mientras se está leyendo arriba.
    expect(await screen.findByText("sigo esperando")).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("siguiendo la conversación al pie", () => {
  it("un mensaje nuevo baja la vista, como hasta ahora", async () => {
    const hilo = await abrirHiloLargo();
    quedarseAlPie(hilo);

    red.hilos[CHAT]!.messages.push(
      mensaje({ id: "m-nuevo", direction: "in", body: "sigo esperando" }),
    );
    emitirWa(entrante(CHAT, { messageId: "m-nuevo" }));

    await screen.findByText("sigo esperando");
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
  });
});

describe("mandar algo es una acción del asesor, no tráfico", () => {
  it("mandar un mensaje baja la vista aunque se estuviera leyendo arriba", async () => {
    const user = userEvent.setup();
    const hilo = await abrirHiloLargo();
    subirALeer(hilo);

    await user.type(
      screen.getByPlaceholderText("Escribe un mensaje…"),
      "ahí va la guía",
    );
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    // No verlo salir sería el bug contrario al que arregla este ticket.
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
  });
});

describe("lo que sí tiene que llegar", () => {
  it("un fallo de envío llega al hilo con su motivo", async () => {
    const hilo = await abrirHiloLargo();
    subirALeer(hilo);

    // El motivo no viaja en el evento: por eso el fallo —y solo el fallo—
    // sigue volviendo a pedir el hilo.
    red.hilos[CHAT]!.messages = [
      mensaje({
        id: MIO,
        direction: "out",
        body: "ya te confirmo",
        status: "failed",
        deliveryError: "El número no tiene WhatsApp",
      }),
    ];
    emitirWa(acuse("failed"));

    expect(
      await screen.findByText(/No entregado · El número no tiene WhatsApp/),
    ).toBeInTheDocument();
  });

  it("un evento de otra conversación no toca este hilo", async () => {
    const hilo = await abrirHiloLargo();
    subirALeer(hilo);
    const pedidosAntes = red.llamadas.filter((c) => c.url.includes("/messages")).length;

    emitirWa({ type: "message.created", conversationId: "c-ajena", messageId: "x" });

    await waitFor(() =>
      expect(
        red.llamadas.filter((c) => c.url.includes("/messages")),
      ).toHaveLength(pedidosAntes),
    );
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
