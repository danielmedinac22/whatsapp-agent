# Spec · Módulos, roles y ruteo de bandeja

Status: ready-for-agent

Origen: revisión con Pablo, 16-ago-2026 · depende de [Operaciones](../ventas-multi-operacion/spec.md)

## Problem Statement

Dos equipos trabajan sobre el mismo número: **ventas**, que atiende a quien llega por un anuncio, y **operaciones**, que confirma el pedido y acompaña la entrega. Hoy no existe ninguna separación entre ellos — de hecho no existe el equipo de ventas: los roles del sistema son `admin` y `operator`, y punto.

Sin separación pasan dos cosas malas. La primera es de foco: alguien de confirmaciones abre la bandeja y ve conversaciones de venta que no le tocan, mezcladas con las suyas, y tiene que filtrar a ojo. La segunda es peor: **nadie sabe de quién es cada conversación**. Un lead que cerró y espera confirmación se ve igual que uno que sigue negociando, así que o lo atienden dos personas o no lo atiende ninguna.

Y el problema no se arregla poniendo una etiqueta que alguien mantenga a mano. Ya hay **tres máquinas de estado** en el sistema —el pipeline del pedido, el estado de confirmación de la conversación y los quince estados logísticos— y todas tendrían que estar de acuerdo con esa cuarta. La que miente siempre es la que un humano olvidó actualizar.

## Solution

**Módulos como espacios de trabajo.** Dentro de cada operación hay dos: el de Katherine, con las plantillas de confirmación, los pedidos y la logística; y el de Sebastián, con las plantillas de venta, la persona, el catálogo y los anuncios. Cada quien entra al suyo y ve lo suyo.

**Roles que abren puertas.** Ventas entra al módulo de Sebastián, operaciones al de Katherine, y admin a ambos.

**El estado no se guarda: se deriva, y su trabajo es rutear.** De los hechos que ya existen —¿hay atribución de anuncio reciente? ¿hay pedido creado? ¿en qué estado va?— sale a qué bandeja pertenece cada conversación. No es una etiqueta descriptiva: es lo que decide quién la ve. Y como se deriva, **no puede quedar desactualizada**: nadie puede olvidar mantenerla.

Lo único que se guarda es **la asignación** — «este lo estoy trabajando yo» — porque eso el sistema no lo puede saber.

## User Stories

1. Como asesor de ventas, quiero ver solo las conversaciones que me toca vender, para no perder tiempo filtrando.
2. Como asesor de ventas, quiero que un lead que ya cerró desaparezca de mi bandeja, para saber que terminé con él.
3. Como asesor de operaciones, quiero ver solo los pedidos por confirmar y en camino, sin conversaciones de venta en curso.
4. Como asesor de operaciones, quiero **ver el historial completo** cuando abro un chat, para saber qué le prometieron al cliente antes de que llegara a mí.
5. Como asesor, quiero marcar que estoy trabajando una conversación, para que un compañero no escriba encima.
6. Como asesor, quiero ver quién está trabajando cada conversación, para no duplicar.
7. Como administrador, quiero entrar a los dos módulos, porque yo sí hago las dos cosas.
8. Como administrador, quiero configurar las plantillas de confirmación sin ver la configuración de ventas, y al revés, para no confundirme entre dos cosas parecidas.
9. Como dueño del negocio, quiero que una conversación llegue sola a la bandeja correcta, sin que nadie la mueva a mano, para que ninguna se pierda.
10. Como dueño del negocio, quiero que un cliente que ya compró y hace clic en un anuncio nuevo vuelva a ventas, porque es plata nueva.
11. Como dueño del negocio, quiero que apagar el módulo de ventas no afecte la confirmación, porque la confirmación es lo que hoy factura.
12. Como usuario, quiero elegir país antes que módulo, porque equivocarme de país es caro y equivocarme de módulo solo es molesto.

## Implementation Decisions

**País primero, módulo dentro.** La operación determina tienda, catálogo, moneda y número — todo lo que hace que un error sea caro. El módulo solo determina qué pantallas se ven. Equivocarse de módulo es una molestia; equivocarse de país despacha al lugar equivocado.

**Los módulos separan pantallas y configuración, no el historial.** Al abrir un chat se ve la conversación completa, incluida la parte de venta. Ocultarla le quitaría a operaciones justo el contexto que necesita —qué le prometieron, qué producto discutieron, si pidió descuento— y el cliente va a mencionar esas cosas de todos modos.

**Roles nuevos: ventas y operaciones.** Hoy el sistema solo tiene `admin` y `operator`, con apenas dos referencias en el código, así que el cambio es barato. Ventas entra al módulo de Sebastián, operaciones al de Katherine, admin a ambos. **La separación la impone el rol, no el módulo**: así protege sin estorbarle a quien legítimamente hace las dos cosas.

**El ruteo es una función pura y derivada.** Recibe los hechos de un contacto —atribución de anuncio, pedidos y sus estados— y devuelve a qué bandeja pertenece. Reglas, de mayor a menor precedencia:

- Atribución de anuncio **más reciente que el último pedido** → ventas. Cubre al recomprador: un clic nuevo es intención de compra nueva.
- Pedido creado y aún no entregado ni cancelado → operaciones.
- Pedido entregado o cancelado, sin clic posterior → operaciones, hasta que algo cambie.
- Nada de lo anterior → ventas. Un mensaje sin pedido es un lead.

**Lo único guardado es la asignación.** Quién está trabajando una conversación es lo que el sistema no puede deducir. Se guarda por conversación, es visible para el equipo y se puede soltar.

**La conexión de la tienda es de la operación, no del módulo de ventas.** Ambos módulos la usan: Sebastián para leer el catálogo, Katherine porque de ahí le entran los pedidos. Si viviera en el módulo de ventas, apagarlo tumbaría la confirmación. El **catálogo** —productos, anuncios, archivos enviables— sí vive en el módulo de Sebastián.

## Testing Decisions

Un buen test aquí demuestra que **una conversación cae en la bandeja correcta** dado un conjunto de hechos. No se prueba la pantalla; se prueba la regla.

**Módulo probado:** la función de ruteo. Es pura, recibe hechos y devuelve bandeja — el mismo patrón del constructor de orden y del reconocimiento de producto.

**Casos que deben quedar cubiertos:** lead nuevo sin pedido; lead con pedido recién creado; pedido en tránsito; pedido entregado; **el recomprador —pedido entregado y clic de anuncio posterior, que debe dar ventas—**; pedido cancelado; y contacto sin pedido ni atribución.

El recomprador es el caso que rompe los diseños ingenuos y por eso tiene que estar escrito como test, no solo como intención.

**Prior art:** `dropi/normalize.test.ts` y `kapso/inbound.test.ts` — vitest, hechos construidos a mano, aserción sobre la salida, nombres en español.

Los permisos de rol se verifican a mano: que ventas no alcance las pantallas de confirmación y al revés.

## Out of Scope

- Un CRM completo: etapas de embudo configurables, historial de actividades, notas comerciales, recordatorios.
- Reportería de desempeño por asesor.
- Reasignación automática por carga de trabajo.
- Más de dos módulos.
- Permisos más finos que rol por módulo.

## Further Notes

**Esto reemplaza la idea de un estado CRM guardado**, que fue la propuesta inicial. El sistema ya tiene tres máquinas de estado —el pipeline del pedido, el estado de confirmación de la conversación y quince estados logísticos— y una cuarta guardada tendría que mantenerse de acuerdo con todas. La pista de que eso duele ya está en el código: el estado de confirmación necesitó un campo que distingue si lo puso el sistema o una persona.

**Consecuencia de compartir número:** hay **una conversación por contacto, para siempre** — la tabla tiene índice único sobre el contacto. Por eso el ruteo no puede ser un campo en la conversación que se sobrescriba: un recomprador tendría su estado de julio encima. Derivarlo lo resuelve solo.

**Conviene decidir la forma visual antes de construirlo.** Cómo se ve el cambio de módulo, cómo se ve que una conversación está asignada a otro, y cómo se distingue una bandeja de la otra son preguntas de diseño. Es exactamente lo que hace el spec de pulido de interfaz.
