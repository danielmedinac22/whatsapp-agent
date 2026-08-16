# 01 — Configuración del vendedor

**What to build:** El admin edita quién es el vendedor y cómo se comporta, sin pedirle nada al equipo técnico: su nombre, sus mensajes base, su tono y hasta qué descuento puede dar. Los cambios aplican en la siguiente conversación, sin desplegar.

**Blocked by:** ventas-conversacion 01 · Sebastián responde con su persona

**Status:** ready-for-agent

- [ ] Campos estructurados para nombre visible, mensajes base (saludo, empuje al cierre, mensaje de embudo) y límite de descuento.
- [ ] Campo de texto libre para tono e instrucciones de personalidad.
- [ ] El límite de descuento acepta cero, y ponerlo en cero prohíbe descuentos.
- [ ] Un cambio guardado aplica en la siguiente conversación, sin reinicio ni despliegue.
- [ ] **El panel no expone ninguna perilla sobre la cascada de reconocimiento**: ni activar niveles, ni reordenarlos, ni ajustar umbrales.
- [ ] La configuración de Katherine no es alcanzable ni editable desde esta pantalla.
