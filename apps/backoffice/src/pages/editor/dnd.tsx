// Ziehen im Editor: Bausteine aus der Leiste in die Vorschau ziehen und in der Vorschau umsortieren.
// Maus, Finger (kurz halten) und Tastatur (Leertaste, Pfeiltasten) gehen. Wer nicht ziehen mag, klickt
// einen Baustein in der Leiste an (er kommt ans Ende) und verschiebt ihn mit ↑/↓ an seiner Werkzeugleiste.
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  Columns2,
  Group as GroupIcon,
  Heart,
  CircleQuestionMark,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  MapPin,
  Minus,
  MousePointerClick,
  MoveVertical,
  Play,
  Quote,
  ShieldCheck,
  Sparkles,
  Trophy,
  Star,
  Type,
} from "lucide-react";
import {
  createContext,
  useContext,
  useState,
  type MouseEventHandler,
  type ReactNode,
  type TouchEventHandler,
} from "react";
import {
  allBlocks,
  BLOCK_INFO,
  blockById,
  canAddTo,
  dropTarget,
  END_ZONE,
  GROUP_ZONE_PREFIX,
  insertInto,
  locate,
  moveTo,
  newBlock,
  type Block,
  type BlockType,
} from "../../lib/blocks.js";

export const PALETTE_PREFIX = "neu:";

/** Symbole der Bausteine (lucide, ISC-Lizenz). */
export const BLOCK_ICONS: Record<BlockType, typeof Type> = {
  text: Type,
  textImage: Columns2,
  image: ImageIcon,
  gallery: Images,
  video: Play,
  map: MapPin,
  button: MousePointerClick,
  quote: Quote,
  faq: CircleQuestionMark,
  divider: Minus,
  spacer: MoveVertical,
  hero: Star,
  featured: Heart,
  new: Sparkles,
  bestseller: Trophy,
  categories: LayoutGrid,
  trust: ShieldCheck,
  group: GroupIcon,
};

export function BlockIcon({ type, className = "size-4" }: { type: BlockType; className?: string }) {
  const I = BLOCK_ICONS[type];
  return <I className={className} aria-hidden="true" />;
}

type Hint = { readonly id: string; readonly after: boolean } | undefined;
export const DragState = createContext<{ hint: Hint; adding: boolean }>({ hint: undefined, adding: false });
export const useDragState = () => useContext(DragState);

function nameOf(id: string | number, blocks: readonly Block[]): string {
  const s = String(id);
  if (s.startsWith(PALETTE_PREFIX)) return BLOCK_INFO[s.slice(PALETTE_PREFIX.length) as BlockType].name;
  if (s.startsWith(GROUP_ZONE_PREFIX)) return "der Gruppe";
  const b = blockById(blocks, s);
  return b === undefined ? "Baustein" : BLOCK_INFO[b.type].name;
}

// Neue Bausteine landen dort, wo der Zeiger ist (zurück auf die Leiste: nichts passiert). Beim
// Umsortieren und mit der Tastatur zählt der nächste Baustein. Innerhalb einer Gruppe liegen mehrere
// Flächen übereinander; deshalb zählt zuerst ein Baustein in der Gruppe, dann die Fläche der Gruppe
// selbst und erst danach die Seite.
function collisionFor(blocks: readonly Block[]): CollisionDetection {
  return (args) => {
    const hits = pointerWithin(args);
    if (hits.length === 0 && !String(args.active.id).startsWith(PALETTE_PREFIX)) return closestCenter(args);
    const rang = (id: string) => {
      if (locate(blocks, id)?.groupId !== undefined) return 0;
      if (id.startsWith(GROUP_ZONE_PREFIX)) return 1;
      return 2;
    };
    return [...hits].sort((a, b) => rang(String(a.id)) - rang(String(b.id)));
  };
}

/** Gemeinsamer Zieh-Bereich für Leiste und Vorschau. */
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
      const t = dropTarget(blocks, overId, type, position(e)?.after === true);
      if (!canAddTo(blocks, t.groupId)) return;
      const block = newBlock(type, allBlocks(blocks));
      onChange(insertInto(blocks, t.groupId, block, t.index));
      onSelect(block.id);
      return;
    }
    const gezogen = blockById(blocks, id);
    if (gezogen === undefined || overId === id) return;
    const t = dropTarget(blocks, overId, gezogen.type);
    if (t.groupId === id) return;
    onChange(moveTo(blocks, id, t.groupId, t.index));
  }

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `${nameOf(a.id, blocks)} aufgenommen.`,
    onDragOver: ({ active: a, over }) =>
      over === null
        ? `${nameOf(a.id, blocks)} ist außerhalb der Seite.`
        : over.id === END_ZONE
          ? `${nameOf(a.id, blocks)} kommt ans Ende.`
          : `${nameOf(a.id, blocks)} ist bei ${nameOf(over.id, blocks)}.`,
    onDragEnd: ({ active: a, over }) =>
      over === null
        ? `${nameOf(a.id, blocks)} abgelegt, nichts geändert.`
        : `${nameOf(a.id, blocks)} abgelegt.`,
    onDragCancel: ({ active: a }) => `Ziehen abgebrochen. ${nameOf(a.id, blocks)} bleibt, wo er war.`,
  };

  const activeType: BlockType | undefined =
    active === undefined
      ? undefined
      : active.startsWith(PALETTE_PREFIX)
        ? (active.slice(PALETTE_PREFIX.length) as BlockType)
        : blockById(blocks, active)?.type;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionFor(blocks)}
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
        {activeType !== undefined ? (
          <span className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-pop ring-1 ring-brand-500">
            <BlockIcon type={activeType} />
            {BLOCK_INFO[activeType].name}
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Ein Baustein in der Leiste: ziehen (Maus, Finger) oder anklicken (Tastatur: Enter). */
export function PaletteTile({
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
      onMouseDown={listeners?.onMouseDown as MouseEventHandler | undefined}
      onTouchStart={listeners?.onTouchStart as TouchEventHandler | undefined}
      onClick={() => onAdd(type)}
      aria-label={`${info.name} hinzufügen`}
      title={info.hint}
      className={
        // Flache Kacheln ohne eigenen Rahmen: 17 weiße Kärtchen mit grauem Kästchen darin waren eine
        // Wand aus Rechtecken. Der Rahmen erscheint erst beim Zeigen, dort wo man ihn braucht.
        "flex w-full cursor-grab flex-col items-center gap-1 rounded-lg px-1.5 py-2.5 text-center text-gray-600 transition select-none hover:bg-white hover:text-gray-900 hover:shadow-xs hover:ring-1 hover:ring-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 " +
        (isDragging ? "opacity-50" : "")
      }
    >
      <BlockIcon type={type} className="size-5" />
      <span className="text-xs leading-tight font-medium">{info.name}</span>
    </button>
  );
}
