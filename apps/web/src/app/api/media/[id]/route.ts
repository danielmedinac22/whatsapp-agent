import { workerFetch } from "@/lib/worker";
import { auth } from "@/auth";

/**
 * Sirve una nota de voz al navegador del asesor. El worker es quien tiene los
 * bytes; aquí solo se exige sesión y se reenvía, porque la URL de Meta caduca
 * en 5 minutos y la de Kapso necesita la API key.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const res = await workerFetch(`/api/wa/media/${id}`);
  if (!res.ok || !res.body) {
    return new Response("media no disponible", { status: res.status || 502 });
  }
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "audio/ogg",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
