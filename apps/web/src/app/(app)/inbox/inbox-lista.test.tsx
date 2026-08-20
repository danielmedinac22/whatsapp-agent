/**
 * PRO-12 · La lista se parchea con el evento en vez de refrescar.
 *
 * Cada evento del stream disparaba un `router.refresh()`: el render de servidor
 * entero —23 idas y vueltas a la base, 1.256 filas leídas— para entregar una
 * fila que cambió. Con tráfico real, un render por mensaje.
 *
 * Y de paso reordenaba la lista bajo el cursor: entra un mensaje de otro
 * cliente, todo baja un puesto y el asesor abre la conversación equivocada.
 *
 * Casi todo lo de acá se afirma por lo que se ve —qué dice la fila, en qué
 * orden están, qué avisa la pantalla—. Lo único que se mira del router es
 * **que no se le pidió la pantalla**, porque eso es literalmente el costo que
 * este ticket vino a sacar y no tiene sombra en el documento.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
  FakeEventSource,
  irA,
  montarRed,
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

/**
 * Tres conversaciones, ordenadas por actividad como las manda el servidor: la
 * de arriba es la más reciente, la de abajo la más vieja.
 */
const TRES = [
  chat({ id: "c-uno", lastAt: "2026-08-20T11:00:00.000Z", preview: "gracias" }),
  chat({ id: "c-dos", lastAt: "2026-08-20T10:00:00.000Z", preview: "ok" }),
  chat({ id: "c-tres", lastAt: "2026-08-20T09:00:00.000Z", preview: "listo" }),
];

function abrir(items = TRES) {
  return render(
    <InboxClient
      initial={items}
      approvedTemplates={[]}
      query=""
      operationId={OPERACION}
      bandeja={null}
      sellerName="Sebastián"
      currentUserId="u-katherine"
    />,
  );
}

/** El orden en el que se ven las conversaciones, de arriba abajo. */
function ordenDeLaLista(): string[] {
  return within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p")!.textContent!.replace("Cliente ", ""));
}

/**
 * La fila de una conversación **en la lista**. Acotado a la lista a propósito:
 * el nombre del cliente también está en la cabecera del hilo cuando está
 * abierto, y esto pregunta por la fila.
 */
function fila(id: string): HTMLElement {
  return within(screen.getByRole("list"))
    .getByText(`Cliente ${id}`)
    .closest("li")!;
}

/**
 * Dejar pasar la ventana del refresh. Sin esto, «no pidió la pantalla» diría lo
 * mismo tanto si no lo pidió como si lo pidió con retraso.
 */
const VENTANA_MAS_UN_POCO = 600;
const dejarPasarLaVentana = () =>
  act(() => new Promise((r) => setTimeout(r, VENTANA_MAS_UN_POCO)));

describe("un mensaje entrante", () => {
  it("actualiza la fila sin pedirle la pantalla al servidor", async () => {
    abrir();

    act(() => {
      emitirWa(
        entrante("c-dos", {
          lastMessagePreview: "¿ya salió mi pedido?",
          unreadCount: 2,
        }),
      );
    });

    await waitFor(() =>
      expect(within(fila("c-dos")).getByText("¿ya salió mi pedido?")).toBeInTheDocument(),
    );
    expect(within(fila("c-dos")).getByText("2")).toBeInTheDocument();

    await dejarPasarLaVentana();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("una ráfaga de 60 mensajes no pide ni un render de servidor", async () => {
    // El número que este ticket vino a mover, medido acá mismo el 20-ago-2026:
    // con el camino de antes esta misma ráfaga pedía **60** renders, uno por
    // evento, y cada render son 23 idas y vueltas a la base. Ahora pide 0.
    abrir();

    act(() => {
      for (let n = 0; n < 60; n++) {
        emitirWa(
          entrante(TRES[n % 3]!.id, {
            messageId: `m-${n}`,
            lastMessagePreview: `mensaje ${n}`,
            unreadCount: n + 1,
            lastActivityAt: new Date(Date.UTC(2026, 7, 20, 12, n)).toISOString(),
          }),
        );
      }
    });

    await waitFor(() =>
      expect(within(fila("c-tres")).getByText("mensaje 59")).toBeInTheDocument(),
    );
    await dejarPasarLaVentana();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("no toca las otras filas", async () => {
    abrir();

    act(() => {
      emitirWa(entrante("c-dos", { lastMessagePreview: "¿ya salió mi pedido?" }));
    });

    await waitFor(() =>
      expect(within(fila("c-dos")).getByText("¿ya salió mi pedido?")).toBeInTheDocument(),
    );
    expect(within(fila("c-uno")).getByText("gracias")).toBeInTheDocument();
    expect(within(fila("c-tres")).getByText("listo")).toBeInTheDocument();
  });

  it("un evento de otra operación no mueve esta bandeja", async () => {
    abrir();

    act(() => {
      emitirWa(
        entrante("c-dos", {
          operationId: "op-colombia",
          lastMessagePreview: "esto es de Colombia",
        }),
      );
    });

    await dejarPasarLaVentana();
    expect(within(fila("c-dos")).getByText("ok")).toBeInTheDocument();
    expect(screen.queryByText(/novedades/)).not.toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("no inventa una conversación que no está en la lista, y avisa que llegó", async () => {
    abrir();

    act(() => {
      emitirWa(entrante("c-que-no-esta", { lastMessagePreview: "hola, vi el anuncio" }));
    });

    expect(await screen.findByText(/1 conversación con novedades/)).toBeInTheDocument();
    expect(ordenDeLaLista()).toEqual(["c-uno", "c-dos", "c-tres"]);
    expect(screen.getByText("3/3")).toBeInTheDocument();
  });

  it("un acuse de lectura no cambia la lista ni avisa de nada", async () => {
    abrir();

    act(() => {
      emitirWa({
        type: "message.status",
        operationId: OPERACION,
        conversationId: "c-tres",
        messageId: "m-1",
        status: "read",
      });
    });

    await dejarPasarLaVentana();
    expect(ordenDeLaLista()).toEqual(["c-uno", "c-dos", "c-tres"]);
    expect(screen.queryByText(/novedades/)).not.toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("un fallo de entrega enciende el aviso de la fila, sin viaje", async () => {
    abrir();

    act(() => {
      emitirWa({
        type: "message.status",
        operationId: OPERACION,
        conversationId: "c-tres",
        messageId: "m-1",
        status: "failed",
      });
    });

    expect(
      await within(fila("c-tres")).findByText("no entregado"),
    ).toBeInTheDocument();
    await dejarPasarLaVentana();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("la lista no se reordena bajo el cursor", () => {
  it("la fila se actualiza en su sitio y aparece un aviso", async () => {
    abrir();

    act(() => {
      emitirWa(
        entrante("c-tres", {
          lastMessagePreview: "¿ya salió mi pedido?",
          lastActivityAt: "2026-08-20T12:00:00.000Z",
        }),
      );
    });

    expect(await screen.findByText(/1 conversación con novedades/)).toBeInTheDocument();
    // Lo nuevo se ve, y donde estaba: el cursor no se queda apuntando a otra.
    expect(within(fila("c-tres")).getByText("¿ya salió mi pedido?")).toBeInTheDocument();
    expect(ordenDeLaLista()).toEqual(["c-uno", "c-dos", "c-tres"]);
  });

  it("el aviso reordena cuando el asesor lo pide", async () => {
    const user = userEvent.setup();
    abrir();

    act(() => {
      emitirWa(entrante("c-tres", { lastActivityAt: "2026-08-20T12:00:00.000Z" }));
    });
    await screen.findByText(/1 conversación con novedades/);

    await user.click(screen.getByRole("button", { name: /novedades/ }));

    expect(ordenDeLaLista()).toEqual(["c-tres", "c-uno", "c-dos"]);
    expect(screen.queryByText(/novedades/)).not.toBeInTheDocument();
  });

  it("no avisa cuando la fila que cambió ya estaba arriba", async () => {
    abrir();

    act(() => {
      emitirWa(
        entrante("c-uno", {
          lastMessagePreview: "otra cosita",
          lastActivityAt: "2026-08-20T12:00:00.000Z",
        }),
      );
    });

    await waitFor(() =>
      expect(within(fila("c-uno")).getByText("otra cosita")).toBeInTheDocument(),
    );
    // Nada se movió, así que un aviso sería ruido: el que aparece siempre es el
    // que nadie mira.
    expect(screen.queryByText(/novedades/)).not.toBeInTheDocument();
  });

  it("cuenta las conversaciones con novedades, no los mensajes", async () => {
    abrir();

    act(() => {
      emitirWa(entrante("c-tres", { lastActivityAt: "2026-08-20T12:00:00.000Z" }));
      emitirWa(entrante("c-tres", { lastActivityAt: "2026-08-20T12:01:00.000Z" }));
      emitirWa(entrante("c-dos", { lastActivityAt: "2026-08-20T12:02:00.000Z" }));
    });

    expect(
      await screen.findByText(/2 conversaciones con novedades/),
    ).toBeInTheDocument();
  });

  it("la conversación abierta sigue abierta después de reordenar", async () => {
    const user = userEvent.setup();
    irA("/inbox?c=c-uno");
    abrir();

    act(() => {
      emitirWa(entrante("c-tres", { lastActivityAt: "2026-08-20T12:00:00.000Z" }));
    });
    await screen.findByText(/novedades/);
    await user.click(screen.getByRole("button", { name: /novedades/ }));

    expect(ordenDeLaLista()).toEqual(["c-tres", "c-uno", "c-dos"]);
    expect(screen.getByText("+502555c-uno")).toBeInTheDocument();
  });
});

describe("una sola conexión al stream por pestaña", () => {
  it("la pestaña abre una y no dos", async () => {
    abrir();

    await waitFor(() => expect(FakeEventSource.abiertas).toHaveLength(1));
  });

  it("cambiar de conversación no abre otra ni cierra la que hay", async () => {
    // El hilo abría la suya y la cerraba y reabría con cada cambio de chat.
    const user = userEvent.setup();
    abrir();
    await waitFor(() => expect(FakeEventSource.abiertas).toHaveLength(1));
    const [laDeSiempre] = FakeEventSource.abiertas;

    await user.click(screen.getByText("Cliente c-dos"));
    await user.click(screen.getByText("Cliente c-tres"));

    expect(FakeEventSource.abiertas).toHaveLength(1);
    expect(FakeEventSource.abiertas[0]).toBe(laDeSiempre);
  });

  it("el hilo sigue enterándose de lo suyo por esa única conexión", async () => {
    irA("/inbox?c=c-dos");
    red.hilos["c-dos"] = { messages: [] };
    abrir();
    await screen.findByRole("log", { name: "Mensajes de la conversación" });

    red.hilos["c-dos"] = {
      messages: [
        {
          id: "m-nuevo",
          direction: "in",
          body: "¿ya salió mi pedido?",
          fromAgent: false,
          status: "sent",
          deliveryError: null,
          mediaUrl: null,
          mediaMime: null,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    act(() => {
      emitirWa(entrante("c-dos", { lastMessagePreview: "otra cosa" }));
    });

    const hilo = await screen.findByRole("log", {
      name: "Mensajes de la conversación",
    });
    await waitFor(() =>
      expect(within(hilo).getByText("¿ya salió mi pedido?")).toBeInTheDocument(),
    );
  });
});
