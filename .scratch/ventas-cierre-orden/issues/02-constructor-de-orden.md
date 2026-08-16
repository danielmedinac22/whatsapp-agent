# 02 — Constructor de orden con validación y clamp de descuento

**What to build:** Dados los datos de cierre de una conversación y la configuración vigente, sale un pedido listo para crear en la tienda, o el conjunto de errores que impiden crearlo. Es el punto donde el límite de descuento deja de ser texto en un prompt y se vuelve una regla real.

Una sola función pura concentra validación, mapeo, clamp e idempotencia — es una sola decisión de negocio, y partirla daría varios seams para probar lo mismo.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Valida los seis requeridos: nombre, apellido, teléfono, ciudad, departamento, y dirección **o** reclamo en oficina.
- [ ] Teléfono en formato válido; ciudad y departamento contra la lista de Colombia.
- [ ] **Dirección y reclamo en oficina coexistiendo es un error de validación**, no una preferencia.
- [ ] El payload lleva líneas con producto, variante y cantidad; cliente; dirección o etiqueta de reclamo en oficina; estado financiero pendiente por contraentrega; y las etiquetas de origen de ventas y nombre del vendedor.
- [ ] **Un descuento por encima del límite configurado sale clampeado al precio válido, y el resultado señala que hubo clamp** para que el orquestador escale.
- [ ] Un límite en cero con descuento pactado también clampea.
- [ ] La llave de idempotencia se deriva del lead, no del momento ni de un aleatorio: dos construcciones del mismo cierre dan la misma llave.
- [ ] Los tests cubren cada caso anterior más campo requerido faltante y ciudad fuera de lista.
