import { workerFetchMultipart } from "@/lib/worker";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const incoming = await req.formData();
  // Se rearma el FormData en vez de reenviar el stream: así fetch pone su
  // propio boundary y no hay que copiar cabeceras a mano.
  const form = new FormData();
  for (const [key, value] of incoming.entries()) {
    form.append(key, value as string | Blob);
  }
  const res = await workerFetchMultipart("/api/wa/send-audio", form);
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
