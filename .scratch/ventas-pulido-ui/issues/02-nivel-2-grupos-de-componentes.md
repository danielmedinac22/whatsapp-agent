# 02 — Nivel 2: grupos de componentes

**What to build:** Dentro del encuadre ya decidido, la forma de los cuatro grupos: el selector de operación, el catálogo, la configuración del vendedor y las conversaciones de venta.

**Blocked by:** 01

**Status:** in-progress — worktree `grill-nivel-1`, sesión con el usuario, 17-ago-2026

- [ ] Cinco variantes por grupo, en el archivo vivo que se actualiza en sitio.
- [ ] El catálogo se muestra vacío y cargado, y con productos de ambos orígenes.
- [ ] La configuración del vendedor separa visualmente lo que tiene consecuencia —el límite de descuento— de lo que es tono.
- [x] Las conversaciones se muestran con casos normales, ambiguos y escalados.
- [x] La vista de ventas se siente hermana de la de confirmaciones, no una aplicación distinta.
- [ ] Veredicto por grupo, registrado con su razón.

### Estado por grupo

| Grupo | Estado |
|---|---|
| Selector de operación | **cerrado en el nivel 1** — el riel *es* el selector; lo que queda es nivel 3 |
| Conversaciones | **cerrado** (ver abajo) |
| Catálogo | pendiente |
| Configuración del vendedor | pendiente |

## Answer · Conversaciones

**No hay bandeja de ventas. Hay vistas de Sebastián dentro del Inbox que ya existe.**

### La ronda que falló, y por qué importa

La primera ronda produjo cinco bandejas nuevas —pestaña, hermana, cola de triage, tablero, agrupada por anuncio— y Daniel las rechazó todas: «ninguna me convence». La causa no era el layout:

**Las cinco le pusieron vocabulario nuevo a actos que el panel ya nombra en producción.** En `apps/web/src/app/(app)/inbox/inbox-client.tsx`:

| Lo que se inventó | Lo que ya existe |
|---|---|
| «Tomar el chat» | `agentMode` por contacto — el botón dice **Agente: ON / OFF** |
| «Vendedor pausado» | **«Respuesta manual»** vs **«Automatización activa»** |
| Una cola de triage nueva | `needsAttention = !agentMode && unread > 0`, **con su filtro ya construido** (línea 255) |
| Contar las automáticas | `automatedCount`, ya calculado |

Inventar vocabulario encima de lo que ya funciona es exactamente lo que hace que una pantalla se sienta *otra aplicación* — las historias 12 y 13 piden lo contrario. **Se descarta como opción, no solo como diseño: quien implemente no debe introducir términos nuevos para estos actos.**

El referente confirma el error desde afuera: Intercom —que se vende como el helpdesk de la era de los agentes— pone al agente y al equipo en **la misma bandeja**, y el traspaso no es un botón: si un compañero responde, el agente deja de responder.

### Las decisiones

1. **Vistas de Sebastián en la barra lateral, con contador** (referentes: Intercom, Gorgias, Featurebase). *Necesitan atención · Las lleva Sebastián · Todas*, colgando de «Conversaciones» dentro del grupo Ventas. Se eligió sobre las cintas de filtro encima de la lista porque **el contador tiene que verse desde afuera de la bandeja**: si solo aparece estando ya adentro, no sirve para que entres. Es el mismo criterio por el que el riel le ganó al filo de color en el nivel 1.

2. **El contexto de venta se narra en el hilo, no en un panel** (referentes: ManyChat, Pipedrive). *«Sebastián reconoció REVITALHAIR – DHT ANTICALVICIE · anuncio 23851094782»*, *«Sebastián escaló tras dos intentos»*, *«Automatización pausada — respondés vos»*. El producto y el anuncio **no son atributos que se consulten: son algo que pasó en un momento del chat**, y el evento lo fecha. Se descartó el tercer panel de contexto: cuatro campos no ganan 268px, y en el módulo de Katherine quedaría vacío.

3. **La fila solo marca el reconocimiento cuando NO es limpio.** «Ambiguo» y «escalado» se ven; «reconocido» no se muestra. Marcar todo es no marcar nada. La fila conserva la marca de automatización que ya tenía.

4. **«Tomar el chat» desaparece como concepto.** El control es `Agente: ON/OFF`, que es el que ya existe. Sigue vigente la distinción del ticket 04 de `ventas-panel` entre pausar al agente y asignarse la conversación (`assigned_user_id`), pero **la asignación no entró en esta ronda** y queda para el nivel 3.

### Consecuencia de esfuerzo

El spec de Panel decía que esta era «la pieza con más rango de esfuerzo del proyecto entero» y que había que decidirla temprano. **Decidida hacia abajo:** no hay pantalla nueva. Lo que falta es un filtro por módulo y por operación sobre `listConversations`, las vistas en la barra, y los eventos de reconocimiento en el hilo.

### Hallazgo que no es de diseño

`listConversations` (`apps/web/src/lib/queries.ts:104`) **hoy no filtra por nada**: trae 200 conversaciones por actividad, sin operación ni módulo. El día que Colombia reciba un mensaje, el Inbox de Katherine mezcla los dos países. `conversations.operation_id` ya existe en el esquema, así que es filtrar, no construir — pero **nadie lo tiene asignado**. Necesita ticket propio.

### Referencia visual

`prototipos/nivel-2-conversaciones.PROTOTIPO.html`. La variante 1 es la decidida; A–E quedan como registro de la comparación.
