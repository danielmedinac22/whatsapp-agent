/**
 * Lo que cambia de un país a otro cuando se captura una dirección: la lista de
 * divisiones administrativas con sus ciudades, y el formato de teléfono.
 *
 * Todo lo de este archivo es PURO: no toca la base, ni el reloj, ni la red. La
 * tabla se indexa por `country_code` —el mismo ISO 3166-1 alfa-2 que ya lleva
 * `operations`— porque **la operación ya sabe su país**: quien valida una
 * dirección recibe la operación, saca su código y con eso tiene las reglas. No
 * hay ninguna lista fija ni ningún país por defecto; un código que no está en
 * la tabla devuelve `null` y quien llame decide qué hacer con eso.
 *
 * **Por qué constantes en código y no filas en la base.** Los datos son de una
 * naturaleza distinta a los de `products` o `operations`: no los edita nadie del
 * negocio, cambian cuando cambia la división política de un país (Guatemala
 * creó su último municipio en 2015; Colombia publica DIVIPOLA una vez al año),
 * y son idénticos para toda instalación del sistema. En la base costarían una
 * migración de mil quinientas filas, una consulta por validación y un estado que
 * puede quedar a medio sembrar en un ambiente y no en otro — sin ganar nada:
 * nadie va a editar «Sacatepéquez» desde el panel. En código se versionan con el
 * resto, se prueban sin conexión y no tienen ambiente donde estar mal.
 *
 * Los nombres viven en `./data/`, uno por país, con su procedencia documentada.
 *
 * No confundir con `../lib/phone.ts`: aquel normaliza un número al `wa_id` con
 * el que la Cloud API direcciona un mensaje. Aquí se decide si un número es un
 * teléfono **posible en ese país**, que es una pregunta distinta y solo tiene
 * sentido con la operación en la mano.
 */

import {
  COLOMBIA_CITY_ALIASES,
  COLOMBIA_DIVISION_ALIASES,
  COLOMBIA_DIVISIONS,
} from "./data/colombia";
import {
  GUATEMALA_CITY_ALIASES,
  GUATEMALA_DIVISION_ALIASES,
  GUATEMALA_DIVISIONS,
} from "./data/guatemala";

/**
 * Una división administrativa de primer nivel con sus ciudades. En los dos
 * países que hoy existen la división se llama «departamento» y la ciudad
 * «municipio»; el tipo usa los nombres neutros porque el tercer país puede
 * llamarlas provincia y cantón, y el constructor de orden no tiene por qué
 * enterarse.
 */
export interface AdministrativeDivision {
  name: string;
  cities: readonly string[];
}

/**
 * Un formato de número nacional válido: cuántos dígitos tiene, ya sin el
 * indicativo de país, y por cuáles puede empezar.
 *
 * Es a propósito una regla de **posibilidad**, no de existencia: dice que el
 * número tiene forma de teléfono de ese país, no que alguien conteste. Validar
 * de más aquí —rangos exactos por operador, portabilidad— es rechazar clientes
 * buenos con datos que envejecen solos.
 */
export interface PhoneFormat {
  /** Longitud del número nacional, sin indicativo de país. */
  length: number;
  /** Prefijos posibles; el número nacional tiene que empezar por alguno. */
  prefixes: readonly string[];
}

/** Todo lo que el país de una operación decide sobre una dirección. */
export interface CountryRules {
  /** ISO 3166-1 alfa-2, como en `operations.country_code`. */
  countryCode: string;
  /** Indicativo telefónico, sin «+». */
  callingCode: string;
  divisions: readonly AdministrativeDivision[];
  /** Cómo la gente nombra ciudades cuyo nombre oficial no usa. */
  cityAliases: Readonly<Record<string, string>>;
  divisionAliases: Readonly<Record<string, string>>;
  phoneFormats: readonly PhoneFormat[];
}

const GUATEMALA: CountryRules = {
  countryCode: "GT",
  callingCode: "502",
  divisions: GUATEMALA_DIVISIONS,
  cityAliases: GUATEMALA_CITY_ALIASES,
  divisionAliases: GUATEMALA_DIVISION_ALIASES,
  // Ocho dígitos. Móviles en 3, 4 y 5; fijos en 2 (capital) y 6 y 7 (interior).
  // Los rangos 0, 1, 8 y 9 no se asignan a abonados.
  phoneFormats: [{ length: 8, prefixes: ["2", "3", "4", "5", "6", "7"] }],
};

const COLOMBIA: CountryRules = {
  countryCode: "CO",
  callingCode: "57",
  divisions: COLOMBIA_DIVISIONS,
  cityAliases: COLOMBIA_CITY_ALIASES,
  divisionAliases: COLOMBIA_DIVISION_ALIASES,
  // Diez dígitos desde la marcación unificada de 2022: móviles en 3, fijos en
  // 60 más el indicativo de la ciudad.
  phoneFormats: [{ length: 10, prefixes: ["3", "60"] }],
};

const COUNTRIES: readonly CountryRules[] = [GUATEMALA, COLOMBIA];

/**
 * Las reglas del país de una operación, o `null` si no hay listas para ese
 * código.
 *
 * **Devuelve `null` en vez de caer en un país por defecto**, por lo mismo que
 * `operations/resolve.ts` no atribuye un mensaje a la operación equivocada:
 * validar una dirección colombiana contra la lista guatemalteca no produce un
 * error, produce un despacho al país equivocado.
 */
export function countryRules(countryCode: string): CountryRules | null {
  const wanted = countryCode.trim().toUpperCase();
  return COUNTRIES.find((c) => c.countryCode === wanted) ?? null;
}

/**
 * La forma con la que se comparan dos nombres de lugar.
 *
 * Quita tildes y diéresis, pasa a minúsculas, borra puntos y comas y junta los
 * espacios. Es lo que hace que «SACATEPEQUEZ», «Sacatepéquez» y «sacatepequez »
 * sean el mismo departamento — y no es cosmética: una validación que rechaza a
 * quien no puso la tilde es una venta perdida en contraentrega, que es el modo
 * de fallo más caro de este módulo.
 *
 * La ñ también se pliega a n («Narino» encuentra a «Nariño»). Confundir dos
 * lugares por eso exigiría que existieran dos que solo se distinguen por la
 * tilde, y no existen.
 */
export function normalizePlaceName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,'"·]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface CountryIndex {
  /** normalizado → nombre canónico de la división. */
  divisions: Map<string, string>;
  /** normalizado → nombre canónico de la ciudad y las divisiones que la tienen. */
  cities: Map<string, { name: string; divisions: string[] }>;
}

const indexCache = new Map<string, CountryIndex>();

/**
 * El índice normalizado de un país, construido una vez. Los datos son
 * constantes, así que memorizarlo no introduce estado observable: la misma
 * entrada da la misma salida para siempre.
 */
function indexOf(rules: CountryRules): CountryIndex {
  const cached = indexCache.get(rules.countryCode);
  if (cached) return cached;

  const index: CountryIndex = { divisions: new Map(), cities: new Map() };
  for (const division of rules.divisions) {
    index.divisions.set(normalizePlaceName(division.name), division.name);
    for (const city of division.cities) {
      const key = normalizePlaceName(city);
      const hit = index.cities.get(key);
      // El mismo nombre en dos departamentos —«San José» está en Escuintla y en
      // Petén— es una sola entrada con dos divisiones, no dos entradas.
      if (hit) hit.divisions.push(division.name);
      else index.cities.set(key, { name: city, divisions: [division.name] });
    }
  }
  // Los alias entran normalizados y apuntan al canónico ya resuelto. Un alias
  // hacia un nombre que no existe se ignora en vez de crear un lugar fantasma.
  for (const [alias, canonical] of Object.entries(rules.divisionAliases)) {
    const target = index.divisions.get(normalizePlaceName(canonical));
    if (target) index.divisions.set(normalizePlaceName(alias), target);
  }
  for (const [alias, canonical] of Object.entries(rules.cityAliases)) {
    const target = index.cities.get(normalizePlaceName(canonical));
    if (target) index.cities.set(normalizePlaceName(alias), target);
  }

  indexCache.set(rules.countryCode, index);
  return index;
}

/**
 * El nombre canónico de la división administrativa, o `null` si ese país no la
 * tiene. Acepta tildes de más o de menos, mayúsculas y alias.
 */
export function resolveDivision(
  rules: CountryRules,
  name: string,
): string | null {
  return indexOf(rules).divisions.get(normalizePlaceName(name)) ?? null;
}

/** Una ciudad del país: su nombre canónico y las divisiones donde existe. */
export interface CityMatch {
  name: string;
  /** Al menos una. Más de una cuando el nombre se repite entre divisiones. */
  divisions: readonly string[];
}

/**
 * La ciudad dentro del país, sin mirar la división que dijo el cliente: eso lo
 * decide quien llama, que es el único que puede juntar los dos errores —«esa
 * ciudad no existe aquí» y «existe, pero en otro departamento»— en una sola
 * respuesta.
 */
export function findCity(rules: CountryRules, name: string): CityMatch | null {
  return indexOf(rules).cities.get(normalizePlaceName(name)) ?? null;
}

/**
 * El número en E.164 si es un teléfono posible en ese país, o `null`.
 *
 * Acepta como lo escribe la gente: con o sin «+», con o sin indicativo de país,
 * con espacios, guiones o paréntesis. Prueba primero el número tal cual —un
 * fijo guatemalteco puede empezar por 502 y ser válido de ocho dígitos— y solo
 * si no encaja le quita el indicativo. El orden importa: al revés, «50212345»
 * se leería como un número de cinco dígitos.
 */
export function resolvePhone(rules: CountryRules, raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const national = matchesFormat(rules, digits)
    ? digits
    : digits.startsWith(rules.callingCode) &&
        matchesFormat(rules, digits.slice(rules.callingCode.length))
      ? digits.slice(rules.callingCode.length)
      : null;
  return national ? `+${rules.callingCode}${national}` : null;
}

function matchesFormat(rules: CountryRules, national: string): boolean {
  return rules.phoneFormats.some(
    (format) =>
      national.length === format.length &&
      format.prefixes.some((prefix) => national.startsWith(prefix)),
  );
}
