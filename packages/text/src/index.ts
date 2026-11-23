// Formatierung in Textfeldern (Kristof 22.11.2026, Paket P13).
//
// Gespeichert wird kein HTML, sondern eine kleine Auszeichnung, die jeder lesen kann:
//
//   **fett**            fett
//   *kursiv*            kursiv
//   ## Zeile            Überschrift (Paket P5)
//   [Text](Adresse)     Link
//   - Zeile             Aufzählung
//   1. Zeile            nummerierte Liste
//   Leerzeile           neuer Absatz
//
// Alles andere ist Text und bleibt Text. Der Shop baut daraus sein eigenes HTML; fremdes HTML
// kommt nie hinein, weil jedes Zeichen zuerst maskiert wird. Deshalb liegt diese Datei in einem
// gemeinsamen Paket: Shop und Backoffice müssen Zeichen für Zeichen dasselbe daraus machen.

/** Adressen, die ein Link haben darf: Webseite, E-Mail, Telefon oder ein Pfad im eigenen Shop. */
export function isSafeTextUrl(url: string): boolean {
  return (
    url.length <= 300 &&
    /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|tel:\+?[0-9 ()/-]+|\/[a-z0-9/_-]*)$/i.test(url) &&
    !url.startsWith("//")
  );
}

/** Zeichen maskieren, bevor irgendetwas zu HTML wird. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Eine Zeile mit Auszeichnung in sicheres HTML: erst maskieren, dann die erlaubten Muster
 * ersetzen. Die Reihenfolge zählt: Links zuerst, damit `*` in einer Adresse nichts kursiv macht.
 */
export function formatInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,300})\)/g, (ganz, beschriftung: string, adresse) => {
    // Die Adresse steht maskiert da (&amp;); fürs Prüfen und fürs Attribut zurückrechnen.
    const roh = String(adresse)
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');
    if (!isSafeTextUrl(roh)) return ganz;
    const extern = /^https?:\/\//i.test(roh);
    const ziel = extern ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${escapeHtml(roh)}"${ziel}>${beschriftungHtml(beschriftung)}</a>`;
  });
  out = out.replace(/\*\*([^*\n]{1,500})\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]{1,500})\*(?!\*)/g, "$1<em>$2</em>");
  return out;
}

/** Beschriftung eines Links: fett und kursiv ja, ein Link im Link nicht. */
function beschriftungHtml(text: string): string {
  return text
    .replace(/\*\*([^*\n]{1,500})\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]{1,500})\*(?!\*)/g, "$1<em>$2</em>");
}

type Abschnitt =
  | { readonly art: "absatz"; readonly zeilen: string[] }
  | { readonly art: "liste"; readonly nummeriert: boolean; readonly punkte: string[] }
  | { readonly art: "ueberschrift"; readonly text: string };

/**
 * Text in Absätze, Überschriften und Listen zerlegen. Eine Leerzeile trennt, `- ` und `1. `
 * beginnen eine Liste, `## ` eine Überschrift.
 */
export function abschnitte(text: string): Abschnitt[] {
  const aus: Abschnitt[] = [];
  for (const zeile of text.replace(/\r\n?/g, "\n").split("\n")) {
    const ueberschrift = /^\s*#{1,3}\s+(.*)$/.exec(zeile);
    if (ueberschrift !== null) {
      aus.push({ art: "ueberschrift", text: (ueberschrift[1] ?? "").trim() });
      continue;
    }
    const punkt = /^\s*[-*]\s+(.*)$/.exec(zeile);
    const nummer = /^\s*\d{1,2}[.)]\s+(.*)$/.exec(zeile);
    const letzter = aus[aus.length - 1];
    if (punkt !== null || nummer !== null) {
      const nummeriert = nummer !== null;
      const inhalt = (nummer?.[1] ?? punkt?.[1] ?? "").trim();
      if (letzter !== undefined && letzter.art === "liste" && letzter.nummeriert === nummeriert)
        letzter.punkte.push(inhalt);
      else aus.push({ art: "liste", nummeriert, punkte: [inhalt] });
      continue;
    }
    if (zeile.trim() === "") {
      if (letzter !== undefined && letzter.art === "absatz" && letzter.zeilen.length > 0)
        aus.push({ art: "absatz", zeilen: [] });
      else if (letzter !== undefined && letzter.art === "liste") aus.push({ art: "absatz", zeilen: [] });
      continue;
    }
    if (letzter !== undefined && letzter.art === "absatz") letzter.zeilen.push(zeile.trim());
    else aus.push({ art: "absatz", zeilen: [zeile.trim()] });
  }
  return aus.filter((a) =>
    a.art === "absatz"
      ? a.zeilen.length > 0
      : a.art === "ueberschrift"
        ? a.text !== ""
        : a.punkte.some((p) => p !== ""),
  );
}

/**
 * Der ganze Text als sicheres HTML: Absätze als `<p>`, Überschriften als `<h3>` (die Seite hat
 * schon eine `<h1>` und meist eine `<h2>`), Listen als `<ul>`/`<ol>`, darin fett, kursiv und
 * Links. Zeilenumbrüche innerhalb eines Absatzes bleiben als `<br />` erhalten.
 */
export function formatText(text: string): string {
  return abschnitte(text)
    .map((a) =>
      a.art === "ueberschrift"
        ? `<h3>${formatInline(a.text)}</h3>`
        : a.art === "absatz"
          ? `<p>${a.zeilen.map(formatInline).join("<br />")}</p>`
          : `<${a.nummeriert ? "ol" : "ul"}>${a.punkte
              .filter((p) => p !== "")
              .map((p) => `<li>${formatInline(p)}</li>`)
              .join("")}</${a.nummeriert ? "ol" : "ul"}>`,
    )
    .join("");
}

/** Nur der reine Text, ohne Auszeichnung: für Vorschauen, Titel und Beschreibungen. */
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]\n]{1,200})\]\([^)\s]{1,300}\)/g, "$1")
    .replace(/\*\*([^*\n]{1,500})\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]{1,500})\*(?!\*)/g, "$1$2")
    .replace(/^\s*(?:#{1,3}|[-*]|\d{1,2}[.)])\s+/gm, "");
}

/**
 * Eine Auszeichnung um den ausgewählten Teil legen (Editor). Gibt den neuen Text zurück und, wo
 * der Cursor danach stehen soll. Steht der Teil schon so da, nimmt der Aufruf sie wieder weg.
 */
export function umschliessen(
  text: string,
  start: number,
  ende: number,
  marke: "**" | "*",
): { text: string; start: number; ende: number } {
  const davor = text.slice(0, start);
  const mitte = text.slice(start, ende);
  const danach = text.slice(ende);
  const n = marke.length;
  if (mitte.startsWith(marke) && mitte.endsWith(marke) && mitte.length >= 2 * n) {
    const ohne = mitte.slice(n, -n);
    return { text: davor + ohne + danach, start, ende: start + ohne.length };
  }
  if (davor.endsWith(marke) && danach.startsWith(marke)) {
    return {
      text: davor.slice(0, -n) + mitte + danach.slice(n),
      start: start - n,
      ende: ende - n,
    };
  }
  return { text: davor + marke + mitte + marke + danach, start: start + n, ende: ende + n };
}

/** Jede ausgewählte Zeile zu einem Listenpunkt machen; steht sie schon so da, wieder zurück. */
export function alsListe(
  text: string,
  start: number,
  ende: number,
  nummeriert: boolean,
): { text: string; start: number; ende: number } {
  const zeilenAnfang = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const zeilenEndeRoh = text.indexOf("\n", ende);
  const zeilenEnde = zeilenEndeRoh === -1 ? text.length : zeilenEndeRoh;
  const teil = text.slice(zeilenAnfang, zeilenEnde);
  const zeilen = teil.split("\n");
  const schonListe = zeilen.every((z) => /^\s*(?:[-*]|\d{1,2}[.)])\s+/.test(z) || z.trim() === "");
  const neu = zeilen
    .map((z, i) => {
      if (z.trim() === "") return z;
      if (schonListe) return z.replace(/^\s*(?:[-*]|\d{1,2}[.)])\s+/, "");
      return (nummeriert ? `${i + 1}. ` : "- ") + z.trim();
    })
    .join("\n");
  const text2 = text.slice(0, zeilenAnfang) + neu + text.slice(zeilenEnde);
  return { text: text2, start: zeilenAnfang, ende: zeilenAnfang + neu.length };
}

/** Die ausgewählten Zeilen zu Überschriften machen; stehen sie schon so da, wieder zurück. */
export function alsUeberschrift(
  text: string,
  start: number,
  ende: number,
): { text: string; start: number; ende: number } {
  const zeilenAnfang = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const zeilenEndeRoh = text.indexOf("\n", ende);
  const zeilenEnde = zeilenEndeRoh === -1 ? text.length : zeilenEndeRoh;
  const zeilen = text.slice(zeilenAnfang, zeilenEnde).split("\n");
  const schon = zeilen.every((z) => /^\s*#{1,3}\s+/.test(z) || z.trim() === "");
  const neu = zeilen
    .map((z) => {
      if (z.trim() === "") return z;
      if (schon) return z.replace(/^\s*#{1,3}\s+/, "");
      return `## ${z.replace(/^\s*(?:[-*]|\d{1,2}[.)])\s+/, "").trim()}`;
    })
    .join("\n");
  return {
    text: text.slice(0, zeilenAnfang) + neu + text.slice(zeilenEnde),
    start: zeilenAnfang,
    ende: zeilenAnfang + neu.length,
  };
}

/** Einen Link einsetzen: der ausgewählte Teil wird die Beschriftung. */
export function alsLink(
  text: string,
  start: number,
  ende: number,
  url: string,
): { text: string; start: number; ende: number } {
  const mitte = text.slice(start, ende) || "Link";
  const eingefuegt = `[${mitte}](${url})`;
  return {
    text: text.slice(0, start) + eingefuegt + text.slice(ende),
    start: start + 1,
    ende: start + 1 + mitte.length,
  };
}
