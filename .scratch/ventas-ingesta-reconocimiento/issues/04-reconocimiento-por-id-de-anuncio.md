# 04 — Reconocimiento por ID de anuncio

**What to build:** Un lead que llega desde un anuncio registrado queda asociado a su producto sin que nadie le pregunte nada, y esa atribución sobrevive el resto de la conversación — incluso cuando el lead responde con botones, que es cuando la referencia del anuncio ya no viene.

Es el nivel primario de la cascada. Los fallbacks van en el ticket siguiente.

**Blocked by:** 01 · 02 · 03

**Status:** claimed (parte pura) — worktree `reconocimiento-cascada`, tanda del 17-ago-2026. La persistencia espera al esquema `0022`.

- [x] La cascada de reconocimiento es una función pura que recibe la referencia del anuncio, el catálogo y un matcher semántico inyectado.
- [x] Devuelve tres formas distinguibles: resuelto a un producto, ambiguo con la lista de candidatos, o desconocido.
- [x] Un anuncio registrado que apunta a un solo producto da resuelto.
- [x] Un anuncio registrado que apunta a varios productos da ambiguo con esa lista, no con el catálogo entero.
- [ ] La atribución del lead a su anuncio y a su producto se persiste en el primer contacto.
- [ ] Un mensaje posterior de la misma conversación —incluida una respuesta de botón, que no trae referencia— sigue teniendo su producto y su anuncio.
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
