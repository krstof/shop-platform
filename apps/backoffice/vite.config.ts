// Backoffice bauen (M3). Ergebnis in dist/: statische Dateien, ausgeliefert unter admin.<Domain>
// (Caddy leitet /admin/v1 und /auth/v1 an die API weiter, alles andere an diese Dateien).
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Keine Quellkarten im ausgelieferten Abbild, kein eingebettetes JavaScript (CSP script-src 'self').
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
