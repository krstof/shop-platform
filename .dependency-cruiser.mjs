// Modulgrenzen (Architektur 3.4, ADR-002). Die Regeln entstehen aus allen module.json-Dateien,
// eine neue Abhängigkeit wird also nur in module.json erklärt, nie hier.
// Aufruf: pnpm lint:deps
import { loadModules } from "./tools/lib/modules.mjs";
import { buildRules, cruiseOptions } from "./tools/lib/depcruise-rules.mjs";

/** @type {import("dependency-cruiser").IConfiguration} */
export default {
  forbidden: buildRules(loadModules()),
  options: cruiseOptions(),
};
