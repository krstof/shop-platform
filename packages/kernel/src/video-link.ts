// Adressen von YouTube und Vimeo lesen. Liegt im Werkzeugkasten, weil zwei Module sie brauchen:
// storefront für den Baustein „Video" und catalog für das Video am Produkt (Paket P5).
// Eingebettet wird nie fremdes HTML, sondern immer eine selbst gebaute Adresse aus Anbieter und
// Kennung; alles andere wird abgelehnt.

export type VideoProvider = "youtube" | "vimeo";
export type VideoRef = { readonly provider: VideoProvider; readonly id: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

export function parseVideoUrl(url: string): VideoRef | undefined {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0] ?? "";
    return YOUTUBE_ID.test(id) ? { provider: "youtube", id } : undefined;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    if (u.pathname === "/watch" && v !== null && YOUTUBE_ID.test(v)) return { provider: "youtube", id: v };
    const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/);
    return m?.[1] === undefined ? undefined : { provider: "youtube", id: m[1] };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/^\/(?:video\/)?(\d{6,12})\/?$/);
    return m?.[1] === undefined ? undefined : { provider: "vimeo", id: m[1] };
  }
  return undefined;
}

/** Adresse zum Anschauen beim Anbieter (für Eingabefelder und Links). */
export function videoWatchUrl(provider: VideoProvider, id: string): string | undefined {
  if (provider === "youtube" && YOUTUBE_ID.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  if (provider === "vimeo" && VIMEO_ID.test(id)) return `https://vimeo.com/${id}`;
  return undefined;
}

/** Adresse zum Einbetten: YouTube ohne Cookies, Vimeo ohne Nachverfolgung. */
export function videoEmbedUrl(provider: VideoProvider, id: string, autoplay = false): string | undefined {
  const auto = autoplay ? "&autoplay=1&muted=1&mute=1" : "";
  if (provider === "youtube" && YOUTUBE_ID.test(id))
    return `https://www.youtube-nocookie.com/embed/${id}?rel=0${auto}`;
  if (provider === "vimeo" && VIMEO_ID.test(id)) return `https://player.vimeo.com/video/${id}?dnt=1${auto}`;
  return undefined;
}
