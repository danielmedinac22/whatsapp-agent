# 04 — Asignación de conversación

**What to build:** Un asesor marca que está trabajando una conversación, y sus compañeros lo ven. Es lo único que el sistema no puede deducir solo — de ahí que sea lo único que se guarda.

**Blocked by:** 03

**Status:** claimed — worktree `bandejas`, ola del 18-ago (2)

- [ ] Un asesor puede tomar una conversación y queda registrado como quien la trabaja.
- [ ] El resto del equipo ve quién la tiene, **antes de escribir**.
- [ ] Se puede soltar, y vuelve a quedar libre.
- [ ] La asignación es por conversación y **no cambia a qué bandeja pertenece** — eso lo decide el ruteo derivado, no la persona.
- [ ] Que una conversación cambie de bandeja **libera la asignación anterior**: quien la vendía ya no la está trabajando.
- [ ] Es independiente de tomar el chat al agente: se puede estar asignado sin haber pausado al vendedor.

## Answer — esquema puesto por la `0022` (17-ago-2026), la funcionalidad sigue abierta

El worktree `esquema-0022` dejó las columnas aplicadas en producción. **Este ticket no genera migración.**

### En `conversations` — lo único que se guarda del ruteo

| columna | tipo | notas |
| -- | -- | -- |
| `assigned_user_id` | uuid nullable → `users` (`set null`) | el asesor que la está trabajando. Borrar el usuario la libera |
| `assigned_at` | timestamptz nullable | desde cuándo. Sin default: la pone quien asigna |

En drizzle: `conversations.assignedUserId`, `assignedAt`.

**Semántica:** tomar = escribir las dos; soltar = poner las dos en `null`; libre = `assigned_user_id is null`. Es **por conversación** (una por contacto, para siempre) y **no cambia a qué bandeja pertenece**: la bandeja se deriva con la función de ruteo (`ventas-modulos-y-ruteo/02`, en curso en el worktree `ruteo-bandeja`) a partir de `conversations.ad_referral_at` —también de la `0022`— y de los pedidos del contacto. **No hay columna de bandeja ni de estado**, a propósito: el spec lo prohíbe y el ticket 02 lo repite.

«Que una conversación cambie de bandeja libera la asignación anterior» es lógica de código, no de esquema: al detectar el cambio de bandeja se ponen las dos columnas en `null`. Es independiente de `contacts.agent_mode` (tomar el chat al agente): se puede estar asignado sin haber pausado al vendedor.

Sin índice sobre `assigned_user_id`: 1.693 conversaciones, y la lista ya trae la fila entera. Si aparece un filtro «las mías» y pesa, es un índice, no una migración de esquema que bloquee a nadie.

### Verificado en producción tras aplicar

Las dos columnas existen, nullable, y ninguna conversación tiene asignación (`0` filas con `assigned_user_id` no nulo).
