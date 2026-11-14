// Einladung annehmen (M8): Link aus der E-Mail `…/einladung#code=…`. Erst ohne Passwort versuchen;
// ist das Konto neu, verlangt die API eins (422 password_required, der Code bleibt gültig).
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Alert, AuthFrame, Button, Field, Input } from "../components/ui.js";
import { ApiError, request } from "../lib/api.js";

const linkStyle = "font-medium text-brand-800 underline-offset-4 hover:underline";

function codeFromHash(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get("code") ?? "";
}

export function AcceptInvitationPage() {
  const [code] = useState(codeFromHash);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [done, setDone] = useState<"created" | "joined">();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (needsPassword && password !== repeat) {
      setError("Die beiden Passwörter sind nicht gleich.");
      return;
    }
    setBusy(true);
    try {
      const body = needsPassword
        ? { code, password, ...(name.trim() === "" ? {} : { name: name.trim() }) }
        : { code };
      const r = await request<{ accountCreated: boolean }>("/auth/v1/invitations/accept", {
        method: "POST",
        body,
      });
      window.history.replaceState(null, "", window.location.pathname);
      setDone(r.accountCreated ? "created" : "joined");
    } catch (err) {
      if (err instanceof ApiError && err.errors.some((f) => f.code === "password_required"))
        setNeedsPassword(true);
      else if (err instanceof ApiError)
        setError(err.field("/body/password") ?? err.field("/body/code") ?? err.message);
      else setError("Das hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  }

  if (code === "" && done === undefined)
    return (
      <AuthFrame title="Einladung">
        <Alert>Der Link ist unvollständig. Bitte den Link aus der E-Mail vollständig öffnen.</Alert>
      </AuthFrame>
    );

  if (done !== undefined)
    return (
      <AuthFrame title="Willkommen!">
        <Alert tone="success">
          {done === "created"
            ? "Dein Konto ist eingerichtet. Melde dich jetzt mit deiner E-Mail und dem neuen Passwort an."
            : "Du bist jetzt im Shop dabei. Melde dich wie gewohnt an."}
        </Alert>
        <p className="mt-6 text-center text-sm">
          <Link to="/anmelden" className={linkStyle}>
            Zum Anmelden
          </Link>
        </p>
      </AuthFrame>
    );

  return (
    <AuthFrame
      title="Einladung annehmen"
      intro={
        needsPassword
          ? "Fast geschafft: Wähle ein Passwort mit mindestens 12 Zeichen. Ein Satz aus mehreren Wörtern ist ideal."
          : "Du wurdest eingeladen, einen Shop zu verwalten."
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        {needsPassword && (
          <>
            <Field label="Dein Name (optional)">
              {(p) => (
                <Input
                  {...p}
                  autoComplete="name"
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field label="Passwort">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  required
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Field label="Noch einmal">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  required
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              )}
            </Field>
          </>
        )}
        <Button type="submit" busy={busy} className="w-full">
          {needsPassword ? "Passwort speichern und annehmen" : "Einladung annehmen"}
        </Button>
      </form>
    </AuthFrame>
  );
}
