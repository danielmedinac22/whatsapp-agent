# 01 — Conexión de administración de la tienda, por operación

**What to build:** El sistema puede **crear** pedidos en la tienda de cada operación. Hoy no puede: los pedidos entran por webhook con un secreto de entorno, pero la conexión a la API de administración —la que hace falta para escribir— **está vacía**, cero filas.

Sin esto, el cierre de ventas no tiene dónde aterrizar.

**Blocked by:** ventas-multi-operacion 03 · La conexión de la tienda cuelga de la operación

**Status:** ready-for-agent

- [ ] La operación de Guatemala tiene su conexión de administración configurada y verificada contra la tienda real.
- [ ] La verificación es de solo lectura primero: se comprueba que se puede consultar un producto antes de intentar escribir nada.
- [ ] Los permisos incluyen creación de pedidos y lectura de productos, y **no más de lo necesario**.
- [ ] Las credenciales viven donde ya viven las demás, no en el código.
- [ ] Queda documentado qué permisos se pidieron, para replicarlo en Colombia sin adivinar.

**Reemplaza al ticket original de plantilla de Meta**, que dejó de existir: al compartir número venta y confirmación, el mensaje de confirmación cae en sesión abierta y ya no es plantilla.
