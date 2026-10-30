// Kürzen von IP-Adressen (Sicherheit 5.12 und 5.15, Q-15, Q-16).
// Protokolle und das Audit-Log speichern nie die volle Adresse.
import { isIPv4, isIPv6 } from "node:net";

export interface TruncateOptions {
  /** Anzahl Bit, die bei IPv4 erhalten bleiben. Standard 24 (letzter Block wird 0). */
  readonly v4Prefix?: number;
  /** Anzahl Bit, die bei IPv6 erhalten bleiben. Standard 48. Die Anfragebremse nutzt 64. */
  readonly v6Prefix?: number;
}

function expandIPv6(ip: string): number[] {
  // Eingebettete IPv4 am Ende (z. B. ::ffff:1.2.3.4) in zwei Blöcke umrechnen.
  let addr = ip.split("%")[0] ?? ip; // Zonenangabe (fe80::1%eth0) abschneiden
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4?.[1] !== undefined) {
    const o = v4[1].split(".").map(Number);
    const hi = (((o[0] ?? 0) << 8) | (o[1] ?? 0)).toString(16);
    const lo = (((o[2] ?? 0) << 8) | (o[3] ?? 0)).toString(16);
    addr = addr.slice(0, -v4[1].length) + `${hi}:${lo}`;
  }
  const [head = "", tail] = addr.split("::");
  const h = head === "" ? [] : head.split(":");
  const t = tail === undefined || tail === "" ? [] : tail.split(":");
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  return [...h, ...Array<string>(fill).fill("0"), ...t].map((x) => Number.parseInt(x, 16));
}

function maskBits(values: number[], bitsPerValue: number, keep: number): number[] {
  return values.map((v, i) => {
    const start = i * bitsPerValue;
    if (keep >= start + bitsPerValue) return v;
    if (keep <= start) return 0;
    const k = keep - start;
    const mask = ((1 << k) - 1) << (bitsPerValue - k);
    return v & mask;
  });
}

/**
 * Kürzt eine IP-Adresse auf ihr Netz. Gibt `undefined` zurück, wenn der Wert keine IP ist.
 * IPv4 in IPv6-Schreibweise (`::ffff:1.2.3.4`) wird wie IPv4 behandelt.
 */
export function truncateIp(ip: string, options: TruncateOptions = {}): string | undefined {
  const v4Prefix = options.v4Prefix ?? 24;
  const v6Prefix = options.v6Prefix ?? 48;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const candidate = mapped?.[1] ?? ip;

  if (isIPv4(candidate)) {
    return maskBits(candidate.split(".").map(Number), 8, v4Prefix).join(".");
  }
  if (isIPv6(ip)) {
    const blocks = maskBits(expandIPv6(ip), 16, v6Prefix);
    const kept = Math.ceil(v6Prefix / 16);
    const head = blocks.slice(0, kept).map((b) => b.toString(16));
    return kept >= 8 ? head.join(":") : `${head.join(":")}::`;
  }
  return undefined;
}
