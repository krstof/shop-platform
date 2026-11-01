# Modul `checkout`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Ablauf vom Warenkorb zur Bestellung (Workflow „Bestellung aufgeben“ mit Kompensation): Adresse, Versand, Zahlart, Rechtstexte, Bestellknopf.

**Welle:** 1

**Datenbankschema:** `checkout`, Tabellen: `checkout_session`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `cart`, `catalog`, `content`, `customers`, `inventory`, `orders`, `payments`, `pricing`, `shipping`, `shop-settings`, `tax`. Alles andere nur über Ereignisse.

**Fassade (geplant):** start(cartId), setAddress(...), setShipping(...), placeOrder(...)

**Ereignisse (geplant):** checkout.completed.v1, checkout.abandoned.v1
