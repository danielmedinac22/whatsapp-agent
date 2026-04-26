import { createOpenRouter } from "@openrouter/ai-sdk-provider";

let _provider: ReturnType<typeof createOpenRouter> | null = null;

export function openrouter() {
  if (_provider) return _provider;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
  _provider = createOpenRouter({
    apiKey,
    headers: {
      "HTTP-Referer": "https://github.com/whatsapp-agent",
      "X-Title": "whatsapp-agent",
    },
  });
  return _provider;
}
