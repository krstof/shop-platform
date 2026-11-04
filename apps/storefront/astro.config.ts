// Storefront (Architektur 2, Tabelle Techstack). Vorschau: fertige HTML-Seiten ohne Server und ohne
// JavaScript im Browser. Ab E14/E22 Server-Rendering mit dem Node-Adapter und Daten aus der Storefront API.
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "never", assets: "_assets" },
  // Keine Telemetrie, keine Schrift- oder Bilddienste von außen.
  devToolbar: { enabled: false },
  server: { host: "127.0.0.1" },
});
