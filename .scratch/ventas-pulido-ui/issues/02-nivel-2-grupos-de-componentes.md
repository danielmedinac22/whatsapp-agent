# 02 — Nivel 2: grupos de componentes

**What to build:** Dentro del encuadre ya decidido, la forma de los cuatro grupos: el selector de operación, el catálogo, la configuración del vendedor y las conversaciones de venta.

**Blocked by:** 01

**Status:** in-progress — worktree `grill-nivel-1`, sesión con el usuario, 17-ago-2026

- [ ] Cinco variantes por grupo, en el archivo vivo que se actualiza en sitio.
- [x] El catálogo se muestra vacío y cargado, y con productos de ambos orígenes.
- [ ] La configuración del vendedor separa visualmente lo que tiene consecuencia —el límite de descuento— de lo que es tono.
- [x] Las conversaciones se muestran con casos normales, ambiguos y escalados.
- [x] La vista de ventas se siente hermana de la de confirmaciones, no una aplicación distinta.
- [ ] Veredicto por grupo, registrado con su razón.

### Estado por grupo

| Grupo | Estado |
|---|---|
| Selector de operación | **cerrado en el nivel 1** — el riel *es* el selector; lo que queda es nivel 3 |
| Conversaciones | **cerrado** (ver abajo) |
| Ficha de cliente y etapas del lead | **cerrado** — grupo agregado el 17-ago-2026 |
| Catálogo | **cerrado** (ver abajo) |
| Configuración del vendedor | pendiente |
| Tablero de pipeline | pendiente — **último grupo**, ver más abajo |

### Grupo agregado: la ficha de cliente y las etapas

Daniel preguntó si hacía falta un visualizador de clientes tipo CRM, y si daría más claridad sobre etapas y estados. La investigación —Mobbin más la documentación de Kommo— separó la pregunta en tres, con tres respuestas distintas:

**Kommo es el análogo comercial más cercano** a lo que Vorare construye: *«cuando alguien hace clic en tu anuncio va a WhatsApp, donde el bot responde y califica»*. Y **su Salesbot mueve el lead por el pipeline solo**, sin que nadie arrastre tarjetas — eso descarta la objeción de «nadie lo va a mantener».

1. **Ficha de cliente: sí, en el panel derecho.** Hoy no hay ningún lugar donde ver a una persona. Hay una conversación por contacto para siempre, así que la conversación *es* el registro del cliente, pero solo muestra mensajes: no hay dónde ver «compró 3 veces, una no confirmó, lleva Q1.087». Con contraentrega al 88,4%, distinguir al recomprador del que nunca confirma es dinero.

   **Esto matiza la decisión 2 de arriba, no la contradice.** Lo que se descartó del panel derecho fueron el producto y el anuncio, que son *eventos* y por eso van al hilo. El historial del cliente es un *registro*, y para eso sirve un panel — es lo que hacen Copilot, Pipedrive y Zillow. Los 268px que no ganaban cuatro campos, sí los gana el historial.

2. **Etapas: sí, pero como barra lineal, no como tablero.** Salesforce pone una barra de etapas sobre el registro (New › Contacted › Nurturing › Converted): no es tablero ni analítica, dice dónde está *este* lead en un recorrido fijo. El de Vorare ya existe y está fijo: `anuncio → reconocido → conversando → pedido → confirmado → entregado`. Hoy ese recorrido **está partido en tres pantallas** —reconocimiento en la conversación, confirmación en Pedidos, entrega en Dropi— y nadie ve el viaje completo de un lead. El 11,6% que no confirma se pierde sin que se sepa en qué escalón.

3. **Tablero de pipeline: entra como último grupo del nivel 2.** Se evaluó dejarlo fuera del spec —un tablero es para repartir trabajo entre personas, y acá el reparto lo hace el ruteo; además el spec excluye reportería—, pero Daniel decidió incluirlo. Va al final a propósito: es el grupo que más depende de que los otros estén resueltos.

### Veredicto · la ficha con pestañas

Daniel eligió la ficha con pestañas sobre las otras cuatro formas. Su razón, textual:

> «Me gusta que todo vive en el panel de forma ordenada, si tenemos información organizada mostrémosla.»

**Es un principio, no solo una preferencia, y conviene leerlo así:** cuando el sistema ya calculó algo, la interfaz lo enseña en vez de esconderlo por ahorrar espacio. Quien construya debería aplicarlo también donde no se lo dijimos.

**El panel queda con el recorrido arriba y tres pestañas:**

- **Cliente** — desde cuándo, pedidos, confirmados, sin confirmar, total comprado, último pedido.
- **Pedidos** — el historial de esa persona con el estado de cada uno.
- **Contexto** — **cómo** se reconoció: qué nivel de la cascada resolvió, y si quedó ambiguo, entre qué productos no pudo distinguir, con la acción de registrar el anuncio.

**El recorrido va vertical dentro del panel**, no como cinta sobre el hilo: en horizontal y en columna angosta las etiquetas se truncan a «A… R… C…», que no es un recorrido sino ruido. Y no se repite en la fila de la lista: la fila ya está en su límite y la etapa no es lo que te hace entrar — eso lo resuelven las vistas.

#### Una disyuntiva que estaba mal planteada

Al llenar las pestañas apareció que «Contexto» decía exactamente lo mismo que el hilo ya narra como evento. Se planteó como «cuál de los dos se cae», y **el principio de Daniel mostró que la disyuntiva era falsa**: el problema no era que sobrara la pestaña, sino que estaba mostrando lo mismo en vez de mostrar más.

Quedan los dos, con trabajos distintos:

- **El evento del hilo dice CUÁNDO**, fechado y en orden respecto de los mensajes.
- **La pestaña dice CÓMO**: el nivel de la cascada que resolvió, y en el caso ambiguo los nombres candidatos que el matcher no pudo separar. Eso el evento no lo puede contar, y hoy no se enseña en ninguna pantalla.

Es el mejor lugar del panel para el problema real de Vorare: los cuatro SKUs REVITALHAIR casi homónimos aparecen ahí, listados, con el botón que los desambigua para siempre.

## Answer · Catálogo

**Tabla densa, con el origen como columna.** Se descartaron las dos secciones separadas, las tarjetas, la pantalla centrada en anuncios y el maestro-detalle.

### El veredicto y su razón

> «Puede presentar más información de forma más clara y en el momento en que se tengan muchos productos, es más fácil de navegar. Añadiría filtros y tipo de comportamientos estándares de la industria para este tipo de componentes.»

La razón **no fue el catálogo de hoy sino el de mañana**: 17 productos caben en cualquier forma; la tabla es la que sigue funcionando cuando sean 60. Quien construya no debería cambiarla por algo más vistoso mirando el catálogo actual.

### Qué distingue lo conectado de lo nativo

El origen es **una columna**, en la misma posición en todas las filas — como lo hacen Dovetail y TheyDo, no como insignia suelta. Se evaluó separar el catálogo en dos secciones (tienda arriba, panel abajo), que vuelve la confusión imposible, y se descartó: **el error no se comete mirando la lista sino al abrir e intentar editar**, y ahí lo ataja el aviso de solo lectura de la ficha. Partir la lista rompería el orden por volumen —que es como Vorare piensa su catálogo, con un producto que es el 77%— y cobraría un precio permanente por un error que se comete una vez.

En la ficha: si el producto vive en Shopify, la descripción es texto plano y encima va **«el panel no escribe sobre la tienda»**; si es nativo, la misma descripción es un campo editable.

### Los comportamientos estándar, pedidos explícitamente

El conjunto sale de los referentes, no de la imaginación: **Dovetail** (buscar · ordenar · campos · filtrar), **Twenty** y **Aboard** (filtros aplicados como chips removibles con «+ añadir filtro»), **Navattic** (buscar + filtro con contador + orden + paginado con total), **Neon** (columnas conmutables).

- **Buscar** por nombre de producto o por ID de anuncio.
- **Filtrar** con contador en el botón, y los filtros activos **como chips removibles bajo la barra**. Un filtro activo que no se ve es cómo se pierde media lista sin notarlo. Filtros: origen, con/sin anuncios, sin archivos enviables.
- **Ordenar** por volumen, precio, nombre o anuncios, con dirección.
- **Columnas** conmutables.
- **Total y estado del filtro al pie**: «4 de 17 productos · filtrado».
- **Selección múltiple con casillas.** Acá no es genérica: **asociar un anuncio a varios productos a la vez es literalmente el N:M del ticket 03 y su camino más corto.**

### Dos correcciones que la elección destapó

1. **El anuncio compartido parecía exclusivo.** El ticket 03 pide que «un mismo anuncio pueda quedar asociado a varios productos y se vea claramente a cuáles», y desde la ficha de un producto no se veía. Ahora cada anuncio compartido dice a qué otros apunta: `23851094999 · también apunta a REVITALHAIR Serum Capilar`.

2. **Un producto sin anuncios no es un producto incompleto: es una fuga de reconocimiento.** Se cambió la insignia neutra «sin anuncios» por su consecuencia: *«Los leads de este producto no se van a reconocer. Sin un anuncio registrado, el matcher tiene que adivinar entre los cuatro nombres REVITALHAIR — y ahí está el 77% del volumen.»* Es la única parte del panel que explica **por qué existe** el registro de anuncios; sin eso, cargar IDs parece burocracia.

### Archivos enviables

Interruptor por archivo (Frame.io, Proton), con el conteo en la cabecera: «2 de 4 enviables». **El `testimonio.mp4` de 27 MB tiene el interruptor deshabilitado y dice por qué** — excede el límite de 16 MB de la API de WhatsApp. Se rechaza al subir, no al enviar, que es el criterio del ticket 02.

### Referencia visual

`prototipos/nivel-2-catalogo.PROTOTIPO.html`. La variante 1 es la decidida; B–E quedan como registro.

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
