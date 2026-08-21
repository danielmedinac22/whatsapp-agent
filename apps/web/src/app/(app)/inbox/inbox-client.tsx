"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildReopenOptions, type ReopenOption } from "@/lib/reopen";
// Del subcamino y no del barril: `@wa/db` arrastra el cliente de la base y
// `node:fs`, y esto es un componente de cliente. `sales-context` y
// `bandeja-viva` son puros.
import {
  escalationPhrase,
  isSalesEscalation,
  type SalesThreadEvent,
} from "@wa/db/sales-context";
import {
  aplicarEvento,
  reordenarPorActividad,
} from "@wa/db/bandeja-viva";
import type { WaEvent } from "@wa/shared";
import { ContextLine } from "../context-line";
import { VoiceRecorder } from "./voice-recorder";
import { tiempoCompleto, tiempoRelativo } from "./tiempo-relativo";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Building2,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  CircleDashed,
  FileText,
  HelpCircle,
  Hand,
  MessageSquareText,
  Package,
  Search,
  Send,
  Sparkles,
  Truck,
  Undo2,
  X,
  XCircle,
} from "lucide-react";

export type ConfirmationStatus =
  | "unknown"
  | "pending"
  | "confirmed"
  | "not_confirmed";

export type DropiStatus =
  | "unknown"
  | "pendiente_confirmacion"
  | "pendiente"
  | "guia_generada"
  | "preparado_transportadora"
  | "recolectado"
  | "en_transito"
  | "con_mensajero"
  | "en_oficina"
  | "entregado"
  | "novedad"
  | "novedad_solucionada"
  | "devolucion"
  | "rechazado"
  | "retornado"
  | "anulada";

export type ChatItem = {
  id: string;
  contactId: string;
  /** Destination wa_id (E.164 digits, sin "+"). */
  to: string;
  name: string;
  /** Último mensaje del cliente — define la ventana de 24h de Meta. */
  lastInboundAt: string | null;
  novedadReason: string | null;
  orderNumber: string | null;
  producto: string | null;
  agentMode: boolean;
  /** El último mensaje que enviamos no se entregó. */
  deliveryFailed: boolean;
  preview: string | null;
  unread: number;
  confirmationStatus: ConfirmationStatus;
  confirmationSource: "auto" | "manual" | null;
  lastAt: string;
  dropiStatus: DropiStatus | null;
  dropiHasNovedad: boolean;
  dropiGuide: string | null;
  dropiCarrier: string | null;
  dropiPdfUrl: string | null;
  /** Quién la está trabajando, o `null` si está libre. */
  assignedTo: { id: string; label: string } | null;
  /**
   * Está esperando que una persona conteste. Lo decide el servidor con
   * `sinResponder` (`@wa/db`) sobre **todas** las conversaciones de la
   * operación, no sobre las que se ven; la lista trae siempre las que dan
   * `true`, aunque queden fuera del corte por actividad, para que la tarjeta y
   * las filas cuenten lo mismo.
   */
  sinResponder: boolean;
  /**
   * El vendedor pasó la conversación a una persona. Lo decide el servidor sobre
   * las escaladas de la conversación (`page.tsx`).
   *
   * **Era `mark: RowMark | null`**, con tres valores: `escalada`, `ambiguo` y
   * `sin_identificar`. Los dos últimos no se dibujan más —ver
   * {@link ESTADOS_DE_LA_FILA}—, y sin ellos `resolveRowMark` se quedaba con
   * una sola rama viva: una unión de un solo miembro es un booleano con pasos
   * de más. Se retiró de `@wa/db` con este ticket.
   */
  escalada: boolean;
  /**
   * **El último mensaje lo escribimos nosotros**, así que {@link ChatItem.preview}
   * es nuestro y la fila lo dice con «Tú:».
   *
   * En 874 de las 1.770 conversaciones (49,4%) la vista previa es nuestra y se
   * leía igual que si la hubiera escrito el cliente: Katherine no podía separar
   * «me escribió y no le contesté» de «ya le contesté» sin abrir la
   * conversación.
   *
   * Lo deriva el servidor de `last_outbound_at > last_inbound_at`, y no es una
   * aproximación: la vista previa y la fecha del saliente se escriben **en la
   * misma sentencia** (`huellaDelSaliente`, en el worker), así que la más
   * reciente de las dos fechas dice de quién es el texto.
   */
  previewEsNuestro: boolean;
};

type FilterKey =
  | "all"
  | "pending"
  | "confirmed"
  | "not_confirmed"
  /** Las que esperan que una persona conteste. Lo decide el servidor: acá solo
   *  se lee `it.sinResponder`, para que la fila, la tarjeta y el contador de la
   *  barra no puedan discrepar. */
  | "sin_responder"
  /** Las que lleva el agente. En la bandeja de ventas es «En automático», una
   *  de las tres vistas de la barra. */
  | "automated";

/**
 * **Los estados de la fila: solo los que piden hacer algo, cada uno con su
 * nombre escrito.**
 *
 * Del nivel 3 se conserva el aspecto —relleno, 800, versalitas, y **ningún
 * estado codificado solo con color**, que fue criterio de aceptación— y cambia
 * lo único que el nivel 4 puso en duda: **cuáles se dibujan**. No lo decidió el
 * gusto, lo decidió la medición del 20-ago-2026 sobre las 200 filas que la
 * lista trae:
 *
 * | estado | sale en | se dibuja |
 * | -- | -- | -- |
 * | lo llevo yo | 0,5% | sí |
 * | escalada | 1,8% | sí |
 * | novedad | 2,1% | sí |
 * | por confirmar | 10,5% | sí |
 * | sin responder | ~15% | sí |
 * | confirmado | 68,5% | **no** |
 * | ventana cerrada | 86% | **no** |
 * | en automático | 99,5% | **no** |
 *
 * **Un chip que llevan casi todas las filas no dice nada: su ausencia informa
 * más que su presencia.** Los tres de abajo le estaban disputando el sitio a
 * los de arriba, que son los que mandan a hacer algo y son justamente los más
 * raros. Una fila tranquila no lleva ninguno —es más agresivo de lo que suena—
 * y eso es lo que deja recorrer la bandeja con la vista, que es el problema que
 * originó el mapa entero. Se aceptó a sabiendas que se pierde la confirmación
 * de un vistazo.
 *
 * Los tres que dejan de dibujarse **no dejan de existir**: «confirmado» y la
 * guía siguen en la tira de detalle, que en el teléfono no se dibuja y en
 * escritorio sí.
 *
 * `en automático` no se retiró: **se invirtió**. Marcaba la regla —199 de 200
 * filas— en vez de la excepción, y lo informativo es la conversación que
 * alguien tomó a mano.
 *
 * `sin producto` y `ambiguo` sí se retiraron enteras, y no por frecuentes sino
 * al revés: **no se han encendido nunca**. `product_recognition` es `NULL` en
 * las 1.770 conversaciones de producción y `ad_referral_at` también, así que
 * las dos marcas del reconocimiento eran código dibujando algo que no existe.
 * El nivel 3 las puso porque estaban escritas, no porque aparecieran. Lo que la
 * cascada dudó **se sigue contando en el hilo** (`SalesEventLine`), que es
 * donde además está fechado.
 *
 * `frecuencia` no es documentación: es lo que ordena la tira cuando hay más de
 * dos y el teléfono tiene que elegir. Ver {@link estadosDeLaFila}.
 */
const ESTADOS_DE_LA_FILA: readonly {
  label: string;
  title: string;
  /** El modificador de `.state-chip`. Los nombres los fija el spec. */
  modificador: string;
  /** En qué % de las filas sale. Medido el 20-ago-2026 sobre las 200. */
  frecuencia: number;
  lo: (it: ChatItem) => boolean;
}[] = [
  {
    /**
     * **La vuelta de «en automático».** El vendedor lleva 199 de cada 200
     * conversaciones, así que marcarlas era marcarlas todas; lo que hay que
     * mirar es la que alguien apartó para llevarla a mano.
     *
     * `.state-chip--mio` lo crea PRO-32 y comparte el tinte de `--auto`: es el
     * mismo eje —quién la lleva— dicho por su otra punta.
     *
     * **`&& !it.sinResponder` es un desvío de la tabla del spec, y sale de una
     * medición que aquella no podía hacer.** «Sin responder» **implica** que el
     * agente está apagado: es la primera de las tres condiciones de
     * `puedeEstarSinResponder` (`@wa/db`), `if (facts.agentMode) return false`.
     * Así que las dos etiquetas salen juntas siempre, y sin esto «lo llevo yo»
     * —que ordena primero, por rara— le comería uno de los dos puestos del
     * teléfono a «sin responder», que es justo lo que hay que ver: la etiqueta
     * más importante de la bandeja se iría al `+N` en el 15% de las filas.
     *
     * El 0,5% medido cuenta las 200 más recientes; la lista dibuja además
     * **todas** las que están sin responder, y ese segundo conjunto es entero
     * de agente apagado. Con la resta, la etiqueta vuelve a decir lo que su
     * frecuencia promete: la conversación que una persona lleva **y que no
     * está esperando a nadie**.
     *
     * Es la misma regla que esta tira ya aplica dos veces más: «novedad» calla
     * la pastilla de logística y «por confirmar» calla la de confirmación. El
     * mismo hecho dicho dos veces no informa el doble.
     */
    label: "lo llevo yo",
    title: "El vendedor automático está apagado: esta la lleva una persona",
    modificador: "state-chip--mio",
    frecuencia: 0.5,
    lo: (it) => !it.agentMode && !it.sinResponder,
  },
  {
    label: "escalada",
    title: "El vendedor pasó esta conversación a un asesor",
    modificador: "state-chip--escalada",
    frecuencia: 1.8,
    lo: (it) => it.escalada,
  },
  {
    label: "novedad",
    title: "La logística reportó una novedad en la entrega",
    modificador: "state-chip--novedad",
    frecuencia: 2.1,
    // El estado `novedad` y la bandera son dos caminos al mismo hecho: la
    // novedad puede seguir viva con la guía ya en otro estado.
    lo: (it) => it.dropiHasNovedad || it.dropiStatus === "novedad",
  },
  {
    /**
     * El mismo hecho que la pastilla «pendiente» de la tira de detalle, que por
     * eso deja de dibujarse cuando esta se enciende: dicho dos veces en la
     * misma fila no informa el doble.
     *
     * Comparte el tinte de «sin responder» —las dos son cosas que esperan— y se
     * separan por el nombre, que es el canal que el veredicto puso por delante
     * del color.
     */
    label: "por confirmar",
    title: "El pedido todavía no está confirmado",
    modificador: "state-chip--espera",
    frecuencia: 10.5,
    lo: (it) => it.confirmationStatus === "pending",
  },
  {
    label: "sin responder",
    title: "El cliente escribió y todavía nadie le contestó",
    modificador: "state-chip--espera",
    frecuencia: 15,
    // Lo deriva el servidor y **no se recalcula acá**: ver `sinResponderCount`.
    lo: (it) => it.sinResponder,
  },
];

/**
 * **Las etiquetas que le tocan a una fila, de la más rara a la más común.**
 *
 * El orden **es** la regla del corte y no una preferencia de lectura: en el
 * teléfono la fila muestra dos, y las que se quedan son las menos frecuentes
 * porque son las que más dicen. Una fila con «sin responder» y «escalada»
 * enseña la escalada: sin responder hay 35, escaladas hay 4.
 *
 * Es puro y se prueba solo, que es la única forma de afirmar la regla sin
 * medir píxeles: ver `inbox-lista.test.tsx`.
 */
export function estadosDeLaFila(it: ChatItem) {
  return ESTADOS_DE_LA_FILA.filter((e) => e.lo(it)).sort(
    (a, b) => a.frecuencia - b.frecuencia,
  );
}

/**
 * Cuántas etiquetas caben en la fila del teléfono.
 *
 * Dos, con `+N` para el resto, y en una línea que **no envuelve**. El 77% de las
 * filas lleva tres estados o más, así que la fila del nivel 3 —la más alta de
 * las cinco que se probaron— no cabe a 390 px. En escritorio no hay corte: la
 * fila las sigue mostrando todas.
 */
export const ETIQUETAS_EN_EL_TELEFONO = 2;

/**
 * **El filtro de la lista, tal como viaja en `?v=`.**
 *
 * La bandeja de ventas ya espejaba su vista en la dirección —son los enlaces de
 * la barra lateral (`./nav`), y los nombres dicen su regla—; la de operaciones
 * la guardaba en memoria, así que se perdía al recargar y al salir y volver.
 * Ahora las dos funcionan igual: el filtro **se deriva del parámetro**, no se
 * duplica en un estado.
 *
 * `all` no tiene token a propósito: la vista por defecto es la URL sin
 * parámetro, y el enlace de hoy tiene que seguir significando lo mismo mañana.
 */
const VISTA_DEL_FILTRO: Record<FilterKey, string | null> = {
  all: null,
  pending: "pendientes",
  confirmed: "confirmadas",
  not_confirmed: "no-confirmadas",
  sin_responder: "sin-responder",
  automated: "en-automatico",
};

/**
 * Cómo se llama cada filtro en la barra.
 *
 * «Pendientes» pasa a **«Por confirmar»**, que es como se llamaba la tarjeta que
 * contaba lo mismo y como lo llama la fila. El nombre corto existía porque el
 * filtro era un `<select>` que competía por ancho con un contador; ahora es una
 * fila de botones que envuelve, así que cada uno puede llamarse por su nombre.
 */
const ETIQUETA_DEL_FILTRO: Record<FilterKey, string> = {
  all: "Todas",
  pending: "Por confirmar",
  confirmed: "Confirmadas",
  not_confirmed: "No confirmadas",
  sin_responder: "Sin responder",
  automated: "En automático",
};

/**
 * **Los filtros que ofrece cada bandeja, en una sola lista.**
 *
 * De acá salen las opciones del selector *y* los tokens que `?v=` acepta, y esa
 * es toda la razón de que exista: mientras fueran dos listas podían discrepar,
 * y discrepaban. Cambiar de bandeja no remonta el componente —es la misma
 * ruta—, así que el filtro «En automático» sobrevivía al salto a operaciones,
 * donde esa opción no se ofrece: el selector se quedaba **en blanco** mientras
 * la lista sí filtraba, y el asesor veía faltar filas sin poder ver por qué.
 * Leyendo el filtro de esta misma lista, un valor que la bandeja no ofrece no
 * se puede ni representar.
 *
 * Los tres estados de confirmación no se ofrecen en ventas: una conversación
 * con pedido ya está en la otra bandeja, así que los tres devuelven cero, y un
 * filtro que siempre vacía la lista es una trampa, no una opción.
 */
const FILTROS_DE_VENTAS: readonly FilterKey[] = [
  "all",
  "automated",
  "sin_responder",
];
const FILTROS_DE_OPERACIONES: readonly FilterKey[] = [
  "all",
  "pending",
  "confirmed",
  "not_confirmed",
  "sin_responder",
];

function filtrosDeLaBandeja(esVentas: boolean): readonly FilterKey[] {
  return esVentas ? FILTROS_DE_VENTAS : FILTROS_DE_OPERACIONES;
}

/**
 * **Los filtros que la barra ofrece, que ya no son todos los que acepta.**
 *
 * «En automático» sale de la barra: lo lleva el 89,9% de las conversaciones, y
 * un número que casi siempre dice «casi todas» no decide nada. Es el mismo
 * argumento con el que el chip se retiró de la fila.
 *
 * **Pero sigue siendo un filtro válido**, porque la barra lateral enlaza a él
 * (`nav.ts`, `?v=en-automatico`) y ese archivo es de otro ticket. Sacarlo del
 * todo dejaría el enlace filtrando en silencio; dejarlo fuera de la barra
 * mientras la lista filtra es el bug que PRO-11 ya cerró —el selector en blanco
 * y las filas faltando sin poder ver por qué—. Así que se ofrece **solo cuando
 * está puesto**: nunca ocupa sitio de más, y quien llega por el enlace ve qué
 * filtro tiene y con qué botón salir.
 */
function filtrosQueSeOfrecen(
  esVentas: boolean,
  puesto: FilterKey,
): readonly FilterKey[] {
  return filtrosDeLaBandeja(esVentas).filter(
    (f) => f !== "automated" || puesto === "automated",
  );
}

/** El filtro que pide la dirección, acotado a lo que esta bandeja ofrece. */
function filtroDeLaVista(vista: string | null, esVentas: boolean): FilterKey {
  return (
    filtrosDeLaBandeja(esVentas).find((f) => VISTA_DEL_FILTRO[f] === vista) ??
    "all"
  );
}

/**
 * Cuánto espera un `router.refresh()` antes de salir, y cuántos se juntan en
 * uno.
 *
 * El refresh no desaparece —sigue siendo el camino de lo que solo el servidor
 * sabe—, pero **deja de ser el camino de los eventos**: un render del Inbox son
 * 23 idas y vueltas a la base, y sin ventana una ráfaga de avisos los pide
 * todos. Con ventana, una ráfaga cuesta uno.
 */
const VENTANA_DE_REFRESCO_MS = 400;

/**
 * **El detalle de la fila se dibuja más callado que sus estados.**
 *
 * Los cinco estados van rellenos, en 800 y en versalitas —son lo que hace que
 * la bandeja se recorra con la vista—. Lo de aquí abajo es el detalle del
 * pedido: importa cuando ya te detuviste en una fila, no cuando la estás
 * salteando. Por eso lleva contorno y no relleno, y el color lo pone el texto.
 *
 * Ninguno inventa un tono: salen todos del contrato de nombres del spec.
 */
const DETALLE = "border-[var(--color-border)] text-[var(--color-text-dim)]";
const DETALLE_BIEN = "border-[var(--color-border)] text-[var(--color-ink)]";
const DETALLE_MAL = "border-[var(--color-border)] text-[var(--color-danger)]";
const DETALLE_ESPERA = "border-[var(--color-border)] text-[var(--color-warn)]";

const STATUS_META: Record<
  ConfirmationStatus,
  { label: string; classes: string; icon: typeof CheckCircle2 }
> = {
  confirmed: {
    label: "confirmado",
    classes: DETALLE_BIEN,
    icon: CheckCircle2,
  },
  not_confirmed: {
    label: "no confirmado",
    classes: DETALLE_MAL,
    icon: XCircle,
  },
  pending: {
    label: "pendiente",
    classes: DETALLE_ESPERA,
    icon: CircleDashed,
  },
  unknown: {
    label: "sin clasificar",
    classes: DETALLE,
    icon: HelpCircle,
  },
};

const DROPI_META: Record<
  DropiStatus,
  { label: string; classes: string; icon: typeof CheckCircle2 }
> = {
  unknown: {
    label: "—",
    classes: DETALLE,
    icon: HelpCircle,
  },
  pendiente_confirmacion: {
    label: "por confirmar",
    classes: DETALLE_ESPERA,
    icon: CircleDashed,
  },
  pendiente: {
    label: "pendiente",
    classes: DETALLE_ESPERA,
    icon: CircleDashed,
  },
  // El tramo de en medio —la guía ya existe y todavía no llegó— no es ni bueno
  // ni malo: informa. Va en gris, que es lo que lo deja pasar de largo cuando
  // se está buscando otra cosa.
  guia_generada: {
    label: "guía",
    classes: DETALLE,
    icon: FileText,
  },
  preparado_transportadora: {
    label: "preparado",
    classes: DETALLE,
    icon: Package,
  },
  recolectado: {
    label: "recolectado",
    classes: DETALLE,
    icon: Package,
  },
  en_transito: {
    label: "en tránsito",
    classes: DETALLE,
    icon: Truck,
  },
  con_mensajero: {
    label: "con mensajero",
    classes: DETALLE,
    icon: Truck,
  },
  en_oficina: {
    label: "en oficina",
    classes: DETALLE_ESPERA,
    icon: Building2,
  },
  entregado: {
    label: "entregado",
    classes: DETALLE_BIEN,
    icon: CheckCircle2,
  },
  novedad: {
    label: "novedad",
    classes: DETALLE_MAL,
    icon: AlertTriangle,
  },
  novedad_solucionada: {
    label: "novedad resuelta",
    classes: DETALLE_BIEN,
    icon: CheckCircle2,
  },
  devolucion: {
    label: "devolución",
    classes: DETALLE_ESPERA,
    icon: Undo2,
  },
  rechazado: {
    label: "rechazado",
    classes: DETALLE_MAL,
    icon: XCircle,
  },
  retornado: {
    label: "retornado",
    classes: DETALLE_ESPERA,
    icon: Undo2,
  },
  anulada: {
    label: "anulada",
    classes: DETALLE,
    icon: XCircle,
  },
};

/**
 * Lo que la bandeja anotó y todavía no se ha mirado.
 *
 * `conversaciones` son las que cambiaron y **quedarían en otro puesto** si la
 * lista se reordenara; `faltaAlguna` dice que al menos una de esas novedades es
 * de una conversación que no está en la lista, y por lo tanto solo la puede
 * traer el servidor.
 */
type Novedades = {
  conversaciones: readonly string[];
  faltaAlguna: boolean;
};

const SIN_NOVEDADES: Novedades = { conversaciones: [], faltaAlguna: false };


/**
 * **Apagar el «Tú:» cuando el evento prueba que quien escribió fue el cliente.**
 *
 * `aplicarEvento` no sabe de este campo —la instantánea del evento trae tres
 * cosas y ninguna es la dirección del mensaje—, así que sin esto una fila que
 * decía «Tú:» seguiría diciéndolo con el texto del cliente encima, que es
 * exactamente la confusión que la palabra vino a deshacer.
 *
 * **La regla es la de {@link aplicarEvento} con `sinResponder`, calcada**: se
 * mueve en un solo sentido y solo con certeza. El contador de no leídos sube en
 * un único sitio de todo el worker —la ingesta de un entrante—, así que verlo
 * subir *prueba* que el cliente acaba de escribir. Hacia el otro lado no se
 * toca: que la vista previa vuelva a ser nuestra lo dice el servidor, que es
 * quien compara las dos fechas.
 *
 * Lo que cuesta equivocarse hacia ese otro lado es una fila que muestra nuestro
 * mensaje sin el «Tú:» hasta el próximo render del servidor. Al revés —el
 * «Tú:» encima del texto del cliente— es la mentira, y es la que esto cierra.
 */
function apagandoElTuSiEscribioElCliente(
  filas: readonly ChatItem[],
  antesDelEvento: readonly ChatItem[],
  conversationId: string,
): ChatItem[] {
  const antes = antesDelEvento.find((f) => f.id === conversationId);
  if (!antes) return [...filas];
  return filas.map((f) =>
    f.id === conversationId && f.unread > antes.unread
      ? { ...f, previewEsNuestro: false }
      : f,
  );
}

export function InboxClient({
  initial,
  approvedTemplates,
  query,
  op,
  operationId,
  bandeja,
  sellerName,
  currentUserId,
}: {
  initial: ChatItem[];
  approvedTemplates: string[];
  /** Término de búsqueda vigente en la URL (?q=), resuelto en el servidor. */
  query: string;
  /**
   * De qué operación es esta bandeja, para la línea de contexto.
   *
   * Baja desde `page.tsx`, que ya tiene la fila entera (`resolvePanelOperation`).
   * Hasta hoy el cliente solo recibía `operationId`, así que en la pantalla
   * desde la que salen mensajes a Guatemala el único indicio del país era una
   * bandera de 8×30 px en un riel que además se pliega.
   */
  op: { name: string; countryCode: string };
  /**
   * La operación que está mirando esta pestaña, o `null` si no se pudo
   * resolver.
   *
   * Es lo que impide que un entrante de Colombia mueva la bandeja de Guatemala.
   * El stream ya filtra en el servidor —un evento que no sale no hay que
   * confiar en que nadie lo mire—, y esto es el cinturón de acá: la pestaña
   * puede quedar abierta mientras el riel cambia de operación sin que el
   * `EventSource` se vuelva a abrir.
   */
  operationId: string | null;
  /**
   * La bandeja que se está viendo, o `null` cuando la operación no tiene
   * vendedor configurado y por lo tanto **no hay dos bandejas**: ahí esta
   * pantalla es exactamente la de siempre.
   */
  bandeja: "ventas" | "operaciones" | null;
  /** El nombre del vendedor configurado, o `null` si no hay ninguno. */
  sellerName: string | null;
  /** Quién está mirando, para poder decir «la trabajo yo» y no solo «alguien». */
  currentUserId: string | null;
}) {
  const router = useRouter();
  /**
   * **El estado de la bandeja vive en la dirección, no en memoria.**
   *
   * Tres síntomas de la misma causa se van con esto: no se podía mandar el
   * enlace de un chat, Atrás sacaba de la pantalla en vez de volver al chat
   * anterior, y recargar aterrizaba en otro. Un cuarto también: cambiar de
   * bandeja es la misma ruta, así que el componente no se remonta y quedaba
   * abierta una conversación de la bandeja de al lado.
   */
  const params = useSearchParams();
  /**
   * Los parámetros como texto. Es lo que se usa de dependencia y no el objeto:
   * un `URLSearchParams` nuevo en cada render volvería a armar el temporizador
   * de la búsqueda cada vez, y la búsqueda no saldría nunca.
   */
  const qsActual = params.toString();
  const pedidaEnLaDireccion = params.get("c");
  const esVentas = bandeja === "ventas";
  const [items, setItems] = useState<ChatItem[]>(initial);
  const [novedades, setNovedades] = useState<Novedades>(SIN_NOVEDADES);
  const [search, setSearch] = useState(query);
  const [searching, startSearch] = useTransition();
  const [, startRefresh] = useTransition();

  /**
   * La lista tal como está **ahora mismo**, para que una ráfaga de eventos no
   * se pise a sí misma: dos entrantes en el mismo tick leen los dos el estado
   * anterior, y el segundo borraría lo que escribió el primero.
   */
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  /**
   * El filtro **se deriva de `?v=`**; no hay un estado que pueda discrepar.
   * Ver {@link filtroDeLaVista}: un valor que esta bandeja no ofrece no llega
   * a existir, así que el selector no puede quedar en blanco mientras la lista
   * filtra.
   */
  const filter = filtroDeLaVista(params.get("v"), esVentas);

  /**
   * Escribir un parámetro de esta pantalla en la dirección, sin pedirle nada al
   * servidor.
   *
   * Es la History API y no `router.push`: lo que se está guardando es **dónde
   * está parado el asesor**, no otra pantalla. Next sincroniza `usePathname` y
   * `useSearchParams` con estas dos llamadas, así que la dirección y lo que se
   * ve no se pueden separar; y como no hay navegación, seleccionar un chat no
   * cuesta un render de servidor ni mueve el scroll de la lista.
   *
   * `push` para la conversación, que es lo que Atrás tiene que devolver;
   * `replace` para el filtro, que es cómo se está mirando y no a dónde se fue.
   */
  const escribirEnLaDireccion = useCallback(
    (clave: string, valor: string | null, modo: "push" | "replace") => {
      const proximos = new URLSearchParams(qsActual);
      if (valor === null) proximos.delete(clave);
      else proximos.set(clave, valor);
      const qs = proximos.toString();
      const url = qs ? `/inbox?${qs}` : "/inbox";
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [qsActual],
  );

  const abrirConversacion = useCallback(
    (it: ChatItem) => {
      if (pedidaEnLaDireccion === it.id) return;
      escribirEnLaDireccion("c", it.id, "push");
    },
    [escribirEnLaDireccion, pedidaEnLaDireccion],
  );

  const ponerFiltro = useCallback(
    (f: FilterKey) => {
      escribirEnLaDireccion("v", VISTA_DEL_FILTRO[f], "replace");
    },
    [escribirEnLaDireccion],
  );

  /**
   * **La conversación abierta se deriva de la dirección**, y no se duplica en
   * un estado que pueda ir por su cuenta.
   *
   * Sin `?c=` se abre la primera de la lista, como siempre. La que pide la
   * dirección está garantizada en la lista: el servidor la ancla (`pinnedId`)
   * aunque se haya salido del corte por actividad o de la búsqueda.
   */
  const selected =
    (pedidaEnLaDireccion
      ? items.find((i) => i.id === pedidaEnLaDireccion) ?? null
      : null) ??
    items[0] ??
    null;

  /**
   * Volver a pedirle el render al servidor: con ventana y dentro de una
   * transición.
   *
   * **No es un `location.reload()` con otro nombre** —no reinicia el cliente,
   * no borra el borrador ni mueve el scroll—, pero cuesta 23 idas y vueltas a
   * la base, así que ya no es el camino de los eventos: solo el de lo que
   * únicamente el servidor puede saber. La ventana junta la ráfaga en uno.
   */
  const refrescoPendiente = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refrescar = useCallback(() => {
    if (refrescoPendiente.current !== null) return;
    refrescoPendiente.current = setTimeout(() => {
      refrescoPendiente.current = null;
      startRefresh(() => router.refresh());
    }, VENTANA_DE_REFRESCO_MS);
  }, [router]);
  useEffect(
    () => () => {
      if (refrescoPendiente.current !== null) {
        clearTimeout(refrescoPendiente.current);
      }
    },
    [],
  );

  /**
   * La URL de esta pantalla con otro término de búsqueda.
   *
   * Se arma sobre los parámetros vigentes y no desde cero: buscar dentro de
   * Conversaciones **no puede devolverte al Inbox de Katherine**, y eso es
   * justo lo que pasaba al reconstruir la URL con solo el término. Ahora
   * también conserva la conversación abierta y el filtro puesto.
   */
  const urlDeLaBandeja = (term: string): string => {
    const proximos = new URLSearchParams(qsActual);
    if (term) {
      proximos.set("q", term);
      /*
        **Una búsqueda nueva suelta la conversación anclada.**
        
        `?c=` mete su conversación en la lista aunque quede fuera del corte, del
        filtro o de la búsqueda: quien la abrió tiene derecho a verla. Pero el
        buscador nunca lo limpiaba, así que la de la búsqueda anterior seguía
        pegada arriba de la siguiente: buscabas 1234, la abrías, buscabas 456 y
        salían 456 **y 1234**. Lo reportó la operación de Vorare.
        
        Al escribir un término nuevo ya no estás mirando la de antes, estás
        buscando otra cosa. Limpiar la búsqueda **no** la suelta, porque ahí sí
        volvés a la bandeja con lo que tenías abierto.
      */
      proximos.delete("c");
    } else {
      proximos.delete("q");
    }
    const qs = proximos.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  };

  // La búsqueda vive en la URL y la resuelve el servidor sobre TODAS las
  // conversaciones — la lista solo carga las 200 más recientes, así que un
  // filtro local no encontraría a nadie de hace meses. Es de las dos cosas que
  // siguen siendo un render de servidor, con su ventana y en transición.
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      const term = search.trim();
      startSearch(() => {
        router.replace(urlDeLaBandeja(term));
      });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, query, router, qsActual]);
  const automatedCount = items.filter((item) => item.agentMode).length;
  const pendingCount = items.filter(
    (item) => item.confirmationStatus === "pending",
  ).length;
  const confirmedCount = items.filter(
    (item) => item.confirmationStatus === "confirmed",
  ).length;
  const notConfirmedCount = items.filter(
    (item) => item.confirmationStatus === "not_confirmed",
  ).length;
  /**
   * **«Sin responder»**: el cliente escribió y nadie le contestó.
   *
   * Ya no se calcula acá. Era `!agentMode && unread > 0`, y `unread_count` mide
   * «nadie la abrió en el panel», no «hay que atenderla»: el 19-ago-2026, de las
   * 54 que marcaba, 30 ya habían sido respondidas. Ahora lo decide el servidor
   * con `sinResponder` (`@wa/db`) sobre las 1.760 conversaciones, y la lista
   * trae siempre las que dan `true` — sin eso este contador diría 1, porque las
   * 200 filas que se cargan por actividad cubren los últimos cinco días y las
   * conversaciones sin responder son más viejas.
   *
   * Un evento del stream solo lo mueve **hacia arriba y con certeza** —ver
   * `aplicarEvento` (`@wa/db/bandeja-viva`)—; apagarlo sigue siendo del
   * servidor.
   */
  const sinResponderCount = items.filter((item) => item.sinResponder).length;

  const contadorDelFiltro: Record<FilterKey, number> = {
    all: items.length,
    pending: pendingCount,
    confirmed: confirmedCount,
    not_confirmed: notConfirmedCount,
    sin_responder: sinResponderCount,
    automated: automatedCount,
  };

  const visibleItems =
    filter === "all"
      ? items
      : filter === "sin_responder"
        ? items.filter((item) => item.sinResponder)
        : filter === "automated"
          ? items.filter((item) => item.agentMode)
          : items.filter((item) => item.confirmationStatus === filter);

  /**
   * **Las secciones son estructura, no decoración de la fila.**
   *
   * Hasta hoy la lista no tenía ninguna: tenía un filtro. Un `h1` y cero `h2`,
   * en la pantalla que más se abre. Ahora se parte en dos por el mismo campo
   * que leen la etiqueta, el filtro y el contador de la barra —`sinResponder`,
   * que decide el servidor y que **aquí no se recalcula**—, así que no hay una
   * regla nueva que pueda discrepar con las otras tres.
   *
   * Lo que se lee es {@link esperandoAlAsentarse} y no el campo en vivo, y ahí
   * está la única sutileza de todo esto: agrupar en vivo haría saltar de sección
   * a la fila que acaba de recibir un mensaje. Lo cuenta ese comentario.
   *
   * **El orden de cada sección es el que traía la lista.** Partir conserva el
   * orden relativo, así que dentro de «Esperando respuesta» y dentro de «El
   * resto» las filas siguen por actividad, como las manda el servidor.
   *
   * ## Las secciones conviven con el filtro sin repetirlo
   *
   * Un filtro puesto puede dejar un solo grupo con filas —«Sin responder» las
   * deja todas en el primero, «En automático» todas en el segundo—, y ahí un
   * encabezado diría lo mismo que el selector que está tres centímetros más
   * arriba, y el otro sería un «· 0» que no lleva a ninguna parte. **Con un
   * solo grupo la lista va plana**, exactamente como estaba. Los encabezados
   * aparecen cuando la lista de verdad se parte en dos, que es cuando decir
   * dónde termina una y empieza la otra informa algo.
   *
   * `null` es «esta sección no se anuncia»: es una sola y es toda la lista.
   */
  /**
   * **La bandeja va por actividad, sin partirse en dos.**
   *
   * Hasta el 21-ago-2026 las que esperaban respuesta iban en una sección
   * propia arriba de todo. Lo pidió cambiar la operación de Vorare y la
   * medición le da la razón: de las 85 que esperaban respuesta, **65 tenían más
   * de un mes**. Eran chats viejos que nadie iba a contestar, arriba todos los
   * días, empujando hacia abajo lo de hoy — que es lo que de verdad se trabaja.
   *
   * **Y no se pierde nada al quitarla.** Una conversación sin responder
   * *reciente* es reciente, así que sube igual por fecha: las 2 de esa semana
   * seguían arriba solas. Lo único que cae son las viejas, que es justo lo que
   * se buscaba. Las que esperan siguen a un toque, en el filtro «Sin responder»
   * de la barra, con su cuenta.
   *
   * El servidor ya las manda ordenadas por actividad (`POR_ACTIVIDAD`), así que
   * esto es dejar de reordenarlas acá.
   */
  const secciones: { nombre: string | null; filas: ChatItem[] }[] = [
    { nombre: null, filas: visibleItems },
  ];

  /**
   * El «ahora» con el que cada fila dice su tiempo, uno solo por render.
   *
   * Se calcula acá y baja como parámetro para que {@link tiempoRelativo} sea
   * pura: los tres bordes que hay que probar —medianoche, ayer a las 23:59 y el
   * salto de semana— no se pueden escribir contra un reloj que corre. Y de paso
   * las filas de un mismo render no se contradicen entre ellas.
   */
  const ahora = new Date();

  /** Anotar que llegó algo que la lista no va a mostrar sola. */
  const anotarNovedad = useCallback(
    (conversationId: string, fueraDeLaLista: boolean) => {
      setNovedades((prev) => ({
        conversaciones: prev.conversaciones.includes(conversationId)
          ? prev.conversaciones
          : [...prev.conversaciones, conversationId],
        faltaAlguna: prev.faltaAlguna || fueraDeLaLista,
      }));
    },
    [],
  );

  /**
   * **Lo que un evento del stream le hace a la lista.**
   *
   * La decisión no está acá: está en `aplicarEvento` (`@wa/db/bandeja-viva`),
   * que es puro y se prueba desde el worker como `resolveInbox` y
   * `sinResponder`. Acá solo se ejecuta lo que decidió.
   *
   * Antes esto era una línea —`router.refresh()`— y costaba el render del
   * servidor entero por cada mensaje que entraba: 23 idas y vueltas a la base y
   * 1.256 filas leídas para entregar una fila que cambió.
   */
  const manejarEvento = useCallback(
    (ev: WaEvent) => {
      const decision = aplicarEvento(itemsRef.current, ev, { operationId });
      if (decision.accion === "refrescar") {
        refrescar();
        return;
      }
      if (decision.accion === "ignorar") {
        // La única que el asesor tiene que saber: llegó un mensaje de una
        // conversación que no está en la lista. No se inventa la fila —el
        // evento trae tres campos y la fila dibuja veinte—, se avisa.
        if (decision.motivo === "fuera-de-la-lista" && decision.conversationId) {
          anotarNovedad(decision.conversationId, true);
        }
        return;
      }
      const filas = apagandoElTuSiEscribioElCliente(
        decision.filas,
        itemsRef.current,
        decision.conversationId,
      );
      itemsRef.current = filas;
      setItems(filas);
      // La fila se actualizó **en su sitio**. Que tendría que haber subido lo
      // dice el aviso, y reordenar lo decide el asesor: entrar un mensaje de
      // otro cliente, que todo baje un puesto y abrir la conversación
      // equivocada es el bug que esto saca.
      if (decision.desordena) anotarNovedad(decision.conversationId, false);
    },
    [anotarNovedad, operationId, refrescar],
  );

  /**
   * **Una sola conexión al stream por pestaña.**
   *
   * Antes se abrían dos contra `/api/events` —una la lista y otra el hilo—, y
   * la del hilo se cerraba y volvía a abrir con cada cambio de conversación.
   * Ahora la abre la lista, una vez, y el hilo se cuelga de ella con
   * {@link suscribirse}.
   */
  const oyentes = useRef(new Set<(ev: WaEvent) => void>());
  const suscribirse = useCallback((fn: (ev: WaEvent) => void) => {
    oyentes.current.add(fn);
    return () => {
      oyentes.current.delete(fn);
    };
  }, []);

  // El manejador vive en una referencia para que la conexión no se reabra cada
  // vez que cambia algo de lo que depende. Las dependencias del efecto son
  // vacías **a propósito**: es lo que hace que sea una sola conexión.
  const manejarRef = useRef(manejarEvento);
  useEffect(() => {
    manejarRef.current = manejarEvento;
  }, [manejarEvento]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("wa", (e) => {
      let ev: WaEvent;
      try {
        ev = JSON.parse((e as MessageEvent).data) as WaEvent;
      } catch {
        return;
      }
      manejarRef.current(ev);
      for (const fn of [...oyentes.current]) fn(ev);
    });
    return () => es.close();
  }, []);

  /**
   * La lista se resincroniza cuando **el servidor** manda un `initial` nuevo, y
   * solo entonces: una navegación, una búsqueda o el refresh de lo que el
   * cliente no puede recalcular.
   *
   * Lo que llega es la lista entera y en su orden, así que las novedades
   * anotadas ya están adentro y el aviso se apaga. Es el único momento en que
   * la lista se reordena sin que el asesor lo pida, y es el que él provocó.
   */
  useEffect(() => {
    itemsRef.current = initial;
    setItems(initial);
    setNovedades(SIN_NOVEDADES);
  }, [initial]);

  /**
   * Ponerse al día: la lista vuelve a su orden y, si hacía falta, se le pide al
   * servidor lo que no está en ella.
   *
   * **Reordenar es una acción del asesor, no del tráfico.** Solo se le pide al
   * servidor cuando alguna novedad es de una conversación que la lista no
   * tiene: reordenar lo que ya está es instantáneo y no cuesta un viaje.
   */
  const ponerseAlDia = useCallback(() => {
    const ordenadas = reordenarPorActividad(itemsRef.current);
    itemsRef.current = ordenadas;
    setItems(ordenadas);
    // Ponerse al día reordena **y reagrupa**: son la misma acción del asesor
    // sobre el mismo arreglo, y dejar una sin la otra sería reordenar la lista
    // para que las secciones siguieran diciendo lo de antes.
    if (novedades.faltaAlguna) refrescar();
    setNovedades(SIN_NOVEDADES);
  }, [novedades.faltaAlguna, refrescar]);

  /**
   * Lo que un botón acaba de escribir en el servidor, aplicado donde ocurrió.
   *
   * Es el patrón de la tabla de Pedidos (`orders-table.tsx`), y reemplazó a los
   * tres `location.reload()` que tenían los botones de esta pantalla.
   *
   * `coincide` es un predicado y no un id porque **el modo agente es del
   * contacto, no de la conversación**: un contacto con dos conversaciones en la
   * lista cambia las dos, y con un id se quedaría una mintiendo.
   *
   * `necesitaAlServidor` dice si queda algo **derivado** que el cliente no
   * puede recalcular, y es explícito y no siempre: soltar una conversación o
   * apagar el agente pueden devolverla a «sin responder» —eso mira la escalada
   * y la actividad, que la fila no trae—, pero marcar una confirmación no
   * deriva nada, y pedir la pantalla entera por eso son 23 viajes a la base
   * para repintar un chip que el parche ya repintó.
   */
  const aplicarCambio = useCallback(
    (
      coincide: (it: ChatItem) => boolean,
      patch: Partial<ChatItem>,
      necesitaAlServidor = false,
    ) => {
      const filas = itemsRef.current.map((it) =>
        coincide(it) ? { ...it, ...patch } : it,
      );
      itemsRef.current = filas;
      setItems(filas);
      if (necesitaAlServidor) refrescar();
    },
    [refrescar],
  );

  /**
   * **Cuántos píxeles del fondo de la ventana tapa el teclado del teléfono.**
   *
   * En el teléfono el hilo es una capa `fixed` de borde a borde y el campo de
   * escribir va pegado a su fondo. Eso solo funciona con el teclado cerrado: al
   * abrirse, el navegador encoge el *viewport visual* pero no el de maquetación,
   * así que un elemento fijo al fondo se queda **debajo del teclado** — y
   * escribir es a lo que Katherine viene a esta pantalla.
   *
   * `visualViewport` es lo que dice cuánto se encogió. La alternativa era
   * `interactive-widget=resizes-content` en el `<meta viewport>`, que vive en
   * `layout.tsx` y es de otro ticket; esto además funciona sin depender de que
   * ese cambio llegue.
   *
   * Vale cero en escritorio y en cualquier navegador sin la API, que es
   * exactamente el comportamiento de antes.
   */
  const [tapadoPorElTeclado, setTapadoPorElTeclado] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const medir = () => {
      const tapado = Math.max(
        0,
        Math.round(window.innerHeight - vv.height - vv.offsetTop),
      );
      // Solo cuando de verdad cambia: `scroll` del viewport visual se dispara
      // en cada píxel de arrastre, y esto cuelga de un render de la bandeja.
      setTapadoPorElTeclado((antes) => (antes === tapado ? antes : tapado));
    };
    medir();
    vv.addEventListener("resize", medir);
    vv.addEventListener("scroll", medir);
    return () => {
      vv.removeEventListener("resize", medir);
      vv.removeEventListener("scroll", medir);
    };
  }, []);

  /**
   * **En el teléfono, si se está mirando el hilo o la lista.**
   *
   * Lo dice `?c=`, que es donde la conversación abierta ya vivía desde PRO-11:
   * no hace falta estado nuevo, y volver es el botón de atrás del navegador sin
   * que nadie tenga que programarlo. Sin `?c=` la lista abre igualmente la
   * primera conversación —es lo que hace el escritorio y no cambia—, pero en el
   * teléfono eso no puede tapar la pantalla: entrar al Inbox es ver la bandeja,
   * no el chat de quien escribió último.
   */
  const hiloAbierto = pedidaEnLaDireccion !== null && selected !== null;

  return (
    /*
      **El corte del lado a lado pasa de `xl` (1280) a `lg` (1024).** Entre esos
      dos anchos había una banda muerta: barra lateral desplegada, sitio de
      sobra, y la lista y el hilo igualmente apilados uno debajo del otro.

      Debajo de `lg` esta pantalla ya no apila nada: **la lista es la pantalla**
      y el hilo es otra, encima. Por eso el alto deja de fijarse acá —era lo que
      convertía la lista en una ventana de 55vh con scroll propio— y el marco
      corre en el flujo del documento, que es como se lee una lista en un
      teléfono.
    */
    <div className="app-page flex flex-col gap-3 lg:h-[calc(100vh-46px)] lg:min-h-0">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          {/*
            La línea de contexto va **sobre** el `h1`, siempre, y una sola vez
            por pantalla. Vive acá y no en `inbox/page.tsx` por un accidente que
            no lo es tanto: el `h1` del Inbox está en el cliente, porque el
            título cambia con la bandeja y la bandeja se lee de la URL.

            `pantalla` es el **módulo del menú** y no el nombre de la pantalla
            —«Ventas», «Confirmación»—, que es lo que distingue el trabajo de
            Katherine del de Sebastián sin abrir el selector. Repetir el `h1`
            dos renglones más arriba no diría nada nuevo.
          */}
          <ContextLine op={op} pantalla={esVentas ? "Ventas" : "Confirmación"} />
          <h1 className="app-title mt-1">
            {esVentas ? "Conversaciones" : "Inbox"}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-dim)]">
            {esVentas
              ? `La bandeja de ${sellerName ?? "ventas"} — el mismo número, la misma pantalla`
              : "Conversaciones en vivo"}
          </p>
        </div>
        {/*
          **El filtro lleva la cuenta, y el bloque de cinco tarjetas desaparece.**

          Eran dos cosas separadas diciendo lo mismo —«Sin responder: 35» en una
          tarjeta y «Sin responder (35)» en el selector de al lado—, y en 390 px
          no caben las dos. Las tres tarjetas que filtraban eran además las
          únicas que hacían algo; las otras dos, «Sin leer» y «Modo agente»,
          eran números que nadie podía usar para llegar a ninguna parte.

          **Envuelve, no desliza**: fue veredicto explícito de la ronda. Un
          carrusel horizontal esconde opciones detrás de un gesto que no se
          anuncia, y acá hay tres o cinco, no veinte.

          Y no se dibuja con la bandeja vacía. Un filtro sobre cero filas no
          filtra, y cinco ceros seguidos se leen como una avería.
        */}
        {items.length > 0 && (
          <div
            role="group"
            aria-label="Filtrar la bandeja"
            className="flex flex-wrap items-center gap-1.5"
          >
            {filtrosQueSeOfrecen(esVentas, filter).map((f) => {
              const activo = filter === f;
              // El realce de «Sin responder» es el mismo que tenía su tarjeta y
              // por lo mismo: solo cuando hay alguna. Un rojo permanente sobre
              // un cero es el aviso que nadie mira.
              const urgente =
                !activo && f === "sin_responder" && sinResponderCount > 0;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => ponerFiltro(f)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
                    activo
                      ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-card)]"
                      : urgente
                        ? "border-[var(--state-espera-fg)] bg-[var(--state-espera-bg)] text-[var(--state-espera-fg)]"
                        : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-text-dim)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-hover)]"
                  }`}
                >
                  {/* El espacio es del nombre accesible y no del dibujo —lo
                      que separa las dos cajas es el `gap`—: sin él un lector de
                      pantalla lee «Todas3». */}
                  {ETIQUETA_DEL_FILTRO[f]}{" "}
                  <span className="font-extrabold tabular-nums opacity-70">
                    {contadorDelFiltro[f]}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div className="grid min-h-0 gap-3 lg:flex-1 lg:grid-cols-[336px_1fr]">
        {/*
          **La lista comparte el fondo de la pantalla y el hilo va sobre
          blanco**, y eso —y no un borde grueso ni un espacio— es lo que las
          separa. Es el criterio del nivel 2, y por eso este `aside` dejó de ser
          `.app-card`: dos tarjetas lado a lado se leían como un continuo.

          El alto y el scroll propio son de `lg` para arriba, donde la lista es
          una columna dentro de una pantalla que no scrollea. En el teléfono la
          lista **es** la pantalla y scrollea con el documento: encerrarla en
          55vh era lo que dejaba el campo de escribir a tres pantallas de
          distancia. `min-w-0` deja que el `truncate` de cada fila funcione.
        */}
        <aside className="flex min-w-0 flex-col rounded-lg lg:h-auto lg:min-h-[520px] lg:overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nombre, teléfono o mensaje…"
                className="app-input h-9 w-full pl-8 pr-8 text-xs lg:h-8"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  title="Limpiar búsqueda"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/*
              **El selector se fue con las tarjetas**, y el contador `n/m` con
              él: los tres decían lo mismo que la barra de filtros de arriba, y
              dos controles para un solo estado es cómo se llega a que discrepen.
              Lo que queda es lo que el selector no decía: si la lista que se
              está mirando es la bandeja o el resultado de una búsqueda.
            */}
            {query && (
              <p className="text-sm font-semibold">
                {searching ? "Buscando…" : "Resultados"}
              </p>
            )}
          </div>
          {/*
            **El aviso de novedades.** La lista no se reordena sola: la fila que
            cambió se repinta donde está y esto dice que hay algo que subiría de
            puesto, o que llegó un mensaje de una conversación que la lista no
            tiene. Reordenar lo decide el asesor, tocándolo.

            Cómo se ve lo decide `.scratch/panel-orientacion/spec.md`; que exista
            lo decide este ticket.
          */}
          {novedades.conversaciones.length > 0 && (
            <button
              type="button"
              onClick={ponerseAlDia}
              className="mx-2 mt-2 rounded-lg border border-[var(--color-ink)] bg-[var(--color-ink-wash)] px-3 py-1.5 text-left text-xs text-[var(--color-ink)] transition hover:bg-[var(--color-ink-soft)]"
            >
              {novedades.conversaciones.length === 1
                ? "1 conversación con novedades"
                : `${novedades.conversaciones.length} conversaciones con novedades`}{" "}
              · ponerse al día
            </button>
          )}
          <ul className="p-2 lg:flex-1 lg:overflow-y-auto">
          {visibleItems.length === 0 && (
            <li className="p-4 text-center text-sm text-[var(--color-text-dim)]">
              {query && items.length === 0
                ? `Sin resultados para «${query}».`
                : items.length === 0
                  ? "No hay conversaciones todavía."
                  : "Sin resultados con este filtro."}
            </li>
          )}
          {secciones.map((seccion) => (
            <Fragment key={seccion.nombre ?? "sin-secciones"}>
              {seccion.nombre !== null && (
                /*
                  Un `<li>` y no un `<h2>` suelto porque un `<ul>` solo puede
                  tener `<li>` por hijo; `role="presentation"` le saca el papel
                  de fila para que la lista siga teniendo tantas filas como
                  conversaciones, y el `<h2>` de adentro conserva el suyo.
                */
                <li role="presentation" className="px-1 pb-2 pt-4 first:pt-1">
                  {/* `.app-section` tal cual la define el contrato —16 px, 600—
                      y sin achicarla acá: es el mismo encabezado de sección que
                      el resto del panel, y que el Inbox por fin tenga uno es
                      justo lo que el diagnóstico echaba de menos. */}
                  {/* **Sin la cuenta.** La llevaba porque no había dónde
                      ponerla; ahora la barra de filtros de arriba dice cuántas
                      hay de cada cosa, y repetirlo acá es el mismo número dos
                      veces en la misma pantalla. La costura sí se queda: es lo
                      que impide que las viejas sin responder se mezclen con lo
                      de hoy. */}
                  <h2 className="app-section">{seccion.nombre}</h2>
                </li>
              )}
              {seccion.filas.map((it) => (
                <FilaDeConversacion
                  key={it.id}
                  it={it}
                  ahora={ahora}
                  abierta={selected?.id === it.id}
                  // Sin `?c=` la lista abre igualmente la primera —es lo que
                  // hace el escritorio y no cambia—, pero en el teléfono esa
                  // conversación **no está abierta**: el hilo no se ve. Una
                  // fila resaltada diría que sí.
                  soloEnEscritorio={pedidaEnLaDireccion === null}
                  onAbrir={abrirConversacion}
                />
              ))}
            </Fragment>
          ))}
        </ul>
        </aside>

        {/*
          **El hilo es una pantalla completa en el teléfono, y una columna en
          escritorio.** Es el mismo componente: lo único que cambia es el marco.

          Encima de todo y no debajo de la barra: el hilo trae su propia
          cabecera con la flecha de volver y el nombre del cliente, así que la
          barra de la aplicación repetiría un renglón de cromo en la pantalla
          que menos espacio tiene.

          El `padding-bottom` es lo que el teclado tapa. Ver
          {@link tapadoPorElTeclado}: sin él, el campo de escribir queda detrás
          del teclado justo cuando se lo va a usar.
        */}
        <section
          style={
            hiloAbierto && tapadoPorElTeclado > 0
              ? { paddingBottom: tapadoPorElTeclado }
              : undefined
          }
          className={
            hiloAbierto
              ? "fixed inset-0 z-30 flex flex-col bg-[var(--color-surface)] lg:static lg:z-auto lg:min-w-0 lg:bg-transparent lg:pb-0"
              : "hidden min-w-0 flex-col lg:flex"
          }
        >
        {selected ? (
          <ConversationPane
            key={selected.id}
            chat={selected}
            approvedTemplates={approvedTemplates}
            currentUserId={currentUserId}
            sellerConfigured={sellerName !== null}
            onAplicado={aplicarCambio}
            suscribirse={suscribirse}
          />
        ) : (
          <div className="app-card flex flex-1 items-center justify-center text-[var(--color-text-dim)]">
            Selecciona una conversación
          </div>
        )}
        </section>
      </div>
    </div>
  );
}

/**
 * **Una fila de la bandeja.** La unidad que más se lee del producto.
 *
 * Tres renglones, y en ese orden por una razón cada uno:
 *
 * 1. **quién, cuánto y cuándo** — el nombre, lo que no se ha leído y el tiempo,
 *    como en WhatsApp, que es donde el asesor ya lo busca;
 * 2. **qué dijo, y quién lo dijo** — la vista previa a lo ancho, con «Tú:»
 *    delante cuando el último mensaje es nuestro;
 * 3. **qué hay que hacer** — las etiquetas, y solo las que piden algo.
 *
 * El tercer renglón es donde el nivel 4 cambió la fila del nivel 3, y no de
 * aspecto: **de contenido**. Antes llevaba todo lo que la conversación era —los
 * estados, la ventana, quién la trabaja, la confirmación, la guía, la
 * entrega—, y a 390 px eso no cabe: el 77% de las filas lleva tres estados o
 * más. Ahora, en el teléfono, lleva **dos como máximo y en una sola línea**,
 * con `+N` detrás y solo de lo que pide acción; el resto no se dibuja. En
 * escritorio la fila sigue mostrándolo todo, que es lo que el veredicto dejó
 * escrito: el corte de dos chips es del teléfono.
 *
 * **Una fila tranquila no lleva ningún renglón de etiquetas**, y ahí es donde
 * esto se paga y se cobra: entran muchas más conversaciones en una pantalla, y
 * se pierde la confirmación de un vistazo.
 */
function FilaDeConversacion({
  it,
  ahora,
  abierta,
  soloEnEscritorio,
  onAbrir,
}: {
  it: ChatItem;
  ahora: Date;
  abierta: boolean;
  /**
   * Si esta fila está abierta **solo porque es la primera**, y no porque la
   * dirección la nombre. En el teléfono eso no se resalta: ahí la lista es la
   * pantalla y no hay ninguna conversación abierta hasta que se toca una.
   */
  soloEnEscritorio: boolean;
  onAbrir: (it: ChatItem) => void;
}) {
  // La ventana cerrada **no la saca de la cuenta**: un lead de hace treinta
  // horas sigue esperando respuesta, y el panel sabe reabrir con plantilla. Lo
  // que cambia es que la fila lo diga, para que nadie abra el chat esperando
  // poder escribir suelto.
  const ventanaCerrada =
    it.sinResponder && windowStateOf(it.lastInboundAt) === "closed";
  const estados = estadosDeLaFila(it);
  /** Las que el teléfono no dibuja, y que el `+N` cuenta. */
  const deMas = estados.slice(ETIQUETAS_EN_EL_TELEFONO);
  /**
   * Si hay algo en la tira de detalle, que solo se dibuja en escritorio.
   *
   * Hace falta saberlo por adelantado para no dejar un renglón vacío con su
   * margen encima de cada fila tranquila del teléfono, que es justo lo que este
   * ticket vino a recuperar: sitio.
   */
  // «Por confirmar» ya es una etiqueta de estado, así que la pastilla
  // «pendiente» sería el mismo hecho dos veces en la misma tira — el trato que
  // «novedad» y la pastilla de logística ya tenían entre ellas.
  const detalleDeConfirmacion =
    it.confirmationStatus !== "unknown" && it.confirmationStatus !== "pending";
  const guiaDeDetalle =
    it.dropiStatus !== null &&
    it.dropiStatus !== "unknown" &&
    it.dropiStatus !== "novedad"
      ? it.dropiStatus
      : null;
  const hayDetalle =
    ventanaCerrada ||
    detalleDeConfirmacion ||
    guiaDeDetalle !== null ||
    it.deliveryFailed;
  return (
    <li
      onClick={() => onAbrir(it)}
      /*
        **En el teléfono cada fila es una tarjeta; en escritorio no.**

        No es adorno: en escritorio el hilo va al lado y es él quien le pone
        límite a la lista, así que una fila sin borde se lee bien. En el
        teléfono la lista es la pantalla entera y sin superficie propia las
        conversaciones corren pegadas, que es justo lo que este nivel vino a
        arreglar.

        La forma la fija el nivel 1: las superficies se separan por **aire y una
        sombra suave**, no por opacidad de casi el mismo color. Tarjeta
        (`--color-card`) sobre el fondo de la pantalla (`--color-bg`), y
        `lg:` la devuelve a como estaba.

        Y no contradice el nivel 2 —«la lista comparte el fondo de la pantalla,
        el hilo va sobre blanco»—, porque ese veredicto describe la planta de
        escritorio, donde lista e hilo conviven. Acá no hay hilo al lado.
      */
      className={`mb-1.5 cursor-pointer rounded-lg border px-3 py-2 transition lg:mb-0.5 lg:shadow-none ${
        abierta
          ? soloEnEscritorio
            ? "border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-panel)] lg:border-[var(--color-ink)] lg:bg-[var(--color-ink-wash)]"
            : "border-[var(--color-ink)] bg-[var(--color-ink-wash)]"
          : "border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-panel)] hover:bg-[var(--color-hover)] lg:border-transparent lg:bg-transparent"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 truncate font-medium text-[var(--color-text)]">
          {it.name}
        </p>
        {/* **El contador sube al primer renglón**, con el nombre y el tiempo:
            los tres son «de quién y cuándo». Abajo le estaba robando ancho a la
            vista previa, que a 390 px es lo que hace falta leer entero — y más
            ahora, que además puede empezar con «Tú:». */}
        {it.unread > 0 && (
          <span className="shrink-0 rounded-md bg-[var(--color-ink)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-card)]">
            {it.unread}
          </span>
        )}
        {/*
          **El tiempo se dice en relativo**, y esto es lo que arregla la mentira
          más vieja de esta lista: la bandeja mezcla a propósito las 200 más
          recientes por actividad con **todas** las que están sin responder, que
          son mucho más viejas, y hasta hoy las pintaba todas con el mismo
          `14:32`. El día exacto sigue estando, en el `title`, para el que se
          detiene en una fila.

          `suppressHydrationWarning` porque el servidor y el navegador no están
          en la misma zona horaria y esta es la línea donde eso se nota.
        */}
        <span
          className="shrink-0 text-[11px] text-[var(--color-text-dim)]"
          title={tiempoCompleto(it.lastAt)}
          suppressHydrationWarning
        >
          {tiempoRelativo(it.lastAt, ahora)}
        </span>
      </div>

      {/*
        **«Tú:» cuando el último mensaje es nuestro.** Es una palabra, y separa
        «me escribió y no le contesté» de «ya le contesté» sin abrir la
        conversación — que era imposible en 874 de las 1.770 filas, la mitad de
        la bandeja. `.row-prev-mine` la fija el contrato de nombres.
      */}
      <p className="mt-0.5 truncate text-xs text-[var(--color-text-dim)]">
        {it.previewEsNuestro && <span className="row-prev-mine">Tú:</span>}
        {it.previewEsNuestro ? " " : ""}
        {it.preview ?? "—"}
      </p>

      {/*
        **La tira: los estados delante y el detalle detrás.**

        En el teléfono no envuelve y solo lleva dos estados, con `+N`; el detalle
        entero no se dibuja. En escritorio envuelve y va todo, que es la fila de
        siempre. `lg:contents` es lo que deja que el detalle desaparezca en
        bloque sin meter una caja intermedia que rompa la tira.

        El renglón no existe cuando no hay nada que poner en él: sin esto, cada
        fila tranquila del teléfono pagaría el margen de una tira vacía.
      */}
      {(estados.length > 0 || hayDetalle) && (
        <div
          className={`mt-1.5 items-center gap-1 overflow-hidden lg:flex lg:flex-wrap lg:overflow-visible ${
            estados.length > 0 ? "flex" : "hidden"
          }`}
        >
          {estados.map((e, i) => (
            <span
              key={e.label}
              title={e.title}
              className={`state-chip ${e.modificador} ${
                i >= ETIQUETAS_EN_EL_TELEFONO ? "hidden lg:inline-flex" : ""
              }`}
            >
              {e.label}
            </span>
          ))}
          {deMas.length > 0 && (
            <span
              title={`También: ${deMas.map((e) => e.label).join(", ")}`}
              className="chip-more lg:hidden"
            >
              +{deMas.length}
            </span>
          )}
          <span className="hidden lg:contents">
            {ventanaCerrada && (
              <span
                title="El cliente lleva más de 24 horas sin escribir: WhatsApp solo permite reabrir con una plantilla"
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] uppercase ${DETALLE_ESPERA}`}
              >
                <Clock className="h-3 w-3" />
                ventana cerrada
              </span>
            )}
            {detalleDeConfirmacion && (
              <ConfirmationChip status={it.confirmationStatus} />
            )}
            {/* «Novedad» ya es una etiqueta de estado: acá la pastilla de
                logística sería el mismo hecho dicho dos veces en la misma tira. */}
            {guiaDeDetalle !== null && <DropiChip status={guiaDeDetalle} />}
            {it.deliveryFailed && (
              <span
                title="El último mensaje que enviamos no se entregó — revisa si el número es válido"
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] uppercase ${DETALLE_MAL}`}
              >
                <AlertCircle className="h-3 w-3" />
                no entregado
              </span>
            )}
          </span>
        </div>
      )}
    </li>
  );
}

type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

type Msg = {
  id: string;
  direction: "in" | "out";
  body: string;
  fromAgent: boolean;
  status: MessageStatus;
  deliveryError: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  createdAt: string;
};

/** Chulos de entrega, como en WhatsApp: reloj → 1 → 2 → 2 azules → error. */
function DeliveryTicks({
  status,
}: {
  status: MessageStatus;
}) {
  // `--color-text-soft` da 2,85:1 y dejó de ser color de texto, pero estos
  // chulos **dicen algo** —en cola, salió, llegó, lo leyó—, así que van en
  // `--color-text-dim`, que sí llega a AA. El azul de «leído» pasa a la tinta.
  if (status === "failed") {
    return <AlertCircle className="h-3 w-3 text-[var(--color-danger)]" />;
  }
  if (status === "pending") {
    return <Clock className="h-3 w-3 text-[var(--color-text-dim)]" />;
  }
  if (status === "sent") {
    return <Check className="h-3 w-3 text-[var(--color-text-dim)]" />;
  }
  return (
    <CheckCheck
      className={`h-3 w-3 ${
        status === "read"
          ? "text-[var(--color-ink)]"
          : "text-[var(--color-text-dim)]"
      }`}
    />
  );
}

const STATUS_TITLE: Record<MessageStatus, string> = {
  pending: "En cola",
  sent: "Enviado a WhatsApp",
  delivered: "Entregado en el teléfono del cliente",
  read: "Leído por el cliente",
  failed: "No entregado",
};

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A cuántos píxeles del fondo se sigue considerando que el asesor «va al pie»
 * del hilo.
 *
 * No es cero: un hilo se lee cómodo con el último mensaje entero a la vista, y
 * exigir el píxel exacto apagaría el seguimiento en vivo con un arrastre de dos
 * píxeles.
 */
const MARGEN_AL_PIE_PX = 80;

type WindowState = "open" | "closed" | "unknown";

/** Estado de la ventana de 24h de Meta. `unknown` (sin inbound registrado) no
 *  bloquea: solo bloqueamos con evidencia; si Kapso rechaza, el outbox lo marca. */
function windowStateOf(lastInboundAt: string | null): WindowState {
  if (!lastInboundAt) return "unknown";
  const t = Date.parse(lastInboundAt);
  if (!Number.isFinite(t)) return "unknown";
  return Date.now() - t <= SERVICE_WINDOW_MS ? "open" : "closed";
}

/**
 * Un evento de venta tal como viaja por JSON: igual que en `@wa/db`, pero con
 * el instante en texto. Se declara aquí y no se castea a la fecha: el hilo lo
 * único que hace con él es ordenar y mostrar.
 */
type ConFechaEnTexto<T> = T extends { at: Date }
  ? Omit<T, "at"> & { at: string }
  : never;
type WireEvent = ConFechaEnTexto<SalesThreadEvent>;

/** Una línea del hilo: un mensaje o un momento del contexto de venta. */
type ThreadEntry =
  | { at: number; kind: "msg"; msg: Msg }
  | { at: number; kind: "event"; event: WireEvent };

/**
 * Los mensajes y los eventos en un solo hilo, por instante.
 *
 * Es la decisión 2 del nivel 2 hecha código: el producto y el anuncio no son
 * atributos que se consulten en un panel, son **algo que pasó en un momento del
 * chat**. Intercalarlos es lo que los fecha.
 */
function threadEntries(msgs: Msg[], events: WireEvent[]): ThreadEntry[] {
  const entries: ThreadEntry[] = [
    ...msgs.map((msg) => ({
      at: Date.parse(msg.createdAt),
      kind: "msg" as const,
      msg,
    })),
    ...events.map((event) => ({
      at: Date.parse(event.at),
      kind: "event" as const,
      event,
    })),
  ];
  return entries.sort((a, b) => a.at - b.at);
}

/**
 * Aplicar en la lista lo que el servidor ya escribió. Ver `aplicarCambio` en
 * {@link InboxClient}: el predicado dice qué filas cambiaron, el parche qué.
 */
type Aplicar = (
  coincide: (it: ChatItem) => boolean,
  patch: Partial<ChatItem>,
  /** Si queda algo derivado que solo el servidor puede recalcular. */
  necesitaAlServidor?: boolean,
) => void;

function ConversationPane({
  chat,
  approvedTemplates,
  currentUserId,
  sellerConfigured,
  onAplicado,
  suscribirse,
}: {
  chat: ChatItem;
  approvedTemplates: string[];
  currentUserId: string | null;
  sellerConfigured: boolean;
  onAplicado: Aplicar;
  /**
   * Colgarse del stream que la lista ya tiene abierto. Devuelve cómo soltarse.
   *
   * El hilo abría su propio `EventSource` y lo cerraba y reabría con cada
   * cambio de conversación: dos conexiones por pestaña contra el mismo stream,
   * y una de ellas reconectándose todo el tiempo.
   */
  suscribirse: (fn: (ev: WaEvent) => void) => () => void;
}) {
  // Solo para volver: en el teléfono el hilo tapa la lista, y salir es
  // retroceder en el historial, que es donde `?c=` ya está escrito.
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [events, setEvents] = useState<WireEvent[]>([]);
  const [seller, setSeller] = useState<string>("El vendedor");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [assigning, setAssigning] = useState(false);
  // Sin el `location.reload()` que antes lo hacía imposible, el botón del
  // agente se puede pulsar dos veces seguidas. Un POST a la vez.
  const [agentBusy, setAgentBusy] = useState(false);
  const [reopenSending, setReopenSending] = useState<string | null>(null);
  /* En el teléfono las plantillas que no se pueden enviar arrancan plegadas: ver
     el comentario del pie. En escritorio no se usa, porque ahí caben todas. */
  const [verNoDisponibles, setVerNoDisponibles] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Si el asesor va al pie del hilo o se subió a leer. Arranca en `true`:
   * un hilo recién abierto se lee desde el final, como en WhatsApp.
   */
  const alPieRef = useRef(true);

  // La ventana se calcula con el inbound más reciente que conozcamos: el de la
  // lista del servidor o uno recién llegado por SSE a este hilo.
  const latestInboundFromMsgs = msgs
    .filter((m) => m.direction === "in")
    .map((m) => m.createdAt)
    .sort()
    .at(-1);
  const effectiveLastInbound =
    [chat.lastInboundAt, latestInboundFromMsgs]
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;
  const windowState = windowStateOf(effectiveLastInbound);

  const reopenOptions = buildReopenOptions({
    contactName: chat.name.startsWith("+") ? null : chat.name,
    producto: chat.producto,
    dropiGuide: chat.dropiGuide,
    novedadReason: chat.novedadReason,
    approvedTemplates,
  });

  const sendReopen = async (opt: ReopenOption) => {
    if (reopenSending) return;
    setReopenSending(opt.templateName);
    try {
      const r = await fetch("/api/wa/send-template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: chat.to,
          templateName: opt.templateName,
          params: opt.params,
          conversationId: chat.id,
        }),
      });
      if (r.ok) {
        volverAlPie();
        setTimeout(reload, 400);
      } else {
        const j = (await r.json().catch(() => null)) as { error?: unknown } | null;
        alert(
          `No se pudo enviar la plantilla: ${typeof j?.error === "string" ? j.error : r.status}`,
        );
      }
    } finally {
      setReopenSending(null);
    }
  };

  /**
   * Bajar al fondo solo si el asesor ya estaba al fondo.
   *
   * Antes bajaba siempre, y con eso leer la parte de arriba de un hilo activo
   * era imposible: cualquier cosa que llegara arrastraba la vista. Estar al pie
   * es la señal de «voy siguiendo esto en vivo»; haberse subido es la de «estoy
   * leyendo, no me muevas».
   */
  useEffect(() => {
    if (!alPieRef.current) return;
    const el = scrollRef.current;
    // `scrollTo` no existe en todos los entornos donde este componente se
    // monta (jsdom no implementa scroll), y no tenerlo no es motivo para
    // romper el hilo entero.
    el?.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs, events]);

  const anotarSiVaAlPie = () => {
    const el = scrollRef.current;
    if (!el) return;
    alPieRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= MARGEN_AL_PIE_PX;
  };

  /**
   * Mandar algo es volver al pie, aunque se estuviera leyendo arriba.
   *
   * Es la diferencia entre el tráfico y una acción del asesor: que la vista no
   * se mueva sola no significa que no se mueva cuando él la mueve. Escribir y
   * no ver salir el mensaje sería el bug contrario.
   */
  const volverAlPie = () => {
    alPieRef.current = true;
  };

  const reload = async () => {
    const r = await fetch(`/api/conversations/${chat.id}/messages`, {
      cache: "no-store",
    });
    if (r.ok) {
      const j = (await r.json()) as {
        messages: Msg[];
        events?: WireEvent[];
        sellerName?: string;
      };
      setMsgs(j.messages);
      setEvents(j.events ?? []);
      if (j.sellerName) setSeller(j.sellerName);
    }
  };

  useEffect(() => {
    reload();
    return suscribirse((ev) => {
      if (!("conversationId" in ev) || ev.conversationId !== chat.id) return;
      if (ev.type === "message.created") {
        reload();
        return;
      }
      if (ev.type === "message.status") {
        /**
         * Un acuse de entrega o de lectura **no vuelve a pedir el hilo**.
         *
         * Es el mismo criterio que la lista ya aplica y que el hilo no había
         * heredado: cada mensaje que sale produce dos o tres acuses, así que
         * pedía el hilo entero varias veces por mensaje enviado. Lo único que
         * cambia un acuse es el chulo de un mensaje, y eso se reescribe en
         * memoria — así el chulo sigue vivo, como en WhatsApp, sin pagar un
         * viaje ni mover la vista.
         *
         * El fallo sí lo pide: trae el motivo (`deliveryError`), que el
         * evento no lleva y el hilo sí muestra.
         */
        if (ev.status === "failed") {
          reload();
          return;
        }
        setMsgs((prev) =>
          prev.map((m) =>
            m.id === ev.messageId ? { ...m, status: ev.status } : m,
          ),
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, suscribirse]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const r = await fetch("/api/wa/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: chat.to, body: text }),
      });
      if (r.ok) {
        setText("");
        volverAlPie();
        setTimeout(reload, 200);
      } else {
        alert("No se pudo enviar (¿WhatsApp conectado?)");
      }
    } finally {
      setSending(false);
    }
  };

  /**
   * «Esta la estoy trabajando yo», y su contrario.
   *
   * **No toca el modo agente**, y esa separación es el criterio explícito de los
   * dos tickets 04: se puede estar asignado sin haber pausado al vendedor. El
   * botón de al lado sigue siendo `Agente: ON/OFF`, que es el que ya existía.
   */
  const toggleAssignment = async () => {
    if (assigning) return;
    setAssigning(true);
    try {
      const r = await fetch(`/api/conversations/${chat.id}/assignment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on: chat.assignedTo === null }),
      });
      if (!r.ok) {
        alert("No se pudo cambiar quién la trabaja.");
        return;
      }
      // Quién quedó trabajándola lo dice el servidor y no se adivina acá: el
      // endpoint decide que quien toma es siempre el de la sesión, y soltar lo
      // puede hacer cualquiera. El cuerpo trae la fila tal como quedó.
      const j = (await r.json().catch(() => null)) as {
        assignedTo?: ChatItem["assignedTo"];
      } | null;
      const assignedTo = j?.assignedTo ?? null;
      onAplicado(
        (it) => it.id === chat.id,
        {
          assignedTo,
          // Tomarla la saca de «Sin responder» con certeza: `sinResponder` da
          // `false` en cuanto hay alguien asignado. Soltarla podría devolverla,
          // pero eso depende de la escalada y de la actividad, que la fila no
          // trae — ahí no se toca y decide el render del servidor.
          ...(assignedTo ? { sinResponder: false } : {}),
        },
        // Soltarla es lo único que deja algo por derivar: tomarla ya quedó
        // resuelto acá arriba, con certeza.
        assignedTo === null,
      );
    } finally {
      setAssigning(false);
    }
  };

  const toggleAgent = async () => {
    if (agentBusy) return;
    setAgentBusy(true);
    const on = !chat.agentMode;
    try {
      const r = await fetch(`/api/contacts/${chat.contactId}/agent-mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on }),
      });
      if (!r.ok) {
        alert("No se pudo cambiar el modo del agente.");
        return;
      }
      // El modo agente es del contacto: si tiene dos conversaciones en la
      // lista, las dos cambian. Prenderlo saca la fila de «Sin responder» con
      // certeza (`sinResponder` da `false` con el agente encendido); apagarlo
      // podría devolverla, y eso lo decide el servidor.
      onAplicado(
        (it) => it.contactId === chat.contactId,
        {
          agentMode: on,
          ...(on ? { sinResponder: false } : {}),
        },
        // Apagarlo puede devolver la conversación a «sin responder», y eso mira
        // la escalada y la actividad. Prenderlo la saca con certeza.
        !on,
      );
    } finally {
      setAgentBusy(false);
    }
  };

  return (
    /*
      **En el teléfono el hilo va a sangre**: es la pantalla entera, y una
      tarjeta redondeada con borde dejaría cuatro esquinas de fondo a la vista.
      De `lg` para arriba vuelve a ser la tarjeta de siempre, que es lo que la
      separa de la lista.

      La cabecera y el compositor **no se van con el scroll** y eso ya estaba
      resuelto: son hijos `flex-none` de una columna con `overflow-hidden`, y el
      único que scrollea es el hilo. Lo que faltaba era que esta caja midiera la
      ventana en vez de 80vh dentro de una página que scrollea.
    */
    <div className="app-card flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 lg:rounded-lg lg:border">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-3 lg:px-4">
        {/* `basis-full` en el teléfono: el nombre se lleva el primer renglón
            entero y los botones bajan al siguiente. Compartiéndolo, el nombre
            se recortaba a «Víctor C…» a 390 px, y saber a quién le estás
            escribiendo es justo lo que la cabecera fija vino a garantizar. */}
        <div className="flex min-w-0 flex-1 basis-full items-center gap-1.5 lg:basis-auto">
          {/*
            **Volver es el botón de atrás del navegador**, no un estado nuevo: la
            conversación abierta vive en `?c=` desde PRO-11, así que la flecha y
            el gesto del sistema hacen exactamente lo mismo y no se pueden
            desincronizar. En escritorio no hay a dónde volver: la lista está al
            lado.
          */}
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Volver a la bandeja"
            className="-ml-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--color-text-dim)] transition hover:bg-[var(--color-hover)] lg:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{chat.name}</p>
            <p className="text-xs text-[var(--color-text-dim)]">+{chat.to}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sellerConfigured && (
            <button
              onClick={toggleAssignment}
              disabled={assigning}
              title={
                chat.assignedTo
                  ? `La está trabajando ${chat.assignedTo.label} — soltarla la deja libre`
                  : "Marcar que la estás trabajando vos. No pausa al vendedor."
              }
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs uppercase lg:h-8 ${
                chat.assignedTo
                  ? "border-[var(--color-ink)] bg-[var(--color-ink-wash)] text-[var(--color-ink)]"
                  : "border-[var(--color-border)] text-[var(--color-text-dim)]"
              }`}
            >
              <Hand className="h-3.5 w-3.5" />
              {chat.assignedTo
                ? chat.assignedTo.id === currentUserId
                  ? "La trabajo yo · soltar"
                  : `La trabaja ${chat.assignedTo.label}`
                : "Trabajarla yo"}
            </button>
          )}
          <ConfirmationMenu chat={chat} onAplicado={onAplicado} />
          <button
            onClick={toggleAgent}
            disabled={agentBusy}
            className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs uppercase lg:h-8 ${
              chat.agentMode
                ? "border-[var(--color-border)] bg-[var(--state-auto-bg)] text-[var(--state-auto-fg)]"
                : "border-[var(--color-border)] text-[var(--color-text-dim)]"
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            Agente: {chat.agentMode ? "ON" : "OFF"}
          </button>
        </div>
      </header>

      <div className="border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-dim)]">
          <span className="inline-flex h-7 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2">
            <MessageSquareText className="h-3.5 w-3.5" />
            {msgs.length} mensajes
          </span>
          <span className="inline-flex h-7 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2">
            <span className="h-2 w-2 rounded-full bg-[var(--color-ink)]" />
            {chat.agentMode ? "Automatización activa" : "Respuesta manual"}
          </span>
          {chat.dropiStatus && chat.dropiStatus !== "unknown" && (
            <DropiChip status={chat.dropiStatus} />
          )}
          {chat.dropiGuide && (
            <span className="inline-flex h-7 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2">
              <Package className="h-3.5 w-3.5" />
              {chat.dropiGuide}
              {chat.dropiCarrier ? ` · ${chat.dropiCarrier}` : ""}
            </span>
          )}
          {chat.dropiPdfUrl && (
            <a
              href={chat.dropiPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-2 rounded-md border border-[var(--color-border)] px-2 text-[var(--color-ink)] transition hover:bg-[var(--color-ink-wash)]"
            >
              <FileText className="h-3.5 w-3.5" />
              PDF guía
            </a>
          )}
        </div>
      </div>

      {/* `log` es lo que es: la transcripción de una conversación que crece por
          abajo. Le da nombre a la región para quien navega con lector de
          pantalla y no cambia un solo píxel. */}
      <div
        ref={scrollRef}
        role="log"
        aria-label="Mensajes de la conversación"
        onScroll={anotarSiVaAlPie}
        className="flex-1 space-y-2 overflow-y-auto bg-[var(--color-surface)] p-4"
      >
        {threadEntries(msgs, events).map((entry) =>
          entry.kind === "event" ? (
            <SalesEventLine
              key={`ev-${entry.event.kind}-${entry.at}`}
              event={entry.event}
              seller={seller}
            />
          ) : (
            <MessageBubble key={entry.msg.id} m={entry.msg} />
          ),
        )}
      </div>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        {/* «El resto del equipo ve quién la tiene, ANTES de escribir» es el
            criterio del ticket, así que el aviso va pegado al compositor y no
            arriba del todo: arriba se lee cuando ya escribiste. */}
        {sellerConfigured &&
          chat.assignedTo &&
          chat.assignedTo.id !== currentUserId && (
            <div className="mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-ink-wash)] p-2.5 text-xs leading-5 text-[var(--color-text)]">
              👤 <strong>{chat.assignedTo.label} está trabajando esta
              conversación.</strong> Si vas a escribir, avisale primero: el
              cliente ve un solo hilo.
            </div>
          )}
        {windowState === "closed" ? (
          /*
            **El pie no puede comerse la conversación.** Con la ventana cerrada
            este bloque trae el aviso más una tarjeta por plantilla, y sin límite
            dejaba el hilo en un fragmento de burbuja a 390 px: unos 500 px de pie
            sobre una pantalla de 844.

            Se arregla con la misma regla que la fila del nivel 4: **no gastar
            pantalla en lo que no te deja actuar.** Casi siempre solo una de las
            plantillas es enviable —las demás explican que les falta un pedido de
            Shopify o una novedad de Dropi—, así que en el teléfono esas arrancan
            plegadas detrás de su cuenta. En escritorio se ven todas, que es como
            estaba.

            El tope de altura es el cinturón: aunque un día haya seis enviables,
            el hilo conserva más de la mitad de la pantalla.
          */
          <div className="max-h-[46svh] space-y-2 overflow-y-auto lg:max-h-none lg:overflow-visible">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--state-espera-bg)] p-3 text-xs leading-5 text-[var(--state-espera-fg)]">
              ⏳ <strong>Ventana de 24h cerrada.</strong>{" "}
              <span className="hidden lg:inline">
                El cliente lleva más de 24 horas sin escribir y WhatsApp solo
                permite reabrir con una plantilla aprobada por Meta. Cuando
                responda, el chat libre se habilita de nuevo.
              </span>
              <span className="lg:hidden">
                Solo se puede reabrir con una plantilla.
              </span>
            </div>
            <div className="space-y-2">
              {reopenOptions.map((opt) => (
                <div
                  key={opt.templateName}
                  className={`items-start justify-between gap-3 rounded-lg border p-2.5 lg:flex ${
                    opt.sendable
                      ? "flex border-[var(--color-border)]"
                      : `border-[var(--color-border)] opacity-50 ${
                          verNoDisponibles ? "flex" : "hidden"
                        }`
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[var(--color-text)]">
                      {opt.label}
                      {!opt.sendable && opt.reason && (
                        <span className="ml-2 font-normal text-[var(--color-warn)]">
                          · {opt.reason}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-[var(--color-text-dim)]">
                      {opt.preview}
                    </p>
                  </div>
                  <button
                    onClick={() => sendReopen(opt)}
                    disabled={!opt.sendable || reopenSending !== null}
                    className="app-button shrink-0 gap-1.5 text-xs"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {reopenSending === opt.templateName ? "Enviando…" : "Enviar"}
                  </button>
                </div>
              ))}
              {/* Solo en el teléfono, y solo si hay algo plegado que mostrar. */}
              {reopenOptions.some((o) => !o.sendable) && (
                <button
                  onClick={() => setVerNoDisponibles((v) => !v)}
                  className="w-full rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-xs font-medium text-[var(--color-text-dim)] lg:hidden"
                >
                  {verNoDisponibles
                    ? "Ocultar las que no se pueden enviar"
                    : `${reopenOptions.filter((o) => !o.sendable).length} no se pueden enviar todavía`}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {windowState === "unknown" && (
              <p className="text-[11px] leading-4 text-[var(--color-text-dim)]">
                Este contacto aún no ha escrito — si WhatsApp rechaza el envío
                por falta de ventana activa, usa una plantilla.
              </p>
            )}
            <div className="flex flex-wrap items-start gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Escribe un mensaje…"
                className="app-input min-w-[180px] flex-1"
              />
              {/* Solo con la ventana abierta: una nota de voz no puede reabrir
                  una conversación de más de 24h, eso exige plantilla. */}
              <VoiceRecorder
                to={chat.to}
                conversationId={chat.id}
                onSent={() => {
                  volverAlPie();
                  setTimeout(reload, 400);
                }}
              />
              <button
                onClick={send}
                disabled={sending || !text.trim()}
                className="app-button gap-2"
              >
                <Send className="h-4 w-4" />
                Enviar
              </button>
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}

/** Un globo del hilo. Es el mismo de siempre, extraído para poder intercalar
 *  los eventos de venta entre los mensajes sin duplicar su marcado. */
function MessageBubble({ m }: { m: Msg }) {
  return (
          <div
            className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
          >
            <div
              // Las dos burbujas dejaron de ser degradados: son un color cada
              // una, y la del cliente se separa del fondo con la línea suave y
              // no con la opacidad de casi el mismo color.
              className={`max-w-[78%] rounded-lg border px-3 py-2 text-sm ${
                m.direction === "out"
                  ? "border-transparent bg-[var(--color-bubble-out)]"
                  : "border-[var(--color-border)] bg-[var(--color-bubble-in)]"
              } ${
                m.status === "failed" && m.direction === "out"
                  ? "border-[var(--color-danger)]"
                  : ""
              }`}
            >
              {m.mediaUrl && m.mediaMime?.startsWith("audio/") ? (
                <div className="space-y-1">
                  <audio
                    src={m.mediaUrl}
                    controls
                    preload="metadata"
                    className="h-9 w-[240px] max-w-full"
                  />
                  {/* Para el audio entrante el body es la transcripción de
                      Kapso: se muestra como pie para poder leer sin escuchar. */}
                  {m.direction === "in" && m.body.trim() && (
                    <p className="whitespace-pre-wrap break-words text-xs italic text-[var(--color-text-dim)]">
                      “{m.body}”
                    </p>
                  )}
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              )}
              {m.direction === "out" && m.status === "failed" && (
                <p className="mt-1 text-[11px] leading-4 text-[var(--color-danger)]">
                  ⚠ No entregado
                  {m.deliveryError ? ` · ${m.deliveryError}` : ""}
                </p>
              )}
              <p
                className="mt-1 flex items-center justify-end gap-1 text-[10px] uppercase text-[var(--color-text-dim)]"
                suppressHydrationWarning
              >
                {m.fromAgent && "BOT "}
                {new Date(m.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {m.direction === "out" && (
                  <span title={STATUS_TITLE[m.status]} className="ml-0.5 flex">
                    <DeliveryTicks status={m.status} />
                  </span>
                )}
              </p>
            </div>
          </div>
  );
}

/** De qué anuncio vino, dicho por su id o, si no lo hay, por su titular. */
function deQueAnuncio(event: {
  adId: string | null;
  adHeadline: string | null;
}): string {
  if (event.adId) return ` · anuncio ${event.adId}`;
  return event.adHeadline ? ` · «${event.adHeadline}»` : "";
}

/**
 * Un momento del contexto de venta, dentro del hilo.
 *
 * Se lee como una línea de sistema y no como un mensaje: no es de nadie de los
 * dos lados de la conversación, es algo que le pasó a la conversación.
 */
function SalesEventLine({
  event,
  seller,
}: {
  event: WireEvent;
  seller: string;
}) {
  const texto = ((): string => {
    if (event.kind === "producto_identificado") {
      const anuncio = event.adId ? ` · anuncio ${event.adId}` : "";
      return event.productName
        ? `${seller} reconoció ${event.productName}${anuncio}`
        : `${seller} reconoció el producto${anuncio}`;
    }
    if (event.kind === "producto_ambiguo") {
      const deDonde = deQueAnuncio(event);
      // Entre qué dudó es la información útil: sin ella el evento diría lo
      // mismo que «no encontré nada», que es justo lo que se separó. Cuando
      // algún candidato ya no se puede nombrar —borrado del catálogo, o su
      // nombre vive en la tienda— se dice cuántos eran, que sigue siendo cierto.
      const nombres = event.candidates.filter(
        (n): n is string => typeof n === "string" && n.trim().length > 0,
      );
      const entreQue =
        nombres.length === event.candidates.length && nombres.length > 0
          ? nombres.join(" · ")
          : `${event.candidates.length} productos del anuncio`;
      return `${seller} dudó entre ${entreQue}${deDonde}`;
    }
    if (event.kind === "producto_sin_identificar") {
      return `${seller} no logró identificar el producto${deQueAnuncio(event)}`;
    }
    const frase = escalationPhrase(event.reason);
    const sufijo = frase ? ` ${frase}` : "";
    // Solo los motivos del vendedor llevan su nombre: el de audio es del agente
    // que confirma y existe desde mucho antes que este módulo.
    return isSalesEscalation(event.reason)
      ? `${seller} escaló${sufijo}`
      : `Escalada a un asesor${sufijo}`;
  })();
  // Tres tonos y no dos: la duda entre candidatos es del mismo azul con que la
  // fila la marca —hay que desempatar, ahí mismo—, y el ámbar queda para lo que
  // está trabado fuera del chat: un anuncio sin cargar, una escalada.
  const tono =
    event.kind === "producto_identificado"
      ? "hecho"
      : event.kind === "producto_ambiguo"
        ? "duda"
        : "alarma";
  return (
    <div className="flex justify-center py-1">
      <span
        // Los mismos tres tintes que la fila usa para lo mismo, y salidos de
        // los mismos tokens: la línea del hilo y la etiqueta de la lista hablan
        // de un solo hecho y no tendrían por qué verse de dos maneras.
        className={`inline-flex max-w-[86%] items-center gap-1.5 rounded-full border border-transparent px-3 py-1 text-[11px] leading-4 ${
          tono === "alarma"
            ? "bg-[var(--state-espera-bg)] text-[var(--state-espera-fg)]"
            : tono === "duda"
              ? "bg-[var(--state-sinprod-bg)] text-[var(--state-sinprod-fg)]"
              : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-text-dim)]"
        }`}
      >
        {tono === "alarma" ? (
          <AlertTriangle className="h-3 w-3 shrink-0" />
        ) : tono === "duda" ? (
          <HelpCircle className="h-3 w-3 shrink-0" />
        ) : (
          <Sparkles className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate">{texto}</span>
        <span className="shrink-0 opacity-60" suppressHydrationWarning>
          {new Date(event.at).toLocaleDateString([], {
            day: "2-digit",
            month: "short",
          })}
        </span>
      </span>
    </div>
  );
}

function DropiChip({ status }: { status: DropiStatus }) {
  const meta = DROPI_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] uppercase ${meta.classes}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function ConfirmationChip({ status }: { status: ConfirmationStatus }) {
  if (status === "unknown") return null;
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] uppercase ${meta.classes}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function ConfirmationMenu({
  chat,
  onAplicado,
}: {
  chat: ChatItem;
  onAplicado: Aplicar;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[chat.confirmationStatus];
  const Icon = meta.icon;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const set = async (status: ConfirmationStatus) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/conversations/${chat.id}/confirmation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) {
        alert("No se pudo marcar la confirmación.");
        return;
      }
      setOpen(false);
      // `setConfirmationStatus` escribe siempre `manual` en el origen, también
      // al volver a «sin clasificar»: la marca dice quién decidió, no qué.
      onAplicado((it) => it.id === chat.id, {
        confirmationStatus: status,
        confirmationSource: "manual",
      });
    } finally {
      setBusy(false);
    }
  };

  const options: ConfirmationStatus[] = [
    "confirmed",
    "not_confirmed",
    "pending",
    "unknown",
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs uppercase lg:h-8 ${meta.classes}`}
        disabled={busy}
      >
        <Icon className="h-3.5 w-3.5" />
        {meta.label}
        {chat.confirmationSource === "manual" && (
          <span className="ml-1 rounded bg-[var(--color-surface)] px-1 text-[9px]">
            manual
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1 text-xs shadow-[var(--shadow-panel)]">
          {options.map((status) => (
            <button
              key={status}
              onClick={() => set(status)}
              disabled={busy}
              className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-[var(--color-hover)]"
            >
              <ConfirmationChip status={status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
