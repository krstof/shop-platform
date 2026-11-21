// EINZIGE öffentliche Datei des Moduls integrations (Architektur 3.3, Regel 3).
//
// Anbindungen an fremde Dienste, je Shop: an oder aus, offene Einstellungen und geheime
// Zugangsdaten. Die Zugangsdaten liegen verschlüsselt in der Datenbank (Umschlagverschlüsselung aus
// dem Kernel); der Hauptschlüssel steht nur in der Serverkonfiguration. Andere Module fragen über
// `credentials(provider)`, ob eine Anbindung eingerichtet ist, und bekommen die Werte im Klartext;
// die API gibt sie nie an den Browser.
export {
  INTEGRATIONS,
  findIntegration,
  type IntegrationDefinition,
  type IntegrationField,
} from "./catalog.js";
export { integrationEndpoints, type IntegrationDependencies } from "./http/admin.js";
export { fetchExternal, ExternalServiceError } from "./internal/outbound.js";
export {
  createIntegrations,
  type Integrations,
  type IntegrationsDependencies,
  type IntegrationCredentials,
  type IntegrationState,
} from "./internal/store.js";
