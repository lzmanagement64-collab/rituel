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

// Client volontairement non typé tant que les types de la base ne sont pas générés
// (voir src/integrations/supabase/types.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClientSupabase = { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

export function supabasePublic(): ClientSupabase {
  const cle = secretObligatoire("SUPABASE_PUBLISHABLE_KEY");
  return createClient(secretObligatoire("SUPABASE_URL"), cle, options(cle)) as unknown as ClientSupabase;
}

let service: ClientSupabase | null = null;

export function supabaseService(): ClientSupabase {
  if (!service) {
    const cle = lireSecret("SUPABASE_SERVICE_ROLE_KEY") || lireSecret("SUPABASE_SECRET_KEY");
    if (!cle) throw new Error("Configuration manquante : SUPABASE_SERVICE_ROLE_KEY");
    service = createClient(secretObligatoire("SUPABASE_URL"), cle, options(cle)) as unknown as ClientSupabase;
  }
  return service;
}
