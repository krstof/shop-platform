// Baukasten-Editor Teil 2 (14.11.2026): Bausteine aus der Leiste in die Vorschau ziehen, dort per
// Ziehen umsortieren und anklicken, um sie links zu bearbeiten. Ziehen mit Maus, Finger (kurz
// gedrückt halten) und Tastatur (Leertaste, Pfeiltasten). Wer nicht ziehen mag: Baustein in der
// Leiste anklicken (kommt ans Ende) und in der Liste mit ↑/↓ verschieben.
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  pointerWithin,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEventHandler,
  type TouchEventHandler,
  type ReactNode,
} from "react";
import { Button, Field, Input, Textarea } from "../components/ui.js";
import type { DesignImage } from "../lib/api.js";
import {
  BLOCK_INFO,
  blockProblem,
  blockSummary,
  canAdd,
  insertAt,
  MAX_ADDRESS,
  MAX_BLOCK_HEADING,
  MAX_BLOCK_TEXT,
  MAX_BLOCKS,
  MAX_CAPTION,
  missingFixed,
  moveBlock,
  newBlock,
  PALETTE_FREE,
  type Block,
  type BlockType,
  type FixedType,
} from "../lib/blocks.js";

const PALETTE_PREFIX = "neu:";
const END_ZONE = "ende";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

type Hint = { readonly id: string; readonly after: boolean } | undefined;
const DragState = createContext<{ hint: Hint; adding: boolean }>({ hint: undefined, adding: false });

function nameOf(id: string | number, blocks: readonly Block[]): string {
  const s = String(id);
  if (s.startsWith(PALETTE_PREFIX)) return BLOCK_INFO[s.slice(PALETTE_PREFIX.length) as BlockType].name;
  const b = blocks.find((x) => x.id === s);
  return b === undefined ? "Baustein" : BLOCK_INFO[b.type].name;
}

// Neue Bausteine landen dort, wo der Zeiger ist (zurück auf die Leiste: nichts passiert). Beim
// Umsortieren und mit der Tastatur zählt der nächste Baustein.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length > 0 || String(args.active.id).startsWith(PALETTE_PREFIX)) return hits;
  return closestCenter(args);
};

/** Rahmen für Leiste und Vorschau: ein gemeinsamer Zieh-Bereich. */
export function BuilderDnd({
  blocks,
  onChange,
  onSelect,
  children,
}: {
  blocks: readonly Block[];
  onChange: (blocks: Block[]) => void;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [active, setActive] = useState<string | undefined>();
  const [hint, setHint] = useState<Hint>();

  function position(e: DragMoveEvent | DragEndEvent): Hint {
    const over = e.over;
    if (over === null || over.id === END_ZONE) return undefined;
    const r = e.active.rect.current.translated;
    const middle = r === null ? 0 : r.top + r.height / 2;
    return { id: String(over.id), after: middle > over.rect.top + over.rect.height / 2 };
  }

  function onDragStart(e: DragStartEvent) {
    setActive(String(e.active.id));
    setHint(undefined);
  }

  function onDragMove(e: DragMoveEvent) {
    if (!String(e.active.id).startsWith(PALETTE_PREFIX)) return;
    const next = position(e);
    setHint((h) => (h?.id === next?.id && h?.after === next?.after ? h : next));
  }

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    setActive(undefined);
    setHint(undefined);
    if (e.over === null) return;
    const overId = String(e.over.id);
    if (id.startsWith(PALETTE_PREFIX)) {
      const type = id.slice(PALETTE_PREFIX.length) as BlockType;
      if (!canAdd(blocks, type)) return;
      const block = newBlock(type, blocks);
      const p = position(e);
      const at =
        overId === END_ZONE || p === undefined ? blocks.length : blocks.findIndex((b) => b.id === p.id);
      onChange(insertAt(blocks, block, at < 0 ? blocks.length : p?.after ? at + 1 : at));
      onSelect(block.id);
      return;
    }
    const from = blocks.findIndex((b) => b.id === id);
    const to = blocks.findIndex((b) => b.id === overId);
    if (from >= 0 && to >= 0 && from !== to) onChange(moveBlock(blocks, from, to));
  }

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `${nameOf(a.id, blocks)} aufgenommen.`,
    onDragOver: ({ active: a, over }) =>
      over === null
        ? `${nameOf(a.id, blocks)} ist außerhalb der Startseite.`
        : over.id === END_ZONE
          ? `${nameOf(a.id, blocks)} kommt ans Ende.`
          : `${nameOf(a.id, blocks)} ist bei ${nameOf(over.id, blocks)}.`,
    onDragEnd: ({ active: a, over }) =>
      over === null
        ? `${nameOf(a.id, blocks)} abgelegt, nichts geändert.`
        : `${nameOf(a.id, blocks)} abgelegt.`,
    onDragCancel: ({ active: a }) => `Ziehen abgebrochen. ${nameOf(a.id, blocks)} bleibt, wo er war.`,
  };

  const activeName = active === undefined ? undefined : nameOf(active, blocks);
  const activeType: BlockType | undefined =
    active === undefined
      ? undefined
      : active.startsWith(PALETTE_PREFIX)
        ? (active.slice(PALETTE_PREFIX.length) as BlockType)
        : blocks.find((b) => b.id === active)?.type;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(undefined);
        setHint(undefined);
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Zum Verschieben Leertaste drücken, dann mit den Pfeiltasten bewegen und mit Leertaste ablegen. " +
            "Escape bricht ab.",
        },
      }}
    >
      <DragState.Provider value={{ hint, adding: active?.startsWith(PALETTE_PREFIX) ?? false }}>
        {children}
      </DragState.Provider>
      <DragOverlay dropAnimation={null}>
        {activeName !== undefined && activeType !== undefined ? (
          <span className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-stone-900 shadow-lg ring-1 ring-emerald-600">
            <span aria-hidden="true">{BLOCK_INFO[activeType].icon}</span>
            {activeName}
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Leiste mit Bausteinen: ziehen oder anklicken. */
export function Palette({ blocks, onAdd }: { blocks: readonly Block[]; onAdd: (type: BlockType) => void }) {
  const full = blocks.length >= MAX_BLOCKS;
  const fixed = missingFixed(blocks);
  return (
    <div>
      <p className="mb-3 text-sm text-stone-500">
        Zieh einen Baustein in die Vorschau an die gewünschte Stelle. Oder klick ihn an, dann kommt er ans
        Ende.
      </p>
      {full && (
        <p className="mb-3 text-sm text-amber-800">
          Höchstens {MAX_BLOCKS} Bausteine. Entferne erst einen anderen.
        </p>
      )}
      <ul className="grid grid-cols-2 gap-2">
        {PALETTE_FREE.map((t) => (
          <li key={t}>
            <PaletteTile type={t} disabled={full} onAdd={onAdd} />
          </li>
        ))}
      </ul>
      {fixed.length > 0 && (
        <>
          <p className="mt-4 mb-2 text-xs font-medium tracking-wide text-stone-500 uppercase">
            Shop-Bereiche
          </p>
          <ul className="grid grid-cols-2 gap-2">
            {fixed.map((t) => (
              <li key={t}>
                <PaletteTile type={t} disabled={full} onAdd={onAdd} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PaletteTile({
  type,
  disabled,
  onAdd,
}: {
  type: BlockType;
  disabled: boolean;
  onAdd: (type: BlockType) => void;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `${PALETTE_PREFIX}${type}`, disabled });
  const info = BLOCK_INFO[type];
  return (
    <button
      ref={setNodeRef}
      type="button"
      disabled={disabled}
      // Nur Maus und Finger ziehen; Enter und Leertaste fügen per Klick ein.
      onMouseDown={listeners?.onMouseDown as MouseEventHandler | undefined}
      onTouchStart={listeners?.onTouchStart as TouchEventHandler | undefined}
      onClick={() => onAdd(type)}
      aria-label={`${info.name} hinzufügen`}
      className={
        "flex w-full cursor-grab items-start gap-2 rounded-lg bg-white px-2.5 py-2 text-left ring-1 ring-stone-200 transition select-none hover:bg-stone-50 hover:ring-emerald-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 " +
        (isDragging ? "opacity-50" : "")
      }
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800"
      >
        {info.icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-stone-900">{info.name}</span>
        <span className="block text-xs leading-snug text-stone-500">{info.hint}</span>
      </span>
    </button>
  );
}

/** Die Bausteine in der Vorschau: anklicken wählt aus, ziehen sortiert um. */
export function Canvas({
  blocks,
  selectedId,
  onSelect,
  accent,
  render,
}: {
  blocks: readonly Block[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  accent: string;
  render: (b: Block) => ReactNode;
}) {
  const { adding } = useContext(DragState);
  const end = useDroppable({ id: END_ZONE });
  return (
    <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
      <div className="flex flex-col">
        {blocks.map((b) => (
          <CanvasBlock
            key={b.id}
            block={b}
            selected={b.id === selectedId}
            onSelect={onSelect}
            accent={accent}
          >
            {render(b)}
          </CanvasBlock>
        ))}
        <div
          ref={end.setNodeRef}
          className={
            "mt-3 flex items-center justify-center rounded-lg border-2 border-dashed text-xs transition " +
            (blocks.length === 0 ? "min-h-32 " : adding ? "min-h-14 " : "min-h-0 border-transparent ") +
            (end.isOver ? "" : "border-stone-300")
          }
          style={end.isOver ? { borderColor: accent, color: accent } : { color: "#8a8075" }}
        >
          {(blocks.length === 0 || adding) &&
            (blocks.length === 0 ? "Zieh Bausteine hierher" : "Hier ans Ende")}
        </div>
      </div>
    </SortableContext>
  );
}

function CanvasBlock({
  block,
  selected,
  onSelect,
  accent,
  children,
}: {
  block: Block;
  selected: boolean;
  onSelect: (id: string) => void;
  accent: string;
  children: ReactNode;
}) {
  const { hint, adding } = useContext(DragState);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const info = BLOCK_INFO[block.type];
  const line = (
    <span
      aria-hidden="true"
      className="block h-1 rounded-full"
      style={{ background: accent, margin: "2px 0" }}
    />
  );
  const showBefore = adding && hint?.id === block.id && !hint.after;
  const showAfter = adding && hint?.id === block.id && hint.after;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={"relative " + (isDragging ? "z-10 opacity-40" : "")}
    >
      {showBefore ? line : <span className="block h-2" aria-hidden="true" />}
      <div
        {...attributes}
        {...listeners}
        aria-roledescription="Baustein"
        aria-label={`${info.name}: ${blockSummary(block)}${selected ? " (ausgewählt)" : ""}`}
        onClick={() => onSelect(block.id)}
        className="group relative cursor-grab rounded-lg outline-offset-4 select-none focus-visible:outline-2 active:cursor-grabbing"
        style={{
          outline: selected ? `2px solid ${accent}` : undefined,
          outlineColor: selected ? accent : undefined,
        }}
      >
        <span
          className={
            "pointer-events-none absolute -top-2.5 left-2 z-10 rounded px-1.5 py-0.5 text-[11px] font-medium text-white transition " +
            (selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")
          }
          style={{ background: accent }}
        >
          ⠿ {info.name}
        </span>
        <div className="pointer-events-none rounded-lg ring-stone-300 group-hover:ring-1">{children}</div>
      </div>
      {showAfter && line}
    </div>
  );
}

/** Platzhalter für leere Bausteine in der Vorschau (im Shop unsichtbar). */
export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm"
      style={{ borderColor: "#d9cfbf", color: "#8a8075" }}
    >
      {children}
      <span className="mt-1 block text-xs">Im Shop unsichtbar, solange leer.</span>
    </div>
  );
}

/** Vorschau der freien Bausteine (Text, Bild, Video …) im Stil der Storefront. */
export function FreeBlockPreview({
  block,
  images,
  titel,
  mobile,
}: {
  block: Block;
  images: ReadonlyMap<string, DesignImage>;
  titel: { fontFamily: string; fontWeight: number };
  mobile: boolean;
}) {
  const box = { background: "#f1ebe1", color: "#5e554c" } as const;
  switch (block.type) {
    case "text":
      if (block.heading.trim() === "" && block.text.trim() === "")
        return <EmptyHint>Text: Schreib links eine Überschrift und einen Absatz.</EmptyHint>;
      return (
        <div className="py-2">
          {block.heading.trim() !== "" && (
            <p className="text-xl" style={titel}>
              {block.heading}
            </p>
          )}
          {block.text.trim() !== "" && (
            <p className="mt-2 text-sm whitespace-pre-line">{block.text.trim()}</p>
          )}
        </div>
      );
    case "textImage": {
      const img = block.imageId === null ? undefined : images.get(block.imageId);
      if (block.heading.trim() === "" && block.text.trim() === "" && img === undefined)
        return <EmptyHint>Text mit Bild: Lade links ein Bild hoch und schreib etwas dazu.</EmptyHint>;
      const picture = img ? (
        <img src={img.url} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg text-xs" style={box}>
          Bild fehlt noch
        </div>
      );
      return (
        <div className={"grid items-center gap-4 py-2 " + (mobile ? "grid-cols-1" : "grid-cols-2")}>
          <div className={!mobile && block.imageSide === "right" ? "order-2" : ""}>{picture}</div>
          <div>
            {block.heading.trim() !== "" && (
              <p className="text-xl" style={titel}>
                {block.heading}
              </p>
            )}
            {block.text.trim() !== "" && (
              <p className="mt-2 text-sm whitespace-pre-line">{block.text.trim()}</p>
            )}
          </div>
        </div>
      );
    }
    case "image": {
      const img = block.imageId === null ? undefined : images.get(block.imageId);
      if (img === undefined) return <EmptyHint>Bild: Lade links ein Foto hoch.</EmptyHint>;
      return (
        <figure className="py-2">
          <img src={img.url} alt="" className="w-full rounded-lg object-cover" />
          {block.caption.trim() !== "" && (
            <figcaption className="mt-1.5 text-center text-xs" style={{ color: "#5e554c" }}>
              {block.caption.trim()}
            </figcaption>
          )}
        </figure>
      );
    }
    case "video":
      if (block.url.trim() === "")
        return <EmptyHint>Video: Füg links einen YouTube- oder Vimeo-Link ein.</EmptyHint>;
      return (
        <div
          className="my-2 flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg text-sm"
          style={{ background: "#26221e", color: "#f4efe6" }}
        >
          <span aria-hidden="true" className="text-3xl">
            ▶
          </span>
          Video
        </div>
      );
    case "map":
      if (block.address.trim() === "") return <EmptyHint>Karte: Gib links eine Adresse ein.</EmptyHint>;
      return (
        <div
          className="my-2 flex aspect-[16/7] w-full flex-col items-center justify-center gap-1 rounded-lg px-4 text-center text-sm"
          style={box}
        >
          <span aria-hidden="true" className="text-2xl">
            ⌖
          </span>
          {block.address.trim()}
        </div>
      );
    case "spacer":
      return (
        <div
          className="rounded-lg border border-dashed"
          style={{ height: { s: "1rem", m: "2.5rem", l: "5rem" }[block.size], borderColor: "#e2d9cb" }}
        />
      );
    default:
      return null;
  }
}

/** Liste „Aufbau der Startseite“ mit Bearbeitungsfeldern des ausgewählten Bausteins. */
export function BlockOutline({
  blocks,
  onChange,
  selectedId,
  onSelect,
  images,
  uploadImage,
  renderFixed,
}: {
  blocks: readonly Block[];
  onChange: (blocks: Block[]) => void;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  images: ReadonlyMap<string, DesignImage>;
  uploadImage: (file: File) => Promise<DesignImage>;
  renderFixed: (type: FixedType) => ReactNode;
}) {
  const refs = useRef(new Map<string, HTMLLIElement>());

  // In der Vorschau angeklickt: Bearbeitungsfelder links ins Bild holen.
  useEffect(() => {
    if (selectedId === undefined) return;
    refs.current.get(selectedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  function update(id: string, change: Partial<Block>) {
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...change } as Block) : b)));
  }

  if (blocks.length === 0)
    return <p className="text-sm text-stone-500">Die Startseite ist leer. Füg oben einen Baustein hinzu.</p>;

  return (
    <ol className="space-y-2">
      {blocks.map((b, i) => {
        const info = BLOCK_INFO[b.type];
        const open = b.id === selectedId;
        const problem = blockProblem(b);
        return (
          <li
            key={b.id}
            ref={(el) => {
              if (el === null) refs.current.delete(b.id);
              else refs.current.set(b.id, el);
            }}
            className={"scroll-mt-24 rounded-lg ring-1 " + (open ? "ring-emerald-600" : "ring-stone-200")}
          >
            <div className="flex items-center gap-2 px-2.5 py-2">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => onSelect(open ? undefined : b.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-md bg-stone-100 text-stone-700"
                >
                  {info.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-stone-900">{info.name}</span>
                  <span className={"block truncate text-xs " + (problem ? "text-red-700" : "text-stone-500")}>
                    {problem ? "Bitte prüfen" : blockSummary(b)}
                  </span>
                </span>
              </button>
              <span className="flex shrink-0 gap-1">
                <SmallButton
                  label={`${info.name} nach oben`}
                  disabled={i === 0}
                  onClick={() => onChange(moveBlock(blocks, i, i - 1))}
                >
                  ↑
                </SmallButton>
                <SmallButton
                  label={`${info.name} nach unten`}
                  disabled={i === blocks.length - 1}
                  onClick={() => onChange(moveBlock(blocks, i, i + 1))}
                >
                  ↓
                </SmallButton>
                <SmallButton
                  label={`${info.name} entfernen`}
                  onClick={() => {
                    onChange(blocks.filter((x) => x.id !== b.id));
                    if (open) onSelect(undefined);
                  }}
                >
                  ✕
                </SmallButton>
              </span>
            </div>
            {open && (
              <div className="border-t border-stone-200 px-3 pt-3 pb-4">
                {b.type === "hero" || b.type === "featured" || b.type === "categories" || b.type === "new" ? (
                  renderFixed(b.type)
                ) : (
                  <BlockFields
                    block={b}
                    update={(c) => update(b.id, c)}
                    images={images}
                    uploadImage={uploadImage}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function BlockFields({
  block,
  update,
  images,
  uploadImage,
}: {
  block: Block;
  update: (change: Partial<Block>) => void;
  images: ReadonlyMap<string, DesignImage>;
  uploadImage: (file: File) => Promise<DesignImage>;
}) {
  switch (block.type) {
    case "text":
      return (
        <div className="space-y-4">
          <HeadingField value={block.heading} onChange={(heading) => update({ heading })} />
          <TextField value={block.text} onChange={(text) => update({ text })} />
        </div>
      );
    case "textImage":
      return (
        <div className="space-y-4">
          <ImageField
            imageId={block.imageId}
            images={images}
            uploadImage={uploadImage}
            onChange={(imageId) => update({ imageId })}
          />
          <Choice
            label="Bild steht"
            value={block.imageSide}
            options={[
              { id: "left", name: "Links" },
              { id: "right", name: "Rechts" },
            ]}
            onChange={(imageSide) => update({ imageSide })}
          />
          <HeadingField value={block.heading} onChange={(heading) => update({ heading })} />
          <TextField value={block.text} onChange={(text) => update({ text })} />
        </div>
      );
    case "image":
      return (
        <div className="space-y-4">
          <ImageField
            imageId={block.imageId}
            images={images}
            uploadImage={uploadImage}
            onChange={(imageId) => update({ imageId })}
          />
          <Field label="Bildunterschrift" hint="Freiwillig, eine Zeile.">
            {(p) => (
              <Input
                {...p}
                value={block.caption}
                maxLength={MAX_CAPTION}
                onChange={(e) => update({ caption: e.target.value })}
              />
            )}
          </Field>
        </div>
      );
    case "video":
      return (
        <Field
          label="Link zum Video"
          hint="Von YouTube oder Vimeo, etwa https://youtu.be/… Im Shop lädt das Video erst, wenn Besucher es erlauben."
          error={blockProblem(block)}
        >
          {(p) => (
            <Input
              {...p}
              type="url"
              inputMode="url"
              value={block.url}
              maxLength={300}
              placeholder="https://www.youtube.com/watch?v=…"
              onChange={(e) => update({ url: e.target.value })}
            />
          )}
        </Field>
      );
    case "map":
      return (
        <Field
          label="Adresse"
          hint="Straße, Ort. Der Shop zeigt sie auf Google Maps, erst wenn Besucher es erlauben."
        >
          {(p) => (
            <Input
              {...p}
              value={block.address}
              maxLength={MAX_ADDRESS}
              placeholder="Teeweg 1, 20095 Hamburg"
              onChange={(e) => update({ address: e.target.value })}
            />
          )}
        </Field>
      );
    case "spacer":
      return (
        <Choice
          label="Größe"
          value={block.size}
          options={[
            { id: "s", name: "Klein" },
            { id: "m", name: "Mittel" },
            { id: "l", name: "Groß" },
          ]}
          onChange={(size) => update({ size })}
        />
      );
    default:
      return null;
  }
}

function HeadingField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Überschrift" hint="Freiwillig.">
      {(p) => (
        <Input
          {...p}
          value={value}
          maxLength={MAX_BLOCK_HEADING}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function TextField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Text" hint={`${value.length}/${MAX_BLOCK_TEXT} Zeichen. Leerzeilen trennen Absätze.`}>
      {(p) => (
        <Textarea
          {...p}
          value={value}
          maxLength={MAX_BLOCK_TEXT}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-28"
        />
      )}
    </Field>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; name: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-stone-800">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className="mt-1.5 inline-flex rounded-lg p-0.5 ring-1 ring-stone-200"
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={
              "rounded-md px-3 py-1 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 " +
              (value === o.id ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-50")
            }
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function ImageField({
  imageId,
  images,
  uploadImage,
  onChange,
}: {
  imageId: string | null;
  images: ReadonlyMap<string, DesignImage>;
  uploadImage: (file: File) => Promise<DesignImage>;
  onChange: (id: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const img = imageId === null ? undefined : images.get(imageId);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file === undefined) return;
    setError(undefined);
    if (!IMAGE_TYPES.includes(file.type)) {
      setError("Bitte das Bild als PNG, JPEG oder WebP hochladen.");
      return;
    }
    setBusy(true);
    try {
      onChange((await uploadImage(file)).id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Das Bild konnte nicht hochgeladen werden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-medium text-stone-800">Bild</p>
      {img && (
        <img
          src={img.thumbnailUrl}
          alt="Gewähltes Bild"
          className="mt-1.5 h-28 w-full rounded-lg object-cover ring-1 ring-stone-200"
        />
      )}
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => void onFile(e)}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" busy={busy} disabled={busy} onClick={() => input.current?.click()}>
          {img ? "Anderes Bild" : "Bild hochladen"}
        </Button>
        {img && (
          <Button variant="ghost" disabled={busy} onClick={() => onChange(null)}>
            Bild entfernen
          </Button>
        )}
      </div>
      {error && <p className="mt-1.5 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function SmallButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-stone-600 ring-1 ring-stone-200 transition hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
