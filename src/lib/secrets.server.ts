// ============================================================
// Lecture des secrets côté serveur (jamais envoyés au navigateur).
// Hébergement Node (process.env) ou Cloudflare (globalThis.__env__).
// La liste complète est dans .env.example.
// ============================================================
type Source = Record<string, unknown> | undefined;

function sources(): Source[] {
  const g = globalThis as { __env__?: Source; process?: { env?: Source } };
  return [g.process?.env, g.__env__];
}

/** Valeur d'un secret (espaces et guillemets autour retirés), ou "" s'il est absent. */
export function lireSecret(nom: string): string {
  for (const src of sources()) {
    const v = src?.[nom];
    if (typeof v === "string" && v.trim()) return v.trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

export function secretObligatoire(nom: string): string {
  const v = lireSecret(nom);
  if (!v) throw new Error(`Configuration manquante : ${nom}`);
  return v;
}

/** Adresse publique du site, sans « / » final (ex. https://rituel.app). */
export function adresseSite(): string {
  return (lireSecret("SITE_URL") || "http://localhost:3000").replace(/\/+$/, "");
}
