// Vorschau im Editor: sieht aus wie der Shop und ist zugleich die Arbeitsfläche. Bausteine hierher ziehen,
// am Griff ⠿ umsortieren, Texte direkt anklicken und schreiben, Bilder anklicken und hochladen. Was sich
// nicht schreiben lässt (Link eines Knopfs, Video-Adresse, Produkte …), steht unter ⚙ an der Werkzeugleiste.
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Plus,
  Search,
  Settings2,
  Trash,
  Upload,
  X,
} from "lucide-react";
import { siFacebook, siInstagram, siPinterest, siTiktok, siX, siYoutube } from "simple-icons";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Select } from "../../components/select.js";
import { StockPhotoButton } from "../../components/stock-photos.js";
import type { Category, DesignImage, Product } from "../../lib/api.js";
import {
  BLOCK_INFO,
  blockProblem,
  blockSummary,
  duplicateBlock,
  MAX_BLOCK_HEADING,
  MAX_BLOCK_TEXT,
  MAX_BUTTON_LABEL,
  MAX_CAPTION,
  MAX_FAQ_ITEMS,
  MAX_GALLERY,
  MAX_QUOTE,
  MAX_SECTION_PRODUCTS,
  MAX_SECTION_TEXT,
  MAX_SECTION_TITLE,
  moveBlock,
  parseVideoUrl,
  type Block,
  type ContentPage,
} from "../../lib/blocks.js";
import { formatEuro } from "../../lib/money.js";
import { END_ZONE, useDragState } from "./dnd.js";
import { InlineText } from "./inline.js";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const SOCIAL_ICONS: Record<string, { path: string; title: string }> = {
  instagram: siInstagram,
  facebook: siFacebook,
  tiktok: siTiktok,
  youtube: siYoutube,
  pinterest: siPinterest,
  x: siX,
};

export interface CanvasShop {
  readonly name: string;
  readonly logo: DesignImage | null;
  readonly tagline: string;
  readonly footerText: string;
  /** Beschriftungen der Links in der Fußzeile (eigene Seiten zuerst). */
  readonly footerLinks: readonly string[];
  /** Netzwerke mit Profil. */
  readonly social: readonly string[];
  /** Kopfzeile: Suche offen, als Lupe oder gar nicht. */
  readonly suche: "offen" | "lupe" | "aus";
}

interface Ctx {
  images: ReadonlyMap<string, DesignImage>;
  uploadImage: (file: File) => Promise<DesignImage>;
  /** Kennung des Shops, für die Bildersuche. */
  shopId: string;
  products: readonly Product[];
  categories: readonly Category[];
  pages: readonly ContentPage[];
  shopName: string;
  /** Zeigt die Vorschau gerade das Handy? Die Bühne schneidet ihr Bild dann anders zu. */
  mobile: boolean;
}

export function Canvas({
  page,
  blocks,
  onBlocks,
  selectedId,
  onSelect,
  shop,
  template,
  ...ctx
}: Ctx & {
  page: ContentPage | undefined;
  blocks: readonly Block[];
  onBlocks: (b: Block[]) => void;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  shop: CanvasShop;
  /** Design-Vorlage (Anordnung). */
  template: string;
}) {
  const { adding } = useDragState();
  const mobile = ctx.mobile;
  const end = useDroppable({ id: END_ZONE });
  const [settingsFor, setSettingsFor] = useState<string | undefined>();
  const update = (id: string, change: Partial<Block>) =>
    onBlocks(blocks.map((b) => (b.id === id ? ({ ...b, ...change } as Block) : b)));
  const cats = ctx.categories.slice(0, 4);
  const all = ctx.products.slice(0, 4);

  return (
    <div
      className={
        `sp vorlage-${template} mx-auto overflow-hidden shadow-pop ring-1 ring-gray-200 ` +
        (mobile ? "max-w-[390px] rounded-[1.75rem]" : "rounded-lg")
      }
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(undefined);
      }}
    >
      <p className="sp-band">Testshop: Hier ist nichts echt, auch die Zahlung nicht.</p>
      <header className="sp-kopf">
        <div className="sp-breite sp-kopf-innen">
          <div className="sp-marke">
            {shop.logo ? (
              <img className="sp-logo-bild" src={shop.logo.thumbnailUrl} alt={shop.name} />
            ) : (
              <p className="sp-logo">{shop.name}</p>
            )}
            {shop.tagline.trim() !== "" && <p className="sp-slogan">{shop.tagline.trim()}</p>}
          </div>
          <nav className="sp-nav" aria-label="Kategorien (Vorschau)">
            {cats.map((c) => (
              <span key={c.id}>{c.name}</span>
            ))}
          </nav>
          <div className="sp-korb">
            {shop.suche === "offen" && (
              <span className="sp-suche" aria-hidden="true">
                <span>Suchen …</span>
                <b>Suchen</b>
              </span>
            )}
            {shop.suche === "lupe" && (
              <span className="sp-suche-lupe" aria-hidden="true">
                <Search className="size-4" />
              </span>
            )}
            <span className="sp-korb-link">Warenkorb (0)</span>
          </div>
        </div>
      </header>

      <main className="sp-breite sp-main">
        {page && <h1>{page.title.trim() || "Ohne Titel"}</h1>}
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((b, i) => (
            <CanvasBlock
              key={b.id}
              block={b}
              selected={b.id === selectedId}
              first={i === 0}
              last={i === blocks.length - 1}
              onSelect={() => onSelect(b.id)}
              onMove={(d) => onBlocks(moveBlock(blocks, i, i + d))}
              onDuplicate={() => onBlocks(duplicateBlock(blocks, i))}
              onRemove={() => {
                onBlocks(blocks.filter((x) => x.id !== b.id));
                onSelect(undefined);
              }}
              settingsOpen={settingsFor === b.id}
              onSettings={
                hasSettings(b) ? () => setSettingsFor((s) => (s === b.id ? undefined : b.id)) : undefined
              }
              settings={<BlockSettings block={b} update={(c) => update(b.id, c)} ctx={ctx} />}
            >
              <BlockView
                block={b}
                update={(c) => update(b.id, c)}
                ctx={ctx}
                mainHeading={
                  page === undefined &&
                  b.type === "hero" &&
                  blocks.find((x) => x.type === "hero")?.id === b.id
                }
                openSettings={() => {
                  onSelect(b.id);
                  setSettingsFor(b.id);
                }}
              />
            </CanvasBlock>
          ))}
        </SortableContext>
        <div
          ref={end.setNodeRef}
          className={
            "my-3 flex items-center justify-center rounded-lg border-2 border-dashed text-sm transition " +
            (blocks.length === 0 || adding ? "min-h-24 " : "min-h-0 border-transparent ") +
            (end.isOver ? "border-brand-500 bg-brand-50/40 text-brand-700" : "border-gray-300 text-gray-500")
          }
        >
          {blocks.length === 0
            ? "Zieh Bausteine aus der Leiste links hierher."
            : adding
              ? "Hier ans Ende"
              : null}
        </div>

        {page === undefined && (
          <section className="sp-abschnitt" aria-label="Alle Produkte (immer am Ende der Startseite)">
            <h2>Alle Produkte</h2>
            <ProductGrid products={all} />
          </section>
        )}
      </main>

      <footer className="sp-fuss">
        <div className="sp-breite sp-fuss-innen">
          <div>
            <p className="sp-logo">{shop.name}</p>
            {shop.footerText.trim() !== "" && (
              <p className="sp-klein" style={{ whiteSpace: "pre-line" }}>
                {shop.footerText.trim()}
              </p>
            )}
            {shop.social.length > 0 && (
              <div className="sp-sozial">
                {shop.social.map((n) => {
                  const icon = SOCIAL_ICONS[n];
                  return icon ? (
                    <span key={n} title={icon.title}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d={icon.path} />
                      </svg>
                    </span>
                  ) : null;
                })}
              </div>
            )}
          </div>
          {shop.footerLinks.length > 0 && (
            <div className="sp-fuss-links">
              {shop.footerLinks.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
          )}
          <p className="sp-klein">Alle Preise inkl. MwSt.</p>
        </div>
      </footer>
    </div>
  );
}

function hasSettings(b: Block): boolean {
  return ["textImage", "video", "button", "spacer", "featured", "hero", "image"].includes(b.type);
}

function CanvasBlock({
  block,
  selected,
  first,
  last,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
  settingsOpen,
  onSettings,
  settings,
  children,
}: {
  block: Block;
  selected: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  settingsOpen: boolean;
  onSettings: (() => void) | undefined;
  settings: ReactNode;
  children: ReactNode;
}) {
  const { hint, adding } = useDragState();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
  const info = BLOCK_INFO[block.type];
  const problem = blockProblem(block);
  const line = <span aria-hidden="true" className="my-1 block h-1 rounded-full bg-brand-500" />;
  const tool =
    "flex size-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-brand-600";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={"relative " + (isDragging ? "z-10 opacity-40" : "")}
      onClickCapture={onSelect}
      onFocusCapture={onSelect}
    >
      {adding && hint?.id === block.id && !hint.after && line}
      <div
        className={
          "group/blk relative rounded-lg py-1 outline-offset-[6px] transition-[outline-color] " +
          (selected
            ? "outline-2 outline-brand-500 outline-solid"
            : "outline-1 outline-transparent hover:outline-dashed hover:outline-brand-300")
        }
      >
        <div
          className={
            "absolute -top-4 right-1 z-20 items-center gap-0.5 rounded-lg bg-white px-1 py-0.5 font-sans text-sm text-gray-800 shadow-pop ring-1 ring-gray-200 " +
            (selected ? "flex" : "hidden group-hover/blk:flex")
          }
          style={{ fontFamily: "var(--font-sans)" }}
        >
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-roledescription="Baustein"
            aria-label={`${info.name} verschieben: ${blockSummary(block)}`}
            className={tool + " cursor-grab active:cursor-grabbing"}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
          <span className="px-1 text-xs font-medium text-gray-600">{info.name}</span>
          {onSettings && (
            <button
              type="button"
              aria-expanded={settingsOpen}
              aria-label={`${info.name}: Einstellungen`}
              title="Einstellungen"
              className={tool + (settingsOpen ? " bg-brand-50 text-brand-700" : "")}
              onClick={onSettings}
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            aria-label={`${info.name} nach oben`}
            title="Nach oben"
            className={tool}
            disabled={first}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`${info.name} nach unten`}
            title="Nach unten"
            className={tool}
            disabled={last}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`${info.name} verdoppeln`}
            title="Verdoppeln"
            className={tool}
            onClick={onDuplicate}
          >
            <Copy className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`${info.name} entfernen`}
            title="Entfernen"
            className={tool + " hover:bg-red-50 hover:text-red-700"}
            onClick={onRemove}
          >
            <Trash className="size-4" aria-hidden="true" />
          </button>
        </div>
        {settingsOpen && onSettings && (
          <div
            className="absolute top-5 right-1 z-30 w-80 max-w-[calc(100%-0.5rem)] rounded-lg bg-white p-4 text-left text-sm text-gray-800 shadow-pop ring-1 ring-gray-200"
            style={{ fontFamily: "var(--font-sans)", lineHeight: 1.5 }}
            role="dialog"
            aria-label={`${info.name}: Einstellungen`}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold text-gray-900">{info.name}</p>
              <button
                type="button"
                aria-label="Einstellungen schließen"
                className={tool}
                onClick={onSettings}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            {settings}
          </div>
        )}
        {problem && (
          <p
            className="mb-1 rounded bg-red-50 px-2 py-1 text-sm text-red-800"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {problem}
          </p>
        )}
        {children}
      </div>
      {adding && hint?.id === block.id && hint.after && line}
    </div>
  );
}

/** Ein Baustein so, wie der Shop ihn zeigt, mit Schreibfeldern und Bild-Hochladen. */
function BlockView({
  block: b,
  update,
  ctx,
  mainHeading,
  openSettings,
}: {
  block: Block;
  update: (c: Partial<Block>) => void;
  ctx: Ctx;
  mainHeading: boolean;
  openSettings: () => void;
}) {
  switch (b.type) {
    case "text":
      return (
        <section className="sp-abschnitt sp-text">
          <InlineText
            as="h2"
            value={b.heading}
            onChange={(heading) => update({ heading })}
            placeholder="Überschrift (freiwillig)"
            label="Überschrift"
            maxLength={MAX_BLOCK_HEADING}
          />
          <InlineText
            as="p"
            multiline
            value={b.text}
            onChange={(text) => update({ text })}
            placeholder="Hier deinen Text schreiben …"
            label="Text"
            maxLength={MAX_BLOCK_TEXT}
          />
        </section>
      );
    case "textImage":
      return (
        <section className={"sp-abschnitt sp-textbild " + (b.imageSide === "left" ? "bild-links" : "")}>
          <div className="sp-text">
            <InlineText
              as="h2"
              value={b.heading}
              onChange={(heading) => update({ heading })}
              placeholder="Überschrift"
              label="Überschrift"
              maxLength={MAX_BLOCK_HEADING}
            />
            <InlineText
              as="p"
              multiline
              value={b.text}
              onChange={(text) => update({ text })}
              placeholder="Erzähl etwas dazu …"
              label="Text"
              maxLength={MAX_BLOCK_TEXT}
            />
          </div>
          <div className="sp-textbild-bild">
            <ImageSlot
              imageId={b.imageId}
              ctx={ctx}
              onChange={(imageId) => update({ imageId })}
              ratio="4 / 3"
            />
          </div>
        </section>
      );
    case "image":
      return (
        <figure className="sp-abschnitt sp-figur" style={{ margin: 0 }}>
          <ImageSlot
            imageId={b.imageId}
            ctx={ctx}
            onChange={(imageId) => update({ imageId })}
            ratio="16 / 9"
          />
          <figcaption>
            <InlineText
              value={b.caption}
              onChange={(caption) => update({ caption })}
              placeholder="Bildunterschrift (freiwillig)"
              label="Bildunterschrift"
              maxLength={MAX_CAPTION}
            />
          </figcaption>
        </figure>
      );
    case "gallery":
      return (
        <figure className="sp-abschnitt sp-figur" style={{ margin: 0 }}>
          <div className={`sp-galerie g${Math.min(Math.max(b.imageIds.length + 1, 2), 4)}`}>
            {b.imageIds.map((id, i) => {
              const img = ctx.images.get(id);
              return (
                <div key={`${id}-${i}`} className="group/img relative">
                  {img ? (
                    <img src={img.url} alt="" />
                  ) : (
                    <div className="sp-platz" style={{ aspectRatio: "1" }} />
                  )}
                  <button
                    type="button"
                    aria-label={`Bild ${i + 1} entfernen`}
                    className="absolute top-2 right-2 hidden size-7 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow group-hover/img:flex focus-visible:flex"
                    onClick={() => update({ imageIds: b.imageIds.filter((_, j) => j !== i) })}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
            {b.imageIds.length < MAX_GALLERY && (
              <UploadButton
                ctx={ctx}
                onUploaded={(img) => update({ imageIds: [...b.imageIds, img.id] })}
                label="Bild hinzufügen"
                style={{ aspectRatio: "1" }}
              />
            )}
          </div>
          <figcaption>
            <InlineText
              value={b.caption}
              onChange={(caption) => update({ caption })}
              placeholder="Bildunterschrift (freiwillig)"
              label="Bildunterschrift"
              maxLength={MAX_CAPTION}
            />
          </figcaption>
        </figure>
      );
    case "video": {
      const v = parseVideoUrl(b.url);
      return (
        <section className="sp-abschnitt">
          {v ? (
            <div
              className="sp-platz"
              style={{ aspectRatio: "16 / 9", background: "#26221e", color: "#f4efe6", borderStyle: "solid" }}
            >
              <span style={{ fontSize: "2.5rem" }} aria-hidden="true">
                ▶
              </span>
              {v.provider === "youtube" ? "YouTube-Video" : "Vimeo-Video"}
              <span className="sp-klein" style={{ color: "#cfc8bd" }}>
                Im Shop lädt es, wenn Besucher es erlauben.
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="sp-platz"
              style={{ aspectRatio: "16 / 9" }}
              onClick={openSettings}
            >
              <span style={{ fontSize: "2rem" }} aria-hidden="true">
                ▶
              </span>
              Video: Link von YouTube oder Vimeo einfügen
            </button>
          )}
        </section>
      );
    }
    case "map":
      return (
        <section className="sp-abschnitt">
          <div className="sp-extern">
            <p style={{ margin: "0 0 0.25rem", fontWeight: 600 }}>
              Karte:{" "}
              <InlineText
                as="span"
                value={b.address}
                onChange={(address) => update({ address })}
                placeholder="Adresse eingeben, z. B. Teeweg 1, Hamburg"
                label="Adresse"
                maxLength={200}
              />
            </p>
            <p className="sp-klein" style={{ margin: 0 }}>
              Google Maps zeigt im Shop diese Adresse, sobald Besucher externe Inhalte erlauben.
            </p>
          </div>
        </section>
      );
    case "spacer":
      return (
        <div
          aria-label="Abstand"
          className="rounded border border-dashed border-transparent group-hover/blk:border-gray-300"
          style={{ height: { s: "1rem", m: "2.5rem", l: "5rem" }[b.size] }}
        />
      );
    case "button":
      return (
        <p className="sp-abschnitt" style={{ textAlign: "center", margin: 0 }}>
          <span className={"sp-knopf " + (b.style === "secondary" ? "zweit" : "")}>
            <InlineText
              as="span"
              value={b.label}
              onChange={(label) => update({ label })}
              placeholder="Beschriftung"
              label="Beschriftung des Knopfs"
              maxLength={MAX_BUTTON_LABEL}
            />
          </span>
          {b.url.trim() === "" && (
            <button
              type="button"
              className="sp-klein"
              style={{ display: "block", margin: "0.5rem auto 0", textDecoration: "underline" }}
              onClick={openSettings}
            >
              Wohin führt der Knopf? Ziel wählen
            </button>
          )}
        </p>
      );
    case "quote":
      return (
        <figure className="sp-abschnitt sp-zitat" style={{ marginBlock: 0 }}>
          <InlineText
            className="sp-zitat-text"
            multiline
            value={b.text}
            onChange={(text) => update({ text })}
            placeholder="Was sagen deine Kundinnen?"
            label="Zitat"
            maxLength={MAX_QUOTE}
          />
          <InlineText
            className="sp-zitat-autor"
            value={b.author}
            onChange={(author) => update({ author })}
            placeholder="Name (freiwillig)"
            label="Von wem"
            maxLength={MAX_CAPTION}
          />
        </figure>
      );
    case "divider":
      return <hr className="sp-linie" />;
    case "faq":
      return (
        <section className="sp-abschnitt">
          <InlineText
            as="h2"
            value={b.heading}
            onChange={(heading) => update({ heading })}
            placeholder="Überschrift (freiwillig)"
            label="Überschrift"
            maxLength={MAX_BLOCK_HEADING}
          />
          {b.items.map((it, i) => (
            <div key={i} className="sp-faq-eintrag group/faq relative pr-8">
              <InlineText
                className="sp-faq-frage"
                value={it.question}
                onChange={(question) =>
                  update({ items: b.items.map((x, j) => (j === i ? { ...x, question } : x)) })
                }
                placeholder="Frage"
                label={`Frage ${i + 1}`}
                maxLength={MAX_BLOCK_HEADING * 2}
              />
              <InlineText
                className="sp-faq-antwort"
                multiline
                value={it.answer}
                onChange={(answer) =>
                  update({ items: b.items.map((x, j) => (j === i ? { ...x, answer } : x)) })
                }
                placeholder="Antwort"
                label={`Antwort ${i + 1}`}
                maxLength={MAX_BLOCK_TEXT}
              />
              <button
                type="button"
                aria-label={`Frage ${i + 1} entfernen`}
                className="absolute top-3 right-0 hidden size-7 items-center justify-center rounded-md text-gray-500 group-hover/faq:flex hover:bg-white focus-visible:flex"
                onClick={() => update({ items: b.items.filter((_, j) => j !== i) })}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          ))}
          {b.items.length < MAX_FAQ_ITEMS && (
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50"
              style={{ fontFamily: "var(--font-sans)" }}
              onClick={() => update({ items: [...b.items, { question: "", answer: "" }] })}
            >
              <Plus className="size-4" aria-hidden="true" /> Frage hinzufügen
            </button>
          )}
        </section>
      );
    case "hero": {
      const img = typeof b.imageId === "string" ? ctx.images.get(b.imageId) : undefined;
      const Tag = mainHeading ? "h1" : "h2";
      const knopf = (b.buttonLabel ?? "").trim();
      return (
        <section className={"sp-buehne " + (img ? "mit-bild" : "")}>
          {img && (
            <img
              className="sp-buehne-foto"
              src={img.url}
              alt=""
              style={{ objectPosition: fokusPosition(b, ctx.mobile) }}
            />
          )}
          <div className="sp-buehne-text">
            <InlineText
              as={Tag}
              value={b.title ?? ""}
              onChange={(title) => update({ title })}
              placeholder={`Willkommen bei ${ctx.shopName}`}
              label="Überschrift der Bühne"
              maxLength={MAX_SECTION_TITLE}
            />
            <InlineText
              as="p"
              multiline
              value={b.text ?? ""}
              onChange={(text) => update({ text })}
              placeholder="Schön, dass du da bist. Stöbere durch unser Sortiment."
              label="Text der Bühne"
              maxLength={MAX_SECTION_TEXT}
            />
            {knopf !== "" && (
              <p className="sp-buehne-knopf">
                <span className="sp-knopf">{knopf}</span>
              </p>
            )}
          </div>
          {!img && (
            <div>
              <UploadButton
                ctx={ctx}
                onUploaded={(i) => update({ imageId: i.id })}
                label="Großes Bild hinzufügen"
                compact
              />
            </div>
          )}
        </section>
      );
    }
    case "featured": {
      const byId = new Map(ctx.products.map((p) => [p.id, p]));
      const chosen = (b.productIds ?? [])
        .map((id) => byId.get(id))
        .filter((p): p is Product => p !== undefined);
      return (
        <section className="sp-abschnitt">
          <InlineText
            as="h2"
            value={b.heading ?? ""}
            onChange={(heading) => update({ heading })}
            placeholder="Empfohlen"
            label="Überschrift"
            maxLength={MAX_SECTION_TITLE}
          />
          {chosen.length > 0 ? (
            <ProductGrid products={chosen} />
          ) : (
            <button type="button" className="sp-platz" style={{ minHeight: "8rem" }} onClick={openSettings}>
              Produkte auswählen
              <span className="sp-klein">Im Shop unsichtbar, solange keine gewählt sind.</span>
            </button>
          )}
        </section>
      );
    }
    case "new": {
      const newest = ctx.products
        .filter((p) => p.stock > 0)
        .slice()
        .reverse()
        .slice(0, 4);
      return (
        <section className="sp-abschnitt">
          <InlineText
            as="h2"
            value={b.heading ?? ""}
            onChange={(heading) => update({ heading })}
            placeholder="Neu im Shop"
            label="Überschrift"
            maxLength={MAX_SECTION_TITLE}
          />
          {newest.length > 1 ? (
            <ProductGrid products={newest} />
          ) : (
            <p className="sp-platz">Erscheint, sobald es zwei lieferbare Produkte gibt.</p>
          )}
        </section>
      );
    }
    case "bestseller": {
      // Welche Produkte sich am besten verkaufen, weiß erst der Shop; die Vorschau zeigt Beispiele.
      const examples = ctx.products.slice(0, 4);
      return (
        <section className="sp-abschnitt">
          <InlineText
            as="h2"
            value={b.heading}
            onChange={(heading) => update({ heading })}
            placeholder="Bestseller"
            label="Überschrift"
            maxLength={MAX_SECTION_TITLE}
          />
          {examples.length > 0 ? (
            <>
              <ProductGrid products={examples} />
              <p className="sp-klein">
                Im Shop stehen hier die meistverkauften Produkte der letzten 90 Tage.
              </p>
            </>
          ) : (
            <p className="sp-platz">Erscheint, sobald etwas verkauft wurde.</p>
          )}
        </section>
      );
    }
    case "categories":
      return (
        <section className="sp-abschnitt">
          <InlineText
            as="h2"
            value={b.heading ?? ""}
            onChange={(heading) => update({ heading })}
            placeholder="Kategorien"
            label="Überschrift"
            maxLength={MAX_SECTION_TITLE}
          />
          {ctx.categories.length > 0 ? (
            <div className="sp-kategorien">
              {ctx.categories.map((c) => (
                <div key={c.id} className={c.image ? "mit-bild" : undefined}>
                  {c.image && <img src={c.image.thumbnailUrl} alt="" />}
                  <strong>{c.name}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="sp-platz">Erscheint, sobald es sichtbare Kategorien gibt.</p>
          )}
        </section>
      );
  }
}

function ProductGrid({ products }: { products: readonly Product[] }) {
  if (products.length === 0)
    return <p className="sp-klein">Hier stehen deine Produkte, sobald welche im Shop sind.</p>;
  return (
    <div className="sp-raster">
      {products.map((p) => (
        <div key={p.id} className="sp-karte">
          {p.images[0] ? (
            <img className="sp-bild" src={p.images[0].thumbnailUrl} alt="" />
          ) : (
            <span className="sp-bild" />
          )}
          <span className="sp-karte-name">{p.name}</span>
          <p className="sp-karte-preis">
            {p.price === null ? "–" : formatEuro((p.salePrice ?? p.price).amount)}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Bildfläche: zeigt das Bild oder einen Platzhalter; Klick lädt ein neues hoch. */
function ImageSlot({
  imageId,
  ctx,
  onChange,
  ratio,
}: {
  imageId: string | null;
  ctx: Ctx;
  onChange: (id: string | null) => void;
  ratio: string;
}) {
  const img = imageId === null ? undefined : ctx.images.get(imageId);
  if (!img)
    return (
      <UploadButton
        ctx={ctx}
        onUploaded={(i) => onChange(i.id)}
        label="Bild hochladen"
        style={{ aspectRatio: ratio }}
      />
    );
  return (
    <div className="group/img relative">
      <img src={img.url} alt="" />
      <div
        className="absolute top-2 right-2 hidden gap-1 group-hover/img:flex focus-within:flex"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <UploadButton ctx={ctx} onUploaded={(i) => onChange(i.id)} label="Bild ändern" compact />
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-white/95 px-2.5 py-1.5 text-sm text-gray-800 shadow ring-1 ring-gray-200 hover:bg-white"
          onClick={() => onChange(null)}
        >
          <X className="size-4" aria-hidden="true" /> Entfernen
        </button>
      </div>
    </div>
  );
}

/** Knopf oder Fläche zum Hochladen eines Bildes. */
function UploadButton({
  ctx,
  onUploaded,
  label,
  compact = false,
  style,
}: {
  ctx: Ctx;
  onUploaded: (img: DesignImage) => void;
  label: string;
  compact?: boolean;
  style?: React.CSSProperties;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (error === undefined) return;
    const t = setTimeout(() => setError(undefined), 6000);
    return () => clearTimeout(t);
  }, [error]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file === undefined) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setError("Bitte PNG, JPEG oder WebP.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onUploaded(await ctx.uploadImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hochladen hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => void onFile(e)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        style={compact ? { fontFamily: "var(--font-sans)" } : style}
        className={
          compact
            ? "inline-flex items-center gap-1.5 rounded-md bg-white/95 px-2.5 py-1.5 text-sm font-medium text-gray-800 shadow ring-1 ring-gray-200 hover:bg-white"
            : "sp-platz"
        }
      >
        <Upload className={compact ? "size-4" : "size-6"} aria-hidden="true" />
        {busy ? "Wird hochgeladen …" : label}
        {error && <span className="text-sm text-red-700">{error}</span>}
      </button>
      {/* Bildersuche (21.11.2026): dasselbe Ergebnis wie ein Bild von der Festplatte. */}
      <StockPhotoButton
        shopId={ctx.shopId}
        compact={compact}
        onPicked={async (file) => {
          setBusy(true);
          setError(undefined);
          try {
            onUploaded(await ctx.uploadImage(file));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Hochladen hat nicht geklappt.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/** Zuschnitt-Punkt einer Bühne als CSS-Wert. Am Handy gilt der eigene Punkt, sonst der vom Computer. */
function fokusPosition(b: Block, mobile: boolean): string {
  if (b.type !== "hero") return "50% 50%";
  const stufe = (w: number | undefined, ersatz: number) =>
    typeof w === "number" && Number.isFinite(w)
      ? Math.min(100, Math.max(0, Math.round(w / 25) * 25))
      : ersatz;
  const x = stufe(b.focusX, 50);
  const y = stufe(b.focusY, 50);
  return mobile ? `${stufe(b.focusMobileX, x)}% ${stufe(b.focusMobileY, y)}%` : `${x}% ${y}%`;
}

/** Einstellungen unter ⚙: alles, was man nicht direkt schreiben kann. */
function BlockSettings({
  block: b,
  update,
  ctx,
}: {
  block: Block;
  update: (c: Partial<Block>) => void;
  ctx: Ctx;
}) {
  const field =
    "mt-1 block w-full rounded-md border-0 px-2.5 py-1.5 text-sm ring-1 ring-gray-200 focus:ring-2 focus:ring-brand-500 focus:outline-none";
  switch (b.type) {
    case "textImage":
      return (
        <div className="space-y-3">
          <Toggle
            label="Bild steht"
            value={b.imageSide}
            options={[
              ["left", "Links"],
              ["right", "Rechts"],
            ]}
            onChange={(imageSide) => update({ imageSide })}
          />
          <ImageField imageId={b.imageId} ctx={ctx} onChange={(imageId) => update({ imageId })} />
        </div>
      );
    case "image":
      return <ImageField imageId={b.imageId} ctx={ctx} onChange={(imageId) => update({ imageId })} />;
    case "hero": {
      const bildId = typeof b.imageId === "string" ? b.imageId : null;
      const buehnenBild = bildId === null ? undefined : ctx.images.get(bildId);
      const ziele = [
        { url: "/", name: "Startseite" },
        ...ctx.pages.map((p) => ({ url: `/seite/${p.slug}`, name: p.title || p.slug })),
      ];
      const knopfZiel = b.buttonUrl ?? "";
      return (
        <div className="space-y-4">
          <ImageField
            imageId={bildId}
            ctx={ctx}
            onChange={(imageId) => update({ imageId })}
            hint="Am besten ein breites Foto im Querformat."
          />
          {buehnenBild && (
            <div>
              <p className="text-sm font-medium">Zuschnitt</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Klick in das Bild, welche Stelle stehen bleiben soll. Der Shop schneidet oben und unten bzw.
                links und rechts weg, je nach Bildschirm.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <FokusWahl
                  label="Computer"
                  url={buehnenBild.thumbnailUrl}
                  breit
                  x={b.focusX ?? 50}
                  y={b.focusY ?? 50}
                  onChange={(focusX, focusY) => update({ focusX, focusY })}
                />
                <FokusWahl
                  label="Handy"
                  url={buehnenBild.thumbnailUrl}
                  x={b.focusMobileX ?? b.focusX ?? 50}
                  y={b.focusMobileY ?? b.focusY ?? 50}
                  onChange={(focusMobileX, focusMobileY) => update({ focusMobileX, focusMobileY })}
                />
              </div>
            </div>
          )}
          <label className="block text-sm font-medium">
            Knopf (Beschriftung)
            <input
              className={field}
              value={b.buttonLabel ?? ""}
              maxLength={MAX_BUTTON_LABEL}
              placeholder="Zum Beispiel: Jetzt stöbern"
              onChange={(e) => update({ buttonLabel: e.target.value })}
            />
            <span className="mt-1 block text-xs font-normal text-gray-500">
              Leer lassen heißt: kein Knopf in der Bühne.
            </span>
          </label>
          {(b.buttonLabel ?? "").trim() !== "" && (
            <>
              <label className="block text-sm font-medium">
                Ziel
                <Select
                  className="mt-1 font-normal"
                  value={ziele.some((t) => t.url === knopfZiel) ? knopfZiel : "eigen"}
                  onChange={(e) =>
                    update({ buttonUrl: e.target.value === "eigen" ? "https://" : e.target.value })
                  }
                >
                  {ziele.map((t) => (
                    <option key={t.url} value={t.url}>
                      Seite: {t.name}
                    </option>
                  ))}
                  <option value="eigen">Andere Adresse …</option>
                </Select>
              </label>
              {!ziele.some((t) => t.url === knopfZiel) && (
                <label className="block text-sm font-medium">
                  Adresse
                  <input
                    className={field}
                    value={knopfZiel}
                    maxLength={300}
                    placeholder="https://… oder mailto:…"
                    onChange={(e) => update({ buttonUrl: e.target.value })}
                  />
                </label>
              )}
            </>
          )}
        </div>
      );
    }
    case "video":
      return (
        <label className="block text-sm font-medium">
          Link zum Video
          <input
            className={field}
            type="url"
            value={b.url}
            maxLength={300}
            placeholder="https://www.youtube.com/watch?v=…"
            onChange={(e) => update({ url: e.target.value })}
          />
          <span className="mt-1 block text-xs font-normal text-gray-500">
            YouTube oder Vimeo. Im Shop lädt das Video erst, wenn Besucher es erlauben.
          </span>
        </label>
      );
    case "spacer":
      return (
        <Toggle
          label="Größe"
          value={b.size}
          options={[
            ["s", "Klein"],
            ["m", "Mittel"],
            ["l", "Groß"],
          ]}
          onChange={(size) => update({ size })}
        />
      );
    case "button": {
      const targets = [
        { url: "/", name: "Startseite" },
        ...ctx.pages.map((p) => ({ url: `/seite/${p.slug}`, name: p.title || p.slug })),
      ];
      return (
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Ziel
            <Select
              className="mt-1 font-normal"
              value={targets.some((t) => t.url === b.url) ? b.url : "eigen"}
              onChange={(e) => update({ url: e.target.value === "eigen" ? "https://" : e.target.value })}
            >
              {targets.map((t) => (
                <option key={t.url} value={t.url}>
                  Seite: {t.name}
                </option>
              ))}
              <option value="eigen">Andere Adresse …</option>
            </Select>
          </label>
          {!targets.some((t) => t.url === b.url) && (
            <label className="block text-sm font-medium">
              Adresse
              <input
                className={field}
                value={b.url}
                maxLength={300}
                placeholder="https://… oder mailto:…"
                onChange={(e) => update({ url: e.target.value })}
              />
            </label>
          )}
          <Toggle
            label="Stil"
            value={b.style}
            options={[
              ["primary", "Gefüllt"],
              ["secondary", "Umrandet"],
            ]}
            onChange={(style) => update({ style })}
          />
        </div>
      );
    }
    case "featured": {
      const chosen = b.productIds ?? [];
      return (
        <div>
          <p className="text-sm font-medium">Produkte (bis zu {MAX_SECTION_PRODUCTS})</p>
          {ctx.products.length === 0 ? (
            <p className="mt-1 text-gray-500">Noch keine Produkte im Shop.</p>
          ) : (
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
              {ctx.products.map((p) => {
                const on = chosen.includes(p.id);
                return (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!on && chosen.length >= MAX_SECTION_PRODUCTS}
                        onChange={() =>
                          update({ productIds: on ? chosen.filter((x) => x !== p.id) : [...chosen, p.id] })
                        }
                      />
                      {p.images[0] ? (
                        <img src={p.images[0].thumbnailUrl} alt="" className="size-7 rounded object-cover" />
                      ) : (
                        <span className="size-7 rounded bg-gray-100" />
                      )}
                      <span className="truncate">{p.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-gray-500">Reihenfolge wie angeklickt.</p>
        </div>
      );
    }
    default:
      return null;
  }
}

/**
 * Zuschnitt-Punkt wählen: ein kleines Bild im Seitenverhältnis des Geräts. Ein Klick setzt den Punkt,
 * die Pfeiltasten verschieben ihn in Viertelschritten. Gespeichert wird in Prozent (0 bis 100).
 */
function FokusWahl({
  label,
  url,
  breit,
  x,
  y,
  onChange,
}: {
  label: string;
  url: string;
  /** Breites Format (Computer) statt Hochformat (Handy). */
  breit?: boolean;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
  const stufe = (w: number) => Math.min(100, Math.max(0, Math.round(w / 25) * 25));
  const setzen = (nx: number, ny: number) => onChange(stufe(nx), stufe(ny));
  return (
    <div>
      <p className="text-xs font-medium text-gray-600">{label}</p>
      <button
        type="button"
        className="relative mt-1 block w-full overflow-hidden rounded-md ring-1 ring-gray-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
        style={{ aspectRatio: breit === true ? "16 / 7" : "3 / 4" }}
        aria-label={`Zuschnitt für ${label} wählen`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setzen(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
        }}
        onKeyDown={(e) => {
          const schritte: Record<string, [number, number]> = {
            ArrowLeft: [-25, 0],
            ArrowRight: [25, 0],
            ArrowUp: [0, -25],
            ArrowDown: [0, 25],
          };
          const s = schritte[e.key];
          if (s === undefined) return;
          e.preventDefault();
          setzen(stufe(x) + s[0], stufe(y) + s[1]);
        }}
      >
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          style={{ objectPosition: `${stufe(x)}% ${stufe(y)}%` }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-600/80 shadow"
          style={{ left: `${stufe(x)}%`, top: `${stufe(y)}%` }}
        />
      </button>
    </div>
  );
}

function ImageField({
  imageId,
  ctx,
  onChange,
  hint,
}: {
  imageId: string | null;
  ctx: Ctx;
  onChange: (id: string | null) => void;
  hint?: string;
}) {
  const img = imageId === null ? undefined : ctx.images.get(imageId);
  return (
    <div>
      <p className="text-sm font-medium">Bild</p>
      {img && (
        <img
          src={img.thumbnailUrl}
          alt=""
          className="mt-1.5 h-24 w-full rounded-md object-cover ring-1 ring-gray-200"
        />
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <UploadButton
          ctx={ctx}
          onUploaded={(i) => onChange(i.id)}
          label={img ? "Anderes Bild" : "Bild hochladen"}
          compact
        />
        {img && (
          <button
            type="button"
            className="rounded-md px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            onClick={() => onChange(null)}
          >
            Entfernen
          </button>
        )}
      </div>
      {hint && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <div role="radiogroup" aria-label={label} className="mt-1.5 inline-flex rounded-lg bg-gray-100 p-0.5">
        {options.map(([id, name]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            onClick={() => onChange(id)}
            className={
              "rounded-md px-3 py-1 text-sm transition " +
              (value === id
                ? "bg-white font-medium text-gray-900 shadow-xs"
                : "text-gray-600 hover:text-gray-900")
            }
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
