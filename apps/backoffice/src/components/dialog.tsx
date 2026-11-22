// Eigene Pop-ups (15.11.2026, Kristof: keine Browser-Fenster für Rückfragen). Baut auf dem
// HTML-Element <dialog> auf: Es hält den Fokus im Fenster, Escape schließt, der Rest der Seite ist
// solange gesperrt.
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./ui.js";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d === null) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" }[size];
  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-titel"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Klick auf den abgedunkelten Rand schließt.
        if (e.target === e.currentTarget) onClose();
      }}
      className={
        `modal m-auto w-[calc(100%-2rem)] ${width} rounded-xl bg-white p-0 text-gray-900 shadow-2xl ` +
        "ring-1 ring-black/5"
      }
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 pt-5 pb-4">
            <h2 id="modal-titel" className="text-lg font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Schließen"
              className="-mr-2 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5 text-[0.95rem] text-gray-700">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 bg-gray-50/60 px-6 py-4">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export interface ConfirmOptions {
  readonly title: string;
  readonly message: ReactNode;
  readonly confirmLabel: string;
  /** „danger“ färbt den Button rot (Löschen, Stornieren, Sperren). */
  readonly tone?: "danger" | "default";
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | undefined>(undefined);

/** Stellt `useConfirm()` für die ganze Anwendung bereit. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void }>();
  const confirm = useCallback<Confirm>(
    (options) => new Promise<boolean>((resolve) => setState({ options, resolve })),
    [],
  );
  const finish = (ok: boolean) => {
    state?.resolve(ok);
    setState(undefined);
  };
  const o = state?.options;
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={state !== undefined}
        onClose={() => finish(false)}
        title={o?.title ?? ""}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => finish(false)}>
              Abbrechen
            </Button>
            <Button
              autoFocus
              variant={o?.tone === "danger" ? "destructive" : "primary"}
              onClick={() => finish(true)}
            >
              {o?.confirmLabel}
            </Button>
          </>
        }
      >
        {o?.message}
      </Modal>
    </ConfirmContext.Provider>
  );
}

/** Rückfrage als Pop-up: `if (await confirm({...})) …`. */
export function useConfirm(): Confirm {
  const c = useContext(ConfirmContext);
  if (c === undefined) throw new Error("useConfirm braucht <ConfirmProvider>");
  return c;
}
