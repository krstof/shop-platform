// Bildersuche (21.11.2026): ein Knopf, der ein Fenster mit Suchfeld und Treffern öffnet.
//
// Gesucht wird über die eigene API, nicht im Browser beim Anbieter: So bleibt der Zugangsschlüssel
// auf dem Server. Ausgewählt wird ein Bild als ganz normale Datei, damit alles danach so läuft wie
// bei einem Bild von der Festplatte — gleiche Prüfungen, gleicher Weg, gleiche Größen.
import { useMutation } from "@tanstack/react-query";
import { ImageIcon, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { request } from "../lib/api.js";
import { Spinner } from "./ui.js";

interface StockPhoto {
  readonly source: "openverse" | "unsplash";
  readonly id: string;
  readonly title: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
  readonly license: string;
  readonly attribution: string;
  readonly pageUrl: string;
}

/** Wandelt Base64 in eine Datei, damit das Bild denselben Weg geht wie eines von der Festplatte. */
function toFile(data: string, filename: string): File {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const type = filename.endsWith(".png")
    ? "image/png"
    : filename.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return new File([bytes], filename, { type });
}

export function StockPhotoButton({
  shopId,
  onPicked,
  label = "Bild suchen",
  compact = false,
}: {
  shopId: string;
  onPicked: (file: File) => Promise<void>;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Der Knopf steht auch in der Vorschau des Editors, wo die Schrift des Shops gilt. Er ist
        // aber ein Knopf des Backoffice und behält deshalb dessen Schrift.
        style={{ fontFamily: "var(--font-sans)" }}
        className={
          compact
            ? "inline-flex items-center gap-1.5 rounded-md bg-white/95 px-2.5 py-1.5 text-sm font-medium text-gray-800 shadow ring-1 ring-gray-200 hover:bg-white"
            : "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
        }
      >
        <Search className="size-4" aria-hidden="true" />
        {label}
      </button>
      {open && <StockPhotoDialog shopId={shopId} onPicked={onPicked} onClose={() => setOpen(false)} />}
    </>
  );
}

function StockPhotoDialog({
  shopId,
  onPicked,
  onClose,
}: {
  shopId: string;
  onPicked: (file: File) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<StockPhoto[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [taking, setTaking] = useState<string | undefined>();
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const search = useMutation({
    mutationFn: (query: string) =>
      request<{ data: StockPhoto[] }>(`/admin/v1/stock-photos?query=${encodeURIComponent(query)}`, {
        shopId,
      }),
    onSuccess: (result) => {
      setPhotos(result.data);
      setError(
        result.data.length === 0 ? "Dazu habe ich nichts gefunden. Versuch ein anderes Wort." : undefined,
      );
    },
    onError: () => setError("Die Bildersuche antwortet gerade nicht."),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim() === "") return;
    setError(undefined);
    search.mutate(text.trim());
  };

  const take = async (photo: StockPhoto) => {
    setTaking(photo.id);
    setError(undefined);
    try {
      const file = await request<{ data: string; filename: string }>("/admin/v1/stock-photos/download", {
        method: "POST",
        shopId,
        body: { source: photo.source, id: photo.id },
      });
      await onPicked(toFile(file.data, file.filename));
      onClose();
    } catch {
      setError("Das Bild ließ sich nicht holen. Nimm ein anderes.");
    } finally {
      setTaking(undefined);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Bild suchen"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-[1.05rem] font-semibold text-gray-900">Bild suchen</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="text-gray-500 hover:text-gray-900"
          >
            <X className="size-5" />
          </button>
        </div>
        <form onSubmit={submit} className="flex gap-2 border-b border-gray-200 px-5 py-4">
          <input
            ref={field}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={100}
            placeholder="Wonach suchst du? Zum Beispiel: grüner Tee"
            className="flex-1 rounded-md border-0 px-3 py-2 text-sm ring-1 ring-gray-300 focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={search.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {search.isPending ? "Sucht …" : "Suchen"}
          </button>
        </form>
        <div className="min-h-[14rem] flex-1 overflow-y-auto px-5 py-4">
          {search.isPending ? (
            <Spinner />
          ) : photos === undefined ? (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <ImageIcon className="size-4" aria-hidden="true" />
              Such nach einem Wort, das zum Bild passt. Englische Wörter bringen meist mehr Treffer.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {photos.map((photo) => (
                <li key={`${photo.source}-${photo.id}`}>
                  <button
                    type="button"
                    disabled={taking !== undefined}
                    onClick={() => void take(photo)}
                    title={photo.title}
                    className="group relative block w-full overflow-hidden rounded-lg ring-1 ring-gray-200 hover:ring-2 hover:ring-brand-500 disabled:opacity-50"
                  >
                    <img
                      src={photo.thumbnailUrl}
                      alt={photo.title}
                      loading="lazy"
                      className="aspect-[4/3] w-full bg-gray-100 object-cover"
                    />
                    <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1.5 py-0.5 text-[0.65rem] text-white">
                      {taking === photo.id ? "lädt …" : photo.license}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error !== undefined && <p className="mt-3 text-sm text-amber-700">{error}</p>}
        </div>
        <p className="border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
          Die Treffer kommen von Openverse (gemeinfrei, ohne Namensnennung nutzbar). Mit einem Schlüssel unter
          Einstellungen → Anbindungen sucht sie zusätzlich bei Unsplash.
        </p>
      </div>
    </div>
  );
}
