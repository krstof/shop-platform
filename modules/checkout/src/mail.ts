// Bestellbestätigung per E-Mail (M6). Nur Text; Werte aus der Bestellung landen als Text, nie als HTML.
import type { OrderView } from "@shop/orders";

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Versand; setzt apps/api zusammen (heute Mailpit). Darf werfen. */
export interface MailSender {
  send(mail: OutgoingMail): Promise<void>;
}

const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const euro = (cents: number) => EUR.format(cents / 100).replace(/\s/g, " ");

/** Zeilenumbrüche aus Eingaben entfernen (die Felder sind schon einzeilig geprüft). */
const line = (s: string) => s.replace(/[\r\n]+/g, " ");

export function confirmationMail(order: OrderView, shopName: string, link?: string): OutgoingMail {
  const a = order.address;
  const rows = order.lines.map((l) => `  ${l.quantity} × ${line(l.name)}  ${euro(l.lineTotal)}`);
  const taxes = Object.entries(order.taxByRate).map(
    ([rate, cents]) => `  darin ${rate} % MwSt.: ${euro(cents)}`,
  );
  return {
    to: order.email,
    subject: `${line(shopName)}: Deine Bestellung ${order.orderNumber}`,
    text: [
      `Hallo ${line(a.firstName)},`,
      "",
      `vielen Dank für deine Bestellung bei ${line(shopName)}. Die Zahlung ist eingegangen.`,
      "",
      `Bestellnummer: ${order.orderNumber}`,
      ...(link === undefined ? [] : [`Stand deiner Bestellung: ${link}`]),
      "",
      ...rows,
      "",
      `  Versand: ${order.shipping === 0 ? "kostenlos" : euro(order.shipping)}`,
      `  Summe: ${euro(order.total)}`,
      ...taxes,
      "",
      ...(order.customerNote === null ? [] : ["Deine Anmerkung:", `  ${line(order.customerNote)}`, ""]),
      "Lieferadresse:",
      `  ${line(a.firstName)} ${line(a.lastName)}`,
      `  ${line(a.street)}`,
      `  ${line(a.postalCode)} ${line(a.city)}`,
      "",
      "Hinweis: Dies ist ein Testshop. Es wird nichts geliefert und nichts berechnet.",
    ].join("\n"),
  };
}
