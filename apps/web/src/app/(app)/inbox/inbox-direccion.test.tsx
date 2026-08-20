/**
 * PRO-11 · El estado de la bandeja vive en la dirección.
 *
 * Tres síntomas con una sola causa: la conversación abierta y el filtro vivían
 * en memoria. No se podía mandarle a un compañero el enlace de un chat, Atrás
 * sacaba de la pantalla en vez de volver al chat anterior, y recargar aterrizaba
 * en otro. Y un cuarto: cambiar de bandeja es la misma ruta, así que el
 * componente no se remonta y quedaba abierta una conversación de la otra, con
 * el selector en blanco mientras la lista sí filtraba.
 *
 * Lo que se afirma acá es lo que el asesor percibe —qué chat está abierto, qué
 * dice el selector, qué filas se ven— y, en unos pocos casos, la dirección
 * misma: es lo que se copia y se pega en un chat de equipo, así que es cosa
 * suya y no un detalle de cómo está armado esto.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => useSearchParamsFingido(),
}));

import { InboxClient, type ChatItem } from "./inbox-client";
import {
  atras,
  chat,
  direccion,
  irA,
  montarRed,
  OP,
  OPERACION,
  router,
  useSearchParamsFingido,
} from "./inbox-harness";

beforeEach(() => {
  montarRed();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const TRES = [
  chat({ id: "c-uno" }),
  chat({ id: "c-dos" }),
  chat({ id: "c-tres" }),
];

/** La bandeja, montada sobre la dirección en la que esté la pestaña. */
function abrir({
  items = TRES,
  bandeja = null as "ventas" | "operaciones" | null,
} = {}) {
  return render(
    <InboxClient
      initial={items}
      approvedTemplates={[]}
      query=""
      op={OP}
      operationId={OPERACION}
      bandeja={bandeja}
      sellerName="Sebastián"
      currentUserId="u-katherine"
    />,
  );
}

/** Qué conversación está abierta: lo dice el teléfono de la cabecera del hilo. */
function chatAbierto(): string {
  return screen
    .getByText(/^\+502555c-/)
    .textContent!.replace("+502555", "");
}

/** Lo que el selector está mostrando, tal cual se lee. */
function loQueDiceElSelector(): string {
  const select = screen.getByRole("combobox") as HTMLSelectElement;
  return select.selectedOptions[0]?.textContent?.trim() ?? "";
}

describe("la conversación abierta", () => {
  it("se escribe en la dirección al seleccionarla, que es lo que se puede mandar", async () => {
    const user = userEvent.setup();
    abrir();

    await user.click(screen.getByText("Cliente c-tres"));

    expect(direccion()).toBe("/inbox?c=c-tres");
    expect(chatAbierto()).toBe("c-tres");
  });

  it("el enlace de una conversación abre esa conversación", () => {
    // Es lo que recibe el compañero al que le mandaste el enlace, y es también
    // lo que ve el asesor al recargar: la pestaña aterriza en la dirección.
    irA("/inbox?c=c-tres");
    abrir();

    expect(chatAbierto()).toBe("c-tres");
  });

  it("recargar deja en la conversación donde estabas, no en la primera", async () => {
    const user = userEvent.setup();
    const { unmount } = abrir();
    await user.click(screen.getByText("Cliente c-dos"));

    // Recargar es exactamente esto: el cliente se reinicia y la dirección no.
    unmount();
    abrir();

    expect(chatAbierto()).toBe("c-dos");
  });

  it("Atrás devuelve a la conversación anterior, y no saca de la pantalla", async () => {
    const user = userEvent.setup();
    abrir();

    await user.click(screen.getByText("Cliente c-dos"));
    await user.click(screen.getByText("Cliente c-tres"));
    expect(chatAbierto()).toBe("c-tres");

    atras();

    expect(chatAbierto()).toBe("c-dos");
  });

  it("un salto desde Pedidos ya no gana sobre lo que el asesor abrió después", async () => {
    // El `?c=` que ya existía. Lo que cambia es que ahora, si el asesor se mueve
    // a otro chat y recarga, no lo devuelve al del salto.
    const user = userEvent.setup();
    irA("/inbox?c=c-uno");
    const { unmount } = abrir();
    expect(chatAbierto()).toBe("c-uno");

    await user.click(screen.getByText("Cliente c-tres"));
    unmount();
    abrir();

    expect(chatAbierto()).toBe("c-tres");
  });
});

describe("el filtro de la bandeja de operaciones", () => {
  it("sobrevive a recargar", async () => {
    const user = userEvent.setup();
    const { unmount } = abrir();

    await user.selectOptions(screen.getByRole("combobox"), "pending");
    expect(loQueDiceElSelector()).toBe("Pendientes (0)");

    unmount();
    abrir();

    expect(loQueDiceElSelector()).toBe("Pendientes (0)");
  });

  it("viaja en el enlace, que es lo que lo hace sobrevivir a salir y volver", async () => {
    const user = userEvent.setup();
    abrir();

    await user.selectOptions(screen.getByRole("combobox"), "confirmed");

    expect(direccion()).toBe("/inbox?v=confirmadas");
  });

  it("las tarjetas de arriba filtran por el mismo camino", async () => {
    const user = userEvent.setup();
    abrir();

    await user.click(screen.getByRole("button", { name: /Por confirmar/ }));

    expect(loQueDiceElSelector()).toBe("Pendientes (0)");
    expect(direccion()).toBe("/inbox?v=pendientes");
  });

  it("no se lleva por delante la conversación abierta", async () => {
    const user = userEvent.setup();
    abrir();
    await user.click(screen.getByText("Cliente c-dos"));

    await user.selectOptions(screen.getByRole("combobox"), "sin_responder");

    expect(chatAbierto()).toBe("c-dos");
    expect(direccion()).toBe("/inbox?c=c-dos&v=sin-responder");
  });
});

describe("cambiar de bandeja", () => {
  /** Las conversaciones de la otra bandeja: ninguna en común. */
  const DE_VENTAS: ChatItem[] = [
    chat({ id: "c-lead", agentMode: true }),
    chat({ id: "c-otro", agentMode: true }),
  ];

  /** El salto de bandeja: misma ruta, sin `c` ni `v`, y sin remontar. */
  function saltarA(
    rerender: (ui: React.ReactElement) => void,
    url: string,
    items: ChatItem[],
    bandeja: "ventas" | "operaciones",
  ) {
    irA(url);
    rerender(
      <InboxClient
        initial={items}
        approvedTemplates={[]}
        query=""
        op={OP}
        operationId={OPERACION}
        bandeja={bandeja}
        sellerName="Sebastián"
        currentUserId="u-katherine"
      />,
    );
  }

  it("no deja abierta una conversación de la bandeja anterior", async () => {
    const user = userEvent.setup();
    const { rerender } = abrir({ bandeja: "operaciones" });
    await user.click(screen.getByText("Cliente c-tres"));
    expect(chatAbierto()).toBe("c-tres");

    saltarA(rerender, "/inbox?b=ventas", DE_VENTAS, "ventas");

    expect(chatAbierto()).toBe("c-lead");
    // Y la fila abierta está resaltada, que era el otro síntoma: antes quedaba
    // una conversación abierta sin ninguna fila marcada.
    const filas = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(filas[0]!.className).toContain("var(--color-ink)");
  });

  it("el selector nunca queda en blanco mientras la lista filtra", () => {
    // «En automático» solo existe en ventas. Antes sobrevivía al salto a
    // operaciones: el selector se quedaba vacío —esa opción no está ahí— y la
    // lista seguía filtrando, así que faltaban filas sin poder ver por qué.
    irA("/inbox?b=ventas&v=en-automatico");
    const { rerender } = abrir({ items: DE_VENTAS, bandeja: "ventas" });
    expect(loQueDiceElSelector()).toBe("En automático (2)");

    // El parámetro se conserva a propósito: es el caso duro —el botón Atrás del
    // navegador, o un enlace viejo—, y cubre de una vez las dos causas del
    // blanco: que el filtro sobreviviera en memoria, y que sobreviva en la
    // dirección un valor que esta bandeja no ofrece.
    saltarA(rerender, "/inbox?v=en-automatico", TRES, "operaciones");

    expect(loQueDiceElSelector()).toBe("Todas (3)");
    // Y lo que el selector dice es lo que la lista hace: las tres se ven.
    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list")).getAllByRole("listitem"),
    ).toHaveLength(3);
  });

  it("un filtro que la bandeja no ofrece no la deja vacía sin explicación", () => {
    // Una dirección escrita a mano, o vieja. Cae en «Todas», no en el vacío.
    irA("/inbox?v=pendientes&b=ventas");
    abrir({ items: DE_VENTAS, bandeja: "ventas" });

    expect(loQueDiceElSelector()).toBe("Todas (2)");
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });
});
