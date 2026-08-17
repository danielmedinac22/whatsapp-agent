# Spec · Operaciones (multi-país)

Status: ready-for-agent

Origen: nota de voz del 16-ago-2026 · decisiones en [el mapa](../panel-de-ventas/map.md)

**Este spec es la base de los otros cuatro.** Ninguno funciona sin él.

## Problem Statement

El sistema entero asume que existe **un solo negocio**. No como decisión de diseño, sino como sedimento: la conexión de WhatsApp es una fila, la conexión de la tienda es una fila, la conexión de logística es una fila, la configuración del agente es una fila. Ciento diez referencias en el código dan por sentado que preguntar "la conexión" tiene una sola respuesta.

Vorare opera hoy en **Guatemala** —verificado: 1.678 pedidos, todos en quetzales, todos con destino Guatemala— y va a abrir **Colombia**, con su propio número, su propia tienda, su propio catálogo y su propia logística.

Sin este trabajo, la segunda operación no tiene dónde existir. Con él mal hecho, un pedido de Colombia puede terminar creado en la tienda de Guatemala, que es el tipo de error que nadie detecta hasta que sale un envío al país equivocado.

## Solution

Aparece **Operación**: un país donde el negocio opera. Cada operación posee su número de WhatsApp, su tienda, su conexión de logística, su catálogo, sus agentes y su moneda.

Todo mensaje entrante **resuelve su operación** por la conexión por la que llegó, y esa operación acompaña la conversación de principio a fin. Todo lo que el sistema hace después —qué catálogo consulta, en qué tienda crea el pedido, con qué lista valida la dirección, en qué moneda— sale de ahí, nunca de un valor global.

En el panel, un **selector de operación** define sobre cuál se está trabajando.

Y como cada operación tiene **un solo número**, ventas y confirmación conviven en el mismo hilo: la conversación tiene un agente dueño en cada momento, y el paso de uno a otro ocurre dentro del mismo chat.

## User Stories

1. Como cliente en Guatemala, quiero que me atiendan en quetzales y con direcciones de mi país, para que mi pedido llegue.
2. Como cliente en Colombia, quiero lo mismo con mi moneda y mi país, sin que el sistema me ofrezca opciones guatemaltecas.
3. Como cliente, quiero escribir a un solo número y que ahí me vendan y me confirmen, para no tener que hablar con dos contactos distintos.
4. Como cliente que acaba de comprar, quiero que el mensaje de confirmación llegue en el mismo chat donde compré, para no dudar de si es legítimo.
5. Como admin, quiero elegir sobre qué operación estoy trabajando, para no confundirme entre países.
6. Como admin, quiero que quede evidente en pantalla en qué operación estoy, para no editar el catálogo equivocado.
7. Como admin, quiero configurar cada operación por separado, para que los cambios de una no toquen la otra.
8. Como admin, quiero que cada operación tenga su propio catálogo, porque los productos que vendo en cada país son distintos.
9. Como admin, quiero conectar la tienda de cada país por separado, porque son dos tiendas distintas.
10. Como asesor, quiero ver de qué operación es cada conversación, para responder con el contexto correcto.
11. Como asesor, quiero filtrar conversaciones por operación, para atender una a la vez.
12. Como dueño de Vorare, quiero que un pedido de Colombia jamás se cree en la tienda de Guatemala, para no despachar al país equivocado.
13. Como dueño de Vorare, quiero abrir un tercer país sin que haya que reescribir el sistema, para crecer sin rehacer.
14. Como operador del sistema, quiero que la operación de Guatemala siga funcionando exactamente igual durante toda la migración, porque es la que hoy factura.

## Implementation Decisions

**Operación como entidad de primer nivel.** Tiene país, moneda, nombre visible y estado. Las conexiones de WhatsApp, tienda y logística cuelgan de ella, igual que el catálogo y las configuraciones de agente.

**Expand–contract sobre las cuatro tablas singleton.** El radio de impacto es de ciento diez referencias repartidas en cuatro tablas, así que no se fuerza en un corte vertical:

1. **Expand.** Se agrega la referencia a operación junto a lo existente, y se crea la operación de Guatemala con los datos actuales. Nada se rompe: los accesores actuales siguen devolviendo lo mismo.
2. **Migrar por lotes**, dimensionados por tabla — el orden natural es de menor a mayor radio: conexión de WhatsApp, conexión de tienda, conexión de logística, configuración de agente. Cada lote es su propio ticket y deja el sistema verde, porque la forma vieja sigue existiendo.
3. **Contract.** Se elimina el acceso global cuando ya nadie lo usa.

**La operación se resuelve en la ingesta y viaja con la conversación.** Un mensaje entrante determina su operación por la conexión que lo recibió; la conversación la guarda. Ningún componente aguas abajo vuelve a preguntar "cuál es la operación actual" — la recibe.

**Prohibido el acceso global una vez migrado.** Que exista una función que devuelva "la conexión" sin decir de cuál operación es el mecanismo exacto por el que un pedido colombiano termina en la tienda guatemalteca. Al terminar el contract, esa función no debe existir.

**Un número por operación, con dos agentes.** La conversación tiene un **agente dueño** en cada momento. El vendedor es dueño desde que entra el lead hasta que el pedido queda creado; ahí la propiedad pasa al agente de confirmación. Un asesor puede tomar el chat en cualquier punto, lo que suspende a ambos.

**El handoff dentro del mismo número no necesita plantilla nueva, pero las plantillas no desaparecen.** Cuando el cliente acaba de escribir, la ventana está abierta y el primer mensaje de confirmación es texto libre. Pero **los pedidos que entran directo desde la tienda conservan el flujo de hoy sin cambio alguno**: quien compra en la web puede no haber escrito nunca al número, así que su primer toque es plantilla, con la demora actual. Y el seguimiento posterior de guía y entrega sigue siendo plantilla para todos, porque cae fuera de ventana.

La regla es que **el origen decide el contenido y la ventana decide el mecanismo**, nunca el origen por sí solo — un pedido de ventas atascado más de veinticuatro horas también pierde su ventana.

**Validación geográfica y moneda por operación.** La lista de ciudades y divisiones administrativas contra la que se valida una dirección sale de la operación, no de una constante. Lo mismo la moneda de los pedidos.

**Guatemala primero, sin regresiones.** La operación existente se migra primero y su comportamiento observable no cambia en ningún paso. Colombia se crea cuando la migración esté completa.

## Testing Decisions

Un buen test aquí demuestra **aislamiento**: que datos de una operación no se filtren a otra. Es el riesgo real del spec, y es el que un test puede atrapar y una revisión visual no.

**Módulos probados:**

- La resolución de operación a partir de un mensaje entrante.
- La validación geográfica parametrizada por país.

**Casos que deben quedar cubiertos:** un mensaje entrante por la conexión de Guatemala resuelve a Guatemala y otro por la de Colombia resuelve a Colombia; una conexión desconocida no resuelve a ninguna operación en vez de caer en una por defecto; una dirección guatemalteca válida falla contra la lista colombiana y viceversa; y un pedido construido para una operación lleva la moneda de esa operación.

**Prior art:** `kapso/inbound.test.ts` para el parseo de entrantes; `dropi/normalize.test.ts` para transformaciones puras. Mismo estilo: vitest, fixtures inline, nombres en español.

La migración por lotes se verifica con la suite existente en verde después de cada lote, no con tests nuevos: su criterio de éxito es que nada se rompió.

## Out of Scope

- **Multi-cliente.** Varias operaciones de un mismo cliente no es lo mismo que varios clientes. LogiGho y demás siguen fuera.
- Traducción o localización de idioma. Ambas operaciones hablan español.
- Consolidación de reportes entre operaciones.
- Una tercera operación. El modelo la soporta; abrirla es otro trabajo.

## Further Notes

**Prerequisito sin dueño:** la tabla de conexión de la tienda **está vacía**. Los pedidos entran por webhook usando un secreto de entorno, pero **crear** pedidos por la API de administración necesita esa conexión configurada, y nadie lo ha hecho. Aplica a las dos operaciones y bloquea el cierre de ventas.

**Dato para revisar:** la logística está marcada como activa pero **en modo simulación** — las confirmaciones no se envían de verdad. Conviene saber si es intencional antes de replicar la configuración en Colombia.

**Sobre el catálogo:** el análisis que decidió el mecanismo de reconocimiento de producto —cuatro SKUs de nombre casi idéntico concentrando el 77% del volumen— es del catálogo **guatemalteco**. La decisión de usar el identificador de anuncio como primario se sostiene igual para Colombia, porque es la opción robusta en ambos casos, pero la evidencia que la motivó es de un solo país.
