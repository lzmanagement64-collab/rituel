import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { business } from "./config/business";

// Seule l'adresse officielle doit être référencée par Google.
const HOTE_OFFICIEL = new URL(business.siteUrl).hostname;

/** www.emeraldbeauty.fr → emeraldbeauty.fr (redirection permanente). */
function redirectionWww(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.hostname !== `www.${HOTE_OFFICIEL}`) return null;
  url.hostname = HOTE_OFFICIEL;
  url.protocol = "https:";
  url.port = "";
  return new Response(null, { status: 301, headers: { location: url.toString() } });
}

/** Adresses lovable.app (site publié, aperçus) : jamais indexées. */
function nonIndexable(request: Request, response: Response): Response {
  const hote = new URL(request.url).hostname;
  if (hote === HOTE_OFFICIEL || hote === "localhost" || hote === "127.0.0.1") return response;
  const copie = new Response(response.body, response);
  copie.headers.set("X-Robots-Tag", "noindex, nofollow");
  return copie;
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const www = redirectionWww(request);
      if (www) return www;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return nonIndexable(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
