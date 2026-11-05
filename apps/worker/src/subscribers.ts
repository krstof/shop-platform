// Alle Subscriber der Module (Architektur 6.1: apps/worker setzt Module zusammen wie apps/api).
// Neue Module mit Subscribern tragen sich hier ein.
import { auditSubscribers } from "@shop/audit";
import type { Subscriber } from "@shop/kernel";

export function allSubscribers(): Subscriber[] {
  const all = [...auditSubscribers()];
  const names = all.map((s) => s.name);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length > 0) throw new Error(`Subscriber doppelt: ${twice.join(", ")}`);
  return all;
}
