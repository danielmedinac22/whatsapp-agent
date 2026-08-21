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
  query = "",
} = {}) {
  return render(
    <InboxClient
      initial={items}
      approvedTemplates={[]}
      query={query}
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

/**
 * **Un botón de la barra de filtros**, por su nombre. Lleva la cuenta pegada,
 * así que su nombre accesible es «Por confirmar 0».
 */
function filtro(nombre: string): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^${nombre}\\s+\\d+$`),
  });
}

/** El filtro que está puesto, tal cual se lee. */
function filtroPuesto(): string {
  return screen
    .getByRole("button", { pressed: true })
    .textContent!.replace(/\s+/g, " ")
    .trim();
}

/** Cuántas filas se están viendo. */
function cuantasFilas(): number {
  return within(screen.getByRole("list")).getAllByRole("listitem").length;
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

    await user.click(filtro("Por confirmar"));
    expect(filtroPuesto()).toBe("Por confirmar 0");

    unmount();
    abrir();

    expect(filtroPuesto()).toBe("Por confirmar 0");
  });

  it("viaja en el enlace, que es lo que lo hace sobrevivir a salir y volver", async () => {
    const user = userEvent.setup();
    abrir();

    await user.click(filtro("Confirmadas"));

    expect(direccion()).toBe("/inbox?v=confirmadas");
  });

  it("la barra reemplazó a las tarjetas y filtra por el mismo camino", async () => {
    // Las tres tarjetas que filtraban y el selector eran dos controles para un
    // solo estado. Ahora es uno, y sigue escribiendo la dirección igual: el
    // token de `?v=` no cambió, así que un enlace de ayer sigue significando lo
    // mismo mañana.
    const user = userEvent.setup();
    abrir();

    await user.click(filtro("Por confirmar"));

    expect(filtroPuesto()).toBe("Por confirmar 0");
    expect(direccion()).toBe("/inbox?v=pendientes");
  });

  it("no se lleva por delante la conversación abierta", async () => {
    const user = userEvent.setup();
    abrir();
    await user.click(screen.getByText("Cliente c-dos"));

    await user.click(filtro("Sin responder"));

    expect(chatAbierto()).toBe("c-dos");
    expect(direccion()).toBe("/inbox?c=c-dos&v=sin-responder");
  });
});

describe("el buscador", () => {
  /**
   * Lo reportó la operación de Vorare el 21-ago-2026: «cada vez que busco un
   * número aparecen dos resultados, el que busqué y el de la búsqueda
   * anterior». Buscar 1234, abrirla, buscar 456 → salían 456 **y 1234**.
   *
   * La causa era `?c=`: ancla su conversación en la lista aunque quede fuera
   * del corte, del filtro o de la búsqueda, y el buscador nunca lo limpiaba.
   * La de la búsqueda anterior seguía pegada arriba de la siguiente.
   *
   * **Se afirma sobre `router.replace` y no sobre la dirección**, y esa es la
   * diferencia con el resto del archivo: abrir una conversación se escribe con
   * la History API y no cuesta un render, pero buscar sí es un render de
   * servidor —la búsqueda corre sobre TODAS las conversaciones, no sobre las
   * 200 cargadas—, así que va por el router.
   */
  const buscador = () =>
    screen.getByPlaceholderText("Buscar nombre, teléfono o mensaje…");

  it("una búsqueda nueva suelta la conversación de la anterior", async () => {
    const user = userEvent.setup();
    abrir();
    await user.click(screen.getByText("Cliente c-dos"));
    expect(direccion()).toBe("/inbox?c=c-dos");

    await user.type(buscador(), "456");

    await vi.waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/inbox?q=456"),
    );
  });

  it("limpiar la búsqueda no cierra lo que tenías abierto", async () => {
    // La otra mitad: el ancla se suelta al **escribir** un término, no al
    // borrarlo. Volver a la bandeja entera no es dejar de leer un chat.
    const user = userEvent.setup();
    irA("/inbox?c=c-dos&q=456");
    abrir({ query: "456" });

    await user.clear(buscador());

    await vi.waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/inbox?c=c-dos"),
    );
  });

  it("el filtro puesto sobrevive a buscar, que es lo que ya funcionaba", async () => {
    const user = userEvent.setup();
    abrir();
    await user.click(filtro("Sin responder"));

    await user.type(buscador(), "456");

    await vi.waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/inbox?v=sin-responder&q=456"),
    );
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

  it("la barra nunca queda en blanco mientras la lista filtra", () => {
    // «En automático» solo existe en ventas. Antes sobrevivía al salto a
    // operaciones: el selector se quedaba vacío —esa opción no está ahí— y la
    // lista seguía filtrando, así que faltaban filas sin poder ver por qué.
    //
    // Y ahora hay un segundo camino al mismo blanco: «En automático» **salió de
    // la barra** —lo lleva el 89,9% de las conversaciones y no decide nada—,
    // pero la barra lateral sigue enlazando a él. Por eso se ofrece cuando está
    // puesto: quien llega por ese enlace ve qué filtro tiene y con qué salir.
    irA("/inbox?b=ventas&v=en-automatico");
    const { rerender } = abrir({ items: DE_VENTAS, bandeja: "ventas" });
    expect(filtroPuesto()).toBe("En automático 2");

    // El parámetro se conserva a propósito: es el caso duro —el botón Atrás del
    // navegador, o un enlace viejo—, y cubre de una vez las dos causas del
    // blanco: que el filtro sobreviviera en memoria, y que sobreviva en la
    // dirección un valor que esta bandeja no ofrece.
    saltarA(rerender, "/inbox?v=en-automatico", TRES, "operaciones");

    expect(filtroPuesto()).toBe("Todas 3");
    // Y lo que la barra dice es lo que la lista hace: las tres se ven.
    expect(cuantasFilas()).toBe(3);
  });

  it("«en automático» no ocupa sitio en la barra si no está puesto", () => {
    // Sale en el 89,9% de las conversaciones: un número que casi siempre dice
    // «casi todas» no decide nada, y en 390 px cada botón cuesta.
    irA("/inbox?b=ventas");
    abrir({ items: DE_VENTAS, bandeja: "ventas" });

    expect(filtroPuesto()).toBe("Todas 2");
    expect(
      screen.queryByRole("button", { name: /^En automático/ }),
    ).toBeNull();
  });

  it("un filtro que la bandeja no ofrece no la deja vacía sin explicación", () => {
    // Una dirección escrita a mano, o vieja. Cae en «Todas», no en el vacío.
    irA("/inbox?v=pendientes&b=ventas");
    abrir({ items: DE_VENTAS, bandeja: "ventas" });

    expect(filtroPuesto()).toBe("Todas 2");
    expect(cuantasFilas()).toBe(2);
  });
});
