// Editor (früher „Aussehen“, neu gestaltet am 14.11.2026): links neben dem Hauptmenü eine zweite Leiste mit
// Seiten, Bausteinen und Design; rechts die Vorschau in voller Breite, die aussieht wie der Shop. Bausteine
// zieht man hinein und schreibt direkt darin. Im Shop sichtbar wird alles erst mit „Veröffentlichen“.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Smartphone } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { Alert, Badge, Button, Spinner } from "../../components/ui.js";
import {
  ApiError,
  imageUploadData,
  listAll,
  request,
  type DesignImage,
  type DesignState,
  type Product,
} from "../../lib/api.js";
import {
  allBlocks,
  canAdd,
  newBlock,
  newId,
  slugify,
  uniqueSlug,
  type Block,
  type BlockType,
  type ContentPage,
} from "../../lib/blocks.js";
import {
  darker,
  fontOf,
  mix,
  SHOP_TEXT,
  storefrontUrl,
  webFontStack,
  type WebFont,
} from "../../lib/design.js";
import { useShop } from "../layout.js";
import { productsKey, useCategories } from "../products.js";
import { Canvas } from "./canvas.js";
import { BuilderDnd } from "./dnd.js";
import { bodyOf, cleanLinks, formOf, imageMap, problems, sameForm, type Form } from "./form.js";
import "./preview.css";
import {
  ColorsPanel,
  FontsPanel,
  FooterPanel,
  HeaderPanel,
  LogoPanel,
  PagesPanel,
  PalettePanel,
  Section,
  TemplatePanel,
  useFontCss,
} from "./sidebar.js";

const designKey = (shopId: string) => ["design", shopId] as const;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 412)
    return "Jemand hat den Shop inzwischen geändert. Bitte die Seite neu laden.";
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
      <div className="flex justify-center py-16 text-gray-400" role="status">
        <Spinner className="size-6" />
        <span className="sr-only">Editor wird geladen …</span>
      </div>
    );
  if (design.isError)
    return (
      <div className="p-6">
        <Alert>{design.error.message}</Alert>
      </div>
    );
  return <Editor initial={design.data} />;
}

type Panel = "seiten" | "bausteine" | "farben" | "schriften" | "logo" | "fuss" | "kopf" | "vorlage";

function Editor({ initial }: { initial: DesignState }) {
  const shop = useShop();
  const queryClient = useQueryClient();
  const [server, setServer] = useState(initial);
  const [form, setForm] = useState<Form>(() => formOf(initial));
  const [images, setImages] = useState<ReadonlyMap<string, DesignImage>>(() => imageMap(new Map(), initial));
  const [pageId, setPageId] = useState("home");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [mobile, setMobile] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | undefined>();
  // Immer nur ein Bereich offen (Kristof 15.11.2026): Aufklappen schließt die anderen, damit nichts
  // unten verschwindet.
  const [openPanel, setOpenPanel] = useState<Panel | undefined>("bausteine");
  const toggle = (p: Panel) => setOpenPanel((o) => (o === p ? undefined : p));

  const categories = useCategories(shop.id);
  const products = useQuery({
    queryKey: productsKey(shop.id),
    queryFn: () => listAll<Product>("/admin/v1/products", shop.id),
  });
  const published = useMemo(
    () => (products.data ?? []).filter((p) => p.status === "published"),
    [products.data],
  );

  const page = form.pages.find((p) => p.id === pageId);
  const blocks: readonly Block[] = page?.blocks ?? form.blocks;
  const dirty = !sameForm(form, formOf(server));
  const issues = problems(form);
  const unpublished = dirty || server.hasUnpublishedChanges;

  function set(change: Partial<Form>) {
    setForm((f) => ({ ...f, ...change }));
    setMessage(undefined);
  }
  function setBlocks(next: Block[]) {
    if (page) set({ pages: form.pages.map((p) => (p.id === page.id ? { ...p, blocks: next } : p)) });
    else set({ blocks: next });
  }
  function addBlock(type: BlockType) {
    if (!canAdd(blocks)) return;
    // IDs müssen über alle Ebenen eindeutig sein, also auch gegen die Bausteine in Gruppen prüfen.
    const b = newBlock(type, allBlocks(blocks));
    setBlocks([...blocks, b]);
    setSelectedId(b.id);
  }
  function showPage(id: string) {
    setPageId(id);
    setSelectedId(undefined);
  }
  function addPage() {
    const title = "Neue Seite";
    const p: ContentPage = {
      id: newId(form.pages),
      title,
      slug: uniqueSlug(slugify(title), form.pages),
      inFooter: true,
      blocks: [{ id: "text1", type: "text", heading: "", text: "" }],
    };
    set({ pages: [...form.pages, p] });
    showPage(p.id);
  }

  function accept(state: DesignState, keepLocal = false) {
    setServer(state);
    setImages((m) => imageMap(m, state));
    queryClient.setQueryData(designKey(shop.id), state);
    if (!keepLocal) setForm(formOf(state));
  }

  const saveDraft = () =>
    request<DesignState>("/admin/v1/design/draft", {
      method: "PUT",
      shopId: shop.id,
      version: server.version,
      body: bodyOf(form),
    });

  const save = useMutation({
    mutationFn: saveDraft,
    onSuccess: (s) => {
      accept(s);
      setMessage({
        tone: "success",
        text: "Entwurf gespeichert. Im Shop sichtbar erst nach „Veröffentlichen“.",
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
      setMessage({ tone: "success", text: "Veröffentlicht. Dein Shop zeigt jetzt den neuen Stand." });
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });
  const discard = useMutation({
    mutationFn: () => request<DesignState>("/admin/v1/design/discard", { method: "POST", shopId: shop.id }),
    onSuccess: (s) => {
      accept(s);
      setMessage({ tone: "success", text: "Änderungen verworfen." });
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });
  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      if (!IMAGE_TYPES.includes(file.type))
        throw new Error("Bitte das Logo als PNG, JPEG oder WebP hochladen.");
      return request<DesignState>("/admin/v1/design/logo", {
        method: "POST",
        shopId: shop.id,
        body: await imageUploadData(file),
      });
    },
    onSuccess: (s) => {
      accept(s, true);
      set({ logo: s.draft.logo });
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });
  const uploadImage = async (file: File): Promise<DesignImage> => {
    try {
      const img = await request<DesignImage>("/admin/v1/design/images", {
        method: "POST",
        shopId: shop.id,
        body: await imageUploadData(file),
      });
      setImages((m) => new Map(m).set(img.id, img));
      return img;
    } catch (e) {
      throw new Error(errorText(e), { cause: e });
    }
  };
  const busy = save.isPending || publish.isPending || discard.isPending;

  // Schriften für die Vorschau laden und Farben wie im Shop setzen.
  const webFonts = [form.headingFont, form.bodyFont].filter((f): f is WebFont => f !== null);
  useFontCss(webFonts);
  const preset = fontOf(form.font);
  const vars = {
    "--akzent": form.accentColor,
    "--akzent-dunkel": darker(form.accentColor),
    "--grund": form.backgroundColor,
    "--flaeche": mix(form.backgroundColor, SHOP_TEXT, 0.05),
    "--linie": mix(form.backgroundColor, SHOP_TEXT, 0.12),
    "--text": SHOP_TEXT,
    "--text-leise": "#5e554c",
    "--schrift-titel": form.headingFont ? webFontStack(form.headingFont) : preset.titel,
    "--schrift-text": form.bodyFont ? webFontStack(form.bodyFont) : preset.text,
  } as CSSProperties;

  const footerLinks = [
    ...form.pages.filter((p) => p.inFooter && p.title.trim() !== "").map((p) => p.title.trim()),
    ...cleanLinks(form.footerLinks)
      .filter((l) => l.label !== "")
      .map((l) => l.label),
  ];

  return (
    <BuilderDnd blocks={blocks} onChange={setBlocks} onSelect={setSelectedId}>
      <div className="flex flex-col lg:h-[calc(100dvh-3.5rem)] lg:flex-row">
        <aside
          aria-label="Editor"
          className="shrink-0 border-b border-gray-200 bg-gray-25 lg:w-[19rem] lg:overflow-y-auto lg:border-r lg:border-b-0"
        >
          <Section title="Seiten" open={openPanel === "seiten"} onToggle={() => toggle("seiten")}>
            <PagesPanel
              pages={form.pages}
              current={page?.id ?? "home"}
              onSelect={showPage}
              onChange={(pages) => set({ pages })}
              onAdd={addPage}
            />
          </Section>
          <Section title="Bausteine" open={openPanel === "bausteine"} onToggle={() => toggle("bausteine")}>
            <PalettePanel blocks={blocks} onAdd={addBlock} />
          </Section>
          <p className="px-4 pt-4 pb-1 text-[0.72rem] font-semibold tracking-[0.07em] text-gray-400 uppercase">
            Design
          </p>
          <Section title="Farben" open={openPanel === "farben"} onToggle={() => toggle("farben")}>
            <ColorsPanel form={form} set={set} />
          </Section>
          <Section title="Schriften" open={openPanel === "schriften"} onToggle={() => toggle("schriften")}>
            <FontsPanel form={form} set={set} />
          </Section>
          <Section title="Logo und Slogan" open={openPanel === "logo"} onToggle={() => toggle("logo")}>
            <LogoPanel
              form={form}
              set={set}
              uploadLogo={(f) => uploadLogo.mutate(f)}
              busy={uploadLogo.isPending}
            />
          </Section>
          <Section title="Fußzeile" open={openPanel === "fuss"} onToggle={() => toggle("fuss")}>
            <FooterPanel form={form} set={set} />
          </Section>
          <Section title="Kopfzeile" open={openPanel === "kopf"} onToggle={() => toggle("kopf")}>
            <HeaderPanel suche={form.suche} kopfKlebt={form.kopfKlebt} onChange={set} />
          </Section>
          <Section title="Vorlage" open={openPanel === "vorlage"} onToggle={() => toggle("vorlage")}>
            <TemplatePanel value={form.template} onChange={(template) => set({ template })} />
          </Section>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-gray-100">
          <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white/90 px-4 py-2 backdrop-blur lg:static">
            <p className="mr-2 font-semibold text-gray-900">
              {page ? page.title.trim() || "Ohne Titel" : "Startseite"}
            </p>
            <div role="radiogroup" aria-label="Vorschau-Breite" className="flex rounded-lg bg-gray-100 p-0.5">
              {[
                { m: false, name: "Computer", I: Monitor },
                { m: true, name: "Handy", I: Smartphone },
              ].map(({ m, name, I }) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={mobile === m}
                  aria-label={name}
                  title={name}
                  onClick={() => setMobile(m)}
                  className={
                    "flex items-center rounded-md px-2.5 py-1 " +
                    (mobile === m ? "bg-white text-gray-900 shadow-xs" : "text-gray-500 hover:text-gray-900")
                  }
                >
                  <I className="size-4" aria-hidden="true" />
                </button>
              ))}
            </div>
            <span className="hidden sm:inline">
              {unpublished ? (
                <Badge tone="amber">Nicht veröffentlicht</Badge>
              ) : (
                <Badge tone="green">Live im Shop</Badge>
              )}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <a
                href={storefrontUrl(shop.handle, window.location) + (page ? `/seite/${page.slug}` : "")}
                target="_blank"
                rel="noreferrer"
                className="hidden text-sm text-brand-700 hover:underline md:inline"
              >
                Live-Seite ↗
              </a>
              {unpublished && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  busy={discard.isPending}
                  onClick={() => discard.mutate()}
                >
                  Verwerfen
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={!dirty || issues.length > 0 || busy}
                busy={save.isPending}
                onClick={() => save.mutate()}
              >
                Speichern
              </Button>
              <Button
                disabled={!unpublished || issues.length > 0 || busy}
                busy={publish.isPending}
                onClick={() => publish.mutate()}
              >
                Veröffentlichen
              </Button>
            </div>
          </div>
          {(message || issues.length > 0) && (
            <div className="space-y-2 px-4 pt-3">
              {message && <Alert tone={message.tone}>{message.text}</Alert>}
              {issues.length > 0 && (
                <Alert>
                  {issues.map((i) => (
                    <span key={i} className="block">
                      {i}
                    </span>
                  ))}
                </Alert>
              )}
            </div>
          )}
          <div
            className="flex-1 overflow-auto px-3 py-6 sm:px-6"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedId(undefined);
            }}
          >
            <div style={vars}>
              <Canvas
                page={page}
                blocks={blocks}
                onBlocks={setBlocks}
                selectedId={selectedId}
                onSelect={setSelectedId}
                mobile={mobile}
                template={form.template}
                images={images}
                uploadImage={uploadImage}
                shopId={shop.id}
                products={published}
                categories={(categories.data ?? []).filter((c) => c.visible)}
                pages={form.pages}
                shopName={shop.name}
                shop={{
                  name: shop.name,
                  logo: form.logo,
                  tagline: form.tagline,
                  footerText: form.footerText,
                  footerLinks,
                  social: Object.entries(form.social)
                    .filter(([, v]) => v.trim() !== "")
                    .map(([k]) => k),
                  suche: form.suche,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </BuilderDnd>
  );
}
