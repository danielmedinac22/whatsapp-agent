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
function abrirBandeja(items = [chat({ id: "c-uno" }), chat({ id: "c-dos" })]) {
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

/** Deja la pantalla como la deja el asesor antes de tocar un botón. */
async function medioEscritoYFiltrado(user: ReturnType<typeof userEvent.setup>) {
  const borrador = await screen.findByPlaceholderText("Escribe un mensaje…");
  await user.type(borrador, "ya te confirmo la gu");
  await user.selectOptions(
    screen.getByRole("combobox"),
    "sin_responder",
  );
  return borrador;
}

/** Lo que el asesor tiene que seguir viendo después de tocar cualquier botón. */
async function nadaSeMovio(borrador: HTMLElement) {
  expect(borrador).toHaveValue("ya te confirmo la gu");
  expect(screen.getByRole("combobox")).toHaveValue("sin_responder");
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

    await user.click(screen.getByRole("button", { name: /Agente: OFF/ }));
    await screen.findByRole("button", { name: /Agente: ON/ });

    // La otra fila lo dice también, y ahora lo dice **escrito**: hasta el
    // 20-ago-2026 el modo agente era un icono de chispas sin texto y su
    // contrario la palabra «manual» en cada fila que no lo estaba. Marcar todas
    // las filas es no marcar ninguna, así que solo se marca la que sí.
    const lista = screen.getByRole("list");
    await waitFor(() =>
      expect(within(lista).getAllByText("en automático")).toHaveLength(2),
    );
    expect(within(lista).queryAllByText("manual")).toHaveLength(0);
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

    expect(await screen.findByText("Sin responder (2)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Trabajarla yo/ }));

    expect(await screen.findByText("Sin responder (1)")).toBeInTheDocument();
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

  it("mueve el contador de la tarjeta, que se lee de la misma lista", async () => {
    const user = userEvent.setup();
    abrirBandeja();

    await user.click(screen.getByRole("button", { name: /sin clasificar/ }));
    await user.click(screen.getByText("confirmado"));

    expect(await screen.findByText("Confirmadas (1)")).toBeInTheDocument();
  });
});
