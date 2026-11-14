// Shop-Editor Teil 1 und 2 (13.11.2026): Menüpunkt „Aussehen“. Hauptfarbe, Schrift und Logo
// (Teil 1) sowie die Startseite (Teil 2: großes Bild mit Überschrift und Text, hervorgehobene
// Produkte, Kategorien-Kacheln). Die Vorschau rechts zeigt jede Änderung sofort. Im Shop sichtbar
// wird erst „Veröffentlichen“. Die Vorschau ist ein Nachbau des Shops mit echten Daten.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent } from "react";
import { Alert, Badge, Button, Card, Field, Input, Spinner, Textarea } from "../components/ui.js";
import {
  ApiError,
  fileToBase64,
  listAll,
  request,
  type Category,
  type DesignHome,
  type DesignImage,
  type DesignState,
  type Product,
} from "../lib/api.js";
import {
  contrastWithWhite,
  darker,
  fontOf,
  FONTS,
  MAX_FEATURED,
  MAX_HERO_TEXT,
  MAX_HERO_TITLE,
  MAX_FOOTER_LINKS,
  MAX_FOOTER_TEXT,
  MAX_LINK_LABEL,
  MAX_TAGLINE,
  completeLinkUrl,
  isSafeLinkUrl,
  normalizeHex,
  PRESETS,
  readableWithWhite,
  storefrontUrl,
  type Font,
} from "../lib/design.js";
import { formatEuro } from "../lib/money.js";
import {
  cleanBlocks,
  blockProblem,
  canAdd,
  legacyBlocks,
  MAX_PAGE_TITLE,
  MAX_PAGES,
  newBlock,
  newId,
  pageProblem,
  slugify,
  uniqueSlug,
  type Block,
  type BlockType,
  type ContentPage,
} from "../lib/blocks.js";
import { BlockOutline, BuilderDnd, Canvas, EmptyHint, FreeBlockPreview, Palette } from "./design-blocks.js";
import { useShop } from "./layout.js";
import { productsKey, useCategories } from "./products.js";

interface HomeForm {
  heroImage: DesignImage | null;
  heroTitle: string;
  heroText: string;
  featuredProductIds: string[];
  /** Bausteine der Startseite in Reihenfolge (Baukasten). */
  blocks: Block[];
}

interface FooterLinkForm {
  label: string;
  url: string;
}

interface Form {
  accentColor: string;
  font: Font;
  logo: DesignImage | null;
  home: HomeForm;
  tagline: string;
  footerText: string;
  footerLinks: FooterLinkForm[];
  /** Eigene Inhaltsseiten (Baukasten Teil 3). */
  pages: ContentPage[];
}

/** Seiten fürs Speichern und Vergleichen: Titel ohne Leerzeichen am Rand, Bausteine bereinigt. */
function cleanPages(pages: readonly ContentPage[]): ContentPage[] {
  return pages.map((p) => ({
    id: p.id,
    title: p.title.trim(),
    slug: p.slug,
    inFooter: p.inFooter,
    blocks: cleanBlocks(p.blocks),
  }));
}

const designKey = (shopId: string) => ["design", shopId] as const;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function homeOf(h: DesignHome): HomeForm {
  return {
    heroImage: h.heroImage,
    heroTitle: h.heroTitle,
    heroText: h.heroText,
    featuredProductIds: [...h.featuredProductIds],
    blocks: h.blocks ? [...h.blocks] : legacyBlocks(h),
  };
}

function formOf(state: DesignState): Form {
  return {
    accentColor: state.draft.accentColor,
    font: state.draft.font,
    logo: state.draft.logo,
    home: homeOf(state.draft.home),
    tagline: state.draft.tagline,
    footerText: state.draft.footer.text,
    footerLinks: state.draft.footer.links.map((l) => ({ label: l.label, url: l.url })),
    pages: (state.draft.pages ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      inFooter: p.inFooter,
      blocks: [...p.blocks],
    })),
  };
}

/** Links fürs Speichern: leere Zeilen weglassen, Adresse ergänzen (E-Mail → mailto: usw.). */
function cleanLinks(links: FooterLinkForm[]): FooterLinkForm[] {
  return links
    .map((l) => ({ label: l.label.trim(), url: completeLinkUrl(l.url) }))
    .filter((l) => l.label !== "" || l.url !== "");
}

/** Fehlertext für eine Linkzeile oder `undefined`, wenn sie passt. */
function linkProblem(l: FooterLinkForm): string | undefined {
  const label = l.label.trim();
  const url = completeLinkUrl(l.url);
  if (label === "" && url === "") return undefined;
  if (label === "") return "Bitte eine Beschriftung eingeben.";
  if (url === "") return "Bitte eine Adresse eingeben.";
  if (!isSafeLinkUrl(url)) return "Diese Adresse geht nicht. Erlaubt: Webseite, E-Mail oder Telefonnummer.";
  return undefined;
}

function sameHome(a: HomeForm, b: HomeForm): boolean {
  return (
    (a.heroImage?.id ?? null) === (b.heroImage?.id ?? null) &&
    a.heroTitle === b.heroTitle &&
    a.heroText === b.heroText &&
    JSON.stringify(cleanBlocks(a.blocks)) === JSON.stringify(cleanBlocks(b.blocks)) &&
    a.featuredProductIds.join(",") === b.featuredProductIds.join(",")
  );
}

function sameForm(a: Form, b: Form): boolean {
  return (
    a.accentColor === b.accentColor &&
    a.font === b.font &&
    (a.logo?.id ?? null) === (b.logo?.id ?? null) &&
    sameHome(a.home, b.home) &&
    a.tagline.trim() === b.tagline.trim() &&
    a.footerText.trim() === b.footerText.trim() &&
    JSON.stringify(cleanLinks(a.footerLinks)) === JSON.stringify(cleanLinks(b.footerLinks)) &&
    JSON.stringify(cleanPages(a.pages)) === JSON.stringify(cleanPages(b.pages))
  );
}

/** Bilder der Bausteine (Entwurf und veröffentlicht) zu den schon bekannten dazu. */
function imageMap(known: ReadonlyMap<string, DesignImage>, state: DesignState): Map<string, DesignImage> {
  const m = new Map(known);
  for (const i of [
    ...(state.draft.home.blockImages ?? []),
    ...(state.published.home.blockImages ?? []),
    ...[...(state.draft.pages ?? []), ...(state.published.pages ?? [])].flatMap((p) => p.blockImages),
  ])
    m.set(i.id, i);
  return m;
}

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 412)
    return "Jemand hat das Aussehen inzwischen geändert. Bitte die Seite neu laden.";
  return e instanceof Error ? e.message : "Das hat nicht geklappt.";
}

export function DesignPage() {
  const shop = useShop();
  const design = useQuery({
    queryKey: designKey(shop.id),
    queryFn: () => request<DesignState>("/admin/v1/design", { shopId: shop.id }),
  });
  if (design.isPending)
    return (
      <div className="flex justify-center py-16 text-stone-400" role="status">
        <Spinner className="size-6" />
        <span className="sr-only">Aussehen wird geladen …</span>
      </div>
    );
  if (design.isError) return <Alert>{design.error.message}</Alert>;
  return <DesignEditor initial={design.data} />;
}

function DesignEditor({ initial }: { initial: DesignState }) {
  const shop = useShop();
  const queryClient = useQueryClient();
  const [server, setServer] = useState(initial);
  const [form, setForm] = useState<Form>(formOf(initial));
  const [hexText, setHexText] = useState(initial.draft.accentColor);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | undefined>();
  const logoInput = useRef<HTMLInputElement>(null);
  const heroInput = useRef<HTMLInputElement>(null);

  const categories = useCategories(shop.id);
  const products = useQuery({
    queryKey: productsKey(shop.id),
    queryFn: () => listAll<Product>("/admin/v1/products", shop.id),
  });

  const dirty = !sameForm(form, formOf(server));
  const readable = readableWithWhite(form.accentColor);
  const linksOk = form.footerLinks.every((l) => linkProblem(l) === undefined);
  const blocksOk = form.home.blocks.every((b) => blockProblem(b) === undefined);
  const pagesOk = form.pages.every((p) => pageProblem(p, form.pages) === undefined);
  const valid = readable && linksOk && blocksOk && pagesOk;
  // Welche Seite der Baukasten gerade bearbeitet: die Startseite oder eine eigene Seite.
  const [pageId, setPageId] = useState<string>("home");
  const currentPage = form.pages.find((p) => p.id === pageId);
  const currentBlocks: readonly Block[] = currentPage?.blocks ?? form.home.blocks;
  const [tab, setTab] = useState<"startseite" | "stil">("startseite");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [images, setImages] = useState<ReadonlyMap<string, DesignImage>>(() => imageMap(new Map(), initial));
  const [mobile, setMobile] = useState(false);
  const unpublished = dirty || server.hasUnpublishedChanges;

  function setHome(change: Partial<HomeForm>) {
    setForm((f) => ({ ...f, home: { ...f.home, ...change } }));
    setMessage(undefined);
  }

  function setPage(id: string, change: Partial<ContentPage>) {
    setForm((f) => ({ ...f, pages: f.pages.map((p) => (p.id === id ? { ...p, ...change } : p)) }));
    setMessage(undefined);
  }

  function setBlocks(blocks: Block[]) {
    if (currentPage) setPage(currentPage.id, { blocks });
    else setHome({ blocks });
  }

  function addBlock(type: BlockType) {
    if (!canAdd(currentBlocks, type)) return;
    const block = newBlock(type, currentBlocks);
    setBlocks([...currentBlocks, block]);
    setSelectedId(block.id);
  }

  function showPage(id: string) {
    setPageId(id);
    setSelectedId(undefined);
  }

  function addPage() {
    if (form.pages.length >= MAX_PAGES) return;
    const title = "Neue Seite";
    const page: ContentPage = {
      id: newId(form.pages.map((p) => ({ id: p.id, type: "spacer", size: "s" }))),
      title,
      slug: uniqueSlug(slugify(title), form.pages),
      inFooter: true,
      blocks: [{ id: "text1", type: "text", heading: "", text: "" }],
    };
    setForm((f) => ({ ...f, pages: [...f.pages, page] }));
    setMessage(undefined);
    setPageId(page.id);
    setSelectedId("text1");
  }

  function removePage(id: string) {
    setForm((f) => ({ ...f, pages: f.pages.filter((p) => p.id !== id) }));
    setMessage(undefined);
    showPage("home");
  }

  const uploadBlockImage = async (file: File): Promise<DesignImage> => {
    try {
      const img = await request<DesignImage>("/admin/v1/design/images", {
        method: "POST",
        shopId: shop.id,
        body: { data: await fileToBase64(file), filename: file.name },
      });
      setImages((m) => new Map(m).set(img.id, img));
      return img;
    } catch (e) {
      throw new Error(errorText(e), { cause: e });
    }
  };

  function accept(state: DesignState, keepLocal = false) {
    setServer(state);
    setImages((m) => imageMap(m, state));
    queryClient.setQueryData(designKey(shop.id), state);
    if (!keepLocal) {
      setForm(formOf(state));
      setHexText(state.draft.accentColor);
    }
  }

  function setColor(color: string) {
    setForm((f) => ({ ...f, accentColor: color }));
    setHexText(color);
    setMessage(undefined);
  }

  const saveDraft = async (): Promise<DesignState> =>
    request<DesignState>("/admin/v1/design/draft", {
      method: "PUT",
      shopId: shop.id,
      version: server.version,
      body: {
        accentColor: form.accentColor,
        font: form.font,
        logoImageId: form.logo?.id ?? null,
        home: {
          heroImageId: form.home.heroImage?.id ?? null,
          heroTitle: form.home.heroTitle.trim(),
          heroText: form.home.heroText.trim(),
          featuredProductIds: form.home.featuredProductIds,
          showCategories: form.home.blocks.some((b) => b.type === "categories"),
          showNew: form.home.blocks.some((b) => b.type === "new"),
          blocks: cleanBlocks(form.home.blocks),
        },
        tagline: form.tagline.trim(),
        footer: { text: form.footerText.trim(), links: cleanLinks(form.footerLinks) },
        pages: cleanPages(form.pages),
      },
    });

  const save = useMutation({
    mutationFn: saveDraft,
    onSuccess: (s) => {
      accept(s);
      setMessage({
        tone: "success",
        text: "Entwurf gespeichert. Im Shop ändert sich erst nach „Veröffentlichen“ etwas.",
      });
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) accept(await saveDraft());
      return request<DesignState>("/admin/v1/design/publish", { method: "POST", shopId: shop.id });
    },
    onSuccess: (s) => {
      accept(s);
      setMessage({ tone: "success", text: "Veröffentlicht. Dein Shop zeigt jetzt das neue Aussehen." });
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });

  const discard = useMutation({
    mutationFn: () => request<DesignState>("/admin/v1/design/discard", { method: "POST", shopId: shop.id }),
    onSuccess: (s) => {
      accept(s);
      setMessage({
        tone: "success",
        text: "Änderungen verworfen. Der Editor zeigt wieder, was im Shop zu sehen ist.",
      });
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });

  // Hochladen von Logo (Teil 1) und Startseitenbild (Teil 2): gleiche Prüfung, anderer Endpunkt.
  // Noch nicht gespeicherte Eingaben bleiben stehen (keepLocal), nur das neue Bild wird übernommen.
  const uploadFile = async (path: string, file: File): Promise<DesignState> => {
    if (!IMAGE_TYPES.includes(file.type))
      throw new Error("Bitte das Bild als PNG, JPEG oder WebP hochladen (SVG geht noch nicht).");
    const data = await fileToBase64(file);
    return request<DesignState>(path, {
      method: "POST",
      shopId: shop.id,
      body: { data, filename: file.name },
    });
  };

  const uploadLogo = useMutation({
    mutationFn: (file: File) => uploadFile("/admin/v1/design/logo", file),
    onSuccess: (s) => {
      accept(s, true);
      setForm((f) => ({ ...f, logo: s.draft.logo }));
      setMessage(undefined);
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });

  const uploadHero = useMutation({
    mutationFn: (file: File) => uploadFile("/admin/v1/design/hero-image", file),
    onSuccess: (s) => {
      accept(s, true);
      setHome({ heroImage: s.draft.home.heroImage });
      setMessage(undefined);
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });

  function onLogoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file !== undefined) uploadLogo.mutate(file);
  }
  function onHeroFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file !== undefined) uploadHero.mutate(file);
  }

  const busy =
    save.isPending || publish.isPending || discard.isPending || uploadLogo.isPending || uploadHero.isPending;
  const presetName = PRESETS.find((p) => p.color === form.accentColor)?.name;

  // Felder der festen Bausteine (Bühne, Empfehlungen …), angezeigt im aufgeklappten Baustein.
  const heroFields = (
    <div>
      {form.home.heroImage ? (
        <div className="mb-3 overflow-hidden rounded-lg ring-1 ring-stone-200">
          <img
            src={form.home.heroImage.thumbnailUrl}
            alt="Startseitenbild"
            className="h-32 w-full object-cover"
          />
        </div>
      ) : (
        <p className="mb-3 text-sm text-stone-500">
          Ohne Bild zeigt die Startseite nur die Begrüßung auf hellem Grund.
        </p>
      )}
      <input
        ref={heroInput}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        onChange={onHeroFile}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          busy={uploadHero.isPending}
          disabled={busy}
          onClick={() => heroInput.current?.click()}
        >
          {form.home.heroImage ? "Anderes Bild" : "Bild hochladen"}
        </Button>
        {form.home.heroImage && (
          <Button variant="ghost" disabled={busy} onClick={() => setHome({ heroImage: null })}>
            Bild entfernen
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-stone-500">
        Am besten ein breites Foto (Querformat), PNG, JPEG oder WebP.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="hero-titel" className="block text-sm font-medium text-stone-800">
            Überschrift
          </label>
          <Input
            id="hero-titel"
            value={form.home.heroTitle}
            maxLength={MAX_HERO_TITLE}
            placeholder={`Willkommen bei ${shop.name}`}
            onChange={(e) => setHome({ heroTitle: e.target.value })}
            className="mt-1.5"
          />
          <p className="mt-1 text-xs text-stone-500">Leer lassen für die Standardbegrüßung.</p>
        </div>
        <div>
          <label htmlFor="hero-text" className="block text-sm font-medium text-stone-800">
            Text darunter
          </label>
          <Textarea
            id="hero-text"
            value={form.home.heroText}
            maxLength={MAX_HERO_TEXT}
            placeholder="Schön, dass du da bist. Stöbere durch unser Sortiment."
            onChange={(e) => setHome({ heroText: e.target.value })}
            className="mt-1.5 min-h-20"
          />
          <p className="mt-1 text-xs text-stone-500">
            {form.home.heroText.length}/{MAX_HERO_TEXT} Zeichen. Leer lassen für den Standardtext.
          </p>
        </div>
      </div>
    </div>
  );

  function fixedFields(type: "hero" | "featured" | "categories" | "new") {
    if (type === "hero") return heroFields;
    if (type === "featured")
      return (
        <FeaturedPicker
          products={published}
          loading={products.isPending}
          selected={form.home.featuredProductIds}
          onChange={(ids) => setHome({ featuredProductIds: ids })}
        />
      );
    return (
      <p className="text-sm text-stone-500">
        {type === "new"
          ? "Zeigt von selbst die vier neuesten lieferbaren Produkte. Hier gibt es nichts einzustellen."
          : "Zeigt die sichtbaren Kategorien als Kacheln, mit Bild, wenn eins hinterlegt ist."}
      </p>
    );
  }

  const published = (products.data ?? []).filter((p) => p.status === "published");

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Aussehen</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
            {unpublished ? (
              <Badge tone="amber">Nicht veröffentlichte Änderungen</Badge>
            ) : (
              <Badge tone="green">So sieht dein Shop gerade aus</Badge>
            )}
            <a
              href={storefrontUrl(shop.handle, window.location)}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-800 hover:underline"
            >
              Shop ansehen ↗
            </a>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {unpublished && (
            <Button
              variant="ghost"
              disabled={busy}
              busy={discard.isPending}
              onClick={() => {
                if (server.hasUnpublishedChanges) discard.mutate();
                else accept(server);
              }}
            >
              Verwerfen
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={!dirty || !valid || busy}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            Entwurf speichern
          </Button>
          <Button
            disabled={!unpublished || !valid || busy}
            busy={publish.isPending}
            onClick={() => publish.mutate()}
          >
            Veröffentlichen
          </Button>
        </div>
      </div>

      <div className="mb-4 space-y-4" aria-live="polite">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
      </div>

      <BuilderDnd blocks={currentBlocks} onChange={setBlocks} onSelect={setSelectedId}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <div className="space-y-6">
            <div role="tablist" aria-label="Bereich" className="flex rounded-lg bg-stone-100 p-1">
              {[
                { id: "startseite", name: "Seiten" },
                { id: "stil", name: "Farben, Logo, Fußzeile" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id as "startseite" | "stil")}
                  className={
                    "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 " +
                    (tab === t.id
                      ? "bg-white text-stone-900 shadow-sm"
                      : "text-stone-600 hover:text-stone-900")
                  }
                >
                  {t.name}
                </button>
              ))}
            </div>

            {tab === "startseite" && (
              <>
                <div>
                  <p className="mb-2 text-sm font-medium text-stone-700">Welche Seite bearbeiten?</p>
                  <div role="radiogroup" aria-label="Seite" className="flex flex-wrap gap-2">
                    {[{ id: "home", title: "Startseite" }, ...form.pages].map((p) => {
                      const active = (currentPage?.id ?? "home") === p.id;
                      const problem =
                        p.id !== "home" && pageProblem(p as ContentPage, form.pages) !== undefined;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => showPage(p.id)}
                          className={
                            "max-w-full truncate rounded-full px-3 py-1.5 text-sm ring-1 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 " +
                            (active
                              ? "bg-stone-900 text-white ring-stone-900"
                              : problem
                                ? "bg-white text-red-700 ring-red-300 hover:bg-red-50"
                                : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50")
                          }
                        >
                          {p.title.trim() || "Ohne Titel"}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={addPage}
                    disabled={form.pages.length >= MAX_PAGES}
                    className="mt-2 rounded-full px-3 py-1.5 text-sm text-emerald-800 ring-1 ring-emerald-700/40 ring-dashed transition hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {form.pages.length >= MAX_PAGES ? `Höchstens ${MAX_PAGES} Seiten` : "+ Neue Seite"}
                  </button>
                </div>

                {currentPage && (
                  <Card title="Seite">
                    <div className="space-y-4">
                      <Field
                        label="Titel"
                        hint="Steht oben auf der Seite und in der Fußzeile."
                        error={currentPage.title.trim() === "" ? "Bitte einen Titel eingeben." : undefined}
                      >
                        {(p) => (
                          <Input
                            {...p}
                            value={currentPage.title}
                            maxLength={MAX_PAGE_TITLE}
                            onChange={(e) => {
                              const title = e.target.value;
                              // Adresse folgt dem Titel, solange sie noch zum alten Titel passt.
                              const follows =
                                currentPage.slug ===
                                uniqueSlug(slugify(currentPage.title), form.pages, currentPage.id);
                              setPage(currentPage.id, {
                                title,
                                ...(follows
                                  ? { slug: uniqueSlug(slugify(title), form.pages, currentPage.id) }
                                  : {}),
                              });
                            }}
                          />
                        )}
                      </Field>
                      <Field
                        label="Adresse"
                        hint={`${storefrontUrl(shop.handle, window.location)}/seite/${currentPage.slug}`}
                        error={(() => {
                          const p = pageProblem({ ...currentPage, title: "x", blocks: [] }, form.pages);
                          return p;
                        })()}
                      >
                        {(p) => (
                          <Input
                            {...p}
                            value={currentPage.slug}
                            maxLength={60}
                            onChange={(e) =>
                              setPage(currentPage.id, {
                                slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                              })
                            }
                            onBlur={() =>
                              setPage(currentPage.id, {
                                slug: uniqueSlug(slugify(currentPage.slug), form.pages, currentPage.id),
                              })
                            }
                          />
                        )}
                      </Field>
                      <label className="flex items-start gap-2.5 text-sm text-stone-800">
                        <input
                          type="checkbox"
                          checked={currentPage.inFooter}
                          onChange={(e) => setPage(currentPage.id, { inFooter: e.target.checked })}
                          className="mt-0.5 size-4 rounded border-stone-300 text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                        />
                        <span>
                          In der Fußzeile verlinken
                          <span className="block text-xs text-stone-500">
                            Aus heißt: Die Seite ist nur über ihre Adresse erreichbar.
                          </span>
                        </span>
                      </label>
                      <Button variant="danger" onClick={() => removePage(currentPage.id)}>
                        Seite löschen
                      </Button>
                    </div>
                  </Card>
                )}

                <Card title="Bausteine">
                  <Palette blocks={currentBlocks} onAdd={addBlock} allowFixed={!currentPage} />
                </Card>
                <Card title={currentPage ? "Aufbau der Seite" : "Aufbau der Startseite"}>
                  <BlockOutline
                    blocks={currentBlocks}
                    onChange={setBlocks}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    images={images}
                    uploadImage={uploadBlockImage}
                    renderFixed={fixedFields}
                  />
                  {!currentPage && (
                    <p className="mt-3 text-xs text-stone-500">
                      Darunter zeigt der Shop immer alle Produkte.
                    </p>
                  )}
                </Card>
              </>
            )}

            {tab === "stil" && (
              <>
                <Card title="Hauptfarbe">
                  <p className="mb-3 text-sm text-stone-500">Für Knöpfe, Links und Markierungen im Shop.</p>
                  <div role="radiogroup" aria-label="Fertige Farben" className="grid grid-cols-3 gap-2">
                    {PRESETS.map((p) => {
                      const active = p.color === form.accentColor;
                      return (
                        <button
                          key={p.color}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setColor(p.color)}
                          className={
                            "flex flex-col items-center gap-1.5 rounded-lg p-2 text-xs text-stone-700 ring-1 transition " +
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 " +
                            (active
                              ? "bg-stone-50 ring-2 ring-stone-900"
                              : "ring-stone-200 hover:bg-stone-50")
                          }
                        >
                          <Swatch color={p.color} />
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4">
                    <label htmlFor="eigene-farbe" className="block text-sm font-medium text-stone-800">
                      Eigene Farbe
                    </label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="color"
                        aria-label="Farbe auswählen"
                        value={form.accentColor}
                        onChange={(e) => setColor(e.target.value)}
                        className="h-9 w-12 cursor-pointer rounded-md border-0 bg-white p-0.5 ring-1 ring-stone-300"
                      />
                      <Input
                        id="eigene-farbe"
                        value={hexText}
                        maxLength={7}
                        spellCheck={false}
                        aria-describedby="farbe-hinweis"
                        aria-invalid={readable ? undefined : true}
                        className="font-mono uppercase"
                        onChange={(e) => {
                          setHexText(e.target.value);
                          const hex = normalizeHex(e.target.value);
                          if (hex !== undefined) setForm((f) => ({ ...f, accentColor: hex }));
                        }}
                      />
                    </div>
                    <p
                      id="farbe-hinweis"
                      className={"mt-1.5 text-xs " + (readable ? "text-stone-500" : "text-red-700")}
                    >
                      {readable
                        ? `${presetName ?? "Eigene Farbe"} · Kontrast zu weißer Schrift ${contrastWithWhite(form.accentColor).toFixed(1).replace(".", ",")} : 1, gut lesbar.`
                        : "Zu hell: Weiße Schrift auf Knöpfen wäre schlecht lesbar. Bitte eine dunklere Farbe wählen."}
                    </p>
                  </div>
                </Card>

                <Card title="Schrift">
                  <div role="radiogroup" aria-label="Schrift" className="space-y-2">
                    {FONTS.map((f) => {
                      const active = f.id === form.font;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => {
                            setForm((x) => ({ ...x, font: f.id }));
                            setMessage(undefined);
                          }}
                          className={
                            "flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2.5 text-left ring-1 transition " +
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 " +
                            (active
                              ? "bg-stone-50 ring-2 ring-stone-900"
                              : "ring-stone-200 hover:bg-stone-50")
                          }
                        >
                          <span className="text-lg text-stone-900" style={{ fontFamily: f.titel }}>
                            {f.name}
                          </span>
                          <span className="text-xs text-stone-500">{f.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </Card>

                <Card title="Logo">
                  {form.logo ? (
                    <div className="mb-3 flex items-center justify-center rounded-lg bg-stone-50 p-4 ring-1 ring-stone-200">
                      <img src={form.logo.thumbnailUrl} alt="Dein Logo" className="max-h-16 w-auto" />
                    </div>
                  ) : (
                    <p className="mb-3 text-sm text-stone-500">
                      Ohne Logo steht oben im Shop der Name „{shop.name}“.
                    </p>
                  )}
                  <input
                    ref={logoInput}
                    type="file"
                    accept={IMAGE_TYPES.join(",")}
                    className="sr-only"
                    tabIndex={-1}
                    onChange={onLogoFile}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      busy={uploadLogo.isPending}
                      disabled={busy}
                      onClick={() => logoInput.current?.click()}
                    >
                      {form.logo ? "Anderes Logo" : "Logo hochladen"}
                    </Button>
                    {form.logo && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setForm((f) => ({ ...f, logo: null }))}
                      >
                        Logo entfernen
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-stone-500">
                    PNG, JPEG oder WebP, am besten mit durchsichtigem Hintergrund.
                  </p>
                </Card>

                <Card title="Kopf- und Fußzeile">
                  <div>
                    <label htmlFor="slogan" className="block text-sm font-medium text-stone-800">
                      Text unter dem Logo
                    </label>
                    <Input
                      id="slogan"
                      value={form.tagline}
                      maxLength={MAX_TAGLINE}
                      placeholder="z. B. Tee mit Herz seit 1998"
                      onChange={(e) => {
                        setForm((f) => ({ ...f, tagline: e.target.value }));
                        setMessage(undefined);
                      }}
                      className="mt-1.5"
                    />
                    <p className="mt-1 text-xs text-stone-500">Kurz halten. Leer lassen für keinen Text.</p>
                  </div>

                  <div className="mt-5">
                    <label htmlFor="fuss-text" className="block text-sm font-medium text-stone-800">
                      Text im Fuß
                    </label>
                    <Textarea
                      id="fuss-text"
                      value={form.footerText}
                      maxLength={MAX_FOOTER_TEXT}
                      placeholder="z. B. Mo–Fr 9–18 Uhr für dich da."
                      onChange={(e) => {
                        setForm((f) => ({ ...f, footerText: e.target.value }));
                        setMessage(undefined);
                      }}
                      className="mt-1.5 min-h-20"
                    />
                  </div>

                  <div className="mt-5">
                    <p className="text-sm font-medium text-stone-800">Links im Fuß</p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      Zum Beispiel „Kontakt“ mit deiner E-Mail-Adresse, eine Telefonnummer oder eine Webseite.
                    </p>
                    <div className="mt-3 space-y-3">
                      {form.footerLinks.map((l, i) => {
                        const problem = linkProblem(l);
                        const setLink = (change: Partial<FooterLinkForm>) => {
                          setForm((f) => ({
                            ...f,
                            footerLinks: f.footerLinks.map((x, j) => (j === i ? { ...x, ...change } : x)),
                          }));
                          setMessage(undefined);
                        };
                        return (
                          <div key={i} className="rounded-lg p-2.5 ring-1 ring-stone-200">
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1 space-y-2">
                                <Input
                                  aria-label={`Link ${i + 1}: Beschriftung`}
                                  value={l.label}
                                  maxLength={MAX_LINK_LABEL}
                                  placeholder="Beschriftung, z. B. Kontakt"
                                  onChange={(e) => setLink({ label: e.target.value })}
                                />
                                <Input
                                  aria-label={`Link ${i + 1}: Adresse`}
                                  aria-invalid={problem === undefined ? undefined : true}
                                  value={l.url}
                                  maxLength={300}
                                  placeholder="E-Mail, Telefon oder Webseite"
                                  onChange={(e) => setLink({ url: e.target.value })}
                                />
                              </div>
                              <IconButton
                                label={`Link ${i + 1} entfernen`}
                                onClick={() => {
                                  setForm((f) => ({
                                    ...f,
                                    footerLinks: f.footerLinks.filter((_, j) => j !== i),
                                  }));
                                  setMessage(undefined);
                                }}
                              >
                                ✕
                              </IconButton>
                            </div>
                            {problem && <p className="mt-1.5 text-xs text-red-700">{problem}</p>}
                          </div>
                        );
                      })}
                    </div>
                    <Button
                      variant="secondary"
                      className="mt-3"
                      disabled={form.footerLinks.length >= MAX_FOOTER_LINKS}
                      onClick={() =>
                        setForm((f) => ({ ...f, footerLinks: [...f.footerLinks, { label: "", url: "" }] }))
                      }
                    >
                      {form.footerLinks.length >= MAX_FOOTER_LINKS
                        ? `Höchstens ${MAX_FOOTER_LINKS} Links`
                        : "+ Link hinzufügen"}
                    </Button>
                  </div>
                </Card>
              </>
            )}
          </div>

          <div className="lg:sticky lg:top-20 lg:self-start">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-stone-700">Vorschau</p>
              <div
                role="radiogroup"
                aria-label="Vorschau-Breite"
                className="flex rounded-lg p-0.5 ring-1 ring-stone-200"
              >
                {[
                  { id: false, name: "Computer" },
                  { id: true, name: "Handy" },
                ].map((o) => (
                  <button
                    key={o.name}
                    type="button"
                    role="radio"
                    aria-checked={mobile === o.id}
                    onClick={() => setMobile(o.id)}
                    className={
                      "rounded-md px-3 py-1 text-xs transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 " +
                      (mobile === o.id ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-50")
                    }
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            </div>
            <Preview
              mobile={mobile}
              form={form}
              products={published}
              categories={(categories.data ?? []).filter((c) => c.visible)}
              images={images}
              page={currentPage}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setTab("startseite");
              }}
            />
          </div>
        </div>
      </BuilderDnd>
    </div>
  );
}

/** Auswahl und Reihenfolge der hervorgehobenen Produkte (bis zu MAX_FEATURED). */
function FeaturedPicker({
  products,
  loading,
  selected,
  onChange,
}: {
  products: Product[];
  loading: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const chosen = selected.filter((id) => byId.has(id));
  const available = products.filter((p) => !selected.includes(p.id));
  const full = chosen.length >= MAX_FEATURED;

  function move(index: number, delta: number) {
    const next = [...chosen];
    const target = index + delta;
    const a = next[index];
    const b = next[target];
    if (a === undefined || b === undefined) return;
    next[index] = b;
    next[target] = a;
    onChange(next);
  }

  return (
    <div className="mt-5">
      <p className="text-sm font-medium text-stone-800">Hervorgehobene Produkte</p>
      <p className="mt-0.5 text-xs text-stone-500">
        Diese Produkte stehen oben auf der Startseite, in der Reihenfolge von oben nach unten.
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-stone-400">Produkte werden geladen …</p>
      ) : products.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">
          Noch keine veröffentlichten Produkte. Sobald welche im Shop sind, kannst du sie hier hervorheben.
        </p>
      ) : (
        <>
          {chosen.length > 0 && (
            <ol className="mt-3 space-y-2">
              {chosen.map((id, i) => {
                const p = byId.get(id);
                if (p === undefined) return null;
                return (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 ring-1 ring-stone-200"
                  >
                    {p.images[0] ? (
                      <img
                        src={p.images[0].thumbnailUrl}
                        alt=""
                        className="size-8 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="size-8 shrink-0 rounded bg-stone-100" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-stone-800">{p.name}</span>
                    <span className="flex shrink-0 gap-1">
                      <IconButton
                        label={`„${p.name}“ nach oben`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </IconButton>
                      <IconButton
                        label={`„${p.name}“ nach unten`}
                        disabled={i === chosen.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </IconButton>
                      <IconButton
                        label={`„${p.name}“ entfernen`}
                        onClick={() => onChange(chosen.filter((x) => x !== id))}
                      >
                        ✕
                      </IconButton>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-3">
            <label htmlFor="produkt-hinzu" className="sr-only">
              Produkt hervorheben
            </label>
            <select
              id="produkt-hinzu"
              value=""
              disabled={full || available.length === 0}
              onChange={(e) => {
                if (e.target.value !== "") onChange([...chosen, e.target.value]);
              }}
              className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-stone-800 ring-1 ring-stone-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:text-stone-400"
            >
              <option value="">
                {full
                  ? `Höchstens ${MAX_FEATURED} Produkte`
                  : available.length === 0
                    ? "Alle Produkte schon hervorgehoben"
                    : "+ Produkt hinzufügen …"}
              </option>
              {!full &&
                available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}

function IconButton({
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

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="block size-7 rounded-full ring-1 ring-black/10"
      style={{ background: color }}
    />
  );
}

/** Nachbau der Startseite mit den Farben der Storefront (shop.css) und echten Daten. */
function Preview({
  mobile,
  form,
  products,
  categories,
  images,
  page,
  selectedId,
  onSelect,
}: {
  mobile: boolean;
  form: Form;
  products: Product[];
  categories: Category[];
  images: ReadonlyMap<string, DesignImage>;
  /** Eigene Seite statt Startseite. */
  page: ContentPage | undefined;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const shop = useShop();
  const font = fontOf(form.font);
  const accent = form.accentColor;
  const dark = darker(accent);
  const titel = { fontFamily: font.titel, fontWeight: 400 } as const;

  const byId = new Map(products.map((p) => [p.id, p]));
  const featured = form.home.featuredProductIds
    .map((id) => byId.get(id))
    .filter((p): p is Product => p !== undefined);
  const all: PreviewProduct[] = products.length > 0 ? products.slice(0, 3).map(toPreview) : placeholders;
  const cats = categories.slice(0, 4);
  // Wie im Shop: die vier zuletzt angelegten lieferbaren Produkte (die Liste kommt älteste zuerst).
  const newest = products
    .filter((p) => p.stock > 0)
    .reverse()
    .slice(0, 4);
  const footerLabels = [
    ...form.pages.filter((p) => p.inFooter && p.title.trim() !== "").map((p) => p.title.trim()),
    ...cleanLinks(form.footerLinks)
      .filter((l) => l.label !== "")
      .map((l) => l.label),
  ];
  const heroTitle =
    form.home.heroTitle.trim() !== "" ? form.home.heroTitle.trim() : `Willkommen bei ${shop.name}`;
  const heroText =
    form.home.heroText.trim() !== ""
      ? form.home.heroText.trim()
      : "Schön, dass du da bist. Stöbere durch unser Sortiment.";
  const heroBlock = (
    <div className="py-2">
      {form.home.heroImage ? (
        <div className="relative overflow-hidden rounded-xl" style={{ minHeight: "9rem" }}>
          <img
            src={form.home.heroImage.thumbnailUrl}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
          <div
            className="relative flex min-h-36 flex-col justify-end p-4"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0))", color: "#fff" }}
          >
            <p className="text-2xl leading-tight" style={titel}>
              {heroTitle}
            </p>
            <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.92)" }}>
              {heroText}
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="text-3xl leading-tight" style={titel}>
            {heroTitle}
          </p>
          <p className="mt-2 text-sm">{heroText}</p>
        </>
      )}
    </div>
  );

  return (
    <div
      aria-label={page ? `Vorschau der Seite „${page.title}“` : "Vorschau der Startseite"}
      role="region"
      className={
        "overflow-hidden rounded-xl shadow-sm ring-1 ring-stone-200 " +
        (mobile ? "mx-auto w-full max-w-[375px]" : "")
      }
      style={{ background: "#fbf8f3", color: "#26221e", fontFamily: font.text }}
    >
      <div className="px-4 py-1.5 text-center text-xs" style={{ background: "#2f3a33", color: "#f4efe6" }}>
        Testshop: Hier ist nichts echt, auch die Zahlung nicht.
      </div>
      <div
        className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4"
        style={{ borderBottom: "1px solid #e2d9cb" }}
      >
        <span className="flex flex-col gap-0.5">
          {form.logo ? (
            <img src={form.logo.thumbnailUrl} alt="" className="block max-h-10 w-auto max-w-40" />
          ) : (
            <span className="text-xl" style={titel}>
              {shop.name}
            </span>
          )}
          {form.tagline.trim() !== "" && (
            <span className="text-xs" style={{ color: "#5e554c" }}>
              {form.tagline.trim()}
            </span>
          )}
        </span>
        <span className="flex flex-wrap gap-4 text-sm">
          {cats.map((c, i) => (
            <span key={c.id} style={i === 0 ? { borderBottom: `2px solid ${accent}` } : undefined}>
              {c.name}
            </span>
          ))}
        </span>
        <span className="ml-auto text-sm">Warenkorb (0)</span>
      </div>

      <div className="px-5 py-6">
        {page && (
          <p className="mb-2 text-3xl leading-tight" style={titel}>
            {page.title.trim() || "Ohne Titel"}
          </p>
        )}
        <Canvas
          blocks={page?.blocks ?? form.home.blocks}
          selectedId={selectedId}
          onSelect={onSelect}
          accent={accent}
          render={(b) => {
            switch (b.type) {
              case "hero":
                return heroBlock;
              case "featured":
                return featured.length > 0 ? (
                  <div className="py-2">
                    <p className="text-xl" style={titel}>
                      Empfohlen
                    </p>
                    <PreviewGrid
                      items={featured.slice(0, 3).map(toPreview)}
                      mobile={mobile}
                      accent={accent}
                      titel={titel}
                    />
                  </div>
                ) : (
                  <EmptyHint>Empfehlungen: Wähle links Produkte aus.</EmptyHint>
                );
              case "new":
                return newest.length > 1 ? (
                  <div className="py-2">
                    <p className="text-xl" style={titel}>
                      Neu im Shop
                    </p>
                    <p className="mt-1 text-sm" style={{ color: "#5e554c" }}>
                      {newest.map((p) => p.name).join(" · ")}
                    </p>
                  </div>
                ) : (
                  <EmptyHint>Neu im Shop: erscheint, sobald es zwei lieferbare Produkte gibt.</EmptyHint>
                );
              case "categories":
                return cats.length > 0 ? (
                  <div className="py-2">
                    <p className="text-xl" style={titel}>
                      Kategorien
                    </p>
                    <div className={"mt-3 grid gap-3 " + (mobile ? "grid-cols-1" : "grid-cols-2")}>
                      {cats.map((c) => (
                        <span
                          key={c.id}
                          className="rounded-lg px-3 py-3 text-sm"
                          style={{ background: "#f1ebe1", color: dark }}
                        >
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyHint>Kategorien: erscheinen, sobald es sichtbare Kategorien gibt.</EmptyHint>
                );
              default:
                return <FreeBlockPreview block={b} images={images} titel={titel} mobile={mobile} />;
            }
          }}
        />

        {!page && (
          <>
            <p className="mt-7 text-xl" style={titel}>
              Alle Produkte
            </p>
            <PreviewGrid items={all} mobile={mobile} accent={accent} titel={titel} />
          </>
        )}
      </div>
      <div className="px-5 py-5 text-sm" style={{ background: "#f1ebe1", borderTop: "1px solid #e2d9cb" }}>
        <p className="text-lg" style={titel}>
          {shop.name}
        </p>
        {form.footerText.trim() !== "" && (
          <p className="mt-1 whitespace-pre-line" style={{ color: "#5e554c" }}>
            {form.footerText.trim()}
          </p>
        )}
        {footerLabels.length > 0 && (
          <ul className="mt-3 space-y-1">
            {footerLabels.map((label, i) => (
              <li key={i} style={{ color: dark, textDecoration: "underline" }}>
                {label}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs" style={{ color: "#5e554c" }}>
          Ein Testshop der Shop-Plattform. Alle Preise inkl. MwSt., Versand kostenlos.
        </p>
      </div>
    </div>
  );
}

function PreviewGrid({
  items,
  mobile,
  accent,
  titel,
}: {
  items: PreviewProduct[];
  mobile: boolean;
  accent: string;
  titel: { fontFamily: string; fontWeight: number };
}) {
  return (
    <div className={"mt-3 grid gap-4 " + (mobile ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3")}>
      {items.map((p) => (
        <div key={p.id} className="flex flex-col gap-1.5">
          {p.image ? (
            <img src={p.image} alt="" className="aspect-square w-full rounded-lg object-cover" />
          ) : (
            <div className="aspect-square w-full rounded-lg" style={{ background: "#f1ebe1" }} />
          )}
          <span className="text-base leading-snug" style={titel}>
            {p.name}
          </span>
          <span className="text-sm">{p.price === null ? "–" : formatEuro(p.price)}</span>
          <span
            className="mt-1 inline-block self-start rounded-md px-3 py-1.5 text-xs font-semibold"
            style={{ background: accent, color: "#fff" }}
          >
            In den Warenkorb
          </span>
        </div>
      ))}
    </div>
  );
}

interface PreviewProduct {
  readonly id: string;
  readonly name: string;
  readonly price: number | null;
  readonly image: string | undefined;
}

function toPreview(p: Product): PreviewProduct {
  return { id: p.id, name: p.name, price: p.price?.amount ?? null, image: p.images[0]?.thumbnailUrl };
}

/** Solange der Shop keine veröffentlichten Produkte hat. */
const placeholders: PreviewProduct[] = ["Erstes Produkt", "Zweites Produkt", "Drittes Produkt"].map(
  (name, i) => ({ id: `beispiel-${i}`, name, price: 990 + i * 500, image: undefined }),
);
