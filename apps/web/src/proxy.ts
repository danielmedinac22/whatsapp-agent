/**
 * El borde común del panel: aquí se decide quién entra.
 *
 * Corre antes de **toda** ruta que no esté excluida en `config.matcher` —
 * pantallas y rutas de datos por igual—, así que una pantalla nueva queda
 * cubierta por existir, sin que nadie tenga que acordarse de guardarla. Ese es
 * el punto: «ni por URL directa» no lo puede cumplir un menú que esconde el
 * enlace, ni una guarda repetida en cada `page.tsx` que alguien va a olvidar.
 *
 * La decisión no vive aquí sino en `@/access/resolve`, que es pura; aquí solo
 * está la forma de rebotar: las rutas de datos contestan 403 —a un `fetch` no
 * se le redirige a una pantalla— y las pantallas van a la bandeja.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { LANDING_PATH, resolveAccess } from "@/access/resolve";

const PUBLIC_PATHS = ["/login", "/api/auth"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (!req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  const role = req.auth.user?.role;
  if (resolveAccess(role, pathname).allowed) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return new NextResponse("forbidden", { status: 403 });
  }

  // Rebote a la bandeja, que es área común y por eso alcanza todo rol. Si algún
  // día dejara de serlo, contestar antes que entrar en un bucle de
  // redirecciones: un bucle en el panel se ve igual que una caída.
  if (
    pathname === LANDING_PATH ||
    !resolveAccess(role, LANDING_PATH).allowed
  ) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const url = req.nextUrl.clone();
  url.pathname = LANDING_PATH;
  url.search = "";
  return NextResponse.redirect(url);
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
