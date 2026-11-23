// Leiste zum Formatieren über einem mehrzeiligen Textfeld (Paket P13, Kristof 22.11.2026):
// fett, kursiv, Überschrift (Paket P5), Aufzählung, nummerierte Liste und Link. Sie schreibt eine
// kleine Auszeichnung in den Text (**fett**, *kursiv*, „## “, „- “, „1. “, [Text](Adresse)); der
// Shop macht daraus sein HTML.
//
// Warum keine Schriftart, Schriftgröße und Textfarbe je Textstelle: Die gehören in die
// Design-Einstellungen, damit der Shop zusammenbleibt. Unterstrichen gibt es auch nicht, weil
// unterstrichener Text im Web wie ein Link aussieht.
import { Bold, Heading, Italic, Link2, List, ListOrdered } from "lucide-react";
import { useRef, useState, type ComponentProps } from "react";
import { alsLink, alsListe, alsUeberschrift, umschliessen } from "@shop/text";

export interface Auswahl {
  readonly text: string;
  readonly start: number;
  readonly ende: number;
}

export function FormatBar({
  auswahl,
  onChange,
}: {
  /** Der ganze Text und die Stelle, die gerade ausgewählt ist. */
  auswahl: Auswahl;
  /** Neuer Text samt der Stelle, an der der Cursor danach stehen soll. */
  onChange: (neu: { text: string; start: number; ende: number }) => void;
}) {
  const [linkOffen, setLinkOffen] = useState(false);
  const [url, setUrl] = useState("");
  const knopf =
    "flex size-7 items-center justify-center rounded-md text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-brand-600";
  const { text, start, ende } = auswahl;

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg bg-white px-1 py-1 shadow-pop ring-1 ring-gray-200"
      style={{ fontFamily: "var(--font-sans)" }}
      // Der Klick auf die Leiste darf dem Textfeld nicht den Fokus nehmen, sonst ist die Auswahl weg.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className={knopf}
        title="Fett"
        aria-label="Fett"
        onClick={() => onChange(umschliessen(text, start, ende, "**"))}
      >
        <Bold className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={knopf}
        title="Kursiv"
        aria-label="Kursiv"
        onClick={() => onChange(umschliessen(text, start, ende, "*"))}
      >
        <Italic className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={knopf}
        title="Überschrift"
        aria-label="Überschrift"
        onClick={() => onChange(alsUeberschrift(text, start, ende))}
      >
        <Heading className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={knopf}
        title="Aufzählung"
        aria-label="Aufzählung"
        onClick={() => onChange(alsListe(text, start, ende, false))}
      >
        <List className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={knopf}
        title="Nummerierte Liste"
        aria-label="Nummerierte Liste"
        onClick={() => onChange(alsListe(text, start, ende, true))}
      >
        <ListOrdered className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={knopf + (linkOffen ? " bg-gray-100 text-gray-900" : "")}
        title="Link"
        aria-label="Link"
        aria-expanded={linkOffen}
        onClick={() => setLinkOffen((o) => !o)}
      >
        <Link2 className="size-4" aria-hidden="true" />
      </button>
      {linkOffen && (
        <form
          className="flex items-center gap-1 pl-1"
          onSubmit={(e) => {
            e.preventDefault();
            const ziel = url.trim();
            if (ziel !== "") onChange(alsLink(text, start, ende, ziel));
            setUrl("");
            setLinkOffen(false);
          }}
        >
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… oder /seite/…"
            aria-label="Adresse des Links"
            className="w-48 rounded-md border-0 px-2 py-1 text-sm ring-1 ring-gray-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
            onMouseDown={(e) => e.stopPropagation()}
          />
          <button
            type="submit"
            className="rounded-md bg-brand-600 px-2 py-1 text-sm font-medium text-white hover:bg-brand-700"
          >
            Setzen
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Ein gewöhnliches Textfeld mit der Leiste darüber (Produktbeschreibung). Anders als im Editor
 * steht hier immer die Auszeichnung da; die fertige Fassung sieht man im Shop.
 */
export function FormatTextarea({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<ComponentProps<"textarea">, "value" | "onChange">) {
  const feld = useRef<HTMLTextAreaElement>(null);
  const [aktiv, setAktiv] = useState(false);
  const [auswahl, setAuswahl] = useState({ start: 0, ende: 0 });
  const merken = () => {
    const el = feld.current;
    if (el !== null) setAuswahl({ start: el.selectionStart, ende: el.selectionEnd });
  };
  return (
    <div className="relative">
      {aktiv && (
        <div className="absolute -top-11 left-0 z-20">
          <FormatBar
            auswahl={{ text: value, start: auswahl.start, ende: auswahl.ende }}
            onChange={(neu) => {
              onChange(neu.text);
              const el = feld.current;
              if (el === null) return;
              requestAnimationFrame(() => {
                el.focus();
                el.setSelectionRange(neu.start, neu.ende);
                setAuswahl({ start: neu.start, ende: neu.ende });
              });
            }}
          />
        </div>
      )}
      <textarea
        {...rest}
        ref={feld}
        value={value}
        className={
          "block w-full rounded-md border-0 px-3 py-2 text-sm ring-1 ring-gray-200 focus:ring-2 focus:ring-brand-500 focus:outline-none " +
          (rest.className ?? "")
        }
        onChange={(e) => {
          onChange(e.target.value);
          merken();
        }}
        onFocus={() => setAktiv(true)}
        onBlur={() => setAktiv(false)}
        onKeyUp={merken}
        onMouseUp={merken}
        onSelect={merken}
      />
    </div>
  );
}
