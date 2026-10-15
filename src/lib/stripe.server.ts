// ============================================================
// Stripe Connect — chaque salon a SON compte Stripe.
//  - Les acomptes sont des paiements « directs » sur le compte du salon :
//    l'argent ne transite jamais par Rituel, et Rituel ne prend aucune commission.
//  - Le salon ouvre et vérifie son compte sur les pages sécurisées de Stripe
//    (Rituel ne voit ni IBAN ni pièce d'identité).
// Secrets : STRIPE_SECRET_KEY (clé de la plateforme Rituel),
//           STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET (webhook « Connect »).
// ============================================================
import Stripe from "stripe";
import { lireSecret, secretObligatoire } from "./secrets.server";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    client = new Stripe(secretObligatoire("STRIPE_SECRET_KEY"), {
      apiVersion: "2026-03-25.dahlia",
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return client;
}

/** Clé publiable (pk_…), sans danger côté navigateur. */
export function clePubliqueStripe(): string {
  const cle = lireSecret("STRIPE_PUBLISHABLE_KEY");
  return cle.startsWith("pk_") ? cle : "";
}

export function messageStripe(error: unknown): string {
  const e = error as { raw?: { message?: string }; message?: string } | null;
  return e?.raw?.message ?? e?.message ?? "Erreur Stripe";
}

export type EvenementStripe = {
  id: string;
  type: string;
  account?: string;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
};

/** Vérifie la signature d'un webhook Stripe (refuse tout appel non signé ou rejoué tard). */
export async function verifierWebhook(req: Request): Promise<EvenementStripe> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  const secret = secretObligatoire("STRIPE_WEBHOOK_SECRET");
  if (!signature || !body) throw new Error("Signature ou contenu manquant");

  let horodatage: string | undefined;
  const signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [cle, valeur] = part.split("=", 2);
    if (cle === "t") horodatage = valeur;
    if (cle === "v1") signatures.push(valeur);
  }
  if (!horodatage || signatures.length === 0) throw new Error("Format de signature invalide");
  if (Math.abs(Date.now() / 1000 - Number(horodatage)) > 300) throw new Error("Webhook trop ancien");

  const cle = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signe = await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(`${horodatage}.${body}`));
  const attendu = Array.from(new Uint8Array(signe), (o) => o.toString(16).padStart(2, "0")).join("");
  if (!signatures.some((s) => egaliteConstante(s, attendu))) throw new Error("Signature invalide");
  return JSON.parse(body) as EvenementStripe;
}

/** Comparaison en temps constant (évite de deviner une signature caractère par caractère). */
function egaliteConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
