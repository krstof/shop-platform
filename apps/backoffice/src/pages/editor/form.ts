// Zustand des Editors (alles, was „Entwurf speichern“ an die API schickt) und die Umrechnung von und zur API.
import type { DesignImage, DesignState } from "../../lib/api.js";
import {
  blockProblem,
  fillSections,
  legacyBlocks,
  pageProblem,
  splitLayouts,
  splitSections,
  type Block,
  type ContentPage,
} from "../../lib/blocks.js";
import {
  completeLinkUrl,
  completeSocialUrl,
  DEFAULT_BACKGROUND,
  isSafeLinkUrl,
  isSocialUrl,
  readableBackground,
  readableWithWhite,
  SOCIAL,
  searchModeOf,
  type SearchMode,
  templateOf,
  type Template,
  type Font,
  type WebFont,
} from "../../lib/design.js";

export interface FooterLinkForm {
  label: string;
  url: string;
}

export interface Form {
  accentColor: string;
  font: Font;
  headingFont: WebFont | null;
  bodyFont: WebFont | null;
  backgroundColor: string;
  template: Template;
  /** Kopfzeile: Suche und Verhalten beim Scrollen. */
  suche: SearchMode;
  kopfKlebt: boolean;
  /** Leiste ganz oben: an oder aus, dazu bis zu drei kurze Zusagen. */
  leisteAn: boolean;
  zusagen: string[];
  logo: DesignImage | null;
  favicon: DesignImage | null;
  tagline: string;
  footerText: string;
  footerLinks: FooterLinkForm[];
  social: Record<string, string>;
  /** Alte Felder der Startseite (bleiben, wie sie sind; die Bausteine tragen ihren Inhalt selbst). */
  heroImage: DesignImage | null;
  heroTitle: string;
  heroText: string;
  featuredProductIds: string[];
  blocks: Block[];
  pages: ContentPage[];
}

/**
 * Standardtexte, die der Shop einsetzt, wenn ein Feld leer ist. Im Editor sollen sie wirklich
 * dastehen und änderbar sein (Kristof 22.11.2026): Ein Platzhalter, der beim ersten Tippen
 * verschwindet, hilft niemandem. Gespeichert werden sie erst, wenn Kristof speichert.
 */
export function standardText(type: string, shopName: string, feld: "title" | "text" | "heading"): string {
  if (type === "hero")
    return feld === "title"
      ? `Willkommen bei ${shopName}`
      : feld === "text"
        ? "Schön, dass du da bist. Stöbere durch unser Sortiment."
        : "";
  if (feld !== "heading") return "";
  if (type === "featured") return "Empfohlen";
  if (type === "new") return "Neu im Shop";
  if (type === "bestseller") return "Bestseller";
  if (type === "categories") return "Kategorien";
  return "";
}

/** Leere Felder der Shop-Bereiche mit dem Text füllen, den der Shop sonst selbst einsetzt. */
function mitStandardtexten(blocks: readonly Block[], shopName: string): Block[] {
  return blocks.map((b) => {
    if (b.type === "group") return { ...b, blocks: mitStandardtexten(b.blocks, shopName) as typeof b.blocks };
    const voll: Record<string, unknown> = { ...b };
    for (const feld of ["title", "text", "heading"] as const) {
      const standard = standardText(b.type, shopName, feld);
      if (standard === "") continue;
      const wert = (b as unknown as Record<string, unknown>)[feld];
      if (wert === undefined || wert === "") voll[feld] = standard;
    }
    return voll as unknown as Block;
  });
}

export function formOf(state: DesignState, shopName = ""): Form {
  const d = state.draft;
  const h = d.home;
  const legacyHome = { ...h, heroImage: h.heroImage };
  const home = h.content ?? h.blocks;
  return {
    accentColor: d.accentColor,
    font: d.font,
    headingFont: d.headingFont ?? null,
    bodyFont: d.bodyFont ?? null,
    backgroundColor: d.backgroundColor ?? DEFAULT_BACKGROUND,
    template: templateOf(d.template),
    suche: searchModeOf(d.header?.search),
    kopfKlebt: d.header?.sticky === true,
    leisteAn: d.header?.uspOn !== false,
    zusagen: [...(d.header?.usp ?? [])],
    logo: d.logo,
    favicon: d.favicon ?? null,
    tagline: d.tagline,
    footerText: d.footer.text,
    footerLinks: d.footer.links.map((l) => ({ label: l.label, url: l.url })),
    social: Object.fromEntries(SOCIAL.map((n) => [n.id, d.footer.social?.[n.id] ?? ""])),
    heroImage: h.heroImage,
    heroTitle: h.heroTitle,
    heroText: h.heroText,
    featuredProductIds: [...h.featuredProductIds],
    blocks: mitStandardtexten(home ? fillSections(home, legacyHome) : legacyBlocks(legacyHome), shopName),
    pages: (d.pages ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      inFooter: p.inFooter,
      blocks: mitStandardtexten(fillSections(p.content ?? p.blocks, legacyHome), shopName),
    })),
  };
}

/** Links fürs Speichern: leere Zeilen weglassen, Adresse ergänzen (E-Mail → mailto: usw.). */
export function cleanLinks(links: readonly FooterLinkForm[]): FooterLinkForm[] {
  return links
    .map((l) => ({ label: l.label.trim(), url: completeLinkUrl(l.url) }))
    .filter((l) => l.label !== "" || l.url !== "");
}

/** Fehlertext für eine Linkzeile oder `undefined`. */
export function linkProblem(l: FooterLinkForm): string | undefined {
  const label = l.label.trim();
  const url = completeLinkUrl(l.url);
  if (label === "" && url === "") return undefined;
  if (label === "") return "Bitte eine Beschriftung eingeben.";
  if (url === "") return "Bitte eine Adresse eingeben.";
  if (!isSafeLinkUrl(url)) return "Diese Adresse geht nicht. Erlaubt: Webseite, E-Mail oder Telefonnummer.";
  return undefined;
}

export function socialProblem(url: string): string | undefined {
  const u = completeSocialUrl(url);
  return u === "" || isSocialUrl(u)
    ? undefined
    : "Bitte eine Webadresse wie https://instagram.com/… eingeben.";
}

/** Was „Entwurf speichern“ an die API schickt. */
export function bodyOf(f: Form) {
  const blocks = f.blocks;
  // Erst die Einstellungen je Baustein heraustrennen, dann den Inhalt der Shop-Bereiche: beide
  // gehen getrennt an die API (`layouts` und `sections`), die Bausteine bleiben schlank.
  const ohneLayout = splitLayouts(blocks);
  const home = splitSections(ohneLayout.blocks);
  return {
    accentColor: f.accentColor,
    font: f.font,
    headingFont: f.headingFont,
    bodyFont: f.bodyFont,
    backgroundColor: f.backgroundColor,
    template: f.template,
    header: {
      search: f.suche,
      sticky: f.kopfKlebt,
      uspOn: f.leisteAn,
      usp: f.zusagen.map((t) => t.trim()).filter((t) => t !== ""),
    },
    logoImageId: f.logo?.id ?? null,
    faviconImageId: f.favicon?.id ?? null,
    home: {
      heroImageId: f.heroImage?.id ?? null,
      heroTitle: f.heroTitle,
      heroText: f.heroText,
      featuredProductIds: f.featuredProductIds,
      showCategories: blocks.some((b) => b.type === "categories"),
      showNew: blocks.some((b) => b.type === "new"),
      blocks: home.blocks,
      sections: home.sections,
      layouts: ohneLayout.layouts,
    },
    tagline: f.tagline.trim(),
    footer: {
      text: f.footerText.trim(),
      links: cleanLinks(f.footerLinks),
      social: Object.fromEntries(SOCIAL.map((n) => [n.id, completeSocialUrl(f.social[n.id] ?? "")])),
    },
    pages: f.pages.map((p) => {
      const ohne = splitLayouts(p.blocks);
      const s = splitSections(ohne.blocks);
      return {
        id: p.id,
        title: p.title.trim(),
        slug: p.slug,
        inFooter: p.inFooter,
        blocks: s.blocks,
        sections: s.sections,
        layouts: ohne.layouts,
      };
    }),
  };
}

export function sameForm(a: Form, b: Form): boolean {
  return JSON.stringify(bodyOf(a)) === JSON.stringify(bodyOf(b));
}

/** Alle Probleme, die das Speichern verhindern (leer = alles gut). */
export function problems(f: Form): string[] {
  const out: string[] = [];
  if (!readableWithWhite(f.accentColor))
    out.push("Die Hauptfarbe ist zu hell für weiße Schrift auf Buttons.");
  if (!readableBackground(f.backgroundColor)) out.push("Die Hintergrundfarbe ist zu dunkel für den Text.");
  if (f.footerLinks.some((l) => linkProblem(l) !== undefined))
    out.push("Ein Link in der Fußzeile passt nicht.");
  if (Object.values(f.social).some((u) => socialProblem(u) !== undefined))
    out.push("Eine Adresse bei den sozialen Netzwerken passt nicht.");
  if (f.blocks.some((b) => blockProblem(b) !== undefined))
    out.push("Ein Baustein der Startseite passt nicht.");
  const page = f.pages.find((p) => pageProblem(p, f.pages) !== undefined);
  if (page) out.push(`Seite „${page.title.trim() || "Ohne Titel"}“: ${pageProblem(page, f.pages) ?? ""}`);
  return out;
}

/** Bilder (Logo, Bausteine) aus beiden Ständen zu den schon bekannten dazu. */
export function imageMap(
  known: ReadonlyMap<string, DesignImage>,
  state: DesignState,
): Map<string, DesignImage> {
  const m = new Map(known);
  for (const d of [state.draft, state.published]) {
    for (const i of [
      ...(d.logo ? [d.logo] : []),
      ...(d.home.heroImage ? [d.home.heroImage] : []),
      ...(d.home.blockImages ?? []),
      ...(d.pages ?? []).flatMap((p) => p.blockImages),
    ])
      m.set(i.id, i);
  }
  return m;
}
