// ============================================================
// Tâches planifiées (à appeler toutes les 10 minutes par un service de
// planification, ex. cron-job.org ou un « scheduled task ») :
//   POST https://<adresse-du-site>/api/public/taches
//   en-tête : Authorization: Bearer <CRON_SECRET>
// - libère les créneaux dont l'acompte n'a pas été payé à temps ;
// - une fois par jour (à 3 h) : purge RGPD des fiches inactives.
// ============================================================
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/taches")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { lireSecret } = await import("@/lib/secrets.server");
        const secret = lireSecret("CRON_SECRET");
        const recu = request.headers.get("authorization") ?? "";
        if (!secret || secret.length < 24 || recu !== `Bearer ${secret}`) {
          return new Response("Accès refusé", { status: 401 });
        }
        const { supabaseService } = await import("@/lib/supabase.server");
        const { getStripe } = await import("@/lib/stripe.server");
        const admin = supabaseService();

        // Créneaux expirés : la base les libère, on ferme aussi les paiements Stripe restés ouverts.
        const { data: expires } = await admin
          .from("reservations")
          .select("stripe_payment_intent, salons(stripe_account_id)")
          .eq("statut", "en_attente_paiement")
          .lt("acompte_expire_le", new Date().toISOString());
        await admin.rpc("liberer_expirees", { p_salon: null });
        for (const r of (expires ?? []) as {
          stripe_payment_intent: string | null;
          salons: { stripe_account_id: string | null } | null;
        }[]) {
          if (r.stripe_payment_intent && r.salons?.stripe_account_id) {
            await getStripe()
              .paymentIntents.cancel(r.stripe_payment_intent, undefined, { stripeAccount: r.salons.stripe_account_id })
              .catch(() => undefined);
          }
        }

        let purgees: number | null = null;
        const heureParis = Number(
          new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).format(new Date()),
        );
        if (heureParis === 3) {
          const { data } = await admin.rpc("purger_donnees", { p_mois_inactivite: 36 });
          purgees = Number(data ?? 0);
        }
        return Response.json({ liberees: (expires ?? []).length, purgees });
      },
    },
  },
});
