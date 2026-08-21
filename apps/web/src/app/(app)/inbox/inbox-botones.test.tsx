/**
 * PRO-5 · Los tres botones de uso diario dejan de recargar la pantalla.
 *
 * Lo que se afirma acá es lo que el asesor percibe, no cómo está armado el
 * componente: que la fila diga lo nuevo, y que el mensaje a medio escribir, el
 * filtro puesto y el chat abierto sigan donde estaban. Los tres juntos son la
 * prueba de que no hubo recarga: un `location.reload()` se lleva los tres por
 * delante, porque la conversación abierta no vive en la URL.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => useSearchParamsFingido(),
}));

import { InboxClient } from "./inbox-client";
import {
  chat,
  irA,
  montarRed,
  OP,
  OPERACION,
  router,
  useSearchParamsFingido,
  type RedFingida,
} from "./inbox-harness";

let red: RedFingida;

beforeEach(() => {
  red = montarRed();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const KATHERINE = "u-katherine";

/**
 * La bandeja abierta en la segunda conversación, con el vendedor configurado
 * —que es lo que enciende el botón de «trabajarla yo»—.
 */
function abrirBandeja(
  // `agentMode: false` explícito: estas pruebas empujan el botón de OFF a ON, y
  // la conversación con lo mínimo puesto está en automático, que es la norma de
  // producción (199 de cada 200).
  items = [
    chat({ id: "c-uno", agentMode: false }),
    chat({ id: "c-dos", agentMode: false }),
  ],
) {
  // La conversación abierta viene de la dirección, que es donde vive desde
  // PRO-11: es lo mismo que llegar por un enlace o recargar la página.
  irA("/inbox?c=c-dos");
  render(
    <InboxClient
      initial={items}
      approvedTemplates={[]}
      query=""
      op={OP}
      operationId={OPERACION}
      bandeja={null}
      sellerName="Sebastián"
      currentUserId={KATHERINE}
    />,
  );
  return items;
}

/** Un botón de la barra de filtros, que lleva su cuenta pegada al nombre. */
function filtro(nombre: string): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^${nombre}\\s+\\d+$`),
  });
}

/** La cuenta que muestra un filtro. */
function cuentaDelFiltro(nombre: string): string {
  return filtro(nombre).textContent!.replace(nombre, "").trim();
}

/** Deja la pantalla como la deja el asesor antes de tocar un botón. */
async function medioEscritoYFiltrado(user: ReturnType<typeof userEvent.setup>) {
  const borrador = await screen.findByPlaceholderText("Escribe un mensaje…");
  await user.type(borrador, "ya te confirmo la gu");
  await user.click(filtro("Sin responder"));
  return borrador;
}

/** Lo que el asesor tiene que seguir viendo después de tocar cualquier botón. */
async function nadaSeMovio(borrador: HTMLElement) {
  expect(borrador).toHaveValue("ya te confirmo la gu");
  // El filtro puesto sigue puesto. Lo dice el botón marcado de la barra, que es
  // lo que reemplazó al selector.
  expect(
    screen.getByRole("button", { pressed: true }).textContent,
  ).toMatch(/^Sin responder/);
  // El chat abierto sigue siendo el mismo, y no el primero de la lista.
  expect(screen.getByText("+502555c-dos")).toBeInTheDocument();
}

describe("Agente ON/OFF", () => {
  it("deja la fila en ON sin llevarse el borrador, el filtro ni el chat abierto", async () => {
    const user = userEvent.setup();
    abrirBandeja();
    const borrador = await medioEscritoYFiltrado(user);

    await user.click(screen.getByRole("button", { name: /Agente: OFF/ }));

    expect(
      await screen.findByRole("button", { name: /Agente: ON/ }),
    ).toBeInTheDocument();
    await nadaSeMovio(borrador);
  });

  it("cambia las dos filas del mismo contacto, porque el modo agente es del contacto", async () => {
    const user = userEvent.setup();
    // Dos conversaciones, un solo cliente. Es lo que hacía bien la recarga.
    abrirBandeja([
      chat({ id: "c-uno", contactId: "k-mismo", agentMode: false }),
      chat({ id: "c-dos", contactId: "k-mismo", agentMode: false }),
    ]);

    // Las dos filas lo dicen antes de tocar nada: el agente está apagado en el
    // contacto, así que las dos llevan la etiqueta.
    const lista = screen.getByRole("list");
    expect(within(lista).getAllByText("lo llevo yo")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /Agente: OFF/ }));
    await screen.findByRole("button", { name: /Agente: ON/ });

    // Y las dos dejan de decirlo. **La etiqueta informa por su ausencia**: desde
    // el nivel 4 marca la excepción —la que alguien apartó a mano—, porque «en
    // automático» salía en 199 de cada 200 filas y marcar casi todas es no
    // marcar ninguna. Es la fila de al lado la que prueba que el cambio es del
    // contacto y no de la conversación.
    await waitFor(() =>
      expect(within(lista).queryAllByText("lo llevo yo")).toHaveLength(0),
    );
  });

  it("no cambia la fila si el servidor no pudo escribirla", async () => {
    const user = userEvent.setup();
    red.respuestas.push({ url: "/agent-mode", body: null, ok: false });
    abrirBandeja();

    await user.click(screen.getByRole("button", { name: /Agente: OFF/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Agente: OFF/ })).toBeEnabled(),
    );
  });
});

describe("«la trabajo yo»", () => {
  it("deja la fila tomada sin llevarse el borrador, el filtro ni el chat abierto", async () => {
    const user = userEvent.setup();
    red.respuestas.push({
      url: "/assignment",
      body: { ok: true, assignedTo: { id: KATHERINE, label: "Katherine" } },
    });
    abrirBandeja();
    const borrador = await medioEscritoYFiltrado(user);

    await user.click(screen.getByRole("button", { name: /Trabajarla yo/ }));

    expect(
      await screen.findByRole("button", { name: /La trabajo yo · soltar/ }),
    ).toBeInTheDocument();
    await nadaSeMovio(borrador);
  });

  it("dice el nombre que mandó el servidor, y no el que adivine el cliente", async () => {
    const user = userEvent.setup();
    red.respuestas.push({
      url: "/assignment",
      body: { ok: true, assignedTo: { id: "u-otro", label: "Sebastián" } },
    });
    abrirBandeja();

    await user.click(await screen.findByRole("button", { name: /Trabajarla yo/ }));

    expect(
      await screen.findByRole("button", { name: /La trabaja Sebastián/ }),
    ).toBeInTheDocument();
  });

  it("saca la fila de «Sin responder», porque una conversación tomada ya no espera a nadie", async () => {
    const user = userEvent.setup();
    red.respuestas.push({
      url: "/assignment",
      body: { ok: true, assignedTo: { id: KATHERINE, label: "Katherine" } },
    });
    abrirBandeja([
      chat({ id: "c-uno", sinResponder: true }),
      chat({ id: "c-dos", sinResponder: true }),
    ]);

    expect(cuentaDelFiltro("Sin responder")).toBe("2");
    await user.click(screen.getByRole("button", { name: /Trabajarla yo/ }));

    await waitFor(() => expect(cuentaDelFiltro("Sin responder")).toBe("1"));
  });
});

describe("marcar confirmación", () => {
  it("deja la fila confirmada sin llevarse el borrador, el filtro ni el chat abierto", async () => {
    const user = userEvent.setup();
    abrirBandeja();
    const borrador = await medioEscritoYFiltrado(user);

    await user.click(screen.getByRole("button", { name: /sin clasificar/ }));
    await user.click(
      within(screen.getByText("confirmado").closest("button")!).getByText(
        "confirmado",
      ),
    );

    expect(
      await screen.findByRole("button", { name: /confirmado/ }),
    ).toBeInTheDocument();
    await nadaSeMovio(borrador);
  });

  it("mueve el contador del filtro, que se lee de la misma lista", async () => {
    const user = userEvent.setup();
    abrirBandeja();

    await user.click(screen.getByRole("button", { name: /sin clasificar/ }));
    await user.click(screen.getByText("confirmado"));

    await waitFor(() => expect(cuentaDelFiltro("Confirmadas")).toBe("1"));
  });
});
