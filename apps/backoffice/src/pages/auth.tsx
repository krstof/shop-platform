// Anmelden, Passwort vergessen, neues Passwort (M3). Nutzt nur die Auth-API.
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Alert, AuthFrame, Button, Field, Input } from "../components/ui.js";
import { ApiError, request, type CurrentSession } from "../lib/api.js";
import { sessionKey } from "../lib/session.js";

const linkStyle = "font-medium text-brand-800 underline-offset-4 hover:underline";

export function SignInPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "code">("password");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function done(session: CurrentSession) {
    queryClient.setQueryData(sessionKey, session);
    await navigate({ to: "/" });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      if (step === "password") {
        const s = await request<CurrentSession>("/auth/v1/sign-in", {
          method: "POST",
          body: { email, password },
        });
        if (s.secondFactor === "required") setStep("code");
        else await done(s);
      } else {
        await done(
          await request<CurrentSession>("/auth/v1/two-factor/verify", { method: "POST", body: { code } }),
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Anmelden hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title={step === "password" ? "Anmelden" : "Bestätigungscode"}
      intro={
        step === "password"
          ? "Melde dich an, um deinen Shop zu verwalten."
          : "Gib den 6-stelligen Code aus deiner Authenticator-App ein."
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        {step === "password" ? (
          <>
            <Field label="E-Mail">
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  autoComplete="username"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="Passwort">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
          </>
        ) : (
          <Field label="Code">
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
              />
            )}
          </Field>
        )}
        <Button type="submit" busy={busy} className="w-full">
          {step === "password" ? "Anmelden" : "Bestätigen"}
        </Button>
      </form>
      {step === "password" && (
        <p className="mt-6 text-center text-sm">
          <Link to="/passwort-vergessen" className={linkStyle}>
            Passwort vergessen?
          </Link>
        </p>
      )}
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await request("/auth/v1/password/forgot", { method: "POST", body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Das hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Passwort vergessen"
      intro="Wir schicken dir einen Link, mit dem du ein neues Passwort setzt."
    >
      {sent ? (
        <Alert tone="success">
          Wenn es ein Konto mit dieser Adresse gibt, ist jetzt eine E-Mail unterwegs. Der Link darin gilt 30
          Minuten.
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="E-Mail">
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" busy={busy} className="w-full">
            Link senden
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/anmelden" className={linkStyle}>
          Zurück zum Anmelden
        </Link>
      </p>
    </AuthFrame>
  );
}

/** Code aus dem Link `…/passwort-neu#code=…` (steht hinter #, damit er in keinem Protokoll landet). */
function codeFromHash(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get("code") ?? "";
}

export function ResetPasswordPage() {
  const [code] = useState(codeFromHash);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (password !== repeat) {
      setError("Die beiden Passwörter sind nicht gleich.");
      return;
    }
    setBusy(true);
    try {
      await request("/auth/v1/password/reset", { method: "POST", body: { code, newPassword: password } });
      // Code aus der Adresszeile entfernen, er ist verbraucht.
      window.history.replaceState(null, "", window.location.pathname);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Das hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  }

  if (code === "")
    return (
      <AuthFrame title="Neues Passwort">
        <Alert>Der Link ist unvollständig. Bitte fordere einen neuen an.</Alert>
        <p className="mt-6 text-center text-sm">
          <Link to="/passwort-vergessen" className={linkStyle}>
            Neuen Link anfordern
          </Link>
        </p>
      </AuthFrame>
    );

  return (
    <AuthFrame title="Neues Passwort" intro="Mindestens 12 Zeichen. Ein Satz aus mehreren Wörtern ist ideal.">
      {done ? (
        <>
          <Alert tone="success">Dein Passwort ist geändert. Du kannst dich jetzt anmelden.</Alert>
          <p className="mt-6 text-center text-sm">
            <Link to="/anmelden" className={linkStyle}>
              Zum Anmelden
            </Link>
          </p>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Neues Passwort">
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
          <Button type="submit" busy={busy} className="w-full">
            Passwort speichern
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
