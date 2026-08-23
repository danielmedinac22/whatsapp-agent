/**
 * **Cuánto saldo queda, y si el techo de tokens cambia algo hoy.**
 *
 * El worker solo guarda `err.message`, y «Response validation failed» no dice
 * si el proveedor rechazó la petición o si cambió la forma de la respuesta.
 * Esto pregunta las dos cosas: la llamada tal como la hace el worker —sin
 * `maxOutputTokens`, que es reservar el techo del modelo— y la misma llamada
 * con un techo del tamaño de un mensaje de WhatsApp.
 *
 * **El saldo va primero, y no es decoración: sin él las dos llamadas no se
 * pueden interpretar.** OpenRouter cobra la reserva por adelantado, así que el
 * techo solo hace diferencia cuando lo que queda en la llave no alcanza a
 * cubrirla —unos 7 centavos para los 65.536 tokens del modelo—. Con saldo
 * holgado las dos filas salen idénticas, y eso **no** significa que el techo no
 * sirva: significa que hoy no hace falta. Leerlo al revés fue exactamente lo que
 * pasó la primera vez que alguien corrió esto después de una recarga.
 */
import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const MODEL = process.env.MODELO ?? "openai/gpt-5.4-mini";
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("falta OPENROUTER_API_KEY");

const provider = createOpenRouter({
  apiKey: key,
  headers: {
    "HTTP-Referer": "https://github.com/whatsapp-agent",
    "X-Title": "whatsapp-agent",
  },
});

async function turno(etiqueta: string, maxOutputTokens?: number) {
  console.log(`=== ${etiqueta} ===`);
  try {
    const r = await generateText({
      model: provider(MODEL),
      system: "Sos un asesor de ventas de Vorare. Contestá corto y cordial.",
      messages: [{ role: "user", content: "hola, está disponible el producto?" }],
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
    });
    console.log("texto:", JSON.stringify(r.text));
    console.log("uso:", JSON.stringify(r.usage));
  } catch (err) {
    const e = err as Error;
    console.log("falló →", e.name);
    console.log("mensaje:", e.message.slice(0, 400));
  }
}

/** Lo que la llave puede gastar todavía, que es lo que decide todo lo demás. */
async function saldo() {
  const res = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.log(`=== saldo === no pude leerlo (HTTP ${res.status})`);
    return;
  }
  const { data } = (await res.json()) as {
    data: { limit: number | null; limit_remaining: number | null; usage: number };
  };
  const queda = data.limit_remaining;
  console.log("=== saldo de la llave ===");
  console.log(`tope: ${data.limit ?? "sin tope"} · gastado: ${data.usage.toFixed(4)}`);
  console.log(`disponible: ${queda ?? "sin límite"}`);

  // El umbral es la reserva del techo del modelo, que es lo que el proveedor
  // cobra por adelantado. Por debajo de eso la llamada sin techo se cae con un
  // 402 y el worker lo escribe como «Response validation failed».
  const RESERVA_USD = 0.07;
  if (queda !== null && queda < RESERVA_USD) {
    console.log(
      `⚠ por debajo de ~${RESERVA_USD}: la llamada SIN techo debería fallar. Es el modo en que se rompió el 21-ago.`,
    );
  } else {
    console.log(
      `hay saldo de sobra, así que las dos llamadas de abajo van a salir iguales.\n` +
        `  Eso NO dice que el techo no sirva: dice que hoy la reserva se puede pagar.`,
    );
  }
  console.log("");
}

async function main() {
  console.log("modelo:", MODEL);
  await saldo();
  await turno("como lo llama el worker hoy (sin techo)");
  await turno("con techo de 600 tokens", 600);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
