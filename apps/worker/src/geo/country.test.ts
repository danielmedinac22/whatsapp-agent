import { describe, expect, it } from "vitest";
import {
  countryRules,
  findCity,
  normalizePlaceName,
  resolveDivision,
  resolvePhone,
  type CountryRules,
} from "./country";

/** Las dos operaciones que el sistema conoce. Ninguna se supone por defecto. */
function reglas(countryCode: string): CountryRules {
  const rules = countryRules(countryCode);
  if (!rules) throw new Error(`sin reglas para ${countryCode}`);
  return rules;
}

const GT = reglas("GT");
const CO = reglas("CO");

describe("countryRules · la tabla se indexa por el país de la operación", () => {
  it("Guatemala trae sus 22 departamentos y su indicativo", () => {
    expect(GT.divisions).toHaveLength(22);
    expect(GT.callingCode).toBe("502");
  });

  it("Colombia trae sus 32 departamentos más Bogotá D.C.", () => {
    expect(CO.divisions).toHaveLength(33);
    expect(CO.callingCode).toBe("57");
  });

  it("Guatemala tiene los 340 municipios oficiales", () => {
    const municipios = GT.divisions.flatMap((d) => d.cities);
    expect(municipios).toHaveLength(340);
  });

  it("Colombia tiene los 1.122 municipios de DIVIPOLA", () => {
    const municipios = CO.divisions.flatMap((d) => d.cities);
    expect(municipios).toHaveLength(1122);
  });

  it("acepta el código en minúsculas o con espacios: viene de una columna de texto", () => {
    expect(countryRules(" gt ")?.countryCode).toBe("GT");
  });

  it("un país sin listas devuelve null y no cae en ninguno conocido", () => {
    // La dirección segura del error: sin listas no se valida contra las del
    // vecino, se avisa de que no se puede validar.
    expect(countryRules("MX")).toBeNull();
    expect(countryRules("")).toBeNull();
  });
});

describe("normalizePlaceName · la tilde que no puede costar una venta", () => {
  it("iguala tildes, mayúsculas y espacios de sobra", () => {
    expect(normalizePlaceName("  SACATEPÉQUEZ ")).toBe("sacatepequez");
    expect(normalizePlaceName("Sacatepequez")).toBe("sacatepequez");
  });

  it("iguala la ñ y la puntuación", () => {
    expect(normalizePlaceName("Nariño")).toBe(normalizePlaceName("NARINO"));
    expect(normalizePlaceName("Bogotá, D.C.")).toBe("bogota dc");
  });
});

describe("resolveDivision · el departamento contra la lista de su país", () => {
  it("encuentra el departamento aunque falte la tilde", () => {
    expect(resolveDivision(GT, "Sacatepequez")).toBe("Sacatepéquez");
  });

  it("devuelve el nombre canónico, no lo que tecleó el cliente", () => {
    expect(resolveDivision(GT, "el quiche")).toBe("Quiché");
    expect(resolveDivision(CO, "VALLE")).toBe("Valle del Cauca");
  });

  it("un departamento colombiano no existe en la lista guatemalteca", () => {
    expect(resolveDivision(GT, "Cundinamarca")).toBeNull();
    expect(resolveDivision(CO, "Sacatepéquez")).toBeNull();
  });
});

describe("findCity · el municipio y en qué departamentos vive", () => {
  it("resuelve el municipio de la capital por como lo llama la gente", () => {
    expect(findCity(GT, "Ciudad de Guatemala")).toEqual({
      name: "Guatemala",
      divisions: ["Guatemala"],
    });
  });

  it("un nombre repetido entre departamentos es una entrada con dos divisiones", () => {
    // «San José» es municipio de Escuintla y de Petén: por eso la ciudad no se
    // puede validar sin el departamento.
    expect(findCity(GT, "San José")?.divisions).toEqual(["Escuintla", "Petén"]);
  });

  it("Bogotá se encuentra escrita de las cuatro formas de siempre", () => {
    for (const forma of ["Bogotá", "BOGOTA", "Bogotá D.C.", "bogota, d.c."]) {
      expect(findCity(CO, forma)?.name).toBe("Bogotá, D.C.");
    }
  });

  it("un municipio de un país no existe en el otro", () => {
    expect(findCity(GT, "Medellín")).toBeNull();
    expect(findCity(CO, "Quetzaltenango")).toBeNull();
  });

  it("un nombre que no es municipio de nadie no resuelve", () => {
    // «Zona 10» es nomenclatura urbana, no municipio: va en la dirección.
    expect(findCity(GT, "Zona 10")).toBeNull();
  });
});

describe("resolvePhone · el formato del país de la operación", () => {
  it("acepta un móvil guatemalteco escrito como lo escribe la gente", () => {
    for (const raw of ["5555 1234", "+502 5555-1234", "50255551234"]) {
      expect(resolvePhone(GT, raw)).toBe("+50255551234");
    }
  });

  it("acepta un fijo de la capital y uno del interior", () => {
    expect(resolvePhone(GT, "2360 1234")).toBe("+50223601234");
    expect(resolvePhone(GT, "7761 1234")).toBe("+50277611234");
  });

  it("rechaza longitudes y prefijos que Guatemala no asigna", () => {
    expect(resolvePhone(GT, "1234567")).toBeNull();
    expect(resolvePhone(GT, "955512345")).toBeNull();
    expect(resolvePhone(GT, "9555 1234")).toBeNull();
    expect(resolvePhone(GT, "")).toBeNull();
  });

  it("un móvil colombiano de diez dígitos no es un teléfono guatemalteco", () => {
    // El mismo número, los dos países: es la validación parametrizada por
    // operación, no una lista fija.
    expect(resolvePhone(CO, "300 123 4567")).toBe("+573001234567");
    expect(resolvePhone(GT, "300 123 4567")).toBeNull();
  });

  it("acepta el fijo colombiano de la marcación unificada", () => {
    expect(resolvePhone(CO, "+57 601 234 5678")).toBe("+576012345678");
  });
});
