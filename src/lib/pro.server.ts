// ============================================================
// Contrôle d'accès de l'espace pro (côté serveur).
// Double vérification avant toute opération faite avec la clé de service :
//  1. le jeton de la professionnelle est en double authentification (aal2) ;
//  2. la base confirme qu'elle est membre du salon (avec SON jeton, donc
//     soumis aux mêmes règles RLS).
// ============================================================
type Contexte = {
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
  userId: string;
  claims?: Record<string, unknown> | null;
};

export async function exigerMembre(ctx: Contexte, salonId: string, role?: "proprietaire") {
  if (ctx.claims?.aal !== "aal2") {
    throw new Error("Double authentification requise. Reconnectez-vous.");
  }
  const fn = role === "proprietaire" ? "est_proprietaire" : "est_membre";
  const { data, error } = await ctx.supabase.rpc(fn, { p_salon: salonId });
  if (error || data !== true) {
    throw new Error(role ? "Réservé à la propriétaire du salon." : "Accès refusé à ce salon.");
  }
}
