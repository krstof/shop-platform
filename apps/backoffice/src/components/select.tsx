// Eigene Auswahlliste statt der Browser-Auswahl (15.11.2026, Kristof: „nirgendwo Standard-Dropdowns“).
// Gleiche Schreibweise wie <select>: Kinder sind <option value="…">Text</option>, onChange bekommt
// { target: { value } }. Bedienung wie ein Combobox-Button nach WAI-ARIA: Enter/Leertaste/Pfeil öffnen,
// Pfeile wählen, Enter übernimmt, Escape schließt, Buchstaben springen zum passenden Eintrag.
import { Check, ChevronDown, X } from "lucide-react";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

interface OptionProps {
  value?: string | number;
  disabled?: boolean;
  children?: ReactNode;
}

interface Item {
  readonly value: string;
  readonly label: ReactNode;
  readonly text: string;
  readonly disabled: boolean;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function itemsOf(children: ReactNode): Item[] {
  const out: Item[] = [];
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    if (c.type === "option") {
      const p = (c as ReactElement<OptionProps>).props;
      out.push({
        value: String(p.value ?? textOf(p.children)),
        label: p.children,
        text: textOf(p.children),
        disabled: p.disabled === true,
      });
    } else {
      out.push(...itemsOf((c as ReactElement<{ children?: ReactNode }>).props.children));
    }
  });
  return out;
}

export interface SelectProps {
  readonly value: string;
  readonly onChange: (e: { target: { value: string } }) => void;
  readonly children: ReactNode;
  readonly id?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly "aria-label"?: string;
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: boolean | "true" | "false";
  /** Eigener Inhalt des Buttons (sonst der gewählte Eintrag). */
  readonly trigger?: ReactNode;
  /** Klassen für den Button; ersetzen das Aussehen eines Eingabefelds. */
  readonly buttonClassName?: string;
  /** Liste rechtsbündig unter dem Button (Standard: linksbündig, mindestens so breit wie der Button). */
  readonly align?: "left" | "right";
}

const FIELD =
  "flex w-full items-center justify-between gap-2 rounded-md bg-white py-[7px] pr-2.5 pl-3 text-left text-sm " +
  "text-gray-900 shadow-xs ring-1 ring-gray-200 hover:ring-gray-300 focus:ring-2 focus:ring-brand-500 " +
  "focus:outline-none aria-[invalid=true]:ring-red-400 disabled:cursor-not-allowed disabled:opacity-60";

export function Select({
  value,
  onChange,
  children,
  id,
  disabled,
  className,
  trigger,
  buttonClassName,
  align = "left",
  ...aria
}: SelectProps) {
  const items = itemsOf(children);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const selected = items.find((i) => i.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Nach oben öffnen, wenn unten kein Platz ist; gewählten Eintrag sichtbar machen.
  useLayoutEffect(() => {
    if (!open || button.current === null) return;
    const r = button.current.getBoundingClientRect();
    setUp(window.innerHeight - r.bottom < 280 && r.top > window.innerHeight - r.bottom);
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() {
    const i = items.findIndex((x) => x.value === value);
    setActive(
      i >= 0
        ? i
        : Math.max(
            0,
            items.findIndex((x) => !x.disabled),
          ),
    );
    setOpen(true);
  }
  function choose(i: number) {
    const item = items[i];
    if (item === undefined || item.disabled) return;
    setOpen(false);
    button.current?.focus();
    if (item.value !== value) onChange({ target: { value: item.value } });
  }
  function step(from: number, dir: 1 | -1): number {
    for (let i = from + dir; i >= 0 && i < items.length; i += dir) if (!items[i]?.disabled) return i;
    return from;
  }
  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => step(a, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => step(a, -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? step(-1, 1) : step(items.length, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key.length === 1) {
      const now = Date.now();
      typed.current = {
        text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(),
        at: now,
      };
      const i = items.findIndex((x) => !x.disabled && x.text.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  }

  return (
    <div className={"relative " + (className ?? "")}>
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={aria["aria-label"]}
        aria-describedby={aria["aria-describedby"]}
        aria-invalid={aria["aria-invalid"]}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        className={buttonClassName ?? FIELD}
      >
        {trigger ?? (
          <>
            <span className="truncate">{selected?.label ?? ""}</span>
            <ChevronDown
              className={"size-4 shrink-0 text-gray-400 transition-transform " + (open ? "rotate-180" : "")}
              aria-hidden="true"
            />
          </>
        )}
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          className={
            "absolute z-50 max-h-72 min-w-full overflow-y-auto rounded-lg bg-white p-1 text-sm shadow-lg " +
            "ring-1 ring-black/10 " +
            (up ? "bottom-full mb-1 " : "top-full mt-1 ") +
            (align === "right" ? "right-0" : "left-0")
          }
        >
          {items.map((item, i) => (
            <li
              key={item.value}
              id={`${listId}-${i}`}
              data-i={i}
              role="option"
              aria-selected={item.value === value}
              aria-disabled={item.disabled || undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                // In einem <label> würde der Klick sonst den Button erneut auslösen.
                e.preventDefault();
                choose(i);
              }}
              className={
                "flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5 whitespace-nowrap " +
                (item.disabled ? "cursor-default text-gray-400 " : "text-gray-800 ") +
                (i === active && !item.disabled ? "bg-gray-100 " : "")
              }
            >
              <span>{item.label}</span>
              {item.value === value && <Check className="size-4 text-brand-600" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Mehrfachauswahl (15.11.2026: Produkt in mehreren Kategorien). Gewählte Einträge stehen als Chips im
 * Feld, die Liste hat Häkchen. Reihenfolge = Reihenfolge des Anklickens; der erste ist der Hauptwert
 * (`firstLabel`, etwa „Hauptkategorie“).
 */
export function MultiSelect({
  options,
  value,
  onChange,
  id,
  placeholder = "Keine",
  firstLabel,
  emptyText = "Noch nichts zum Auswählen.",
  ...aria
}: {
  options: readonly { readonly value: string; readonly label: string }[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  id?: string;
  placeholder?: string;
  firstLabel?: string;
  emptyText?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const label = new Map(options.map((o) => [o.value, o.label]));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setActive(0);
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = options[active];
      if (o !== undefined) toggle(o.value);
    } else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={box} className="relative">
      <div className="flex min-h-[38px] w-full flex-wrap items-center gap-1.5 rounded-md bg-white py-1.5 pr-9 pl-2 shadow-xs ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-brand-500">
        {value.length === 0 && <span className="px-1 text-sm text-gray-400">{placeholder}</span>}
        {value.map((v, i) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-md bg-gray-100 py-0.5 pr-1 pl-2 text-sm text-gray-800"
          >
            {label.get(v) ?? "Unbekannt"}
            {i === 0 && firstLabel && value.length > 1 && (
              <span className="text-[0.7rem] text-gray-500">· {firstLabel}</span>
            )}
            <button
              type="button"
              aria-label={`${label.get(v) ?? "Eintrag"} entfernen`}
              onClick={() => onChange(value.filter((x) => x !== v))}
              className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        <button
          ref={button}
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          aria-describedby={aria["aria-describedby"]}
          aria-invalid={aria["aria-invalid"]}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onKey}
          className="absolute inset-y-0 right-0 flex w-full items-center justify-end pr-2.5 focus:outline-none"
          style={{ width: value.length === 0 ? "100%" : "2.25rem" }}
        >
          <span className="sr-only">{value.length === 0 ? placeholder : `${value.length} gewählt`}</span>
          <ChevronDown
            className={"size-4 text-gray-400 transition-transform " + (open ? "rotate-180" : "")}
            aria-hidden="true"
          />
        </button>
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute top-full left-0 z-50 mt-1 max-h-72 min-w-full overflow-y-auto rounded-lg bg-white p-1 text-sm shadow-lg ring-1 ring-black/10"
        >
          {options.length === 0 && <li className="px-2.5 py-1.5 text-gray-500">{emptyText}</li>}
          {options.map((o, i) => {
            const on = value.includes(o.value);
            return (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={on}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  toggle(o.value);
                }}
                className={
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-gray-800 " +
                  (i === active ? "bg-gray-100" : "")
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    "flex size-4 shrink-0 items-center justify-center rounded border " +
                    (on ? "border-brand-600 bg-brand-600 text-white" : "border-gray-300 bg-white")
                  }
                >
                  {on && <Check className="size-3" />}
                </span>
                {o.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
