import { describe, expect, it } from "vitest";
import { resolveInbox, type OrderFacts } from "@wa/db";
import { resolveConversationOwner } from "../sales/owner";
import { decideNewContactAgentMode } from "./agent-mode";
import { updatesForExistingContact } from "./contacts";

// ────────────────────────────────────────────────────────────────────────────
// El interruptor que decide si al agente se le pregunta
// ────────────────────────────────────────────────────────────────────────────
//
// Se prueba sobre la cadena real —nacimiento → bandeja → dueño → guardia—
// porque el error posible no está dentro de ninguna de las cuatro piezas, sino
// en cómo se encadenan: hoy el dueño se deriva bien y el vendedor está
// construido, y aun así el lead no recibe respuesta porque el interruptor nace
// apagado y nadie lo enciende antes de que exista un pedido.

const AHORA = new Date("2026-08-18T10:00:00.000Z");
const HACE_UN_MES = new Date("2026-07-18T10:00:00.000Z");

/** Un pedido de julio que la logística todavía está moviendo. */
const PEDIDO_EN_CURSO: OrderFacts = {
  createdAt: HACE_UN_MES,
  pipelineStatus: "confirmed",
  logisticsStatus: "en_transito",
};

const SIN_PEDIDOS: readonly OrderFacts[] = [];

/**
 * La línea de corte que el pipeline le pasa al ruteo: el vendedor se encendió
 * antes de que llegara este mensaje, así que la conversación que nace ahora es
 * suya. Sin corte —producción hoy— nada cae en la bandeja de ventas, y eso es
 * justo lo que prueba el primer bloque.
 */
const ENCENDIDO = new Date("2026-06-01T10:00:00.000Z");

/** Una conversación de las de siempre: más vieja que el vendedor. */
const ANTES_DEL_VENDEDOR = new Date("2026-04-30T10:00:00.000Z");

/** La fila de `contacts` en lo único que este ticket mira. */
interface Contacto {
  agentMode: boolean;
}

/**
 * Un mensaje entrante, encadenado como lo encadena el pipeline.
 *
 * `contacto: null` es un número desconocido — el caso que este ticket vino a
 * atender: la fila se crea en este mismo mensaje y ahí se decide su
 * `agent_mode`. Con un contacto dado, la fila ya existía y ninguna regla de
 * nacimiento la toca.
 *
 * `contesta` es el guardia de `pipeline.ts` puesto en palabras: quién le
 * responde al cliente, o `null` si no le responde nadie.
 */
function mensajeEntrante(input: {
  contacto: Contacto | null;
  vendedor: boolean;
  clicDeAnuncio?: Date | null;
  pedidos?: readonly OrderFacts[];
  /** Cuándo nació la conversación. Por defecto, con este mensaje. */
  nacidaEl?: Date;
}) {
  const nacimiento = input.contacto
    ? null
    : decideNewContactAgentMode({
        origin: "inbound_message",
        salesAgentConfigured: input.vendedor,
      });
  const contacto: Contacto = input.contacto ?? {
    agentMode: nacimiento!.agentMode,
  };

  const pedidos = input.pedidos ?? SIN_PEDIDOS;
  const inbox = resolveInbox(
    { lastAdClickAt: input.clicDeAnuncio ?? null, orders: pedidos },
    {
      activatedAt: input.vendedor ? ENCENDIDO : null,
      // La conversación de un número desconocido nace con este mensaje; la de
      // un contacto que ya existía es anterior, y por eso su caso se escribe
      // con el nacimiento puesto a mano.
      bornAt: input.nacidaEl ?? AHORA,
    },
  );
  const owner = input.vendedor
    ? resolveConversationOwner({
        salesAgentConfigured: true,
        inbox: inbox.inbox,
      })
    : resolveConversationOwner({ salesAgentConfigured: false });

  return {
    nacimiento,
    contacto,
    inbox,
    owner,
    contesta: contacto.agentMode ? owner.agent : null,
  };
}

// ────────────────────────────────────────────────────────────────────────────

describe("sin vendedor configurado · Guatemala no cambia en nada", () => {
  // El criterio que manda sobre todos los demás. Hoy hay **dos** guardias sobre
  // el mismo hecho —que no hay vendedor—: el del nacimiento, que deja el
  // `agent_mode` apagado, y la línea de corte, que sin `activated_at` deja la
  // bandeja de ventas vacía. Cualquiera de los dos basta para que un contacto
  // nuevo no reciba nada, y los dos están puestos.
  const combinaciones = [
    { nombre: "escribe por primera vez", clic: null, pedidos: SIN_PEDIDOS },
    { nombre: "llega desde un anuncio", clic: AHORA, pedidos: SIN_PEDIDOS },
  ];

  for (const caso of combinaciones) {
    it(`el contacto nuevo que ${caso.nombre} nace con el agente apagado`, () => {
      const { nacimiento } = mensajeEntrante({
        contacto: null,
        vendedor: false,
        clicDeAnuncio: caso.clic,
        pedidos: caso.pedidos,
      });
      expect(nacimiento).toEqual({ agentMode: false, rule: "no_sales_agent" });
    });

    it(`y a ese contacto no le contesta nadie, igual que hoy (${caso.nombre})`, () => {
      const { contesta } = mensajeEntrante({
        contacto: null,
        vendedor: false,
        clicDeAnuncio: caso.clic,
        pedidos: caso.pedidos,
      });
      expect(contesta).toBeNull();
    });
  }

  it("el dueño derivado sigue siendo el agente de confirmación", () => {
    const { owner } = mensajeEntrante({ contacto: null, vendedor: false });
    expect(owner).toEqual({ agent: "confirmacion", rule: "no_sales_agent" });
  });

  it("y el contacto de siempre —con pedido y el agente encendido— sigue siendo de Katherine", () => {
    // La conversación que hoy factura: llegó el pedido, la plantilla encendió
    // el interruptor, y desde entonces contesta el agente de confirmación.
    const { contesta } = mensajeEntrante({
      contacto: { agentMode: true },
      vendedor: false,
      pedidos: [PEDIDO_EN_CURSO],
    });
    expect(contesta).toBe("confirmacion");
  });
});

describe("con vendedor configurado · el lead nuevo llega al agente", () => {
  it("el contacto nuevo nace con el agente encendido", () => {
    const { nacimiento } = mensajeEntrante({ contacto: null, vendedor: true });
    expect(nacimiento).toEqual({ agentMode: true, rule: "new_lead" });
  });

  it("y le contesta el vendedor desde el primer mensaje", () => {
    // Es el ticket entero: hoy este mismo lead nace apagado, así que al agente
    // no se le pregunta y Sebastián no contesta por bien configurado que esté.
    const { contesta, inbox } = mensajeEntrante({
      contacto: null,
      vendedor: true,
    });
    expect(inbox).toEqual({ inbox: "ventas", rule: "born_after_activation" });
    expect(contesta).toBe("ventas");
  });

  it("también cuando llega desde un anuncio", () => {
    const { contesta } = mensajeEntrante({
      contacto: null,
      vendedor: true,
      clicDeAnuncio: AHORA,
    });
    expect(contesta).toBe("ventas");
  });
});

describe("un contacto que ya existe no cambia de estado nunca por esta regla", () => {
  // Se cumple por construcción —el nacimiento solo ocurre en el `INSERT`—, pero
  // queda fijado acá porque el que venga puede mover la regla de lugar sin ver
  // qué sostenía.

  it("lo único que se le reescribe a un contacto existente es el nombre", () => {
    const parche = updatesForExistingContact(
      { pushName: "Ana", name: null },
      { pushName: "Ana María", name: "Ana Pérez" },
    );
    expect(Object.keys(parche).sort()).toEqual(["name", "pushName"]);
    expect(parche).toEqual({ pushName: "Ana María", name: "Ana Pérez" });
  });

  it("y cuando no hay nombre nuevo, no se le reescribe nada", () => {
    const parche = updatesForExistingContact(
      { pushName: "Ana", name: "Ana Pérez" },
      { pushName: "Ana", name: "Otro" },
    );
    expect(Object.keys(parche)).toEqual([]);
  });

  it("un asesor que apagó el agente no lo ve volver, ni con un clic de anuncio nuevo", () => {
    // El recomprador que un humano silenció: la conversación **es** del
    // vendedor —la bandeja y el dueño lo dicen— y aun así no le contesta nadie,
    // porque el interruptor del contacto lo apagó una persona y este ticket no
    // toca el guardia.
    const { owner, contesta } = mensajeEntrante({
      contacto: { agentMode: false },
      vendedor: true,
      clicDeAnuncio: AHORA,
      pedidos: [PEDIDO_EN_CURSO],
    });
    expect(owner.agent).toBe("ventas");
    expect(contesta).toBeNull();
  });

  it("y uno que ya lo tenía encendido sigue atendido", () => {
    // Su conversación es más vieja que el corte —el contacto ya existía—, así
    // que lo que la trae a la bandeja de ventas es el clic de anuncio nuevo, no
    // el nacimiento. Es el caso que la regla 5 cubre y que la del recomprador
    // no alcanza: este contacto nunca compró.
    const { contesta, inbox } = mensajeEntrante({
      contacto: { agentMode: true },
      vendedor: true,
      clicDeAnuncio: AHORA,
      nacidaEl: ANTES_DEL_VENDEDOR,
    });
    expect(inbox).toEqual({
      inbox: "ventas",
      rule: "ad_click_after_activation",
    });
    expect(contesta).toBe("ventas");
  });
});

describe("un contacto que nace de un pedido de la tienda", () => {
  it("nace con el agente apagado, como hoy", () => {
    // El tipo ni siquiera deja pasarle la configuración del vendedor: su
    // respuesta no depende de ella, y el receptor de pedidos —por donde entran
    // los que facturan— no gana ni una lectura de más. El interruptor de un
    // contacto con pedido lo encienden `followup` y `confirmation-ack`, este
    // último detrás de la perilla `activate_agent_on_confirm` del admin.
    expect(decideNewContactAgentMode({ origin: "store_order" })).toEqual({
      agentMode: false,
      rule: "born_from_order",
    });
  });
});
