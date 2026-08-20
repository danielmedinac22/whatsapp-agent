/**
 * PRO-27 · La línea de contexto dice en qué operación y en qué módulo estás.
 *
 * Lo que se afirma acá es lo que el asesor ve, no cómo está armado el árbol: que
 * la línea nombra la operación activa, que la bandera es la de su país y no la
 * del otro, y que un país sin bandera dibujada no se queda en blanco.
 *
 * **La bandera se afirma por el degradado y no por un emoji** porque es lo que
 * distingue a Guatemala de Colombia de un vistazo, y es justo el error que este
 * componente existe para prevenir: escribirle al cliente del país equivocado.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ContextLine } from "./context-line";

const GUATEMALA = { name: "Vorare Store Guatemala", countryCode: "GT" };
const COLOMBIA = { name: "Vorare Store Colombia", countryCode: "CO" };

/** El `span` de la bandera: es `aria-hidden`, así que no se alcanza por rol. */
function bandera(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(".op-flag");
  if (!el) throw new Error("la línea de contexto no dibujó ninguna bandera");
  return el;
}

describe("ContextLine", () => {
  it("dice la operación y el módulo, separados por ·", () => {
    render(<ContextLine op={GUATEMALA} pantalla="Confirmación" />);
    expect(
      screen.getByText("Vorare Store Guatemala · Confirmación"),
    ).toBeInTheDocument();
  });

  it("lleva la clase del contrato, que es la que le da el estilo", () => {
    const { container } = render(
      <ContextLine op={GUATEMALA} pantalla="Confirmación" />,
    );
    expect(container.querySelector("p.app-context")).toBeInTheDocument();
  });

  it("pinta banderas distintas para Guatemala y para Colombia", () => {
    const gt = render(<ContextLine op={GUATEMALA} pantalla="Ventas" />);
    const co = render(<ContextLine op={COLOMBIA} pantalla="Ventas" />);
    const fondoGt = bandera(gt.container).style.background;
    const fondoCo = bandera(co.container).style.background;
    expect(fondoGt).toContain("linear-gradient");
    expect(fondoCo).toContain("linear-gradient");
    expect(fondoGt).not.toBe(fondoCo);
  });

  it("no apaga la bandera: la operación de la línea es siempre la activa", () => {
    // `.op-flag` nace con `filter: saturate(.2) brightness(.55)` para el país
    // que no se está usando. Acá solo se dibuja el que sí.
    const { container } = render(
      <ContextLine op={GUATEMALA} pantalla="Ventas" />,
    );
    expect(bandera(container).style.filter).toBe("none");
  });

  it("un país sin bandera dibujada toma el tinte de su operación", () => {
    const { container } = render(
      <ContextLine op={{ name: "Vorare Store Perú", countryCode: "PE" }} pantalla="Ventas" />,
    );
    expect(bandera(container).style.background).toContain("var(--op)");
  });

  it("acepta el código de país en minúsculas", () => {
    const { container } = render(
      <ContextLine op={{ name: "Vorare Store Guatemala", countryCode: "gt" }} pantalla="Ventas" />,
    );
    expect(bandera(container).style.background).toContain("linear-gradient");
  });
});
