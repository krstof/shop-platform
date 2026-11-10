// Storefront (Architektur 2, Tabelle Techstack). Seit M4 Server-Rendering mit dem Node-Adapter: Jede
// Seite holt ihre Daten aus der Storefront-API. Kein JavaScript im Browser, Formulare gehen ohne.
import node from "@astrojs/node";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  trailingSlash: "ignore",
  build: { inlineStylesheets: "never", assets: "_assets" },
  // Formulare nur von der eigenen Adresse (Schutz gegen untergeschobene Bestellungen, CSRF).
  security: { checkOrigin: true },
  // Keine Telemetrie, keine Schrift- oder Bilddienste von außen.
  devToolbar: { enabled: false },
  server: { host: "127.0.0.1" },
});
