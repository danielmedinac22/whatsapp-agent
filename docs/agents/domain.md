# Docs de dominio

Cómo los skills de ingeniería leen la documentación de dominio de este repo cuando
exploran el código.

## Antes de explorar, leé esto

- `CONTEXT.md` en la raíz, el glosario del dominio.
- `docs/adr/`, las decisiones de arquitectura que tocan el área donde vas a trabajar.

Si no existen, seguí sin decir nada. No marques su ausencia ni propongas crearlos por
adelantado. El skill `/domain-modeling` los crea cuando de verdad se resuelve un
término o una decisión.

Hoy no existe ninguno de los dos (20-ago-2026).

## Estructura

Este repo es de un solo contexto, aunque sea un monorepo. `apps/worker`, `apps/web`,
`packages/db` y `packages/shared` comparten un mismo dominio: pedidos, operaciones,
conversaciones.

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-<decisión>.md
│   └── 0002-<decisión>.md
├── apps/
│   ├── worker/
│   └── web/
└── packages/
    ├── db/
    └── shared/
```

Si algún día un paquete desarrolla vocabulario propio, el camino es un
`CONTEXT-MAP.md` en la raíz que apunte a un `CONTEXT.md` por paquete. Mientras tanto,
un solo archivo.

## Usá el vocabulario del glosario

Cuando lo que escribas nombre un concepto del dominio (el título de un issue, una
hipótesis, el nombre de un test), usá el término como lo define `CONTEXT.md`. No te
vayas a sinónimos que el glosario evita a propósito.

Si el concepto que necesitás todavía no está en el glosario, eso es una señal. O
estás inventando lenguaje que el proyecto no usa, y conviene repensarlo, o hay un
hueco real y hay que anotarlo para `/domain-modeling`.

Este repo ya tiene vocabulario propio y bien cargado, en español y en registro de
negocio: operación, mapa, ticket, bandeja, guía, novedad, pedido, contraentrega.
Cuando se escriba `CONTEXT.md`, sale de ahí y no de traducciones nuevas.

## Marcá los choques con un ADR

Si lo que proponés contradice un ADR que ya existe, decilo en voz alta en vez de
pisarlo en silencio.

> Contradice el ADR-0007 (órdenes con event sourcing), pero vale la pena reabrirlo
> porque...
