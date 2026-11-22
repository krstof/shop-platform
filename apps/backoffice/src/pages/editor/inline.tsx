// Direkt in der Vorschau schreiben: ein Text, der aussieht wie im Shop und sich beim Anklicken
// bearbeiten lässt. Bleibt „unkontrolliert“, solange er den Fokus hat, damit der Cursor beim Tippen
// nicht springt.
//
// Mehrzeilige Felder dürfen seit dem 22.11.2026 formatiert werden (Paket P13): Beim Schreiben steht
// die Auszeichnung da (**fett**), beim Verlassen des Feldes zeigt der Editor sie so, wie der Shop
// sie später zeigt. Darüber erscheint die Leiste mit fett, kursiv, Listen und Link.
import { useLayoutEffect, useRef, useState, type ElementType } from "react";
import { formatText } from "@shop/text";
import { FormatBar } from "./format-bar.js";

/** Stelle im Text, die gerade ausgewählt ist (in Zeichen, Zeilenumbruch zählt als eines). */
function auswahlVon(el: HTMLElement): { start: number; ende: number } | undefined {
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount === 0) return undefined;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return undefined;
  const bis = (knoten: Node, offset: number): number => {
    let n = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node: Node | null = walker.currentNode;
    while (node !== null) {
      if (node === knoten) return n + (node.nodeType === Node.TEXT_NODE ? offset : 0);
      if (node.nodeType === Node.TEXT_NODE) n += (node.textContent ?? "").length;
      else if (node.nodeName === "BR") n += 1;
      node = walker.nextNode();
    }
    return n;
  };
  const start = bis(range.startContainer, range.startOffset);
  const ende = bis(range.endContainer, range.endOffset);
  return start <= ende ? { start, ende } : { start: ende, ende: start };
}

/** Cursor wieder an die gewünschte Stelle setzen, nachdem der Text neu geschrieben wurde. */
function auswahlSetzen(el: HTMLElement, start: number, ende: number): void {
  const sel = window.getSelection();
  if (sel === null) return;
  const stelle = (ziel: number): { node: Node; offset: number } => {
    let n = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let letzte: Node = el;
    while (node !== null) {
      const laenge = (node.textContent ?? "").length;
      if (n + laenge >= ziel) return { node, offset: ziel - n };
      n += laenge;
      letzte = node;
      node = walker.nextNode();
    }
    return { node: letzte, offset: letzte === el ? 0 : ((letzte.textContent ?? "").length ?? 0) };
  };
  const a = stelle(start);
  const b = stelle(ende);
  const range = document.createRange();
  range.setStart(a.node, Math.min(a.offset, (a.node.textContent ?? "").length));
  range.setEnd(b.node, Math.min(b.offset, (b.node.textContent ?? "").length));
  sel.removeAllRanges();
  sel.addRange(range);
}

export function InlineText({
  value,
  onChange,
  placeholder,
  label,
  multiline = false,
  format = false,
  maxLength,
  as: Tag = "div",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Name für Screenreader, etwa „Überschrift“. */
  label: string;
  multiline?: boolean;
  /** Formatieren erlauben (nur mehrzeilige Felder). */
  format?: boolean;
  maxLength?: number;
  as?: ElementType;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [aktiv, setAktiv] = useState(false);
  const [auswahl, setAuswahl] = useState<{ start: number; ende: number }>({ start: 0, ende: 0 });
  const formatierbar = format && multiline;

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || document.activeElement === el) return;
    // Außerhalb des Schreibens zeigt ein formatierbares Feld, was der Shop zeigen wird.
    if (formatierbar && value.trim() !== "") {
      const html = formatText(value);
      if (el.innerHTML !== html) el.innerHTML = html;
      return;
    }
    if (el.innerText !== value) el.innerText = value;
  }, [value, formatierbar, aktiv]);

  function read(el: HTMLElement): string {
    let t = el.innerText.replace(/\r/g, "");
    // Leeres Feld: Browser lassen oft einen Zeilenumbruch stehen.
    if (t === "\n") t = "";
    if (!multiline) t = t.replace(/\n/g, " ");
    if (maxLength !== undefined && t.length > maxLength) t = t.slice(0, maxLength);
    return t;
  }

  function merkeAuswahl(): void {
    const el = ref.current;
    if (el === null || !formatierbar) return;
    const a = auswahlVon(el);
    if (a !== undefined) setAuswahl(a);
  }

  const feld = (
    <Tag
      ref={ref}
      role="textbox"
      aria-label={label}
      aria-multiline={multiline || undefined}
      tabIndex={0}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      className={`sp-edit ${className}`}
      onInput={(e: React.FormEvent<HTMLElement>) => {
        const el = e.currentTarget;
        const t = read(el);
        if (t === "" && el.innerHTML !== "") el.innerHTML = "";
        onChange(t);
        merkeAuswahl();
      }}
      onFocus={(e: React.FocusEvent<HTMLElement>) => {
        // Beim Hineinklicken wird aus der Anzeige wieder der Text mit der Auszeichnung.
        if (formatierbar && e.currentTarget.innerText !== value) e.currentTarget.innerText = value;
        setAktiv(true);
      }}
      onKeyUp={merkeAuswahl}
      onMouseUp={merkeAuswahl}
      onSelect={merkeAuswahl}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        if (!multiline && e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") e.currentTarget.blur();
        // Leertaste und Pfeile gehören dem Text, nicht dem Ziehen.
        e.stopPropagation();
      }}
      onBlur={(e: React.FocusEvent<HTMLElement>) => {
        const t = read(e.currentTarget);
        setAktiv(false);
        if (formatierbar && t.trim() !== "") {
          e.currentTarget.innerHTML = formatText(t);
          if (t !== value) onChange(t);
          return;
        }
        if (e.currentTarget.innerText !== t) e.currentTarget.innerText = t;
      }}
    />
  );

  if (!formatierbar) return feld;
  return (
    <div className="relative">
      {aktiv && (
        <div className="absolute -top-10 left-0 z-20">
          <FormatBar
            auswahl={{ text: value, start: auswahl.start, ende: auswahl.ende }}
            onChange={(neu) => {
              onChange(neu.text);
              const el = ref.current;
              if (el === null) return;
              el.innerText = neu.text;
              auswahlSetzen(el, neu.start, neu.ende);
              setAuswahl({ start: neu.start, ende: neu.ende });
            }}
          />
        </div>
      )}
      {feld}
    </div>
  );
}
