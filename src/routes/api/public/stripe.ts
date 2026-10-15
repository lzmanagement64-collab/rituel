// ============================================================
// Webhook Stripe Connect — adresse à déclarer dans Stripe
// (Développeurs → Webhooks → « Événements sur les comptes connectés ») :
//   https://<adresse-du-site>/api/public/stripe
// Événements : payment_intent.succeeded, charge.refunded, account.updated
// Chaque appel est authentifié par sa signature : un appel non signé est rejeté.
// ============================================================
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/stripe")({
  server: {
    handlers: {
      GET: async () =>
        new Response("Webhook Stripe Rituel : adresse correcte.", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      POST: async ({ request }) => {
        const { verifierWebhook } = await import("@/lib/stripe.server");
        let evt: Awaited<ReturnType<typeof verifierWebhook>>;
        try {
          evt = await verifierWebhook(request);
        } catch (e) {
          console.error("[webhook] refusé :", (e as Error).message);
          return new Response("Signature invalide", { status: 400 });
        }

        const { supabaseService } = await import("@/lib/supabase.server");
        const { paiementReussi } = await import("@/lib/paiement.server");
        const objet = evt.data.object as Record<string, unknown>;
        try {
          switch (evt.type) {
            case "payment_intent.succeeded": {
              // Le paiement doit venir du compte du salon qui porte la réservation.
              const { data: r } = await supabaseService()
                .from("reservations")
                .select("salons(stripe_account_id)")
                .eq("stripe_payment_intent", String(objet.id))
                .maybeSingle();
              const compte = (r as { salons: { stripe_account_id: string | null } | null } | null)?.salons
                ?.stripe_account_id;
              if (!compte || compte !== evt.account) {
                console.warn(`[webhook] paiement ${String(objet.id)} ignoré : compte inattendu`);
                break;
              }
              await paiementReussi(String(objet.id), Number(objet.amount_received));
              break;
            }
            case "charge.refunded": {
              if (typeof objet.payment_intent === "string") {
                await supabaseService().rpc("remboursement_enregistre", {
                  p_payment_intent: objet.payment_intent,
                  p_total_centimes: Number(objet.amount_refunded),
                });
              }
              break;
            }
            case "account.updated": {
              await supabaseService()
                .from("salons")
                .update({ paiements_actifs: !!objet.charges_enabled })
                .eq("stripe_account_id", String(objet.id));
              break;
            }
            default:
              break;
          }
        } catch (e) {
          // Erreur : Stripe renverra l'événement plus tard (traitement rejouable sans risque).
          console.error(`[webhook] ${evt.type} (${evt.id}) :`, (e as Error).message);
          return new Response("Erreur temporaire", { status: 500 });
        }
        return Response.json({ received: true });
      },
    },
  },
});
