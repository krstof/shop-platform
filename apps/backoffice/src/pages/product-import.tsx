// Produkte importieren (15.11.2026, Kristof: Pop-up mit Erklärung, Datei hineinziehen). Schritt 1 erklärt
// den Aufbau der Tabelle und nimmt die Datei an (ziehen oder auswählen), Schritt 2 zeigt, was passiert,
// und übernimmt die Zeilen über dieselbe Admin-API wie das Formular.
import { FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { Modal } from "../components/dialog.js";
import { Alert, Button } from "../components/ui.js";
import { CSV_HELP, importTemplateCsv, type ImportResult } from "../lib/product-csv.js";

export const MAX_IMPORT_BYTES = 2_000_000;

export function ImportDialog({
  open,
  onClose,
  read,
  apply,
  applying,
}: {
  open: boolean;
  onClose: () => void;
  /** Liest die Datei und prüft jede Zeile. */
  read: (text: string) => Promise<ImportResult>;
  apply: (result: ImportResult) => void;
  applying: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | undefined>();
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [over, setOver] = useState(false);

  function close() {
    setResult(undefined);
    setError(undefined);
    onClose();
  }
  async function take(file: File | undefined) {
    setError(undefined);
    if (file === undefined) return;
    if (!/\.(csv|txt)$/i.test(file.name) && !file.type.includes("csv")) {
      setError("Bitte eine CSV-Datei wählen (in Excel: „Speichern unter“ → „CSV UTF-8“).");
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError("Die Datei ist zu groß (höchstens 2 MB).");
      return;
    }
    setFileName(file.name);
    setResult(await read(await file.text()));
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files[0]);
  }
  function template() {
    const url = URL.createObjectURL(new Blob([importTemplateCsv()], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "produkte-vorlage.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const created = result?.rows.filter((r) => r.existingId === null).length ?? 0;
  const changed = result?.rows.filter((r) => r.existingId !== null).length ?? 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Produkte importieren"
      size="lg"
      footer={
        result ? (
          <>
            <Button variant="secondary" disabled={applying} onClick={() => setResult(undefined)}>
              Andere Datei
            </Button>
            <Button disabled={result.rows.length === 0} busy={applying} onClick={() => apply(result)}>
              {result.rows.length === 1
                ? "1 Produkt übernehmen"
                : `${result.rows.length} Produkte übernehmen`}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={close}>
            Abbrechen
          </Button>
        )
      }
    >
      {result === undefined ? (
        <div className="space-y-5">
          <p>
            Lege viele Produkte auf einmal an oder ändere sie, mit einer Tabelle aus Excel, Numbers oder
            Google Tabellen. Speichere sie als <strong>CSV</strong> (Trennzeichen Semikolon oder Komma). Die
            erste Zeile enthält die Spaltennamen, jede weitere Zeile ist ein Produkt.
          </p>
          <div className="overflow-hidden rounded-lg ring-1 ring-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Spalte</th>
                  <th className="px-3 py-2 font-medium">Bedeutung</th>
                  <th className="px-3 py-2 font-medium">Beispiel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {CSV_HELP.map((h) => (
                  <tr key={h.column}>
                    <td className="px-3 py-1.5 font-medium whitespace-nowrap text-gray-900">{h.column}</td>
                    <td className="px-3 py-1.5 text-gray-600">{h.text}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-500">{h.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-600">
            Tipp: „Exportieren“ liefert eine fertige Tabelle mit allen Produkten zum Bearbeiten. Oder{" "}
            <button type="button" onClick={template} className="font-medium text-brand-700 underline">
              leere Vorlage herunterladen
            </button>
            . Spalten, die fehlen, bleiben bei vorhandenen Produkten unverändert.
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 " +
              "text-center transition " +
              (over ? "border-brand-500 bg-brand-50" : "border-gray-300 bg-gray-50/60")
            }
          >
            <FileSpreadsheet className="size-8 text-gray-400" aria-hidden="true" />
            <p className="font-medium text-gray-900">CSV-Datei hierher ziehen</p>
            <p className="text-sm text-gray-500">oder</p>
            <Button variant="secondary" onClick={() => input.current?.click()}>
              <Upload className="size-4" aria-hidden="true" /> Datei auswählen
            </Button>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              tabIndex={-1}
              aria-label="CSV-Datei auswählen"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                void take(f);
              }}
            />
          </div>
          {error && <Alert>{error}</Alert>}
        </div>
      ) : (
        <div className="space-y-4">
          <p>
            <strong>{fileName}</strong>: {created === 1 ? "1 neues Produkt" : `${created} neue Produkte`},{" "}
            {changed === 1 ? "1 Änderung" : `${changed} Änderungen`} (gleiche Artikelnummer)
            {result.errors.length > 0 &&
              `, ${result.errors.length} ${result.errors.length === 1 ? "Zeile" : "Zeilen"} mit Fehlern (wird übersprungen)`}
            .
          </p>
          {result.errors.length > 0 && (
            <ul className="max-h-56 list-disc overflow-y-auto rounded-lg bg-red-50 py-3 pr-3 pl-8 text-sm text-red-800">
              {result.errors.map((e) => (
                <li key={e.line}>
                  Zeile {e.line}: {e.message}
                </li>
              ))}
            </ul>
          )}
          {result.rows.length > 0 && (
            <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg text-sm ring-1 ring-gray-200">
              {result.rows.map((r) => (
                <li key={r.line} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="truncate">{r.name}</span>
                  <span className="shrink-0 text-xs text-gray-500">
                    {r.existingId === null ? "neu" : "ändern"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
