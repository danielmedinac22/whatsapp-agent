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

import {
  ETIQUETAS_EN_EL_TELEFONO,
  estadosDeLaFila,
  InboxClient,
  type ChatItem,
} from "./inbox-client";
import { tiempoRelativo } from "./tiempo-relativo";
import {
  chat,
  emitirWa,
  entrante,
  FakeEventSource,
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
      op={OP}
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
 * **Un botón de la barra de filtros**, por su nombre.
 *
 * La barra reemplazó a la vez al bloque de cinco tarjetas y al `<select>`: los
 * dos decían lo mismo y en 390 px no caben los dos. Cada botón lleva su cuenta
 * pegada, así que el nombre accesible es «Sin responder 6».
 */
function filtro(nombre: string): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^${nombre}\\s+\\d+$`),
  });
}

/** La cuenta que muestra un filtro. */
function cuentaDelFiltro(nombre: string): string {
  return filtro(nombre).textContent!.replace(nombre, "").trim();
}

/** El filtro que está puesto, tal como se lee. */
function filtroPuesto(): string {
  return screen
    .getByRole("button", { pressed: true })
    .textContent!.replace(/\s+/g, " ")
    .trim();
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
    expect(cuentaDelFiltro("Todas")).toBe("3");
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

/* ══════════════════════════════════════════════════════════════════════════
   PRO-28 · La fila dice su estado y su tiempo

   El dueño del producto lo dijo así: «es más colores, formas, títulos. Es
   difícil navegarlo en general.» Lo que sigue afirma las tres cosas con las
   que la bandeja se vuelve recorrible con la vista —cada estado con su nombre
   escrito, el tiempo dicho en relativo, y secciones con nombre y cuenta— y una
   cuarta que no es nueva pero que estas tres podían romper: que la lista no se
   mueva sola.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * **Los tres bordes del formato de tiempo.**
 *
 * Se prueban contra la función pura y no contra la pantalla, y por eso la
 * función recibe el «ahora»: medianoche, ayer a las 23:59 y el salto de semana
 * no se pueden escribir contra un reloj que corre sin congelar el del proceso,
 * y congelarlo ataría la prueba a un truco del arnés en vez de al criterio.
 *
 * Las fechas van **sin zona** a propósito: así se leen en la hora local del que
 * corre la prueba, que es la del asesor, que es donde la cuenta de días de
 * calendario tiene que dar bien.
 */
describe("el tiempo de la fila", () => {
  const jueves2032 = () => new Date("2026-08-20T20:32:00");

  it("dice la hora cuando es de hoy", () => {
    expect(tiempoRelativo("2026-08-20T14:32:00", jueves2032())).toBe("14:32");
  });

  describe("borde 1 · medianoche", () => {
    it("lo de las 00:00 de hoy es de hoy, y dice 00:00", () => {
      expect(tiempoRelativo("2026-08-20T00:00:00", jueves2032())).toBe("00:00");
    });

    it("a las 00:01, lo de hace dos minutos ya es de ayer", () => {
      // El corte es el día del calendario y no las 24 horas, que es lo que
      // hace que esto diga «ayer» y no «14:32» ni «hace un rato».
      expect(
        tiempoRelativo("2026-08-19T23:59:00", new Date("2026-08-20T00:01:00")),
      ).toBe("ayer");
    });
  });

  describe("borde 2 · ayer a las 23:59", () => {
    it("dice «ayer», no el nombre del día", () => {
      expect(tiempoRelativo("2026-08-19T23:59:00", jueves2032())).toBe("ayer");
    });

    it("y ayer a las 00:00 también", () => {
      expect(tiempoRelativo("2026-08-19T00:00:00", jueves2032())).toBe("ayer");
    });
  });

  describe("borde 3 · el salto de semana", () => {
    it("a los dos días ya es el nombre del día", () => {
      expect(tiempoRelativo("2026-08-18T09:00:00", jueves2032())).toBe("mar");
    });

    it("a los seis días todavía es el nombre del día", () => {
      expect(tiempoRelativo("2026-08-14T09:00:00", jueves2032())).toBe("vie");
    });

    it("a los siete pasa a fecha, porque el día se llamaría igual que hoy", () => {
      // Es el borde entero: `2026-08-13` es jueves y hoy también. «jue» de un
      // jueves de hace una semana es la misma mentira que arregla este ticket.
      expect(tiempoRelativo("2026-08-13T09:00:00", jueves2032())).toBe("13 ago");
    });
  });

  it("lo viejo va con fecha, que es el caso más común de esta bandeja", () => {
    // 955 de las 1.760 conversaciones de producción tienen más de un mes sin
    // actividad, y aparecen en la lista por estar sin responder.
    expect(tiempoRelativo("2026-07-30T09:00:00", jueves2032())).toBe("30 jul");
  });

  it("lo de otro año lleva el año, que el spec no pedía y la bandeja sí", () => {
    expect(tiempoRelativo("2025-12-24T09:00:00", jueves2032())).toBe(
      "24 dic 2025",
    );
  });

  it("una fecha que no se puede leer no inventa una", () => {
    expect(tiempoRelativo("no es una fecha", jueves2032())).toBe("—");
  });

  it("el reloj del asesor atrasado no produce «en tres días»", () => {
    expect(tiempoRelativo("2026-08-21T09:00:00", jueves2032())).toBe("09:00");
  });
});

describe("la fila dice su tiempo, no siempre la hora", () => {
  const haceUnRato = new Date();
  const haceTresSemanas = new Date(haceUnRato.getTime() - 21 * 86_400_000);

  it("separa lo de hoy de lo de hace tres semanas", () => {
    // Es la mezcla que la bandeja hace **a propósito**: las 200 más recientes
    // por actividad y **todas** las que están sin responder, que son mucho más
    // viejas. Hasta hoy las dos filas decían `14:32`.
    abrir([
      chat({ id: "c-hoy", lastAt: haceUnRato.toISOString() }),
      chat({ id: "c-vieja", lastAt: haceTresSemanas.toISOString() }),
    ]);

    expect(within(fila("c-hoy")).getByTitle(/·/).textContent).toMatch(
      /^\d{2}:\d{2}$/,
    );
    expect(within(fila("c-vieja")).getByTitle(/·/).textContent).toMatch(
      /^\d{1,2} [a-zé]{3}$/,
    );
  });

  it("el día exacto sigue estando, para el que se detiene en una fila", () => {
    abrir([chat({ id: "c-vieja", lastAt: haceTresSemanas.toISOString() })]);

    expect(
      within(fila("c-vieja")).getByTitle(
        new RegExp(`^${haceTresSemanas.getDate()} [a-zé]{3} \\d{4} · `),
      ),
    ).toBeInTheDocument();
  });
});

/** Las etiquetas de estado de una fila, tal como se leen. */
function etiquetasDe(id: string): string[] {
  return [...fila(id).querySelectorAll(".state-chip")].map(
    (e) => e.textContent ?? "",
  );
}

/**
 * **La regla del corte: solo lo que pide hacer algo, y en el teléfono dos.**
 *
 * Es lógica pura y por eso se prueba contra la función y no contra píxeles: el
 * corte a dos lo aplica el CSS —en escritorio la fila las sigue mostrando
 * todas— y una prueba en jsdom no puede ver un `display:none` de una media
 * query. Lo que sí decide esta función, y es lo que el veredicto votó, es
 * **cuáles hay y en qué orden**: mostrar dos sin decidir cuáles no es una regla.
 */
describe("qué etiquetas le tocan a una fila", () => {
  const nombres = (it: ChatItem) => estadosDeLaFila(it).map((e) => e.label);

  /**
   * **La fila más cargada que se puede armar, que lleva cuatro y no cinco.**
   *
   * Las etiquetas son cinco, pero dos de ellas **no pueden salir juntas**: «sin
   * responder» implica el agente apagado (`puedeEstarSinResponder`, en
   * `@wa/db`) y «lo llevo yo» es precisamente eso, así que la segunda se calla
   * cuando está la primera. El techo real de la tira es cuatro.
   *
   * Está escrito acá porque es lo que hace que el `+N` de la fila tenga el
   * número que tiene, y porque una prueba que pidiera cinco estaría pidiendo un
   * estado que la base no puede producir.
   */
  const LA_MAS_CARGADA = chat({
    id: "c-cargada",
    agentMode: false,
    escalada: true,
    dropiHasNovedad: true,
    confirmationStatus: "pending",
    sinResponder: true,
  });

  it("una fila sin nada que hacer no lleva ninguna", () => {
    // Es más agresivo de lo que suena, y es exactamente lo que deja recorrer la
    // bandeja con la vista: lo que se ve son las que piden algo.
    expect(nombres(chat())).toEqual([]);
  });

  it("las ordena de la más rara a la más común, que es el criterio del corte", () => {
    expect(nombres(LA_MAS_CARGADA)).toEqual([
      "escalada",
      "novedad",
      "por confirmar",
      "sin responder",
    ]);
  });

  it("con la fila más cargada, el teléfono enseña dos y cuenta dos", () => {
    const todas = nombres(LA_MAS_CARGADA);

    expect(todas.slice(0, ETIQUETAS_EN_EL_TELEFONO)).toEqual([
      "escalada",
      "novedad",
    ]);
    expect(todas.length - ETIQUETAS_EN_EL_TELEFONO).toBe(2);
  });

  it("«lo llevo yo» se calla cuando la fila ya dice «sin responder»", () => {
    // La segunda implica la primera: `sinResponder` exige el agente apagado. Sin
    // esta resta, «lo llevo yo» —que ordena primero, por rara— le comería uno de
    // los dos puestos del teléfono a la etiqueta que hay que ver.
    expect(nombres(chat({ agentMode: false, sinResponder: true }))).toEqual([
      "sin responder",
    ]);
    expect(nombres(chat({ agentMode: false }))).toEqual(["lo llevo yo"]);
  });

  it("los dos que enseña son los menos frecuentes, no los dos primeros", () => {
    // «Sin responder» sale en el 15% de las filas y «escalada» en el 1,8%: la
    // que hay que mirar es la escalada, aunque haya más filas de la otra. Un
    // orden de lectura fijo se habría quedado con la equivocada.
    expect(
      nombres(chat({ sinResponder: true, escalada: true })).slice(
        0,
        ETIQUETAS_EN_EL_TELEFONO,
      ),
    ).toEqual(["escalada", "sin responder"]);
  });

  it("y la fila lo dibuja: el «+N» dice cuántas quedaron fuera", () => {
    abrir([LA_MAS_CARGADA]);

    expect(within(fila("c-cargada")).getByText("+2")).toBeInTheDocument();
  });

  it("con dos o menos no hay «+N» que poner", () => {
    abrir([chat({ id: "c-dos-estados", sinResponder: true, escalada: true })]);

    expect(within(fila("c-dos-estados")).queryByText(/^\+\d+$/)).toBeNull();
  });
});

describe("las etiquetas de estado", () => {
  it("ningún estado se codifica solo con color: los cinco llevan su nombre", () => {
    // Era criterio de aceptación de la ronda y es lo que hizo ganar esta
    // variante. Hasta hoy se incumplía de forma literal: «sin responder» era
    // `border-l-2 border-l-red-400/60`, una rayita roja y nada más.
    abrir([
      chat({ id: "c-espera", sinResponder: true }),
      chat({ id: "c-mio", agentMode: false }),
      chat({ id: "c-escalada", escalada: true }),
      chat({ id: "c-novedad", dropiHasNovedad: true }),
      chat({ id: "c-porconfirmar", confirmationStatus: "pending" }),
    ]);

    expect(etiquetasDe("c-espera")).toEqual(["sin responder"]);
    expect(etiquetasDe("c-mio")).toEqual(["lo llevo yo"]);
    expect(etiquetasDe("c-escalada")).toEqual(["escalada"]);
    expect(etiquetasDe("c-novedad")).toEqual(["novedad"]);
    expect(etiquetasDe("c-porconfirmar")).toEqual(["por confirmar"]);
  });

  it("«en automático» se invirtió: se marca la que NO lo está", () => {
    // Salía en 199 de cada 200 filas, así que marcaba la regla en vez de la
    // excepción. Lo informativo es la conversación que alguien tomó a mano.
    abrir([
      chat({ id: "c-automatica", agentMode: true }),
      chat({ id: "c-a-mano", agentMode: false }),
    ]);

    expect(etiquetasDe("c-automatica")).toEqual([]);
    expect(etiquetasDe("c-a-mano")).toEqual(["lo llevo yo"]);
  });

  it("«confirmado» dejó de ser etiqueta, y sigue estando en el detalle", () => {
    // Sale en el 68,5% de las filas: un chip que llevan casi todas no dice
    // nada. Baja a la tira de detalle, que el teléfono no dibuja y el
    // escritorio sí — no se pierde, deja de competir.
    abrir([chat({ id: "c-confirmada", confirmationStatus: "confirmed" })]);

    expect(etiquetasDe("c-confirmada")).toEqual([]);
    expect(
      within(fila("c-confirmada")).getByText("confirmado"),
    ).toBeInTheDocument();
  });

  it("«por confirmar» sí es etiqueta, y entonces no se dice dos veces", () => {
    // Es el mismo trato que «novedad» tenía con la pastilla de logística: el
    // mismo hecho en la misma tira, una sola vez.
    abrir([chat({ id: "c-pendiente", confirmationStatus: "pending" })]);

    expect(etiquetasDe("c-pendiente")).toEqual(["por confirmar"]);
    expect(within(fila("c-pendiente")).queryByText("pendiente")).toBeNull();
  });

  it("la novedad de logística no se dice dos veces en la misma fila", () => {
    abrir([
      chat({ id: "c-novedad", dropiStatus: "novedad", dropiHasNovedad: true }),
    ]);

    expect(etiquetasDe("c-novedad")).toEqual(["novedad"]);
    expect(within(fila("c-novedad")).getAllByText("novedad")).toHaveLength(1);
  });
});

/**
 * **«Tú:» delante de la vista previa cuando el último mensaje es nuestro.**
 *
 * En 874 de las 1.770 conversaciones la fila mostraba lo que escribimos
 * nosotros y se leía igual que si lo hubiera escrito el cliente: «me escribió y
 * no le contesté» y «ya le contesté» eran la misma fila.
 */
describe("de quién es la vista previa", () => {
  /** La vista previa entera, con su prefijo si lo lleva. */
  const previa = (id: string) =>
    fila(id).querySelectorAll("p")[1]!.textContent;

  it("lo nuestro va con «Tú:» y lo del cliente va sin nada", () => {
    abrir([
      chat({ id: "c-mia", preview: "ya te confirmo la guía", previewEsNuestro: true }),
      chat({ id: "c-suya", preview: "¿ya salió mi pedido?" }),
    ]);

    expect(previa("c-mia")).toBe("Tú: ya te confirmo la guía");
    expect(previa("c-suya")).toBe("¿ya salió mi pedido?");
  });

  it("un entrante lo apaga: el cliente acaba de escribir", async () => {
    // `aplicarEvento` no sabe de este campo, así que sin esto la fila seguiría
    // diciendo «Tú:» con el texto del cliente encima — la confusión exacta que
    // la palabra vino a deshacer. Que el contador de no leídos suba es la
    // prueba de que escribió el cliente: sube en un solo sitio del worker.
    abrir([
      chat({ id: "c-mia", preview: "ya te confirmo la guía", previewEsNuestro: true }),
    ]);
    expect(previa("c-mia")).toBe("Tú: ya te confirmo la guía");

    act(() => {
      emitirWa(
        entrante("c-mia", {
          lastMessagePreview: "sigo esperando",
          unreadCount: 1,
        }),
      );
    });

    await waitFor(() => expect(previa("c-mia")).toBe("sigo esperando"));
  });
});

/** Los encabezados dentro de la lista. **Desde el 21-ago-2026 siempre está
 *  vacío**, y por eso sigue existiendo: es lo que afirma que la bandeja no se
 *  parte en dos. Ver el describe de abajo. */
function seccionesDeLaLista(): string[] {
  return within(screen.getByRole("list"))
    .queryAllByRole("heading")
    .map((h) => h.textContent!.replace(/\s+/g, " ").trim());
}

/**
 * Seis esperando respuesta y tres que no, **en el orden del servidor**: por
 * actividad, y con las que esperan repartidas entre las otras. Es la forma que
 * tiene la lista de producción, donde las sin responder entran aunque se hayan
 * salido del corte por actividad y quedan mezcladas entre las recientes.
 */
const SEIS_Y_TRES = [
  chat({ id: "c-espera-0", sinResponder: true, lastAt: "2026-08-20T11:00:00.000Z" }),
  chat({ id: "c-resto-0", lastAt: "2026-08-20T10:00:00.000Z" }),
  chat({ id: "c-espera-1", sinResponder: true, lastAt: "2026-08-20T09:00:00.000Z" }),
  chat({ id: "c-espera-2", sinResponder: true, lastAt: "2026-08-19T09:00:00.000Z" }),
  chat({ id: "c-resto-1", lastAt: "2026-08-18T09:00:00.000Z" }),
  chat({ id: "c-espera-3", sinResponder: true, lastAt: "2026-08-17T09:00:00.000Z" }),
  chat({ id: "c-resto-2", lastAt: "2026-08-16T09:00:00.000Z" }),
  chat({ id: "c-espera-4", sinResponder: true, lastAt: "2026-07-30T09:00:00.000Z" }),
  chat({ id: "c-espera-5", sinResponder: true, lastAt: "2026-07-02T09:00:00.000Z" }),
];

describe("la bandeja va por actividad, sin partirse en dos", () => {
  /*
    Hasta el 21-ago-2026 las que esperaban respuesta iban en una sección propia
    arriba de todo. Lo pidió cambiar la operación de Vorare y la medición le dio
    la razón: de las 85 que esperaban respuesta, **65 tenían más de un mes**.
    Chats viejos que nadie iba a contestar, arriba todos los días, empujando
    hacia abajo lo que sí se trabaja.
  */

  it("no dibuja encabezados: la lista es una sola", () => {
    abrir(SEIS_Y_TRES);

    expect(seccionesDeLaLista()).toEqual([]);
  });

  it("las que esperan no suben: manda el orden del servidor", () => {
    // Es el orden en el que llegan, que es por actividad. Las que esperan
    // quedan repartidas entre las demás, cada una en la fecha que le toca.
    abrir(SEIS_Y_TRES);

    expect(ordenDeLaLista()).toEqual([
      "c-espera-0", "c-resto-0", "c-espera-1",
      "c-espera-2", "c-resto-1", "c-espera-3",
      "c-resto-2", "c-espera-4", "c-espera-5",
    ]);
  });

  it("una que espera y es reciente sigue arriba, porque es reciente", () => {
    // El argumento de que no se pierde nada al quitar la sección: lo que la
    // subía era la fecha, no el grupo.
    abrir(SEIS_Y_TRES);

    expect(ordenDeLaLista()[0]).toBe("c-espera-0");
  });

  it("y las que esperan desde julio caen al fondo, que es lo que se pedía", () => {
    abrir(SEIS_Y_TRES);

    expect(ordenDeLaLista().slice(-2)).toEqual(["c-espera-4", "c-espera-5"]);
  });

  it("con la bandeja vacía no hay nada que anunciar", () => {
    abrir([]);

    expect(seccionesDeLaLista()).toEqual([]);
    expect(screen.getByText("No hay conversaciones todavía.")).toBeInTheDocument();
  });

  it("las que esperan siguen a un toque, en el filtro", async () => {
    // Quitarles la sección no las esconde: el filtro las junta cuando el asesor
    // decide mirarlas, que es la diferencia entre ofrecerlas y imponerlas.
    const user = userEvent.setup();
    abrir(SEIS_Y_TRES);

    await user.click(filtro("Sin responder"));

    expect(
      within(screen.getByRole("list")).getAllByRole("listitem"),
    ).toHaveLength(6);
    expect(seccionesDeLaLista()).toEqual([]);
  });
});

describe("la barra de filtros lleva la cuenta", () => {
  it("dice cuántas hay de cada vista, y cuál está puesta", () => {
    abrir(SEIS_Y_TRES);

    expect(cuentaDelFiltro("Todas")).toBe("9");
    expect(cuentaDelFiltro("Sin responder")).toBe("6");
    expect(filtroPuesto()).toBe("Todas 9");
  });

  it("pulsar uno lo pone, y la lista hace lo que dice", async () => {
    const user = userEvent.setup();
    abrir(SEIS_Y_TRES);

    await user.click(filtro("Sin responder"));

    expect(filtroPuesto()).toBe("Sin responder 6");
  });

  it("con la bandeja vacía no hay filtro, y sí título y cartel", () => {
    // Un filtro sobre cero filas no filtra, y cinco ceros seguidos se leen como
    // una avería. Lo que queda es lo que explica la pantalla.
    abrir([]);

    expect(screen.queryByRole("button", { pressed: true })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Inbox", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No hay conversaciones todavía."),
    ).toBeInTheDocument();
  });
});

describe("un evento en vivo no mueve la fila bajo el cursor", () => {
  /**
   * Dos esperando desde julio y dos de hoy: es la forma de la bandeja real.
   *
   * `c-nueva` va con el agente apagado porque es la que va a recibir el
   * entrante, y **un entrante no puede encender «sin responder» en una que
   * lleva el agente**: es la primera de las tres condiciones de
   * `puedeEstarSinResponder` (`@wa/db`), y `aplicarEvento` la respeta.
   */
  const DOS_Y_DOS = [
    chat({ id: "c-espera", sinResponder: true, lastAt: "2026-07-01T09:00:00.000Z" }),
    chat({ id: "c-espera-2", sinResponder: true, lastAt: "2026-07-01T08:00:00.000Z" }),
    chat({ id: "c-quieta", lastAt: "2026-08-20T11:00:00.000Z" }),
    chat({
      id: "c-nueva",
      agentMode: false,
      lastAt: "2026-08-20T10:00:00.000Z",
    }),
  ];

  it("un entrante enciende la etiqueta sin mover la fila", async () => {
    // Es el bug de PRO-12: la fila no puede saltar de puesto con el cursor
    // encima. La etiqueta sí cambia —la fila dice lo que es, donde está—, y
    // reordenar es una decisión del asesor, no del stream.
    abrir(DOS_Y_DOS);

    act(() => {
      emitirWa(
        entrante("c-nueva", {
          lastMessagePreview: "hola, ¿siguen abiertos?",
          unreadCount: 1,
          lastActivityAt: "2026-08-20T12:00:00.000Z",
        }),
      );
    });

    // La etiqueta sí aparece: la fila dice lo que es, donde está. Y reemplaza a
    // «lo llevo yo», que la fila llevaba por tener el agente apagado: «sin
    // responder» ya lo dice, y el mismo hecho dos veces en la misma tira no
    // informa el doble.
    await waitFor(() =>
      expect(etiquetasDe("c-nueva")).toEqual(["sin responder"]),
    );
    expect(ordenDeLaLista()).toEqual([
      "c-espera", "c-espera-2", "c-quieta", "c-nueva",
    ]);
    expect(seccionesDeLaLista()).toEqual([]);
  });

  it("y ponerse al día reordena por fecha, no por quién espera", async () => {
    const user = userEvent.setup();
    abrir(DOS_Y_DOS);

    act(() => {
      emitirWa(
        entrante("c-nueva", {
          unreadCount: 1,
          lastActivityAt: "2026-08-20T12:00:00.000Z",
        }),
      );
    });
    await screen.findByText(/1 conversación con novedades/);

    await user.click(screen.getByRole("button", { name: /novedades/ }));

    expect(seccionesDeLaLista()).toEqual([]);
    // Acá se ve la queja del cliente resuelta: las dos que esperan desde julio
    // caen al fondo, y arriba quedan las dos de hoy. Antes se sentaban encima.
    expect(ordenDeLaLista()).toEqual([
      "c-nueva", "c-quieta", "c-espera", "c-espera-2",
    ]);
  });
});

describe("los tres números de «sin responder» dicen lo mismo", () => {
  /**
   * Es el criterio que este repo ya pagó caro: hasta el 19-ago-2026 el cliente
   * lo calculaba como `!agentMode && unread > 0`, y de las 54 que marcaba **30
   * ya habían sido respondidas**. Ahora lo decide el servidor y acá se lee el
   * mismo campo tres veces, así que no pueden discrepar — pero eso hay que
   * seguir sin romperlo, y esto es lo que lo vigila.
   *
   * Los tres eran la etiqueta, la tarjeta y el selector. La tarjeta y el
   * selector se fundieron en el botón del filtro, así que ahora el tercero es
   * **la lista filtrada**: que el número diga 6 y al pulsarlo se vean 6.
   */
  it("la etiqueta, el contador del filtro y la lista filtrada cuentan igual", async () => {
    const user = userEvent.setup();
    abrir(SEIS_Y_TRES);

    const conEtiqueta = within(screen.getByRole("list")).getAllByText(
      "sin responder",
    );
    expect(conEtiqueta).toHaveLength(6);
    expect(cuentaDelFiltro("Sin responder")).toBe("6");

    await user.click(filtro("Sin responder"));

    expect(
      within(screen.getByRole("list")).getAllByRole("listitem"),
    ).toHaveLength(6);
  });

  it("y siguen contando igual después de un entrante", async () => {
    abrir([
      chat({ id: "c-espera", sinResponder: true }),
      // Con el agente apagado: si lo llevara, el entrante no la encendería.
      chat({ id: "c-nueva", agentMode: false }),
    ]);

    act(() => {
      emitirWa(entrante("c-nueva", { unreadCount: 1 }));
    });

    await waitFor(() =>
      expect(
        within(screen.getByRole("list")).getAllByText("sin responder"),
      ).toHaveLength(2),
    );
    expect(cuentaDelFiltro("Sin responder")).toBe("2");
  });
});


describe("la línea de contexto", () => {
  it("dice en qué operación y en qué bandeja está, encima del título", () => {
    // En la pantalla desde la que salen mensajes a clientes de Guatemala, el
    // único indicio del país era una bandera de 8×30 px en un riel que se
    // pliega.
    abrir();

    const contexto = screen.getByText(/Vorare Store Guatemala/);
    expect(contexto.textContent).toBe("Vorare Store Guatemala · Confirmación");
    expect(
      contexto.compareDocumentPosition(
        screen.getByRole("heading", { name: "Inbox", level: 1 }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
