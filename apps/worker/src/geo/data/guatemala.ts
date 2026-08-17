/**
 * Guatemala · 22 departamentos y sus 340 municipios.
 *
 * **Es la lista de la operación que factura**, así que su costo de error no es
 * simétrico: un municipio que falta aquí es una dirección buena que el
 * constructor de orden rechaza, y en contraentrega eso es una venta perdida sin
 * que nadie se entere de por qué. Por eso se cotejó entrada por entrada contra
 * la división administrativa publicada en Wikidata (`municipality of
 * Guatemala`, Q1872284) y contra el conteo oficial —22 departamentos, 340
 * municipios— antes de escribirla.
 *
 * Los nombres son los **oficiales**, no los de uso diario: el municipio de la
 * capital es «Guatemala» y no «Ciudad de Guatemala», el de Sacatepéquez es
 * «Antigua Guatemala» y no «La Antigua». Lo que la gente sí dice vive en
 * {@link GUATEMALA_CITY_ALIASES}, y lo que solo cambia por tildes o
 * mayúsculas lo resuelve la normalización de `../country.ts` sin tabla: la
 * validación que rechaza «Sacatepequez» por no llevar tilde es la misma venta
 * perdida de arriba.
 *
 * Deliberadamente **no** hay zonas ni barrios. En la capital la gente dice
 * «zona 10», que no es un municipio; eso va en la dirección, no en la ciudad, y
 * quien capture los datos tiene que pedir el municipio. Meterlas aquí volvería
 * la lista un directorio de nomenclatura urbana que nadie puede mantener.
 */

import type { AdministrativeDivision } from "../country";

/** Los 22 departamentos de Guatemala, con sus municipios. */
export const GUATEMALA_DIVISIONS: readonly AdministrativeDivision[] = [
  {
    name: "Alta Verapaz",
    cities: [
      "Chahal", "Chisec", "Cobán", "Fray Bartolomé de las Casas", "Lanquín",
      "Panzós", "Raxruhá", "San Cristóbal Verapaz", "San Juan Chamelco",
      "San Pedro Carchá", "Santa Catalina La Tinta", "Santa Cruz Verapaz",
      "Santa María Cahabón", "Senahú", "Tactic", "Tamahú", "Tucurú",
    ],
  },
  {
    name: "Baja Verapaz",
    cities: [
      "Cubulco", "El Chol", "Granados", "Purulhá", "Rabinal", "Salamá",
      "San Jerónimo", "San Miguel Chicaj",
    ],
  },
  {
    name: "Chimaltenango",
    cities: [
      "Acatenango", "Chimaltenango", "El Tejar", "Parramos", "Patzicía",
      "Patzún", "San Andrés Itzapa", "San José Poaquil", "San Juan Comalapa",
      "San Martín Jilotepeque", "San Miguel Pochuta", "San Pedro Yepocapa",
      "Santa Apolonia", "Santa Cruz Balanyá", "Tecpán Guatemala", "Zaragoza",
    ],
  },
  {
    name: "Chiquimula",
    cities: [
      "Camotán", "Chiquimula", "Concepción Las Minas", "Esquipulas", "Ipala",
      "Jocotán", "Olopa", "Quezaltepeque", "San Jacinto", "San José La Arada",
      "San Juan Ermita",
    ],
  },
  {
    name: "El Progreso",
    cities: [
      "El Jícaro", "Guastatoya", "Morazán", "San Agustín Acasaguastlán",
      "San Antonio La Paz", "San Cristóbal Acasaguastlán", "Sanarate",
      "Sansare",
    ],
  },
  {
    name: "Escuintla",
    cities: [
      "Escuintla", "Guanagazapa", "Iztapa", "La Democracia", "La Gomera",
      "Masagua", "Nueva Concepción", "Palín", "San José", "San Vicente Pacaya",
      "Santa Lucía Cotzumalguapa", "Sipacate", "Siquinalá", "Tiquisate",
    ],
  },
  {
    name: "Guatemala",
    cities: [
      "Amatitlán", "Chinautla", "Chuarrancho", "Fraijanes", "Guatemala",
      "Mixco", "Palencia", "San José del Golfo", "San José Pinula",
      "San Juan Sacatepéquez", "San Miguel Petapa", "San Pedro Ayampuc",
      "San Pedro Sacatepéquez", "San Raymundo", "Santa Catarina Pinula",
      "Villa Canales", "Villa Nueva",
    ],
  },
  {
    name: "Huehuetenango",
    cities: [
      "Aguacatán", "Chiantla", "Colotenango", "Concepción Huista", "Cuilco",
      "Huehuetenango", "Jacaltenango", "La Democracia", "La Libertad",
      "Malacatancito", "Nentón", "Petatán", "San Antonio Huista",
      "San Gaspar Ixchil", "San Ildefonso Ixtahuacán", "San Juan Atitán",
      "San Juan Ixcoy", "San Mateo Ixtatán", "San Miguel Acatán",
      "San Pedro Necta", "San Pedro Soloma", "San Rafael La Independencia",
      "San Rafael Petzal", "San Sebastián Coatán",
      "San Sebastián Huehuetenango", "Santa Ana Huista", "Santa Bárbara",
      "Santa Cruz Barillas", "Santa Eulalia", "Santiago Chimaltenango",
      "Tectitán", "Todos Santos Cuchumatán", "Unión Cantinil",
    ],
  },
  {
    name: "Izabal",
    cities: [
      "El Estor", "Livingston", "Los Amates", "Morales", "Puerto Barrios",
    ],
  },
  {
    name: "Jalapa",
    cities: [
      "Jalapa", "Mataquescuintla", "Monjas", "San Carlos Alzatate",
      "San Luis Jilotepeque", "San Manuel Chaparrón", "San Pedro Pinula",
    ],
  },
  {
    name: "Jutiapa",
    cities: [
      "Agua Blanca", "Asunción Mita", "Atescatempa", "Comapa", "Conguaco",
      "El Adelanto", "El Progreso", "Jalpatagua", "Jerez", "Jutiapa", "Moyuta",
      "Pasaco", "Quesada", "San José Acatempa", "Santa Catarina Mita",
      "Yupiltepeque", "Zapotitlán",
    ],
  },
  {
    name: "Petén",
    cities: [
      "Dolores", "El Chal", "Flores", "La Libertad", "Las Cruces",
      "Melchor de Mencos", "Poptún", "San Andrés", "San Benito",
      "San Francisco", "San José", "San Luis", "Santa Ana", "Sayaxché",
    ],
  },
  {
    name: "Quetzaltenango",
    cities: [
      "Almolonga", "Cabricán", "Cajolá", "Cantel", "Coatepeque",
      "Colomba Costa Cuca", "Concepción Chiquirichapa", "El Palmar",
      "Flores Costa Cuca", "Génova", "Huitán", "La Esperanza", "Olintepeque",
      "Palestina de Los Altos", "Quetzaltenango", "Salcajá", "San Carlos Sija",
      "San Francisco La Unión", "San Juan Ostuncalco",
      "San Martín Sacatepéquez", "San Mateo", "San Miguel Sigüilá", "Sibilia",
      "Zunil",
    ],
  },
  {
    name: "Quiché",
    cities: [
      "Canillá", "Chajul", "Chicamán", "Chichicastenango", "Chiché",
      "Chinique", "Cunén", "Ixcán", "Joyabaj", "Nebaj", "Pachalum", "Patzité",
      "Sacapulas", "San Andrés Sajcabajá", "San Antonio Ilotenango",
      "San Bartolomé Jocotenango", "San Juan Cotzal", "San Pedro Jocopilas",
      "Santa Cruz del Quiché", "Uspantán", "Zacualpa",
    ],
  },
  {
    name: "Retalhuleu",
    cities: [
      "Champerico", "El Asintal", "Nuevo San Carlos", "Retalhuleu",
      "San Andrés Villa Seca", "San Felipe", "San Martín Zapotitlán",
      "San Sebastián", "Santa Cruz Muluá",
    ],
  },
  {
    name: "Sacatepéquez",
    cities: [
      "Alotenango", "Antigua Guatemala", "Ciudad Vieja", "Jocotenango",
      "Magdalena Milpas Altas", "Pastores", "San Antonio Aguas Calientes",
      "San Bartolomé Milpas Altas", "San Lucas Sacatepéquez",
      "San Miguel Dueñas", "Santa Catarina Barahona",
      "Santa Lucía Milpas Altas", "Santa María de Jesús",
      "Santiago Sacatepéquez", "Santo Domingo Xenacoj", "Sumpango",
    ],
  },
  {
    name: "San Marcos",
    cities: [
      "Ayutla", "Catarina", "Comitancillo", "Concepción Tutuapa", "El Quetzal",
      "El Tumbador", "Esquipulas Palo Gordo", "Ixchiguán", "La Blanca",
      "La Reforma", "Malacatán", "Nuevo Progreso", "Ocós", "Pajapita",
      "Río Blanco", "San Antonio Sacatepéquez", "San Cristóbal Cucho",
      "San José El Rodeo", "San José Ojetenam", "San Lorenzo", "San Marcos",
      "San Miguel Ixtahuacán", "San Pablo", "San Pedro Sacatepéquez",
      "San Rafael Pie de la Cuesta", "Sibinal", "Sipacapa", "Tacaná",
      "Tajumulco", "Tejutla",
    ],
  },
  {
    name: "Santa Rosa",
    cities: [
      "Barberena", "Casillas", "Chiquimulilla", "Cuilapa", "Guazacapán",
      "Nueva Santa Rosa", "Oratorio", "Pueblo Nuevo Viñas", "San Juan Tecuaco",
      "San Rafael Las Flores", "Santa Cruz Naranjo", "Santa María Ixhuatán",
      "Santa Rosa de Lima", "Taxisco",
    ],
  },
  {
    name: "Sololá",
    cities: [
      "Concepción", "Nahualá", "Panajachel", "San Andrés Semetabaj",
      "San Antonio Palopó", "San José Chacayá", "San Juan La Laguna",
      "San Lucas Tolimán", "San Marcos La Laguna", "San Pablo La Laguna",
      "San Pedro La Laguna", "Santa Catarina Ixtahuacán",
      "Santa Catarina Palopó", "Santa Clara La Laguna", "Santa Cruz La Laguna",
      "Santa Lucía Utatlán", "Santa María Visitación", "Santiago Atitlán",
      "Sololá",
    ],
  },
  {
    name: "Suchitepéquez",
    cities: [
      "Chicacao", "Cuyotenango", "Mazatenango", "Patulul", "Pueblo Nuevo",
      "Río Bravo", "Samayac", "San Antonio Suchitepéquez", "San Bernardino",
      "San Francisco Zapotitlán", "San Gabriel", "San José El Ídolo",
      "San José La Máquina", "San Juan Bautista", "San Lorenzo",
      "San Miguel Panán", "San Pablo Jocopilas", "Santa Bárbara",
      "Santo Domingo Suchitepéquez", "Santo Tomás La Unión", "Zunilito",
    ],
  },
  {
    name: "Totonicapán",
    cities: [
      "Momostenango", "San Andrés Xecul", "San Bartolo Aguas Calientes",
      "San Cristóbal Totonicapán", "San Francisco El Alto",
      "Santa Lucía La Reforma", "Santa María Chiquimula", "Totonicapán",
    ],
  },
  {
    name: "Zacapa",
    cities: [
      "Cabañas", "Estanzuela", "Gualán", "Huité", "La Unión", "Río Hondo",
      "San Diego", "San Jorge", "Teculután", "Usumatlán", "Zacapa",
    ],
  },
];

/**
 * Los nombres con los que un cliente guatemalteco nombra su municipio cuando no
 * usa el oficial. No es cortesía: «Ciudad de Guatemala» es lo que dice todo el
 * mundo y el municipio se llama «Guatemala», así que sin esta tabla el destino
 * más frecuente del país fallaría la validación.
 *
 * Solo lo que la normalización no arregla sola. Las tildes, las mayúsculas y la
 * puntuación ya las resuelve `../country.ts`; aquí van nombres realmente
 * distintos —abreviados, coloquiales o con el santo omitido—.
 */
export const GUATEMALA_CITY_ALIASES: Readonly<Record<string, string>> = {
  "Ciudad de Guatemala": "Guatemala",
  "Guatemala City": "Guatemala",
  "Nueva Guatemala de la Asunción": "Guatemala",
  "La Antigua": "Antigua Guatemala",
  Antigua: "Antigua Guatemala",
  Xela: "Quetzaltenango",
  "La Tinta": "Santa Catalina La Tinta",
  "Santa Cruz El Chol": "El Chol",
  "San Bartolo": "San Bartolo Aguas Calientes",
  Pochuta: "San Miguel Pochuta",
  Yepocapa: "San Pedro Yepocapa",
  Comalapa: "San Juan Comalapa",
  Ixtahuacán: "San Ildefonso Ixtahuacán",
  Soloma: "San Pedro Soloma",
  Barillas: "Santa Cruz Barillas",
  Cahabón: "Santa María Cahabón",
  "Puerto San José": "San José",
};

/**
 * Los departamentos también se abrevian. «El Quiché» y «Quiché» son el mismo
 * departamento, y quien escribe «Peten» sin tilde ya lo resuelve la
 * normalización.
 */
export const GUATEMALA_DIVISION_ALIASES: Readonly<Record<string, string>> = {
  "El Quiché": "Quiché",
  "El Petén": "Petén",
  Guate: "Guatemala",
  "Ciudad de Guatemala": "Guatemala",
};
