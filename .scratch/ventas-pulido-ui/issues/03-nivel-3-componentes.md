# 03 — Nivel 3: componentes individuales

**What to build:** El detalle final de las piezas que se usan a diario: la tarjeta de producto con su origen, el campo de identificador de anuncio, el marcador de archivo enviable, el estado de reconocimiento dentro de una conversación, y los controles de tomar y devolver el chat.

**Blocked by:** 02

**Status:** done

- [x] Un producto conectado a la tienda se distingue de uno nativo **sin leer**. — resuelto en el nivel 2 (origen como columna + aviso de solo lectura en la ficha).
- [x] **Registrar un anuncio nuevo se siente de segundos.** — esta ronda.
- [x] Los archivos enviables se distinguen de los no enviables de un vistazo. — resuelto en el nivel 2 (interruptor por archivo, «2 de 4 enviables»).
- [x] El estado de reconocimiento —resuelto, ambiguo, escalado— se lee sin abrir la conversación. — resuelto en el nivel 2 (la fila marca solo lo que **no** es limpio).
- [x] Tomar el chat comunica inequívocamente que el vendedor quedó pausado. — el concepto se descartó en el nivel 2: es `Agente: ON/OFF`, que ya existe en producción.
- [x] Veredicto por componente, registrado, listo para que la implementación tenga contra qué construir.

---

## Answer

**El anuncio se elige de la lista de la cuenta publicitaria de Meta. No se escribe ningún identificador.** Fue la variante F. Se descartaron el campo con eco, la bandeja de pendientes, el pegado masivo, el registro desde el hilo y la confirmación de la propuesta.

### El veredicto y su razón

> «F es el más claro.»

Al preguntarle qué lo hace más claro, Daniel señaló **dos** cosas, y las dos son de la interacción:

1. **El anuncio se llama por su nombre.** «DHT ANTICALVICIE · Video · testimonial» es un dato de persona; `24019338702` es un dato de máquina. Con cuatro SKUs de nombre casi idéntico, el nombre del anuncio es lo único que los distingue **al elegir**.
2. **No se escribe ningún identificador.** Desaparece la clase entera de error del pegado —la URL en vez del ID, los espacios del copiado, el ID de otra cuenta, un dígito mal que no avisa nunca—. No hay que validar nada porque no hay nada que escribir.

**Y lo que NO eligió importa igual.** Se le ofreció como tercera razón que F es la única que funciona el día uno sin esperar tráfico, y **no la tomó**. Para quien construya: esa propiedad es un beneficio del diseño, **no su justificación**. Si mañana aparece una forma que se llama por su nombre y no pide escribir pero necesita tráfico previo, sigue cumpliendo la razón del veredicto.

### El hallazgo que hizo Daniel, y que la ronda no tenía

**La primera ronda no incluía esta variante.** Las cinco que produje resolvían el registro con lo que el panel ya tiene: un campo, o los anuncios que Kapso reportó al llegar un lead. Daniel preguntó «¿aquí no debería traer el anuncio de la integración con Meta?» — y esa pregunta abrió la variante que ganó.

El error fue de encuadre: diseñé contra los datos que el panel ya recibe en vez de contra los que **puede pedir**. La cuenta publicitaria `act_2042265076620189` («CP - Vorare») está verificada desde el 16-ago, y `GET /act_.../ads` devuelve nombre, campaña, conjunto y estado. Estaba disponible y no la miré.

### Lo que esta decisión cuesta, y hay que aceptarlo explícitamente

1. **Estrena una dependencia que hoy no existe.** No hay ninguna credencial de Meta en el entorno: solo `KAPSO_*`, `SHOPIFY_WEBHOOK_SECRET`, `OPENROUTER_API_KEY`, `DATABASE_URL`, `AUTH_SECRET`, `WORKER_*`. Hace falta un token de **usuario de sistema** con `ads_read` y su renovación. Hasta hoy, registrar un anuncio no dependía de nadie.
2. **El estado «sin conectar» va a pasar solo**, porque el token vence. El prototipo lo mockea a propósito: cuando la cuenta no está, queda el campo a mano. **F no reemplaza a las otras, las envuelve** — el campo de A sobrevive como respaldo, no como forma principal.
3. **Una sola cuenta publicitaria sirve a las dos operaciones**, y está en COP zona Bogotá mientras la que factura es Guatemala. **Meta no dice a qué país pertenece un anuncio**: el panel lo deduce del nombre, que es una convención y no un dato. Los anuncios de la otra operación se muestran atenuados y marcados, pero esa deducción puede fallar. Es el mismo problema del ticket 10 de multi-operación.

### La verificación contra producción, y lo que destapó

Antes de cerrar se consultó la base de producción (solo lectura, 18-ago-2026):

```
conversations = 1.713 · con ad_id = 0 · con ctwa_clid = 0
con ad_headline = 0 · con ad_referral_raw = 0
products = 0 · product_ads = 0 · operations = 1
```

**La referencia CTWA no se capturó nunca, ni una sola vez.** La ruta de captura está viva —`inbound/pipeline.ts:237` escribe y hasta registra por qué ruta llegó— pero la migración `0022` aterrizó el 17-ago y desde entonces entraron ~28 conversaciones.

**Resuelto el 18-ago con la credencial de Meta, y no es ninguna de las dos cosas que se sospechaban.** Leída la cuenta publicitaria: de 500 conjuntos, 10 tienen destino WhatsApp, y **ninguno apunta al número que escucha el panel**. Los dos activos —`CJ NEURO WPP` y `CJ ABT WPP BUSSINES SEBASTIAN SEGUNDA CAMPAÑA`— van a +502 4722 4176, otra WABA.

**Y es a propósito.** Hoy las confirmaciones corren en un WhatsApp y las ventas en otro; los dos se van a unir en uno solo, y Sebastián queda activo cuando eso pase. Daniel lo dejó **pendiente de validación con datos reales** una vez esté en producción.

No es un bug y no hay pérdida retroactiva: esos leads nunca pudieron llegar al panel. Lo único que condiciona la unificación es que el número de la pauta está en **ON_PREMISE** (que Meta descontinúa) y el del panel en **CLOUD_API**, que es lo que Kapso usa — la unificación tiene que ir hacia Cloud API.

### La consecuencia de F que hay que tener a la vista

**F resuelve registrar, no reconocer.** El registro llena `product_ads`; el reconocimiento hace lo contrario —toma el `ad_id` del mensaje entrante y lo busca en ese mapa. Si el `referral` no llega, **el mapa queda perfecto y nunca se consulta**.

Y F **esconde** ese fallo en vez de mostrarlo. Con la bandeja de pendientes (B, D, E) un referral roto se ve: la bandeja se queda vacía para siempre y eso grita. Con F no hay bandeja — se registran los ocho anuncios desde Meta, la pantalla se ve completa y correcta, y no pasa nada.

**Por eso elegir F hace más urgente verificar que el referral llega, no menos.** Quien implemente debería construir una señal explícita de «llegaron N clics de anuncios registrados esta semana»; sin ella, el módulo puede estar muerto y verse sano.

### Lo que el nivel 3 no tenía que decidir

El ticket pedía seis cosas y **cuatro ya estaban resueltas de hecho al construir el nivel 2**. Se verificaron con Daniel y se dejaron como estaban: el origen del producto, los archivos enviables, el estado de reconocimiento en la fila, y los controles de tomar el chat (concepto descartado). **Es un hallazgo, no una desviación**: un ticket escrito antes de que existiera el nivel 2 sobreestima lo que queda después.

Tampoco se prototipó el nivel de detalle de la ficha de producto: la ronda se concentró en la interacción que el spec señala como la que determina el soporte recurrente, y la ficha quedó con la anatomía del nivel 2.

### Referencias

`prototipos/nivel-3-anuncio.PROTOTIPO.html` — seis variantes. La F es la decidida; A–E quedan como registro de la comparación. Publicado en https://claude.ai/code/artifact/36627031-bab8-458a-9f88-a86f9703406b

Los referentes de la variante elegida, de Mobbin:

- **ManyChat «Pick Automation»** — buscador, filtros de estado, píldora ACTIVO/PAUSADO, nombre con subtítulo de campaña y conjunto. Es la forma exacta.
- **Klaviyo Campaigns** — buscador + filtro de estado + estado como columna.

Los de las descartadas: Wise y Fireflies (A), 7shifts «Integration Mapping» y Midday (B, D), Mailchimp y Wix (C), Salesforce y folk (E).

### Qué queda abierto, con dueño

Cuatro cosas salieron de esta ronda y **ninguna es de diseño**. Necesitan ticket propio:

1. **La credencial de Meta.** Token de usuario de sistema con `ads_read` sobre `act_2042265076620189`. Sin esto, la variante elegida no se puede construir. Se le preguntó a la sesión principal y no tiene contacto con Vorare; queda para Daniel.
2. **Confirmar que el token del 16-ago fue revocado.** La nota dice que *debía* revocarse. «Debía» no es «fue».
3. **Verificar que el `referral` de Kapso llega.** La prueba es un solo clic en un anuncio CTWA activo. Si aparece el `ad_id`, resuelto; si llega el mensaje sin `ad_id`, hay un bug que arreglar antes de construir encima.
4. **La asignación de conversación (`assigned_user_id`).** El Answer del nivel 2 la difirió explícitamente a este nivel y no entró: la ronda se concentró en el anuncio. La columna existe en el esquema (`schema.ts:484`). Sigue sin dueño.

### El resultado, en una frase

**El anuncio se elige por su nombre de una lista leída de la cuenta publicitaria de Meta; no se escribe ningún identificador, y el campo a mano queda solo como respaldo para cuando la conexión no está.**
