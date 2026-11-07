// Endpunkte der Platform-API (Architektur 4.3). Erreichbar nur für aktive Betreiberkonten mit
// bestätigtem zweitem Faktor (apps/api, actor.ts) und nie mit einem Shop. Heute nur „Wer bin ich
// als Betreiber“; Händler und Shops verwalten folgt mit E7.
import { defineEndpoint, type Endpoint } from "@shop/http";
import { ForbiddenError } from "@shop/kernel";
import { z } from "zod";
import { OPERATOR_ROLES, type OperatorDirectory } from "../internal/operators.js";

export interface PlatformEndpointOptions {
  readonly operators: Pick<OperatorDirectory, "findOperator">;
}

const operatorSchema = z
  .object({
    userId: z.uuid(),
    role: z
      .enum(OPERATOR_ROLES)
      .describe(
        "owner: Inhaber der Plattform, operator: Betrieb, support: Hilfe für Händler, viewer: nur lesen.",
      ),
  })
  .meta({ id: "PlatformOperator" });

export function platformEndpoints(options: PlatformEndpointOptions): Endpoint[] {
  const me = defineEndpoint({
    api: "platform",
    method: "GET",
    path: "/operator",
    operationId: "getPlatformOperator",
    summary: "Wer bin ich als Betreiber",
    description:
      "Liefert das Betreiberkonto der Sitzung und seine Rolle. Nur mit bestätigtem zweitem Faktor; " +
      "ohne Zwei-Faktor oder ohne Betreiberkonto 403. Die Sitzung endet nach 1 Stunde ohne Aktivität, " +
      "spätestens 12 Stunden nach der Anmeldung.",
    tags: ["Plattform"],
    access: { scopes: ["platform:read"] },
    response: { status: 200, description: "Betreiberkonto.", schema: operatorSchema },
    handler: async ({ auth }) => {
      const userId = auth?.actor.type === "user" ? auth.actor.id : undefined;
      const operator = userId === undefined ? undefined : await options.operators.findOperator(userId);
      if (operator === undefined) throw new ForbiddenError();
      return { userId: operator.userId, role: operator.role };
    },
  });
  return [me];
}
