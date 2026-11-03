// Baut die Importregeln für dependency-cruiser aus den module.json-Dateien (Architektur 3.4).
// Wird von .dependency-cruiser.mjs (Prüfung im Projekt) und vom Test mit Beispielmodulen benutzt.

/** @param {string} s */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Die einzige öffentliche Datei eines Moduls (Architektur 3.3, Regel 3).
 * Über den Paketnamen (@shop/<modul>) zeigt der Import je nach package.json auf die gebaute Fassung in dist/.
 */
export const PUBLIC_ENTRY = "^modules/[^/]+/(src/index\\.(ts|js|mjs)|dist/index\\.(js|d\\.ts))$";

/**
 * @param {import("./modules.mjs").ModuleInfo[]} mods
 * @returns {import("dependency-cruiser").IForbiddenRuleType[]}
 */
export function buildRules(mods) {
  /** @type {import("dependency-cruiser").IForbiddenRuleType[]} */
  const rules = [
    {
      name: "kein-kreis",
      comment: "Kreise zwischen Dateien sind verboten (Architektur 3.3, Regel 4).",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "kernel-kennt-keine-module",
      comment: "Der Kernel ist ein Werkzeugkasten und darf kein Fachmodul und kein Programm kennen.",
      severity: "error",
      from: { path: "^packages/kernel/" },
      to: { path: "^(modules|apps)/" },
    },
    {
      name: "pakete-kennen-keine-module",
      comment: "Gemeinsame Pakete unter packages/ hängen nie von Fachmodulen oder Programmen ab.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^(modules|apps)/" },
    },
    {
      name: "module-kennen-keine-programme",
      comment: "Fachmodule importieren nie aus apps/. Programme setzen Module zusammen, nicht umgekehrt.",
      severity: "error",
      from: { path: "^modules/" },
      to: { path: "^apps/" },
    },
    {
      name: "nur-oeffentliche-datei-fremder-module",
      comment:
        "Ein Modul darf aus einem anderen Modul nur dessen src/index.ts importieren (Fassade, Ereignisse, DTOs). " +
        "Interne Dateien und db.generated.ts sind tabu (Architektur 3.3, Regel 3).",
      severity: "error",
      from: { path: "^modules/([^/]+)/" },
      to: { path: "^modules/[^/]+/", pathNot: ["^modules/$1/", PUBLIC_ENTRY] },
    },
    {
      name: "kein-unaufloesbarer-import",
      comment:
        "Jeder Import muss sich auflösen lassen. Sonst könnte ein Import über einen Paketnamen " +
        "(@shop/<modul>/intern) unbemerkt an den Regeln vorbeigehen.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "programme-nur-ueber-oeffentliche-datei",
      comment: "Programme unter apps/ benutzen Module nur über deren src/index.ts.",
      severity: "error",
      from: { path: "^apps/" },
      to: { path: "^modules/[^/]+/", pathNot: [PUBLIC_ENTRY] },
    },
  ];
  for (const m of mods) {
    if (m.kind !== "module") continue;
    const allowed = [m.name, ...m.dependsOn].map(esc).join("|");
    rules.push({
      name: `nicht-erklaerte-abhaengigkeit:${m.name}`,
      comment:
        `Modul ${m.name} darf nur ${m.dependsOn.length > 0 ? m.dependsOn.join(", ") : "kein anderes Modul"} aufrufen ` +
        "(module.json → dependsOn). Alles andere über Ereignisse.",
      severity: "error",
      from: { path: `^modules/${esc(m.name)}/` },
      to: { path: "^modules/", pathNot: `^modules/(${allowed})/` },
    });
  }
  return rules;
}

/**
 * Gemeinsame Einstellungen für das Auflösen von Importen.
 * Importe mit der Endung .js (NodeNext) löst dependency-cruiser selbst auf die .ts-Datei auf (im Test geprüft).
 * @returns {import("dependency-cruiser").ICruiseOptions}
 */
export function cruiseOptions() {
  return {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|dist|coverage|\\.turbo)/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".mjs", ".js", ".json"],
      exportsFields: ["exports"],
      // „source“ zeigt in den package.json unserer Pakete auf src/: So prüft die Regel Importe über
      // Paketnamen (@shop/<modul>) auch vor dem Bauen und immer gegen die echte Quelldatei.
      conditionNames: ["source", "types", "import", "default"],
      mainFields: ["types", "module", "main"],
    },
  };
}
