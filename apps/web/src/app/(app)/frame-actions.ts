"use server";

/**
 * Las dos cosas que el marco guarda entre pantallas: sobre qué operación se
 * trabaja y si las barras están plegadas.
 *
 * Van como acciones de servidor y no como `fetch` desde el cliente por una
 * razón concreta: la cookie de operación es `httpOnly`, así que el navegador no
 * la puede escribir. Y como el riel se dibuja en el servidor, después de cada
 * acción hace falta `revalidatePath("/", "layout")` para que la pantalla se
 * vuelva a pedir con la operación nueva — es *todo* el contenido el que cambia,
 * no solo el color de la barra.
 */

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import { listOperations } from "@wa/db";
import {
  PANEL_BARS_COOKIE,
  PANEL_COOKIE_MAX_AGE,
  PANEL_OPERATION_COOKIE,
} from "@/lib/operation";

/**
 * Cambiar de operación.
 *
 * **Solo acepta un id que exista en la tabla.** El valor llega de un formulario
 * y un formulario se puede falsificar; sin esta comprobación, una cookie con
 * basura dejaría al panel resolviendo por el puente sin que nadie lo note. Con
 * un id desconocido no se escribe nada y el riel se queda donde estaba.
 *
 * Y **reexpande las barras**: decisión 9 del nivel 1. Cambiar de país es el
 * único momento en que el contexto cambió de verdad y vale interrumpir el
 * plegado. Volver a plegarlas es acto del usuario, nunca automático.
 */
export async function selectOperation(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session) return;

  const requested = String(formData.get("operationId") ?? "").trim();
  if (!requested) return;
  const exists = (await listOperations()).some((o) => o.id === requested);
  if (!exists) return;

  const jar = await cookies();
  jar.set(PANEL_OPERATION_COOKIE, requested, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: PANEL_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  jar.set(PANEL_BARS_COOKIE, "open", {
    sameSite: "lax",
    path: "/",
    maxAge: PANEL_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
}

/**
 * Plegar o desplegar las barras. Se recuerda de forma global —no por
 * pantalla—, porque un marco que se pliega solo al navegar es peor que no poder
 * plegarlo.
 */
export async function toggleBars(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session) return;

  const next = formData.get("bars") === "collapsed" ? "collapsed" : "open";
  const jar = await cookies();
  jar.set(PANEL_BARS_COOKIE, next, {
    sameSite: "lax",
    path: "/",
    maxAge: PANEL_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
}

/**
 * Cerrar sesión.
 *
 * Está acá abajo, junto a las otras dos, porque ahora quien la dispara es un
 * componente de cliente: el botón del riel abre una pregunta antes de salir, y
 * un componente de cliente no puede declarar la acción en su propio archivo.
 */
export async function endSession(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
