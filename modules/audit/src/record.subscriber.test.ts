import { uuidv7, type EventEnvelope } from "@shop/kernel";
import { describe, expect, it } from "vitest";
import { recordSubscriber, toAuditEntry } from "./record.subscriber.js";

const tenantId = uuidv7();
const base: EventEnvelope = {
  id: uuidv7(),
  type: "catalog.manufacturer.updated.v1",
  tenantId,
  occurredAt: "2026-11-05T06:00:00.000Z",
  actor: { type: "user", id: uuidv7() },
  correlationId: uuidv7(),
  causationId: null,
  data: {},
};

describe("audit.record", () => {
  it("hört auf alle Ereignisse", () => {
    expect(recordSubscriber.name).toBe("audit.record");
    expect(recordSubscriber.events).toBe("*");
  });

  it("übernimmt Urheber, Zeitpunkt, Vorgang, Objekt und Änderungen", () => {
    const id = uuidv7();
    const entry = toAuditEntry({ ...base, data: { id, changes: { city: ["Kiel", "Hamburg"] } } });
    expect(entry).toEqual({
      tenantId,
      occurredAt: base.occurredAt,
      actorType: "user",
      actorId: base.actor.id,
      action: "catalog.manufacturer.updated.v1",
      entityType: "catalog.manufacturer",
      entityId: id,
      changes: { city: ["Kiel", "Hamburg"] },
      correlationId: base.correlationId,
    });
  });

  it("kopiert keine weiteren Daten des Ereignisses ins Protokoll", () => {
    const entry = toAuditEntry({ ...base, data: { id: uuidv7(), name: "Teehaus", email: "a@b.example" } });
    expect(JSON.stringify(entry)).not.toContain("Teehaus");
    expect(JSON.stringify(entry)).not.toContain("a@b.example");
    expect(entry.changes).toBeNull();
  });

  it("verträgt Ereignisse ohne Objekt-ID und ohne Urheber-ID", () => {
    const entry = toAuditEntry({ ...base, actor: { type: "system" }, data: { orderNumber: 7 } });
    expect(entry).toMatchObject({ actorType: "system", actorId: null, entityId: null, changes: null });
  });

  it("ignoriert Daten, die nicht der Vereinbarung folgen, statt sie zu übernehmen", () => {
    const entry = toAuditEntry({ ...base, data: { id: "keine-uuid", changes: { a: "kein Paar" } } });
    expect(entry).toMatchObject({ entityId: null, changes: null });
  });

  it("lehnt Ereignisse ohne Shop ab", () => {
    expect(() => toAuditEntry({ ...base, tenantId: null })).toThrow(/ohne Shop/);
  });
});
