// Schlichte Bausteine fürs Backoffice (M3). Bewusst wenige, mit klaren Zuständen und Fokusrahmen.
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
};

export function Button({
  variant = "primary",
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const styles = {
    primary: "bg-emerald-700 text-white hover:bg-emerald-800 shadow-sm",
    secondary: "bg-white text-stone-800 ring-1 ring-stone-300 hover:bg-stone-100 shadow-sm",
    ghost: "text-stone-700 hover:bg-stone-200/60",
    danger: "bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50",
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        focus,
        styles,
        className,
      )}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent",
        className,
      )}
    />
  );
}

interface FieldProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}

/** Beschriftetes Feld mit Hinweis und Fehlertext, richtig verknüpft für Screenreader. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
      </label>
      {children({
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(error ? { "aria-invalid": true as const } : {}),
      })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-stone-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

const control = cx(
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm ring-1 ring-stone-300",
  "placeholder:text-stone-400 focus:ring-2 focus:ring-emerald-600 focus:outline-none",
  "aria-[invalid=true]:ring-red-400",
);

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(control, className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(control, "min-h-32", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(control, "pr-8", className)}>
      {children}
    </select>
  );
}

export function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200", className)}>
      {title && <h2 className="mb-4 text-sm font-semibold text-stone-900">{title}</h2>}
      {children}
    </section>
  );
}

export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success" | "info";
  children: ReactNode;
}) {
  const styles = {
    error: "bg-red-50 text-red-800 ring-red-200",
    success: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    info: "bg-sky-50 text-sky-900 ring-sky-200",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("rounded-lg px-4 py-3 text-sm ring-1", styles)}
    >
      {children}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "green" | "stone" | "amber"; children: ReactNode }) {
  const styles = {
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    stone: "bg-stone-100 text-stone-700 ring-stone-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
  }[tone];
  return (
    <span
      className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1", styles)}
    >
      {children}
    </span>
  );
}

/** Seite für Anmelden und Passwort: schmale Karte in der Mitte. */
export function AuthFrame({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-semibold tracking-wide text-emerald-800">
          Shop-Plattform
        </p>
        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-stone-200">
          <h1 className="text-xl font-semibold text-stone-900">{title}</h1>
          {intro && <p className="mt-1 text-sm text-stone-600">{intro}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
