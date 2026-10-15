// Paiement de l'acompte : formulaire Stripe intégré, directement sur le compte
// Stripe du salon. La carte bancaire ne passe jamais par les serveurs de Rituel.
import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { euros } from "@/lib/regles";

const instances = new Map<string, Promise<Stripe | null>>();
function stripePour(cle: string, compte: string) {
  const k = `${cle}|${compte}`;
  if (!instances.has(k)) instances.set(k, loadStripe(cle, { stripeAccount: compte, locale: "fr" }));
  return instances.get(k)!;
}

export function Paiement(props: {
  clePublique: string;
  compteStripe: string;
  clientSecret: string;
  acompte: number;
  retourUrl: string;
  couleur: string;
  onPaye: () => void;
}) {
  const stripe = useMemo(() => stripePour(props.clePublique, props.compteStripe), [props.clePublique, props.compteStripe]);
  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: props.clientSecret,
        locale: "fr",
        appearance: {
          theme: "stripe",
          variables: { colorPrimary: props.couleur, borderRadius: "12px", fontFamily: "DM Sans, system-ui, sans-serif" },
        },
      }}
    >
      <Formulaire acompte={props.acompte} retourUrl={props.retourUrl} onPaye={props.onPaye} />
    </Elements>
  );
}

function Formulaire({ acompte, retourUrl, onPaye }: { acompte: number; retourUrl: string; onPaye: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const reste = useCompteARebours(30 * 60);

  const payer = async () => {
    if (!stripe || !elements || reste === 0) return;
    setEnvoi(true);
    setErreur(null);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: retourUrl },
      redirect: "if_required",
    });
    if (error) {
      setErreur(
        error.type === "card_error" || error.type === "validation_error"
          ? (error.message ?? "Paiement refusé.")
          : "Le paiement n'a pas pu aboutir. Merci de réessayer.",
      );
      setEnvoi(false);
      return;
    }
    if (paymentIntent && ["succeeded", "processing"].includes(paymentIntent.status)) onPaye();
    setEnvoi(false);
  };

  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-lin p-3 text-sm" role={reste === 0 ? "alert" : undefined}>
        {reste === 0
          ? "Le délai de paiement est dépassé : le créneau a été libéré. Merci de recommencer."
          : `Votre créneau est bloqué pendant ${Math.floor(reste / 60)} min ${String(reste % 60).padStart(2, "0")} s, le temps du paiement.`}
      </p>
      <PaymentElement options={{ layout: "tabs" }} />
      {erreur && (
        <p role="alert" className="text-sm text-destructive">
          {erreur}
        </p>
      )}
      <button type="button" className="btn-marque w-full" disabled={!stripe || envoi || reste === 0} onClick={payer}>
        {envoi ? "Paiement en cours…" : `Payer l'acompte de ${euros(acompte)}`}
      </button>
      <p className="text-center text-xs text-gris">
        Paiement sécurisé par Stripe, versé directement au salon. Vos données bancaires ne sont jamais stockées.
      </p>
    </div>
  );
}

function useCompteARebours(secondes: number) {
  const [reste, setReste] = useState(secondes);
  useEffect(() => {
    const fin = Date.now() + secondes * 1000;
    const id = setInterval(() => setReste(Math.max(0, Math.round((fin - Date.now()) / 1000))), 1000);
    return () => clearInterval(id);
  }, [secondes]);
  return reste;
}
