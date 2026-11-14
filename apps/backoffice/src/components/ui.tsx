// Schlichte Bausteine fürs Backoffice (M3). Bewusst wenige, mit klaren Zuständen und Fokusrahmen.
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";
import { SlopifyLogo } from "./logo.js";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

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
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-xs",
    secondary: "bg-white text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50 hover:ring-gray-300 shadow-xs",
    ghost: "text-gray-700 hover:bg-gray-100",
    danger: "bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50",
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
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
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">
        {label}
      </label>
      {children({
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(error ? { "aria-invalid": true as const } : {}),
      })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-gray-500">
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
  "block w-full rounded-md border-0 bg-white px-3 py-[7px] text-sm text-gray-900 shadow-xs ring-1 ring-gray-200",
  "placeholder:text-gray-400 hover:ring-gray-300 focus:ring-2 focus:ring-brand-500 focus:outline-none",
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
    <section className={cx("rounded-lg bg-white p-5 ring-1 ring-gray-200", className)}>
      {title && <h2 className="mb-4 text-[15px] font-semibold text-gray-900">{title}</h2>}
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
    success: "bg-brand-50 text-brand-900 ring-brand-200",
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

/** Status als farbige Marke mit Punkt (wie „Released“, „To do“ in airfocus). */
export function Badge({
  tone,
  children,
}: {
  tone: "green" | "stone" | "amber" | "blue" | "red" | "violet";
  children: ReactNode;
}) {
  const styles = {
    green: ["bg-[#e3f5e9] text-[#1d6b3c]", "bg-[#2f9e5b]"],
    stone: ["bg-gray-100 text-gray-600", "bg-gray-400"],
    amber: ["bg-[#fdf1d8] text-[#8a5a00]", "bg-[#e0a325]"],
    blue: ["bg-brand-50 text-brand-800", "bg-brand-500"],
    red: ["bg-red-50 text-red-800", "bg-red-500"],
    violet: ["bg-violet-50 text-violet-800", "bg-violet-500"],
  }[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        styles[0],
      )}
    >
      <span aria-hidden="true" className={cx("size-1.5 rounded-full", styles[1])} />
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
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 flex justify-center">
          <SlopifyLogo size="lg" />
        </p>
        <div className="rounded-xl bg-white p-8 shadow-pop ring-1 ring-gray-200">
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          {intro && <p className="mt-1 text-sm text-gray-600">{intro}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
