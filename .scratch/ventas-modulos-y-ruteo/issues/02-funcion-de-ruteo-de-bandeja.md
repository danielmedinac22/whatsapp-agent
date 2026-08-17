# 02 — La función de ruteo de bandeja

**What to build:** Dada una conversación y los hechos que la rodean, el sistema sabe **a qué bandeja pertenece** — la de ventas o la de operaciones — sin que nadie lo marque a mano.

Es una función pura y derivada. Como se deriva de hechos que ya existen, **no puede quedar desactualizada**: nadie puede olvidar mantenerla.

**Blocked by:** ventas-multi-operacion 02 · La conexión de WhatsApp cuelga de la operación

**Status:** ready-for-agent

Reglas, de mayor a menor precedencia:

1. Atribución de anuncio **más reciente que el último pedido** → **ventas**.
2. Pedido creado y aún no entregado ni cancelado → **operaciones**.
3. Pedido entregado o cancelado, sin clic posterior → **operaciones**.
4. Nada de lo anterior → **ventas**. Un mensaje sin pedido es un lead.

- [ ] Función pura: recibe hechos, devuelve bandeja. No consulta base de datos por dentro.
- [ ] **No se guarda ningún estado nuevo.** El sistema ya tiene tres máquinas de estado; una cuarta guardada tendría que mantenerse de acuerdo con todas.
- [ ] Los tests cubren: lead sin pedido · pedido recién creado · pedido en tránsito · pedido entregado · pedido cancelado · contacto sin nada.
- [ ] **Test obligatorio del recomprador:** pedido entregado en el pasado **más un clic de anuncio posterior** debe dar **ventas**. Es el caso que rompe los diseños ingenuos y por eso va escrito como test, no como intención.
