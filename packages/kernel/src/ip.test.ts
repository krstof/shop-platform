import { describe, expect, it } from "vitest";
import { truncateIp } from "./ip.js";

describe("truncateIp", () => {
  it.each([
    ["203.0.113.57", "203.0.113.0"],
    ["10.1.2.3", "10.1.2.0"],
    ["::ffff:203.0.113.57", "203.0.113.0"],
    ["2001:db8:85a3:8d3:1319:8a2e:370:7348", "2001:db8:85a3::"],
    ["2001:db8::1", "2001:db8:0::"],
    ["::1", "0:0:0::"],
    ["fe80::1%eth0", "fe80:0:0::"],
  ])("%s → %s", (ip, expected) => {
    expect(truncateIp(ip)).toBe(expected);
  });

  it("kürzt IPv6 für die Anfragebremse auf /64 (Q-15)", () => {
    expect(truncateIp("2001:db8:85a3:8d3:1319:8a2e:370:7348", { v6Prefix: 64 })).toBe("2001:db8:85a3:8d3::");
    expect(truncateIp("2001:db8:85a3:8d3:ffff::1", { v6Prefix: 64 })).toBe(
      truncateIp("2001:db8:85a3:8d3:1::2", { v6Prefix: 64 }),
    );
  });

  it("kann auch nicht volle Blöcke kürzen", () => {
    expect(truncateIp("203.0.113.57", { v4Prefix: 20 })).toBe("203.0.112.0");
    expect(truncateIp("2001:db8:85a3:8d3::1", { v6Prefix: 56 })).toBe("2001:db8:85a3:800::");
  });

  it("gibt bei Nicht-Adressen undefined zurück", () => {
    expect(truncateIp("kein-ip")).toBeUndefined();
    expect(truncateIp("999.1.1.1")).toBeUndefined();
    expect(truncateIp("")).toBeUndefined();
  });
});
