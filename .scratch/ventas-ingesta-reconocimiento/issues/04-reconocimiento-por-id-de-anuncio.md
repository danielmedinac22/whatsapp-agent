# 04 — Reconocimiento por ID de anuncio

**What to build:** Un lead que llega desde un anuncio registrado queda asociado a su producto sin que nadie le pregunte nada, y esa atribución sobrevive el resto de la conversación — incluso cuando el lead responde con botones, que es cuando la referencia del anuncio ya no viene.

Es el nivel primario de la cascada. Los fallbacks van en el ticket siguiente.

**Blocked by:** 01 · 02 · 03

**Status:** resolved — parte pura en el worktree `reconocimiento-cascada`; persistencia cableada en el worktree `ingesta-atribucion`. Tanda del 17-ago-2026, sin merge ni deploy.

- [x] La cascada de reconocimiento es una función pura que recibe la referencia del anuncio, el catálogo y un matcher semántico inyectado.
- [x] Devuelve tres formas distinguibles: resuelto a un producto, ambiguo con la lista de candidatos, o desconocido.
- [x] Un anuncio registrado que apunta a un solo producto da resuelto.
- [x] Un anuncio registrado que apunta a varios productos da ambiguo con esa lista, no con el catálogo entero.
- [x] La atribución del lead a su anuncio y a su producto se persiste en el primer contacto.
- [x] Un mensaje posterior de la misma conversación —incluida una respuesta de botón, que no trae referencia— sigue teniendo su producto y su anuncio.
- [x] Los tests cubren la cascada con el matcher semántico stubeado, sin llamar a ningún modelo.

## Answer

**Parte pura entregada el 17-ago-2026** en `apps/worker/src/sales/recognition.ts` (+ `recognition.test.ts`), rama `danielmedinac22/reconocimiento-cascada`. Cinco de los siete criterios quedan cumplidos; los dos de persistencia esperan al esquema `0022` y por eso el `Status` sigue en `claimed`.

### La firma

```ts
recognizeProduct(input: {
  referral: AdReferralRef | null;            // { adId, headline, body } — ya parseada, la expone el ticket 02
  catalog: readonly CatalogProduct[];        // { id, name } — el catálogo DE LA OPERACIÓN
  adMappings: readonly AdProductMapping[];   // { adId, productIds[] } — N:M; varias filas del mismo adId se juntan
  matchSemantically: SemanticMatcher;        // (copy, catalog) => SemanticCandidate[] | Promise<…>, INYECTADO
}): Promise<ProductRecognition>
```

Los tipos son **estructurales**, no de `@wa/db`: una fila de catálogo ya es un `CatalogProduct` y el join anuncio↔producto entra tal cual, fila por par, sin agrupar. Se adapta en el borde cuando aterrice la `0022`.

El matcher devuelve **candidatos con confianza en [0, 1]** (`{ productId, confidence }`), y su tipo **no tiene forma de decir «este»**. Puede ser síncrono (stub) o asíncrono (producción). Si lanza, la excepción sube tal cual: quien orquesta decide si un modelo caído es «desconocido» o un reintento, y lo loguea — la cascada no tiene logger.

### La forma del resultado

```ts
| { kind: "resolved";  product: CatalogProduct;                                level: "ad-id" | "semantic" }
| { kind: "ambiguous"; candidates: readonly [CatalogProduct, CatalogProduct, ...CatalogProduct[]]; level: "ad-id" | "semantic" }
| { kind: "unknown";   reason: "no-referral" | "empty-catalog" | "no-ad-copy" | "low-confidence" }
```

- No existe un cuarto caso «resuelto con confianza baja» (la forma de `dropi/match-shopify.ts`, donde elegir y marcar es lo correcto). Aquí un producto elegido a medias es información del SKU equivocado mandada a un cliente.
- `ambiguous.candidates` tiene **al menos dos** por tipo. En el nivel 1 salen en orden del catálogo; en el 2, de mayor a menor confianza. Es orden de presentación para la lista corta del ticket 05, no un ranking.
- `unknown.reason` es telemetría, no comportamiento: para el que pregunta valen igual, pero en el log distinguen un «hola» orgánico de un proveedor que recortó el copy (`no-ad-copy`), que es justo el riesgo abierto del spec.

### El umbral, y por qué no hay margen

`SEMANTIC_CONFIDENCE_THRESHOLD = 0.8`, constante exportada del módulo, no un campo del panel.

**«Similitud alta entre sí» no se mide con un segundo umbral de margen ni con similitud léxica de nombres: se decide por cardinalidad.** Un candidato cuenta si su confianza es ≥ 0,8; si **exactamente uno** lo supera → resuelto; si **más de uno** → ambiguo con todos, aunque uno tenga la confianza más alta; ninguno → desconocido. Dos productos confiables para el mismo copy es que el copy no los distingue.

Por qué así y no «gana el mejor por un margen» (que es lo que hace `match-shopify.ts` con `DISTINCT_MARGIN = 0.15`):

1. **Hace inescribible el error.** La única puerta a `resolved` es una función que recibe un conjunto de productos —sin confianzas ni orden— y decide por tamaño. En todo el módulo no hay `max`, ni `sort()[0]` en el camino que resuelve. Con margen, el código tiene literalmente un «mejor» y un «segundo», y alguien lo usa.
2. **Es más conservador**, que es la dirección segura del error sobre el 77% del volumen: 0,97 contra 0,81 queda ambiguo (con margen, resolvería). Hay test para ese caso exacto.
3. **La similitud léxica de nombres sería un segundo matcher, peor, dentro de la función pura.** Y es mal proxy: de los cuatro REVITALHAIR, *Hair Recovery 3X - COMBO RECUPERACION CAPILAR TOTAL* no se parece por Levenshtein a los tres DHT (≈0,3), pero vende lo mismo. El matcher inyectado **es** el oráculo de similitud; la cascada solo decide sobre lo que él dice.

Por qué 0,8: la dirección segura es preguntar de más. Un umbral bajo resolvería a un solo producto con confianza mediana. Un matcher que hable de «casi seguro» tiene que devolver 0,8 o más; «podría ser» queda por debajo y cede al nivel 3. Es el mismo número que la confianza «alta» del cruce de pedidos, pero **no la misma constante**: escalas distintas, sin acoplar.

### Decisiones que el ticket no decía y quedaron tomadas (revisar si alguna incomoda)

- **Un mapeo hacia productos que no están en el catálogo cuenta como anuncio no registrado.** Es el «catálogo de la operación» del spec hecho observable: un anuncio mal etiquetado hacia un producto de otro país no resuelve a él; los ids ajenos se descartan y, si no queda ninguno, cae al nivel 2. Con test.
- **Los ids que el matcher invente fuera del catálogo se ignoran**, con la confianza que sea. Un modelo puede alucinar un id. Con test.
- **Sin titular ni cuerpo no se consulta al matcher** (→ `unknown/no-ad-copy`); con catálogo vacío tampoco (→ `unknown/empty-catalog`). No hay nada que matchear y en producción cada consulta cuesta.
- El `adId` se compara con `trim()` a ambos lados: el admin lo pega desde el Ads Manager.

### Verificación

`pnpm -r typecheck` limpio en los 4 paquetes. `pnpm --filter @wa/worker test`: **90 tests en 8 archivos** (los 73 previos sin tocar + 17 nuevos). Sin llamadas a ningún modelo; sin tocar `inbound.ts`, `schema.ts`, `apps/web` ni la base (una sola lectura para sacar los cuatro nombres reales del fixture).

Los 17 cubren los siete casos del spec —incluido REVITALHAIR con los cuatro nombres reales y confianzas altas pero **no** iguales (0,92 / 0,90 / 0,86 / 0,83 → ambiguo con los cuatro)— más: precedencia del mapeo sobre el texto, mapeo repartido en filas, ids fuera del catálogo, id inventado por el matcher, orden de presentación, matcher asíncrono y el margen que no existe.

### Lo que queda pendiente de la persistencia (criterios 5 y 6)

Ambos leen y escriben tablas de la `0022` que otro worktree está creando:

- **Persistir la atribución en el primer contacto**: guardar `adId` + `ctwaClid` (los dos vienen en la referencia, ver ticket 02) y, según el `kind`, el `product.id` o los `candidates`. El resultado de esta función es lo que se guarda; el `level` dice cómo se llegó.
- **Que un mensaje posterior siga teniendo su producto**: leer la atribución guardada en vez de la referencia, porque las respuestas de botón no la traen. La cascada no se toca para eso — solo cambia de dónde sale el `referral` que recibe (o si se llama siquiera).

Cuando la `0022` aterrice, el borde son ~10 líneas: mapear filas → `CatalogProduct[]` / `AdProductMapping[]`, y elegir el matcher real (ticket 05).

## Answer — la persistencia, cableada el 17-ago-2026 (worktree `ingesta-atribucion`)

**Los dos criterios que faltaban están cerrados.** La cascada no se tocó: ni su firma, ni
su lógica, ni sus 17 tests. Lo que se agregó es el borde que la alimenta y lo que guarda
su resultado.

### El borde: `apps/worker/src/sales/catalog.ts`

Son las ~10 líneas que el ticket anticipaba, y hacen exactamente lo previsto:

```ts
recognizeProductForReferral({ operationId, referral }): Promise<ProductRecognition>
```

- `loadCatalog(operationId)` → `CatalogProduct[]`, filtrando **por operación**. Un lead
  guatemalteco no se resuelve contra productos colombianos aunque el anuncio estuviera mal
  etiquetado — y la cascada, además, descarta por su cuenta los ids del mapeo que no estén
  en ese catálogo.
- `loadAdMappings(operationId, adId)` → una fila por par `(anuncio, producto)`, tal cual;
  la cascada las junta sola. Sin `adId` no se consulta el mapeo: no hay con qué buscar.
- El **matcher semántico entra vacío** (`NO_SEMANTIC_MATCHER`, cero candidatos). El nivel 2
  llama a un modelo y es del ticket 05, así que hoy la cascada solo puede resolver por id
  de anuncio, que es justo el alcance de *este* ticket. Se exporta
  `SEMANTIC_LEVEL_WIRED = false` y va en el log del reconocimiento **para que nadie lea un
  `low-confidence` como «el modelo miró el anuncio y no supo»**: hoy significa «el anuncio
  no está registrado y nadie más miró».

Un apunte que hereda el ticket 05: `products.name` es **nulo** para los productos
conectados a Shopify (el nombre se lee de la tienda en tiempo de uso, a propósito). Al
nivel 1 no le importa, pero **el matcher real tendrá que resolver los nombres contra
Shopify antes de matchear** o le estaría preguntando a un modelo por productos sin nombre.

### Qué se guarda, y cuándo

Solo `kind: "resolved"` escribe `conversations.product_id`. **Ambiguo no escribe nada**:
elegir uno de varios candidatos es mandarle al cliente información del SKU equivocado, y
la lista corta es del ticket 05.

El orden importa y es deliberado: primero se guarda la **atribución** (anuncio + clic +
crudo), que es lo irrecuperable, y después se reconoce el producto, que es derivable. Si
el reconocimiento falla, la conversación queda con su anuncio y sin producto — que es el
estado que hace que el vendedor pregunte, y no una pérdida.

**Un clic nuevo deja el producto en `null`** como parte de la misma escritura de la
atribución, y la cascada lo vuelve a resolver sobre el anuncio nuevo. Conservar el
anterior dejaría el producto de julio colgado del anuncio de agosto.

### Criterio 6: el mensaje posterior

Se cumple sin volver a llamar a la cascada, que es como el ticket lo anticipaba: **cambia
de dónde sale la información, no la función**. Un mensaje sin referencia —toda respuesta
de botón o de lista— no escribe nada y la conversación conserva `ad_id`, `ctwa_clid` y
`product_id`; el reconocimiento **ni siquiera se invoca**, porque pedirle a la cascada que
resuelva sin referencia sería preguntarle lo que ya está contestado. Está probado en
`sales/attribution.test.ts` y en `sales/owner.test.ts` («una respuesta de botón sigue
teniendo su anuncio, su producto y su clic»).

### Verificación

`pnpm -r typecheck` limpio en los 4 paquetes. `pnpm --filter @wa/worker test`: **180 tests
en 12 archivos** — los 17 de la cascada intactos y sin tocar. Contra producción, solo
lectura: `products` y `product_ads` de Guatemala están vacías, así que hoy el nivel 1 no
puede resolver nada todavía; las consultas del borde se ejecutaron igual contra la base
real para comprobar que corren.
