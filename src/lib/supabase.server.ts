// ============================================================
// Clients Supabase côté serveur.
//  - supabasePublic() : clé publiable, soumis aux règles RLS (lectures publiques).
//  - supabaseService() : clé de service, contourne RLS. Réservé aux opérations
//    qui doivent passer par le serveur (paiement, statuts, e-mails) APRÈS
//    vérification des droits. Jamais importé dans un fichier navigateur.
// ============================================================
import { createClient } from "@supabase/supabase-js";
import { lireSecret, secretObligatoire } from "./secrets.server";

function fetchAvecCle(cle: string): typeof fetch {
  return (input, init) => {
    const h = new Headers(init?.headers);
    // Les nouvelles clés Supabase (sb_…) ne sont pas des jetons JWT.
    if (cle.startsWith("sb_") && h.get("Authorization") === `Bearer ${cle}`) h.delete("Authorization");
    h.set("apikey", cle);
    return fetch(input, { ...init, headers: h });
  };
}

const options = (cle: string) => ({
  auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  global: { fetch: fetchAvecCle(cle) },
});

export function supabasePublic() {
  const cle = secretObligatoire("SUPABASE_PUBLISHABLE_KEY");
  return createClient(secretObligatoire("SUPABASE_URL"), cle, options(cle));
}

let service: ReturnType<typeof createClient> | null = null;

export function supabaseService() {
  if (!service) {
    const cle = lireSecret("SUPABASE_SERVICE_ROLE_KEY") || lireSecret("SUPABASE_SECRET_KEY");
    if (!cle) throw new Error("Configuration manquante : SUPABASE_SERVICE_ROLE_KEY");
    service = createClient(secretObligatoire("SUPABASE_URL"), cle, options(cle));
  }
  return service;
}
