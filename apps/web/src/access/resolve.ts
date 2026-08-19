/**
 * Quién alcanza qué del panel.
 *
 * Todo lo de este archivo es PURO: no toca la base, ni la sesión, ni el reloj.
 * Recibe un rol y una ruta y devuelve si pasa. Los dos bordes que la aplican
 * —el proxy (`src/proxy.ts`) y el menú del layout de `(app)`— le preguntan a
 * esta misma función, así que el menú no puede prometer una pantalla que el
 * borde rebota, ni al revés.
 *
 * **La guarda va en el borde común, no en cada pantalla.** Una guarda por
 * pantalla se olvida el día que alguien agrega la siguiente; el proxy corre
 * antes de toda ruta —pantallas *y* rutas de datos— y no se puede saltar
 * agregando un archivo. Lo único que se olvida aquí es una línea de
 * {@link AREAS}, y olvidarla **no filtra nada**: una ruta sin clasificar queda
 * cerrada para los roles nuevos (`ruta_sin_clasificar`). El error posible es
 * que a ventas le falte una pantalla suya —se ve al primer clic—, nunca que
 * alcance una que no le toca.
 *
 * **El criterio que manda sobre todos los demás: nadie pierde acceso.** En
 * producción hay tres usuarios y los tres son `admin` (verificado el
 * 17-ago-2026, no supuesto). Por eso esta función solo sabe *quitar* alcance a
 * `sales` y `operations`, que hoy no tiene nadie: cualquier otro rol —`admin`,
 * el heredado `operator`, un valor que este código no conozca, o una sesión sin
 * rol— pasa por todas partes, igual que hoy. Es imposible que esta migración le
 * quite una pantalla a alguien que ya existe.
 *
 * La separación la impone **el rol, no el módulo**: quien legítimamente hace
 * las dos cosas —los tres admin de hoy— no queda atrapado en una.
 */

import type { User } from "@wa/db";

/**
 * Los roles del sistema. Es el tipo del enum real (`user_role`) y no una unión
 * escrita a mano: si el esquema gana un rol, el `switch` de {@link moduleOf}
 * deja de compilar hasta que alguien decida qué módulo abre. Es el mismo idioma
 * que `inbox/resolve.ts`, que saca `OrderPipelineStatus` de `ShopifyOrder`.
 */
export type Role = User["role"];

/**
 * Los dos módulos: el del vendedor y el de confirmación. Son los mismos nombres
 * que las bandejas de `apps/worker/src/inbox/resolve.ts`, a propósito: quien
 * tiene el rol ve la bandeja homónima.
 *
 * Ojo con el idioma: `operaciones` es el equipo que confirma pedidos, no la
 * tabla `operations` (el país). La colisión es del lenguaje del negocio y ya se
 * decidió respetarla en el esquema; el país no se decide aquí —país primero,
 * módulo dentro— y esta función no lo mira.
 */
export type Module = "ventas" | "operaciones";

/**
 * A qué parte del panel pertenece una ruta.
 *
 * - un {@link Module}: la ruta es de ese módulo y solo la alcanza quien lo abre.
 * - `ambos`: los dos módulos la necesitan. La bandeja, el historial de un chat,
 *   mandar un mensaje. **El historial no se separa** —operaciones necesita ver
 *   qué le prometió ventas al cliente— y esa decisión ya está en el spec.
 * - `solo-admin`: configuración de la operación, no de un módulo. La conexión
 *   de la tienda es de la operación —ambos módulos dependen de ella—, así que
 *   no cuelga de ninguno: la toca quien administra.
 */
export type Area = Module | "ambos" | "solo-admin";

/**
 * La tabla. **Es lo único que hay que tocar al agregar una pantalla**, y su
 * ausencia cierra en vez de abrir.
 *
 * Los patrones se comparan por segmentos y **matchean prefijos**: `/api/agent`
 * cubre `/api/agent/prompt/versions/<id>/restore`. Un `*` vale por exactamente
 * un segmento, para los `[id]` que quedan en medio. Gana el patrón más largo,
 * así que el orden de esta lista no cambia el resultado — dos patrones del
 * mismo largo no deben poder matchear la misma ruta.
 *
 * La clasificación de hoy sale de lo que cada pantalla realmente hace, no de su
 * nombre: `/templates` y `/agent` parecen genéricas y no lo son — todos los
 * tipos de plantilla que existen (`followup`, `remarketing`, `confirmation_ack`,
 * `dropi_*`) y toda la configuración de `agent_settings` son del agente que
 * confirma y acompaña la entrega. Lo de ventas vive en `sales_agent_settings`,
 * `products` y `product_ads`, que la `0022` dejó vacías, y son las dos
 * pantallas que la ola del 18-ago-2026 está construyendo: `/catalogo` y
 * `/vendedor`, ya clasificadas abajo aunque sus páginas todavía no existan.
 */
const AREAS: Readonly<Record<string, Area>> = {
  // ── Pantallas ──────────────────────────────────────────────────────────
  /** La bandeja. Hoy es una sola; el ticket 03 la parte en dos. */
  "/inbox": "ambos",
  /**
   * Las dos pantallas de ventas, cuyas páginas construyen otros worktrees de la
   * ola. Van clasificadas desde ya porque **la ausencia cierra**: sin línea
   * aquí, `resolveAccess` las manda a `ruta_sin_clasificar` y el menú no las
   * ofrece a nadie con módulo — la pantalla existiría y nadie la vería.
   *
   * Son de ventas y no `ambos`: el catálogo es lo que Sebastián ofrece y la
   * configuración del vendedor es su persona. Lo de confirmación no las toca.
   */
  "/catalogo": "ventas",
  "/vendedor": "ventas",
  /**
   * El estado del reporte de conversiones a Meta (`ventas-capi/05`). Es de
   * ventas y no `solo-admin` porque lo que informa es la salud de un camino del
   * módulo —si las ventas del vendedor le vuelven a la pauta—, no una conexión
   * de la operación. Es de sólo lectura y no enciende nada: el modo se cambia
   * por entorno y con un despliegue.
   */
  "/reporte-meta": "ventas",
  /** Plantillas de confirmación, seguimiento, remarketing y logística. */
  "/templates": "operaciones",
  /** Prompt, modelo y automatizaciones del agente que confirma. */
  "/agent": "operaciones",
  /** Pedidos y su estado logístico. */
  "/orders": "operaciones",
  /** WhatsApp, Shopify y Dropi: es de la operación, no de un módulo. */
  "/connection": "solo-admin",

  // ── Rutas de datos de la bandeja ───────────────────────────────────────
  /** Estado de la conexión: lo pinta el indicador que está en el layout. */
  "/api/wa/status": "ambos",
  "/api/wa/send": "ambos",
  "/api/wa/send-audio": "ambos",
  "/api/wa/send-template": "ambos",
  /** El stream que refresca la bandeja. */
  "/api/events": "ambos",
  /** Adjuntos de los mensajes. */
  "/api/media": "ambos",
  /** El historial de un chat, que los dos módulos ven entero. */
  "/api/conversations/*/messages": "ambos",
  /**
   * «Contesta el bot o contesto yo». No es una decisión de confirmación sino de
   * quién conduce el chat, y los dos módulos la necesitan. Lo que hoy hace que
   * ventas pueda tocarla sobre un chat de operaciones es que la bandeja es una
   * sola: quién ve qué conversación lo decide el ruteo del ticket 03, no el rol.
   */
  "/api/contacts/*/agent-mode": "ambos",
  /**
   * «Esta la estoy trabajando yo». Área común y no de ventas: es una marca
   * sobre la conversación —quién la atiende ahora—, no una decisión de módulo,
   * y el equipo que confirma la necesita por la misma razón que el que vende.
   * Sin esta línea la ruta quedaría `ruta_sin_clasificar` y **cerrada**: hoy no
   * se notaría, porque los tres usuarios de producción son `admin`, y se
   * notaría el día que exista el primer `sales`.
   */
  "/api/conversations/*/assignment": "ambos",

  // ── Rutas de datos de confirmación ─────────────────────────────────────
  /** Marcar un pedido confirmado o no confirmado. Es *la* decisión de Katherine. */
  "/api/conversations/*/confirmation": "operaciones",
  /** Configuración del agente que confirma, y el historial de su prompt. */
  "/api/agent": "operaciones",
  /** Pedidos de logística: listarlos, confirmarlos, enlazarlos. */
  "/api/dropi/orders": "operaciones",

  // ── Rutas de datos de la operación ─────────────────────────────────────
  "/api/dropi/connection": "solo-admin",
  "/api/dropi/sync": "solo-admin",
  "/api/shopify/connection": "solo-admin",
};

/**
 * La pantalla a la que rebota quien no alcanza la que pidió. Es área común, es
 * lo que la raíz ya abre, y por eso todo rol llega.
 */
export const LANDING_PATH = "/inbox";

/**
 * A qué **bandeja** cae cada rol, ahora que el ticket 03 partió la bandeja en
 * dos. Es la pregunta que este archivo dejó abierta para ese ticket.
 *
 * La ruta no cambia —hay una sola pantalla, decisión del nivel 2— y lo que
 * cambia es el parámetro: quien vende cae en la de ventas, todos los demás en
 * la de siempre. **Sigue siendo `/inbox` para todo el mundo**, así que el
 * rebote no puede quedarse sin destino ni entrar en un bucle.
 *
 * Hoy no lo nota nadie: los tres usuarios de producción son `admin` y `admin`
 * no tiene módulo. Se decide igual porque el día que exista el primer `sales`,
 * lo que no esté decidido acá lo va a mandar a la bandeja de Katherine.
 */
export function landingFor(role: Role | undefined): {
  pathname: string;
  search: string;
} {
  const modulo = role === undefined ? null : moduleOf(role);
  return {
    pathname: LANDING_PATH,
    search: modulo === "ventas" ? "?b=ventas" : "",
  };
}

/**
 * Qué módulo abre un rol. `null` = **ningún módulo lo restringe**: alcanza todo
 * el panel.
 *
 * `operator` es el valor heredado y devuelve `null` a propósito: nadie lo tiene
 * en producción, sigue siendo el `default` de `users.role`, y hoy alcanza todo
 * el panel porque hoy no hay ninguna separación. Mapearlo a un módulo le
 * cambiaría el rol a alguien por efecto colateral de este ticket, que es
 * justamente lo que no se puede hacer. Queda dicho en el ticket qué debería
 * ser, y se deja como está.
 */
export function moduleOf(role: Role): Module | null {
  switch (role) {
    case "sales":
      return "ventas";
    case "operations":
      return "operaciones";
    case "admin":
    case "operator":
      return null;
    default:
      return unknownRoleReachesEverything(role);
  }
}

/**
 * La red para un rol que este código no conoce.
 *
 * El parámetro `never` es la verificación de exhaustividad: si el enum
 * `user_role` gana un valor, {@link moduleOf} deja de compilar hasta que
 * alguien decida ahí qué módulo abre, en vez de dejarlo caer aquí en silencio.
 *
 * En ejecución sí puede llegar algo —un token viejo emitido antes de que la
 * sesión llevara rol, una fila con un valor que el enum cambió— y entonces
 * **no se le quita nada**: esta migración solo puede restringir a `sales` y
 * `operations`. Cerrar aquí sería la forma de dejar a Katherine sin confirmar
 * por un token viejo, y eso es exactamente lo que no puede pasar.
 */
function unknownRoleReachesEverything(_role: never): null {
  return null;
}

/** Por qué se dejó pasar, o por qué no. */
export type AccessRule =
  /** El rol no está restringido a ningún módulo: admin, `operator`, o desconocido. */
  | "rol_sin_restriccion"
  /** La ruta es de los dos módulos. */
  | "area_comun"
  /** La ruta es del módulo que este rol abre. */
  | "modulo_propio"
  /** La ruta es del otro módulo. Este es el rebote que pide el ticket. */
  | "modulo_ajeno"
  /** La ruta es configuración de la operación y el rol no es admin. */
  | "solo_admin"
  /** La ruta no está en {@link AREAS}. Cerrada para los roles con módulo. */
  | "ruta_sin_clasificar";

/**
 * Si pasa, y cuál de las reglas lo decidió. La regla no es decorativa: es lo
 * que deja verificar que ventas rebotó de `/orders` **por ser de otro módulo**
 * y no porque la ruta se quedó sin clasificar por accidente.
 */
export interface AccessDecision {
  allowed: boolean;
  rule: AccessRule;
}

/** Los segmentos no vacíos de una ruta: `/api/media/7` → `["api","media","7"]`. */
function segments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/** Si el patrón cubre la ruta, tratándolo como prefijo y con `*` = un segmento. */
function matches(pattern: readonly string[], path: readonly string[]): boolean {
  if (pattern.length > path.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    const expected = pattern[i];
    if (expected === "*") continue;
    if (expected !== path[i]) return false;
  }
  return true;
}

/**
 * El área de una ruta, o `null` si no está en la tabla. Gana el patrón más
 * largo, así que las dos rutas de una conversación —el historial y la
 * confirmación— no se pisan aunque compartan prefijo.
 *
 * La raíz es área común porque no es una pantalla: solo redirige a la bandeja.
 * Se resuelve antes de la tabla para que no la cubra ningún patrón vacío — un
 * prefijo de cero segmentos matchearía *todas* las rutas y abriría por defecto
 * justo lo que aquí se cierra.
 */
function areaOf(pathname: string): Area | null {
  const path = segments(pathname);
  if (path.length === 0) return "ambos";

  let best: Area | null = null;
  let bestLength = -1;
  for (const [pattern, area] of Object.entries(AREAS)) {
    const parts = segments(pattern);
    if (parts.length > bestLength && matches(parts, path)) {
      best = area;
      bestLength = parts.length;
    }
  }
  return best;
}

/**
 * Si un rol alcanza una ruta.
 *
 * El rol llega de la sesión, así que puede faltar: un token emitido antes de
 * que la sesión llevara rol no tiene ninguno. Ausente **no restringe** — misma
 * razón que {@link unknownRoleReachesEverything}.
 *
 * No mira el método HTTP: leer y escribir una ruta de otro módulo son la misma
 * respuesta. Y no mira la operación (el país), que es una separación distinta y
 * de otro ticket.
 */
export function resolveAccess(
  role: Role | undefined,
  pathname: string,
): AccessDecision {
  const modulo = role === undefined ? null : moduleOf(role);
  if (modulo === null) return { allowed: true, rule: "rol_sin_restriccion" };

  const area = areaOf(pathname);
  if (area === null) return { allowed: false, rule: "ruta_sin_clasificar" };
  if (area === "ambos") return { allowed: true, rule: "area_comun" };
  if (area === "solo-admin") return { allowed: false, rule: "solo_admin" };
  return area === modulo
    ? { allowed: true, rule: "modulo_propio" }
    : { allowed: false, rule: "modulo_ajeno" };
}
