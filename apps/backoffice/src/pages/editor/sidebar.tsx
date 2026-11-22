// Zweite Leiste im Editor (neben dem Hauptmenü): oben die Seiten des Shops (Seitenbaum zum Umordnen,
// Zahnrad für Titel, Adresse, Fußzeile, Löschen), darunter die Bausteine zum Hineinziehen, unten das Design
// (Farben, Schriften, Logo, Fußzeile).
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { ChevronRight, FileText, GripVertical, House, Plus, Search, Settings2, Trash, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  canAdd,
  MAX_PAGE_TITLE,
  MAX_PAGES,
  PALETTE,
  pageProblem,
  slugify,
  uniqueSlug,
  type Block,
  type BlockType,
  type ContentPage,
} from "../../lib/blocks.js";
import {
  BACKGROUNDS,
  FONTS,
  loadFontCatalog,
  MAX_FOOTER_LINKS,
  MAX_FOOTER_TEXT,
  MAX_LINK_LABEL,
  MAX_TAGLINE,
  normalizeHex,
  PRESETS,
  readableBackground,
  readableWithWhite,
  searchFonts,
  SOCIAL,
  SEARCH_MODES,
  type SearchMode,
  SUGGESTED_FONTS,
  TEMPLATES,
  type Template,
  webFontCssUrl,
  webFontStack,
  type WebFont,
} from "../../lib/design.js";
import { PaletteTile } from "./dnd.js";
import { linkProblem, socialProblem, type Form } from "./form.js";

const field =
  "mt-1 block w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-gray-900 ring-1 ring-gray-200 placeholder:text-gray-400 focus:ring-2 focus:ring-brand-500 focus:outline-none aria-[invalid=true]:ring-red-400";
const iconBtn =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-150 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-brand-600";

/** Aufklappbarer Abschnitt der Leiste. */
export function Section({
  title,
  open,
  onToggle,
  children,
  action,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="border-b border-gray-200">
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left text-[0.72rem] font-semibold tracking-[0.07em] text-gray-500 uppercase hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <ChevronRight className={"size-4 transition " + (open ? "rotate-90" : "")} aria-hidden="true" />
          {title}
        </button>
        {action}
      </div>
      {open && <div className="px-3 pb-4">{children}</div>}
    </section>
  );
}

// --- Seiten ---

export function PagesPanel({
  pages,
  current,
  onSelect,
  onChange,
  onAdd,
}: {
  pages: readonly ContentPage[];
  current: string;
  onSelect: (id: string) => void;
  onChange: (pages: ContentPage[]) => void;
  onAdd: () => void;
}) {
  const [settingsFor, setSettingsFor] = useState<string | undefined>();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function onDragEnd(e: DragEndEvent) {
    if (e.over === null || e.active.id === e.over.id) return;
    const from = pages.findIndex((p) => p.id === e.active.id);
    const to = pages.findIndex((p) => p.id === e.over?.id);
    if (from >= 0 && to >= 0) onChange(arrayMove([...pages], from, to));
  }
  const row = (active: boolean) =>
    "group flex items-center gap-1 rounded-md pr-1 text-[0.92rem] " +
    (active ? "bg-brand-50 text-brand-900 ring-1 ring-brand-200" : "text-gray-700 hover:bg-gray-100");

  return (
    <div>
      <ul className="space-y-0.5" aria-label="Seiten des Shops">
        <li className={row(current === "home")}>
          <span className="w-6" aria-hidden="true" />
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-brand-600"
            aria-current={current === "home" ? "page" : undefined}
            onClick={() => onSelect("home")}
          >
            <House className="size-4 shrink-0 text-gray-500" aria-hidden="true" />
            <span className="truncate font-medium">Startseite</span>
          </button>
        </li>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            screenReaderInstructions: {
              draggable: "Leertaste zum Aufnehmen, Pfeiltasten zum Verschieben, Leertaste zum Ablegen.",
            },
          }}
        >
          <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {pages.map((p) => (
              <PageRow
                key={p.id}
                page={p}
                pages={pages}
                active={current === p.id}
                rowClass={row(current === p.id)}
                onSelect={() => onSelect(p.id)}
                settingsOpen={settingsFor === p.id}
                onSettings={() => setSettingsFor((s) => (s === p.id ? undefined : p.id))}
                onChange={(change) => onChange(pages.map((x) => (x.id === p.id ? { ...x, ...change } : x)))}
                onRemove={() => {
                  onChange(pages.filter((x) => x.id !== p.id));
                  setSettingsFor(undefined);
                  if (current === p.id) onSelect("home");
                }}
              />
            ))}
          </SortableContext>
        </DndContext>
      </ul>
      <button
        type="button"
        onClick={onAdd}
        disabled={pages.length >= MAX_PAGES}
        className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="size-4" aria-hidden="true" />
        {pages.length >= MAX_PAGES ? `Höchstens ${MAX_PAGES} Seiten` : "Neue Seite"}
      </button>
    </div>
  );
}

function PageRow({
  page,
  pages,
  active,
  rowClass,
  onSelect,
  settingsOpen,
  onSettings,
  onChange,
  onRemove,
}: {
  page: ContentPage;
  pages: readonly ContentPage[];
  active: boolean;
  rowClass: string;
  onSelect: () => void;
  settingsOpen: boolean;
  onSettings: () => void;
  onChange: (c: Partial<ContentPage>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id });
  const problem = pageProblem(page, pages);
  const slugProblem = pageProblem({ ...page, title: "x", blocks: [] }, pages);
  const [confirm, setConfirm] = useState(false);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
      className={isDragging ? "z-10 opacity-60" : ""}
    >
      <div className={rowClass}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Seite „${page.title || "Ohne Titel"}“ verschieben`}
          className="flex h-8 w-6 cursor-grab items-center justify-center text-gray-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-brand-600"
          aria-current={active ? "page" : undefined}
          onClick={onSelect}
        >
          <FileText
            className={"size-4 shrink-0 " + (problem ? "text-red-600" : "text-gray-500")}
            aria-hidden="true"
          />
          <span className="truncate">{page.title.trim() || "Ohne Titel"}</span>
        </button>
        <button
          type="button"
          aria-expanded={settingsOpen}
          aria-label={`Einstellungen der Seite „${page.title || "Ohne Titel"}“`}
          title="Einstellungen"
          className={iconBtn + (settingsOpen ? " bg-white text-gray-900" : "")}
          onClick={onSettings}
        >
          <Settings2 className="size-4" aria-hidden="true" />
        </button>
      </div>
      {settingsOpen && (
        <div className="mx-1 my-1.5 space-y-3 rounded-lg bg-white p-3 ring-1 ring-gray-200">
          <label className="block text-sm font-medium text-gray-800">
            Titel
            <input
              className={field}
              value={page.title}
              maxLength={MAX_PAGE_TITLE}
              aria-invalid={page.title.trim() === "" || undefined}
              onChange={(e) => {
                const title = e.target.value;
                const follows = page.slug === uniqueSlug(slugify(page.title), pages, page.id);
                onChange({ title, ...(follows ? { slug: uniqueSlug(slugify(title), pages, page.id) } : {}) });
              }}
            />
          </label>
          <label className="block text-sm font-medium text-gray-800">
            Adresse
            <span className="mt-1 flex items-center rounded-md bg-gray-50 ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-brand-500">
              <span className="pl-2.5 text-sm text-gray-500">/seite/</span>
              <input
                className="w-full min-w-0 border-0 bg-transparent py-1.5 pr-2.5 text-sm focus:outline-none"
                value={page.slug}
                maxLength={60}
                aria-invalid={slugProblem !== undefined || undefined}
                onChange={(e) => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
                onBlur={() => onChange({ slug: uniqueSlug(slugify(page.slug), pages, page.id) })}
              />
            </span>
            {slugProblem && (
              <span className="mt-1 block text-xs font-normal text-red-700">{slugProblem}</span>
            )}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={page.inFooter}
              onChange={(e) => onChange({ inFooter: e.target.checked })}
            />
            In der Fußzeile verlinken
          </label>
          {confirm ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-700">Wirklich löschen?</span>
              <button
                type="button"
                className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700"
                onClick={onRemove}
              >
                Löschen
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-gray-600 hover:bg-gray-100"
                onClick={() => setConfirm(false)}
              >
                Abbrechen
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-red-700 hover:bg-red-50"
              onClick={() => setConfirm(true)}
            >
              <Trash className="size-4" aria-hidden="true" /> Seite löschen
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// --- Bausteine ---

export function PalettePanel({ blocks, onAdd }: { blocks: readonly Block[]; onAdd: (t: BlockType) => void }) {
  const full = !canAdd(blocks);
  return (
    <div>
      <p className="mb-3 text-xs leading-relaxed text-gray-500">
        In die Vorschau ziehen oder anklicken (kommt ans Ende). Texte schreibst du direkt in der Vorschau.
      </p>
      {full && <p className="mb-2 text-xs text-amber-800">Höchstens 30 Bausteine je Seite.</p>}
      {PALETTE.map((g) => (
        <div key={g.title} className="mb-3">
          <p className="mb-1.5 text-xs font-medium text-gray-500">{g.title}</p>
          <ul className="grid grid-cols-3 gap-1.5">
            {g.types.map((t) => (
              <li key={t}>
                <PaletteTile type={t} disabled={full} onAdd={onAdd} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// --- Design ---

type Set = (change: Partial<Form>) => void;

export function ColorsPanel({ form, set }: { form: Form; set: Set }) {
  const [accentText, setAccentText] = useState(form.accentColor);
  const [bgText, setBgText] = useState(form.backgroundColor);
  useEffect(() => setAccentText(form.accentColor), [form.accentColor]);
  useEffect(() => setBgText(form.backgroundColor), [form.backgroundColor]);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-800">Hauptfarbe</p>
        <p className="text-xs text-gray-500">Buttons, Links, Markierungen.</p>
        <Swatches
          colors={PRESETS}
          value={form.accentColor}
          onPick={(accentColor) => set({ accentColor })}
          label="Hauptfarbe"
        />
        <HexInput
          label="Eigene Hauptfarbe"
          text={accentText}
          setText={setAccentText}
          onValid={(accentColor) => set({ accentColor })}
          problem={
            readableWithWhite(form.accentColor) ? undefined : "Zu hell: weiße Schrift wäre schlecht lesbar."
          }
        />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-800">Hintergrund</p>
        <p className="text-xs text-gray-500">Fläche hinter allem; Kästen und Linien passen sich an.</p>
        <Swatches
          colors={BACKGROUNDS}
          value={form.backgroundColor}
          onPick={(backgroundColor) => set({ backgroundColor })}
          label="Hintergrund"
          bordered
        />
        <HexInput
          label="Eigener Hintergrund"
          text={bgText}
          setText={setBgText}
          onValid={(backgroundColor) => set({ backgroundColor })}
          problem={
            readableBackground(form.backgroundColor) ? undefined : "Zu dunkel: der Text wäre schlecht lesbar."
          }
        />
      </div>
    </div>
  );
}

function Swatches({
  colors,
  value,
  onPick,
  label,
  bordered = false,
}: {
  colors: readonly { name: string; color: string }[];
  value: string;
  onPick: (c: string) => void;
  label: string;
  bordered?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="mt-2 flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c.color}
          type="button"
          role="radio"
          aria-checked={value === c.color}
          aria-label={c.name}
          title={c.name}
          onClick={() => onPick(c.color)}
          className={
            "size-8 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 " +
            (value === c.color
              ? "ring-2 ring-brand-500 ring-offset-2"
              : bordered
                ? "ring-1 ring-gray-300"
                : "ring-1 ring-black/10")
          }
          style={{ background: c.color }}
        />
      ))}
    </div>
  );
}

function HexInput({
  label,
  text,
  setText,
  onValid,
  problem,
}: {
  label: string;
  text: string;
  setText: (t: string) => void;
  onValid: (hex: string) => void;
  problem: string | undefined;
}) {
  const hex = normalizeHex(text);
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="color"
        aria-label={`${label} wählen`}
        value={hex ?? "#000000"}
        onChange={(e) => {
          setText(e.target.value);
          onValid(e.target.value);
        }}
        className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <input
        aria-label={label}
        className={field + " mt-0 font-mono"}
        value={text}
        maxLength={7}
        aria-invalid={problem !== undefined || hex === undefined || undefined}
        onChange={(e) => {
          setText(e.target.value);
          const h = normalizeHex(e.target.value);
          if (h) onValid(h);
        }}
      />
      {problem && <span className="sr-only">{problem}</span>}
      {problem && <p className="basis-full text-xs text-red-700">{problem}</p>}
    </div>
  );
}

/** Schriften: drei schlichte Sätze oder je eine Google-Schrift für Überschriften und Text. */
export function FontsPanel({ form, set }: { form: Form; set: Set }) {
  const [picking, setPicking] = useState<"heading" | "body" | undefined>();
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-800">Grundstil</p>
        <div role="radiogroup" aria-label="Grundstil der Schrift" className="mt-1.5 grid grid-cols-3 gap-1.5">
          {FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={form.font === f.id && !form.headingFont && !form.bodyFont}
              onClick={() => set({ font: f.id, headingFont: null, bodyFont: null })}
              className={
                "rounded-md px-1 py-2 text-center text-xs ring-1 transition " +
                (form.font === f.id && !form.headingFont && !form.bodyFont
                  ? "bg-brand-50 text-brand-900 ring-brand-400"
                  : "bg-white text-gray-700 ring-gray-200 hover:ring-gray-300")
              }
            >
              <span className="block text-base" style={{ fontFamily: f.titel }}>
                Aa
              </span>
              {f.name}
            </button>
          ))}
        </div>
      </div>
      <FontSlot
        label="Überschriften"
        value={form.headingFont}
        onOpen={() => setPicking(picking === "heading" ? undefined : "heading")}
        onClear={() => set({ headingFont: null })}
        open={picking === "heading"}
      />
      {picking === "heading" && (
        <FontPicker value={form.headingFont} onPick={(headingFont) => set({ headingFont })} />
      )}
      <FontSlot
        label="Fließtext"
        value={form.bodyFont}
        onOpen={() => setPicking(picking === "body" ? undefined : "body")}
        onClear={() => set({ bodyFont: null })}
        open={picking === "body"}
      />
      {picking === "body" && <FontPicker value={form.bodyFont} onPick={(bodyFont) => set({ bodyFont })} />}
      <p className="text-xs text-gray-500">
        Schriften von Google Fonts, im Shop geladen über Bunny Fonts (ohne Tracking).
      </p>
    </div>
  );
}

function FontSlot({
  label,
  value,
  onOpen,
  onClear,
  open,
}: {
  label: string;
  value: WebFont | null;
  onOpen: () => void;
  onClear: () => void;
  open: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-gray-800">{label}</p>
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={onOpen}
          className="flex flex-1 items-center justify-between rounded-md bg-white px-2.5 py-1.5 text-left text-sm ring-1 ring-gray-200 hover:ring-gray-300"
        >
          <span style={value ? { fontFamily: webFontStack(value) } : undefined}>
            {value ? value.name : "Wie Grundstil"}
          </span>
          <span className="text-xs text-brand-700">{open ? "Schließen" : "Ändern"}</span>
        </button>
        {value && (
          <button
            type="button"
            className={iconBtn}
            aria-label={`${label}: Google-Schrift entfernen`}
            onClick={onClear}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Auswahl aus 20 Vorschlägen oder Suche in allen Google Fonts; jede zeigt sich in ihrer eigenen Schrift. */
function FontPicker({ value, onPick }: { value: WebFont | null; onPick: (f: WebFont) => void }) {
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<WebFont[] | undefined>();
  useEffect(() => {
    if (query.trim() !== "" && catalog === undefined) void loadFontCatalog().then(setCatalog);
  }, [query, catalog]);
  const list = useMemo(
    () => (query.trim() === "" ? [...SUGGESTED_FONTS] : searchFonts(catalog ?? [], query, 20)),
    [query, catalog],
  );
  useFontCss(list);
  return (
    <div className="rounded-lg bg-white p-2 ring-1 ring-gray-200">
      <label className="flex items-center gap-2 rounded-md bg-gray-50 px-2 ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-brand-500">
        <Search className="size-4 text-gray-400" aria-hidden="true" />
        <span className="sr-only">Google Fonts durchsuchen</span>
        <input
          className="w-full border-0 bg-transparent py-1.5 text-sm focus:outline-none"
          placeholder="Google Fonts durchsuchen …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <p className="mt-2 px-1 text-xs text-gray-500">
        {query.trim() === ""
          ? "Beliebte Schriften"
          : catalog === undefined
            ? "Lädt …"
            : `${list.length} Treffer`}
      </p>
      <ul className="mt-1 max-h-64 overflow-y-auto" role="listbox" aria-label="Schriften">
        {list.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              role="option"
              aria-selected={value?.id === f.id}
              onClick={() => onPick(f)}
              className={
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-gray-50 " +
                (value?.id === f.id ? "bg-brand-50" : "")
              }
            >
              <span className="text-[1.05rem]" style={{ fontFamily: webFontStack(f) }}>
                {f.name}
              </span>
              <span className="text-[0.7rem] text-gray-400">
                {
                  {
                    serif: "Serif",
                    "sans-serif": "Sans",
                    display: "Display",
                    handwriting: "Hand",
                    monospace: "Mono",
                  }[f.category]
                }
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lädt die Stildatei für die gezeigten Schriften (eine Datei je Liste, über Bunny Fonts). */
export function useFontCss(fonts: readonly WebFont[]) {
  const url = webFontCssUrl(fonts);
  useEffect(() => {
    if (url === undefined) return;
    if (document.querySelector(`link[data-schrift="${CSS.escape(url)}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.dataset["schrift"] = url;
    document.head.appendChild(link);
  }, [url]);
}

export function LogoPanel({
  form,
  set,
  uploadLogo,
  busy,
}: {
  form: Form;
  set: Set;
  uploadLogo: (f: File) => void;
  busy: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) uploadLogo(f);
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-24 items-center justify-center rounded-md bg-gray-50 ring-1 ring-gray-200">
          {form.logo ? (
            <img src={form.logo.thumbnailUrl} alt="Logo" className="max-h-10 max-w-20" />
          ) : (
            <span className="text-xs text-gray-400">Kein Logo</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            onChange={onFile}
          />
          <button
            type="button"
            disabled={busy}
            className="rounded-md px-2 py-1 text-left text-sm font-medium text-brand-700 hover:bg-brand-50"
            onClick={() => input.current?.click()}
          >
            {busy ? "Wird hochgeladen …" : form.logo ? "Anderes Logo" : "Logo hochladen"}
          </button>
          {form.logo && (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-left text-sm text-gray-600 hover:bg-gray-100"
              onClick={() => set({ logo: null })}
            >
              Entfernen
            </button>
          )}
        </div>
      </div>
      <label className="block text-sm font-medium text-gray-800">
        Text unter dem Logo
        <input
          className={field}
          value={form.tagline}
          maxLength={MAX_TAGLINE}
          placeholder="z. B. Tee mit Herz seit 1998"
          onChange={(e) => set({ tagline: e.target.value })}
        />
      </label>
    </div>
  );
}

export function FooterPanel({ form, set }: { form: Form; set: Set }) {
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-gray-800">
        Text
        <textarea
          className={field + " min-h-16"}
          value={form.footerText}
          maxLength={MAX_FOOTER_TEXT}
          placeholder="z. B. Mo–Fr 9–18 Uhr erreichbar"
          onChange={(e) => set({ footerText: e.target.value })}
        />
      </label>
      <div>
        <p className="text-sm font-medium text-gray-800">Soziale Netzwerke</p>
        <p className="text-xs text-gray-500">Leer lassen, wenn du dort kein Profil hast.</p>
        <div className="mt-1.5 space-y-1.5">
          {SOCIAL.map((n) => {
            const v = form.social[n.id] ?? "";
            const problem = socialProblem(v);
            return (
              <label key={n.id} className="flex items-center gap-2 text-sm">
                <span className="w-20 shrink-0 text-gray-700">{n.name}</span>
                <input
                  className={field + " mt-0"}
                  value={v}
                  placeholder={n.example}
                  aria-invalid={problem !== undefined || undefined}
                  title={problem}
                  onChange={(e) => set({ social: { ...form.social, [n.id]: e.target.value } })}
                />
              </label>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-800">Weitere Links</p>
        <p className="text-xs text-gray-500">Eigene Seiten stehen von selbst in der Fußzeile.</p>
        <div className="mt-1.5 space-y-2">
          {form.footerLinks.map((l, i) => {
            const problem = linkProblem(l);
            return (
              <div key={i} className="rounded-md bg-white p-2 ring-1 ring-gray-200">
                <div className="flex gap-1">
                  <input
                    aria-label={`Link ${i + 1}: Beschriftung`}
                    className={field + " mt-0"}
                    value={l.label}
                    maxLength={MAX_LINK_LABEL}
                    placeholder="Beschriftung"
                    onChange={(e) =>
                      set({
                        footerLinks: form.footerLinks.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className={iconBtn + " mt-0.5"}
                    aria-label={`Link ${i + 1} entfernen`}
                    onClick={() => set({ footerLinks: form.footerLinks.filter((_, j) => j !== i) })}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <input
                  aria-label={`Link ${i + 1}: Adresse`}
                  className={field}
                  value={l.url}
                  placeholder="Webseite, E-Mail oder Telefon"
                  aria-invalid={problem !== undefined || undefined}
                  onChange={(e) =>
                    set({
                      footerLinks: form.footerLinks.map((x, j) =>
                        j === i ? { ...x, url: e.target.value } : x,
                      ),
                    })
                  }
                />
                {problem && <p className="mt-1 text-xs text-red-700">{problem}</p>}
              </div>
            );
          })}
        </div>
        {form.footerLinks.length < MAX_FOOTER_LINKS && (
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50"
            onClick={() => set({ footerLinks: [...form.footerLinks, { label: "", url: "" }] })}
          >
            <Plus className="size-4" aria-hidden="true" /> Link hinzufügen
          </button>
        )}
      </div>
    </div>
  );
}

/** Design-Vorlagen mit kleiner Skizze; Farben und Schriften bleiben, nur die Anordnung ändert sich. */

/** Kopfzeile: Suche offen oder als Lupe, und ob der Kopf beim Scrollen oben bleibt (22.11.2026). */
export function HeaderPanel({
  suche,
  kopfKlebt,
  onChange,
}: {
  suche: SearchMode;
  kopfKlebt: boolean;
  onChange: (c: { suche?: SearchMode; kopfKlebt?: boolean }) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-gray-900">Suche</p>
        <div role="radiogroup" aria-label="Suche im Kopf" className="space-y-2">
          {SEARCH_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={suche === m.id}
              onClick={() => onChange({ suche: m.id })}
              className={
                "flex w-full items-center gap-3 rounded-lg bg-white p-2 text-left ring-1 transition " +
                (suche === m.id ? "ring-2 ring-brand-500" : "ring-gray-200 hover:ring-gray-300")
              }
            >
              <SucheSkizze id={m.id} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">{m.name}</span>
                <span className="block text-xs leading-snug text-gray-500">{m.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={kopfKlebt}
          onChange={(e) => onChange({ kopfKlebt: e.target.checked })}
        />
        <span>
          Kopfzeile bleibt beim Scrollen oben
          <span className="block text-xs text-gray-500">
            Praktisch in langen Shops, nimmt am Handy aber Platz weg.
          </span>
        </span>
      </label>
    </div>
  );
}

/** Kleine Skizze neben der Auswahl: Feld, Lupe oder nichts. */
function SucheSkizze({ id }: { id: SearchMode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-14 shrink-0 items-center justify-end gap-1 rounded-md bg-gray-100 px-1.5"
    >
      {id === "offen" && <span className="h-3 w-9 rounded-sm bg-gray-300" />}
      {id === "lupe" && <Search className="size-4 text-gray-400" />}
      {id === "aus" && <span className="h-3 w-3 rounded-sm bg-gray-200" />}
    </span>
  );
}

export function TemplatePanel({ value, onChange }: { value: Template; onChange: (t: Template) => void }) {
  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">Ändert nur die Anordnung, Farben und Schriften bleiben.</p>
      <div role="radiogroup" aria-label="Design-Vorlage" className="space-y-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={value === t.id}
            onClick={() => onChange(t.id)}
            className={
              "flex w-full items-center gap-3 rounded-lg bg-white p-2 text-left ring-1 transition " +
              (value === t.id ? "ring-2 ring-brand-500" : "ring-gray-200 hover:ring-gray-300")
            }
          >
            <Sketch id={t.id} />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">{t.name}</span>
              <span className="block text-xs leading-snug text-gray-500">{t.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Sketch({ id }: { id: Template }) {
  const bar = "rounded-sm bg-gray-300";
  return (
    <span
      aria-hidden="true"
      className="flex h-16 w-20 shrink-0 flex-col gap-1 overflow-hidden rounded-md bg-gray-50 p-1.5 ring-1 ring-gray-200"
    >
      {id === "klassisch" && (
        <>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-4 rounded-sm bg-gray-500" />
            <span className={bar + " h-1 w-6"} />
          </span>
          <span className="h-6 rounded bg-brand-200" />
          <span className="grid grid-cols-3 gap-0.5">
            <span className="h-3 rounded-sm bg-gray-200" />
            <span className="h-3 rounded-sm bg-gray-200" />
            <span className="h-3 rounded-sm bg-gray-200" />
          </span>
        </>
      )}
      {id === "modern" && (
        <>
          <span className="flex items-center justify-between">
            <span className={bar + " h-1 w-3"} />
            <span className="h-1.5 w-5 rounded-sm bg-gray-500" />
            <span className={bar + " h-1 w-3"} />
          </span>
          <span className={bar + " mx-auto h-0.5 w-9"} />
          <span className="-mx-1.5 h-6 bg-brand-200" />
          <span className="grid grid-cols-4 gap-0.5">
            <span className="h-3 rounded-[1px] bg-gray-200" />
            <span className="h-3 rounded-[1px] bg-gray-200" />
            <span className="h-3 rounded-[1px] bg-gray-200" />
            <span className="h-3 rounded-[1px] bg-gray-200" />
          </span>
        </>
      )}
      {id === "galerie" && (
        <>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-4 rounded-sm bg-gray-500" />
            <span className={bar + " h-1 w-5"} />
          </span>
          <span className="-mx-1.5 flex h-8 items-end justify-center bg-brand-200 pb-1">
            <span className="h-1.5 w-9 rounded-sm bg-white/90" />
          </span>
          <span className="-mx-1 grid grid-cols-2 gap-0.5">
            <span className="h-4 bg-gray-200" />
            <span className="h-4 bg-gray-200" />
          </span>
        </>
      )}
      {id === "editorial" && (
        <>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-sm bg-gray-500" />
            <span className="h-0.5 w-8 rounded-sm bg-gray-400" />
          </span>
          <span className="-mx-1.5 grid h-6 grid-cols-2 bg-gray-200">
            <span className="flex flex-col justify-center gap-0.5 px-1">
              <span className="h-1 w-6 rounded-sm bg-gray-500" />
              <span className="h-0.5 w-5 rounded-sm bg-gray-400" />
            </span>
            <span className="bg-brand-200" />
          </span>
          <span className="mx-auto mt-0.5 h-1 w-8 rounded-sm bg-gray-400" />
          <span className="grid grid-cols-3 gap-1">
            <span className="h-4 bg-gray-200" />
            <span className="h-4 bg-gray-200" />
            <span className="h-4 bg-gray-200" />
          </span>
        </>
      )}
    </span>
  );
}
