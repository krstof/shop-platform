// KI-generierte Produktbeschreibung (15.11.2026, Kristof): oben Stichworte oder die bisherige
// Beschreibung, darunter auf Knopfdruck ein schön geschriebener Vorschlag. Die KI darf nichts
// hinzudichten (Anweisung im Modul ai). Übernommen wird erst mit „Übernehmen“, gespeichert wie immer.
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Modal } from "../components/dialog.js";
import { Alert, Button, Textarea } from "../components/ui.js";
import { ApiError, request } from "../lib/api.js";

export function AiDescriptionButton({
  shopId,
  name,
  category,
  current,
  onApply,
}: {
  shopId: string;
  name: string;
  category: string | undefined;
  current: string;
  onApply: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState("");
  const write = useMutation({
    mutationFn: () =>
      request<{ description: string }>("/admin/v1/assistant/product-description", {
        method: "POST",
        shopId,
        body: { name: name.trim(), notes: notes.trim(), ...(category ? { category } : {}) },
      }),
    onSuccess: (r) => setResult(r.description),
  });
  const missingName = name.trim() === "";
  const error =
    write.error instanceof ApiError && write.error.status === 503
      ? "Die KI ist auf diesem Server gerade nicht verfügbar."
      : write.error?.message;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNotes(current);
          setResult("");
          write.reset();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 ring-1 ring-violet-200 transition hover:bg-violet-100"
      >
        <Sparkles className="size-3.5" aria-hidden="true" /> KI-generierte Produktbeschreibung
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="KI-generierte Produktbeschreibung"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={result.trim() === ""}
              onClick={() => {
                onApply(result.trim());
                setOpen(false);
              }}
            >
              Übernehmen
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-800">Stichworte oder bisherige Beschreibung</span>
            <span className="block text-xs text-gray-500">
              Alles, was im Text stehen soll, etwa: „Japan, erste Ernte, mild, 100 g“. Die KI erfindet nichts
              dazu.
            </span>
            <Textarea
              className="mt-1.5"
              rows={5}
              maxLength={5000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              busy={write.isPending}
              disabled={missingName || notes.trim().length < 3}
              onClick={() => write.mutate()}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              {result === "" ? "Beschreibung schreiben" : "Neu schreiben"}
            </Button>
            {missingName && (
              <span className="text-sm text-gray-500">Gib dem Produkt zuerst einen Namen.</span>
            )}
          </div>
          {error && <Alert>{error}</Alert>}
          <label className="block">
            <span className="text-sm font-medium text-gray-800">Vorschlag der KI</span>
            <span className="block text-xs text-gray-500">Du kannst ihn hier noch anpassen.</span>
            <Textarea
              className="mt-1.5"
              rows={8}
              maxLength={5000}
              value={result}
              placeholder={write.isPending ? "Die KI schreibt …" : "Hier erscheint der Text."}
              onChange={(e) => setResult(e.target.value)}
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
