// Direkt in der Vorschau schreiben: ein Text, der aussieht wie im Shop und sich beim Anklicken
// bearbeiten lässt (nur reiner Text, kein Formatieren). Bleibt „unkontrolliert“, solange er den Fokus
// hat, damit der Cursor beim Tippen nicht springt.
import { useLayoutEffect, useRef, type ElementType } from "react";

export function InlineText({
  value,
  onChange,
  placeholder,
  label,
  multiline = false,
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
  maxLength?: number;
  as?: ElementType;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || document.activeElement === el) return;
    if (el.innerText !== value) el.innerText = value;
  }, [value]);

  function read(el: HTMLElement): string {
    let t = el.innerText.replace(/\r/g, "");
    // Leeres Feld: Browser lassen oft einen Zeilenumbruch stehen.
    if (t === "\n") t = "";
    if (!multiline) t = t.replace(/\n/g, " ");
    if (maxLength !== undefined && t.length > maxLength) t = t.slice(0, maxLength);
    return t;
  }

  return (
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
      }}
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
        if (e.currentTarget.innerText !== t) e.currentTarget.innerText = t;
      }}
    />
  );
}
