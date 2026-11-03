// Baut den Kern-Server (Architektur 4, ADR-009): NestJS mit Fastify als Webserver.
// NestJS hält die Module und ihre Abhängigkeiten zusammen; die HTTP-Endpunkte kommen
// ausschließlich aus den Endpunkt-Verträgen der Module und laufen durch router.ts.
import "reflect-metadata";
import type { Endpoint } from "@shop/http";
import { NotFoundError, pickLocale, uuidv7, type Logger } from "@shop/kernel";
import type { ArgumentsHost, DynamicModule, ExceptionFilter } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ActorResolver } from "./actor.js";
import { sendProblem } from "./problem-reply.js";
import { registerEndpoints } from "./router.js";

/** Höchstgröße einer Anfrage (Sicherheit 5.4). Bilder laufen getrennt über signierte Upload-Adressen. */
export const BODY_LIMIT_BYTES = 1_048_576;

export interface ApiOptions {
  readonly endpoints: readonly Endpoint[];
  readonly resolveActor: ActorResolver;
  readonly logger: Logger;
  /** Hinter Caddy: nur der Proxy auf dieser Adresse darf die Absenderadresse setzen. */
  readonly trustedProxy?: string;
}

// NestJS braucht eine Klasse als Kennung des Moduls; der Inhalt steht in rootModule().
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class ApiModule {}

/** Wurzelmodul. Weitere Fachmodule mit Fassaden hängen sich ab E5 hier als imports an. */
function rootModule(): DynamicModule {
  return { module: ApiModule, providers: [] };
}

/**
 * Letzte Auffangstelle für alles, was nicht durch router.ts läuft (unbekannte Adressen,
 * Fehler von NestJS selbst): ebenfalls Problem Details, nie eine Standardseite mit Einzelheiten.
 */
class ProblemFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const status = (exception as { getStatus?: () => number }).getStatus?.();
    const error = status === 404 ? new NotFoundError({ cause: exception }) : exception;
    void sendProblem(reply, error, request.id, pickLocale(request.headers["accept-language"]), this.logger);
  }
}

export async function createApi(options: ApiOptions): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    // Eigene requestId (UUIDv7) für jede Anfrage. Eine mitgeschickte Kennung wird nicht übernommen.
    genReqId: () => uuidv7(),
    requestIdHeader: false,
    trustProxy: options.trustedProxy ?? false,
    routerOptions: { caseSensitive: true, ignoreTrailingSlash: false, maxParamLength: 200 },
    connectionTimeout: 30_000,
    requestTimeout: 30_000,
    onProtoPoisoning: "error",
    onConstructorPoisoning: "error",
    return503OnClosing: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(rootModule(), adapter, {
    logger: false,
    abortOnError: false,
  });
  app.useGlobalFilters(new ProblemFilter(options.logger));

  const fastify = app.getHttpAdapter().getInstance();
  // Nur JSON. Text und Formulare werden mit 415 abgelehnt.
  fastify.removeContentTypeParser(["text/plain"]);
  fastify.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  fastify.addHook("onResponse", async (request, reply) => {
    options.logger.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? "(unbekannt)",
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      "Anfrage beendet",
    );
  });
  registerEndpoints(fastify, options);
  await app.init();
  return app;
}
