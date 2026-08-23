/**
 * **Qué contesta OpenRouter hoy, crudo, y si el techo de tokens lo arregla.**
 *
 * El worker solo guarda `err.message`, y «Response validation failed» no dice
 * si el proveedor rechazó la petición o si cambió la forma de la respuesta.
 * Esto pregunta las dos cosas: la llamada tal como la hace el worker —sin
 * `maxOutputTokens`, que es reservar el techo del modelo— y la misma llamada
 * con un techo del tamaño de un mensaje de WhatsApp.
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

async function main() {
  console.log("modelo:", MODEL);
  await turno("como lo llama el worker hoy (sin techo)");
  await turno("con techo de 600 tokens", 600);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
