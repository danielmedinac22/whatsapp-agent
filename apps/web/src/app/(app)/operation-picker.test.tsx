/**
 * El selector de operación reemplaza al riel: la cabecera de la barra es
 * también con qué se cambia de país.
 *
 * Lo que se afirma acá es lo que ve quien entra al panel, no cómo está armado
 * el árbol: que con una sola operación no hay ningún selector que abrir, que
 * con dos la lista trae las dos y marca la que está en uso, y que sin operación
 * elegida la lista está abierta de arranque. Esa última es la que importa de
 * verdad: **con el riel las baldosas estaban siempre a la vista, y ahora la
 * única salida del panel el día que Colombia se ponga a atender es esta lista.**
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// `vi.hoisted` porque `vi.mock` sube al principio del archivo: un `vi.fn()`
// declarado acá abajo todavía no existe cuando la fábrica corre.
const { elegir } = vi.hoisted(() => ({ elegir: vi.fn() }));
vi.mock("./frame-actions", () => ({ selectOperation: elegir }));

import { OperationPicker } from "./operation-picker";
import type { BarOperation } from "./operation-bar";

function operacion(
  name: string,
  countryCode: string,
  currency: string,
  phone: string | null,
): BarOperation {
  return {
    operation: {
      id: `op-${countryCode}`,
      name,
      countryCode,
      currency,
      status: "active",
      capiDatasetId: null,
      metaAdAccountId: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    phone,
  };
}

const GT = operacion("Guatemala", "GT", "GTQ", "+502 3689 0343");
const CO = operacion("Colombia", "CO", "COP", null);

/** La lista desplegada, o `null` si está cerrada. */
function lista(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(".op-picker-list");
  return el;
}

describe("OperationPicker", () => {
  it("con una sola operación no hay nada que abrir", async () => {
    render(<OperationPicker entries={[GT]} active={GT} />);

    expect(screen.getByText("Guatemala")).toBeInTheDocument();
    expect(screen.getByText("Operando · GTQ")).toBeInTheDocument();
    expect(screen.getByText("+502 3689 0343")).toBeInTheDocument();
    // Un selector de un solo elemento es una promesa que no se cumple.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(lista()).toBeNull();
  });

  it("con dos, abre la lista y marca la que está en uso", async () => {
    render(<OperationPicker entries={[GT, CO]} active={GT} />);

    const disparador = screen.getByRole("button", { expanded: false });
    await userEvent.click(disparador);
    expect(disparador).toHaveAttribute("aria-expanded", "true");

    const desplegada = lista()!;
    expect(desplegada).not.toBeNull();
    const filas = within(desplegada).getAllByRole("button");
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveAttribute("aria-current", "true");
    expect(filas[1]).not.toHaveAttribute("aria-current");
  });

  it("una operación sin número lo dice, en vez de callarlo", async () => {
    render(<OperationPicker entries={[GT, CO]} active={CO} />);

    expect(screen.getAllByText("sin número conectado").length).toBeGreaterThan(0);
  });

  it("elegir manda el id de esa operación y cierra la lista", async () => {
    elegir.mockClear();
    render(<OperationPicker entries={[GT, CO]} active={GT} />);

    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await userEvent.click(
      within(lista()!).getByRole("button", { name: /Colombia/ }),
    );

    expect(elegir).toHaveBeenCalledTimes(1);
    const datos = elegir.mock.calls[0]![0] as FormData;
    expect(datos.get("operationId")).toBe("op-CO");
    expect(lista()).toBeNull();
  });

  it("sin operación elegida la lista arranca abierta", () => {
    render(<OperationPicker entries={[GT, CO]} active={null} />);

    expect(screen.getByText("Elegí una operación")).toBeInTheDocument();
    expect(lista()).not.toBeNull();
    // La cabecera no inventa un número: el de nadie no es el de ninguna de las
    // dos. Dentro de la lista sí se ven, que es de lo que se elige.
    const cabecera = document.querySelector<HTMLElement>(".op-picker-face")!;
    expect(within(cabecera).queryByText("+502 3689 0343")).toBeNull();
    expect(within(lista()!).getByText("+502 3689 0343")).toBeInTheDocument();
  });

  it("Escape la cierra", async () => {
    render(<OperationPicker entries={[GT, CO]} active={null} />);

    expect(lista()).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(lista()).toBeNull();
  });
});
