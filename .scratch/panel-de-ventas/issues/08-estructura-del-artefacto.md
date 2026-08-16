# Estructura del artefacto

Type: prototype
Status: resolved
Blocked by: 05, 07, 11

## Question

¿Qué secciones tiene el documento y en qué orden, para que Vorare lo lea de arriba a abajo y termine entendiendo qué compra, qué no compra y qué le toca a él?

Hacer un borrador rápido — esqueleto de secciones más una sección escrita de verdad como muestra de tono — y reaccionar a él. Barato y desechable: el objetivo es discutir sobre algo concreto, no acertar de una.

Puntos que la estructura tiene que resolver:

- Dónde va el precio: arriba, o al final después del alcance.
- Cómo se presentan las exclusiones sin que suenen a excusa.
- Dónde caen las dependencias del cliente: el número de ventas, las cuentas de Kapso (plan Pro, $25/mes) y OpenRouter, y la información de productos cargada en Shopify.
- **Cómo se maneja la volatilidad de los costos variables.** Meta sube tarifas el **1-oct-2026** (+2% a +7% del variable) y publica las definitivas el **1-sep**. Si el documento sale antes del 1-sep necesita cláusula de vigencia y una nota del alza; si sale después, la tabla va en firme. Decidir cuál — y notar que esto le pone fecha al mapa.
- **Dónde va el punto de quiebre.** El costo variable de Vorare iguala la mensualidad de 200.000 COP alrededor de los **550 leads/mes**. Decirlo es honesto y además vende: a ese volumen el módulo ya se pagó solo varias veces. Esconderlo se cobra después.

**La tabla de costos hay que rehacerla limpia sobre `gpt-5.6-terra`**, que es el modelo decidido. Las cifras que circulan en los tickets anteriores están reescaladas a mano desde una premisa equivocada. Cifras de referencia con Terra: 100 leads ≈ $86.000 COP · 500 ≈ $115.000 · 2.000 ≈ $224.000, incluyendo Kapso Pro.

Consultar `artifact-design` antes de escribir cualquier página.

## Answer

**Nueve secciones, precio arriba en ficha y desglosado abajo.**

1. **Encabezado** — qué es, en una línea, más una ficha con el precio, la modalidad y desde cuándo se cobra.
2. **Cómo funciona** — el recorrido de un lead, numerado. Es la única parte narrativa y sí es una secuencia real, así que la numeración informa en vez de decorar.
3. **Qué incluye** — las nueve piezas con su condición de entrega, tomadas de *Criterios de aceptación del alcance*.
4. **Qué no incluye** — exclusiones explícitas, con color propio para que se lean como frontera y no como excusa.
5. **Lo que pone Vorare** — número de ventas, cuentas de Kapso y OpenRouter, información de productos en Shopify, IDs de anuncio.
6. **Costos por cuenta de Vorare** — tabla de tres escenarios de volumen.
7. **La inversión** — 200.000 COP/mes, qué cubre "mantener" y qué no.
8. **Entrega por fases** — las tres fases con su contenido y estimado.
9. **Supuestos y condiciones** — incluida la vigencia de los costos.

### Decisiones de estructura

- **El precio va arriba en ficha y desglosado abajo.** Es un número atractivo: esconderlo hasta el final hace que el lector lo busque en vez de leer el alcance.
- **Las exclusiones van inmediatamente después del alcance**, no al final entre la letra chica. Una exclusión escondida se lee como trampa; una exclusión al lado de lo incluido se lee como claridad.
- **Las dependencias del cliente tienen sección propia**, no una nota al pie. Son la causa número uno de que un proyecto se retrase, y el documento las convierte en compromiso mutuo.
- **Cláusula de vigencia sobre los costos variables**, porque Meta sube tarifas el 1-oct-2026 y las definitivas salen el 1-sep.
- **Sin numeración en el alcance**: no es una secuencia. Solo el recorrido del lead y las fases van numerados, porque solo ellos tienen orden real.
