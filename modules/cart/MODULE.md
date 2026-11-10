# Modul `cart`

> Landkarte für spätere Läufe (Architektur 8.4). Code seit MVP-Etappe M6 (Paket `@shop/cart`), Fassade in `src/index.ts`.

**Aufgabe:** Warenkorb für Gäste, Mengen, serverseitige Neuberechnung von Preisen und Steuern.

**Welle:** 1

**Datenbankschema:** `cart`, Tabellen: `cart`, `cart_line`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `catalog`, `inventory`, `pricing`, `shop-settings`, `tax`. Alles andere nur über Ereignisse.

**Fassade (geplant):** getCart(token), addLine(...), updateQuantity(...), freeze(cartId)

**Ereignisse (geplant):** cart.line.added.v1
