// Rechnung als PDF (14.11.2026): baut im Browser aus den Daten der Admin-API (Bestellung und
// Einstellungen „Allgemein“) eine einfache A4-Rechnung. Ohne Bibliothek: Standardschrift Helvetica
// (in jedem PDF-Programm eingebaut, Zeichensatz WinAnsi mit Umlauten und €), mehrere Seiten bei
// vielen Artikeln. Die Nummer der Rechnung ist die Bestellnummer.

export interface InvoiceSeller {
  readonly shopName: string;
  readonly company?: string;
  readonly name?: string;
  readonly street?: string;
  readonly addressLine2?: string;
  readonly postalCode?: string;
  readonly city?: string;
  readonly country?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly vatId?: string;
  readonly tradeRegister?: string;
}

export interface InvoiceOrder {
  readonly orderNumber: string;
  readonly placedAt: string;
  readonly email: string;
  readonly paymentStatus: string;
  readonly paymentMethodName: string | null;
  readonly address: {
    readonly firstName: string;
    readonly lastName: string;
    readonly street: string;
    readonly postalCode: string;
    readonly city: string;
    readonly countryCode: string;
  };
  readonly subtotal: number;
  readonly discount?: number;
  readonly couponCode?: string | null;
  readonly shipping: number;
  readonly total: number;
  readonly taxByRate: Readonly<Record<string, number>>;
  readonly lines: readonly {
    readonly position: number;
    readonly name: string;
    readonly sku: string | null;
    readonly quantity: number;
    readonly unitPrice: number;
    readonly lineTotal: number;
    readonly taxRatePercent: number;
  }[];
}

const COUNTRY: Record<string, string> = {
  DE: "Deutschland",
  AT: "Österreich",
  CH: "Schweiz",
  NL: "Niederlande",
  BE: "Belgien",
  LU: "Luxemburg",
  FR: "Frankreich",
  DK: "Dänemark",
  PL: "Polen",
  CZ: "Tschechien",
  IT: "Italien",
  ES: "Spanien",
};

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const euro = (cents: number) => EURO.format(cents / 100);
const DAY = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

// --- Schrift und Zeichen ---

/** Breiten der Helvetica für Zeichen 32–126 (Tausendstel der Schriftgröße). */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Zeichen außerhalb von Latin-1, die WinAnsi trotzdem kennt. */
const WIN_ANSI: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  "„": 0x84,
  "…": 0x85,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "−": 0x2d,
  " ": 0xa0,
};

/** Text als WinAnsi-Bytes (je Zeichen ein Code 0–255); Unbekanntes wird „?“. */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.normalize("NFC")) {
    const mapped = WIN_ANSI[ch];
    const code = ch.codePointAt(0) ?? 63;
    if (mapped !== undefined) out.push(mapped);
    else if (code === 9 || code === 10 || code === 13) out.push(32);
    else if ((code >= 32 && code < 127) || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else out.push(63);
  }
  return out;
}

function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const c of winAnsi(text)) {
    if (c >= 32 && c <= 126) w += WIDTHS[c - 32] ?? 556;
    else if (c === 0xa0) w += 278;
    else w += 556;
  }
  return (w * size * (bold ? 1.06 : 1)) / 1000;
}

/** Kürzt einen Text mit „…“, bis er in `max` Punkte Breite passt. */
export function fitText(text: string, max: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= max) return text;
  let s = text;
  while (s.length > 1 && textWidth(`${s}…`, size, bold) > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function pdfString(text: string): string {
  let s = "(";
  for (const c of winAnsi(text)) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += `\\${String.fromCharCode(c)}`;
    else s += String.fromCharCode(c);
  }
  return `${s})`;
}

// --- Seiten ---

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const LEFT = 56;
const RIGHT = PAGE_W - 56;
const BOTTOM = 96;

class Pages {
  readonly pages: string[] = [];
  private ops: string[] = [];

  constructor() {
    this.pages.push("");
  }

  text(
    x: number,
    y: number,
    text: string,
    size = 10,
    opts: { bold?: boolean; align?: "right"; gray?: boolean } = {},
  ) {
    const w = opts.align === "right" ? textWidth(text, size, opts.bold) : 0;
    const color = opts.gray ? "0.42 g" : "0.1 g";
    this.ops.push(
      `BT ${color} /${opts.bold ? "F2" : "F1"} ${size} Tf ${(x - w).toFixed(2)} ${y.toFixed(2)} Td ${pdfString(text)} Tj ET`,
    );
  }

  line(x1: number, y: number, x2: number, width = 0.5) {
    this.ops.push(`0.8 G ${width} w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`);
  }

  newPage() {
    this.flush();
    this.pages.push("");
  }

  flush() {
    this.pages[this.pages.length - 1] = this.ops.join("\n");
    this.ops = [];
  }
}

const COL = { pos: LEFT, name: LEFT + 28, qty: 360, unit: 450, total: RIGHT };

function tableHead(p: Pages, y: number): number {
  p.text(COL.pos, y, "Pos.", 9, { bold: true });
  p.text(COL.name, y, "Artikel", 9, { bold: true });
  p.text(COL.qty, y, "Menge", 9, { bold: true, align: "right" });
  p.text(COL.unit, y, "Einzelpreis", 9, { bold: true, align: "right" });
  p.text(COL.total, y, "Gesamt", 9, { bold: true, align: "right" });
  p.line(LEFT, y - 6, RIGHT);
  return y - 22;
}

function sellerLines(s: InvoiceSeller): string[] {
  const place = [s.postalCode, s.city].filter((x) => x !== undefined && x.trim() !== "").join(" ");
  return [
    s.company?.trim() || s.shopName,
    s.company?.trim() && s.name?.trim() ? s.name : "",
    s.street ?? "",
    s.addressLine2 ?? "",
    place,
    s.country !== undefined && s.country !== "DE" ? (COUNTRY[s.country] ?? s.country) : "",
  ].filter((l) => l.trim() !== "");
}

/** Die Rechnung als PDF-Datei (Bytes). */
export function invoicePdf(order: InvoiceOrder, seller: InvoiceSeller): Uint8Array {
  const p = new Pages();
  const sellerAddress = sellerLines(seller);

  // Kopf: Absender rechts, Empfänger links.
  let y = PAGE_H - 64;
  p.text(RIGHT, y, sellerAddress[0] ?? seller.shopName, 13, { bold: true, align: "right" });
  y -= 16;
  for (const l of [
    ...sellerAddress.slice(1),
    seller.email ?? "",
    seller.phone ? `Tel. ${seller.phone}` : "",
  ]) {
    if (l.trim() === "") continue;
    p.text(RIGHT, y, l, 9, { align: "right", gray: true });
    y -= 12;
  }

  const oneLine = [sellerAddress[0], sellerAddress.slice(1).join(", ")].filter(Boolean).join(" · ");
  y = PAGE_H - 170;
  p.text(LEFT, y, fitText(oneLine, 300, 7), 7, { gray: true });
  y -= 18;
  const a = order.address;
  for (const l of [
    `${a.firstName} ${a.lastName}`,
    a.street,
    `${a.postalCode} ${a.city}`,
    a.countryCode === "DE" ? "" : (COUNTRY[a.countryCode] ?? a.countryCode),
  ]) {
    if (l.trim() === "") continue;
    p.text(LEFT, y, l, 10.5);
    y -= 14;
  }

  y = PAGE_H - 300;
  p.text(LEFT, y, "Rechnung", 20, { bold: true });
  p.text(RIGHT, y + 8, `Rechnungsnummer: ${order.orderNumber}`, 9.5, { align: "right" });
  p.text(RIGHT, y - 6, `Datum: ${DAY.format(new Date(order.placedAt))}`, 9.5, { align: "right" });
  y -= 22;
  p.text(LEFT, y, `Vielen Dank für deine Bestellung bei ${seller.shopName}.`, 10);
  y -= 34;

  // Artikel
  y = tableHead(p, y);
  for (const l of order.lines) {
    if (y < BOTTOM + 40) {
      p.text(RIGHT, BOTTOM - 30, "Weiter auf der nächsten Seite", 8, { align: "right", gray: true });
      p.newPage();
      y = tableHead(p, PAGE_H - 72);
    }
    p.text(COL.pos, y, String(l.position), 9.5);
    p.text(COL.name, y, fitText(l.name, COL.qty - COL.name - 50, 9.5), 9.5);
    p.text(COL.qty, y, String(l.quantity), 9.5, { align: "right" });
    p.text(COL.unit, y, euro(l.unitPrice), 9.5, { align: "right" });
    p.text(COL.total, y, euro(l.lineTotal), 9.5, { align: "right" });
    const detail = [l.sku ? `Art.-Nr. ${l.sku}` : "", `${l.taxRatePercent} % MwSt.`]
      .filter(Boolean)
      .join(" · ");
    p.text(COL.name, y - 11, fitText(detail, COL.qty - COL.name - 50, 7.5), 7.5, { gray: true });
    y -= 26;
  }

  // Summen
  const rows: [string, string, boolean][] = [["Zwischensumme", euro(order.subtotal), false]];
  if ((order.discount ?? 0) > 0)
    rows.push([`Gutschein ${order.couponCode ?? ""}`.trim(), `−${euro(order.discount ?? 0)}`, false]);
  rows.push(["Versand", order.shipping === 0 ? "kostenlos" : euro(order.shipping), false]);
  rows.push(["Gesamtbetrag", euro(order.total), true]);
  const taxRows = Object.entries(order.taxByRate).sort(([x], [y2]) => Number(y2) - Number(x));
  if (y < BOTTOM + 30 + (rows.length + taxRows.length) * 15) {
    p.newPage();
    y = PAGE_H - 72;
  }
  p.line(LEFT, y + 10, RIGHT);
  y -= 6;
  for (const [label, value, bold] of rows) {
    if (bold) {
      p.line(COL.unit - 80, y + 11, RIGHT);
      y -= 4;
    }
    p.text(COL.unit, y, label, bold ? 11 : 9.5, { bold, align: "right" });
    p.text(COL.total, y, value, bold ? 11 : 9.5, { bold, align: "right" });
    y -= bold ? 18 : 15;
  }
  for (const [rate, cents] of taxRows) {
    p.text(COL.unit, y, `enthaltene MwSt. ${rate} %`, 8.5, { align: "right", gray: true });
    p.text(COL.total, y, euro(cents), 8.5, { align: "right", gray: true });
    y -= 13;
  }
  y -= 12;
  if (order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded") {
    p.text(LEFT, y, `Bezahlt${order.paymentMethodName ? ` per ${order.paymentMethodName}` : ""}.`, 9.5);
  }

  // Fuß auf jeder Seite
  p.flush();
  const foot = [
    [seller.company?.trim() || seller.shopName, seller.email ?? ""].filter(Boolean).join(" · "),
    [seller.vatId ? `USt-IdNr. ${seller.vatId}` : "", seller.tradeRegister ?? ""].filter(Boolean).join(" · "),
    "Testshop – Bestellungen und Zahlungen sind nicht echt.",
  ].filter((l) => l.trim() !== "");
  const pages = p.pages.map((ops, i) => {
    const f = new Pages();
    let fy = 58;
    f.line(LEFT, fy + 14, RIGHT);
    for (const l of foot) {
      f.text(LEFT, fy, fitText(l, RIGHT - LEFT - 60, 7.5), 7.5, { gray: true });
      fy -= 10;
    }
    if (p.pages.length > 1)
      f.text(RIGHT, 58, `Seite ${i + 1} von ${p.pages.length}`, 7.5, { align: "right", gray: true });
    f.flush();
    return `${ops}\n${f.pages[0] ?? ""}`;
  });
  return assemble(pages, `Rechnung ${order.orderNumber}`);
}

/** Setzt die PDF-Datei zusammen (Objekte, Querverweistabelle). */
function assemble(contents: readonly string[], title: string): Uint8Array {
  const objects: string[] = [];
  const pageIds = contents.map((_, i) => 5 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${contents.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  contents.forEach((c, i) => {
    const pageId = 5 + i * 2;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${c.length} >>\nstream\n${c}\nendstream`;
  });
  const infoId = objects.length;
  objects[infoId] = `<< /Title ${pdfString(title)} /Producer (Slopify) >>`;

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id] ?? "null"}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
