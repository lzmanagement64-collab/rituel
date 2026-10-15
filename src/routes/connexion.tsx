// ============================================================
// Connexion de l'espace pro — sans mot de passe à voler :
//  1. code à usage unique envoyé par e-mail ;
//  2. double authentification OBLIGATOIRE (application type Google
//     Authenticator, 1Password…). Sans elle, la base ne montre aucune donnée.
// Les comptes sont créés par Rituel (pas d'inscription libre pour l'instant).
// ============================================================
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/connexion")({
  head: () => ({ meta: [{ title: "Connexion — Rituel Pro" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Connexion,
});

type Etape = "email" | "code" | "enrolement" | "verification" | "chargement";

function Connexion() {
  const navigate = useNavigate();
  const [etape, setEtape] = useState<Etape>("chargement");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<{ svg: string; secret: string; factorId: string } | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  /** Après le code e-mail : double authentification à créer ou à saisir. */
  async function etapeSuivante() {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") {
      navigate({ to: "/pro" });
      return;
    }
    const { data: facteurs } = await supabase.auth.mfa.listFactors();
    const totp = facteurs?.totp?.find((f) => f.status === "verified");
    if (totp) {
      setFactorId(totp.id);
      setEtape("verification");
      return;
    }
    // Facteurs inachevés d'une tentative précédente : nettoyés avant d'en créer un neuf.
    for (const f of facteurs?.all ?? []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Rituel" });
    if (error || !data) {
      setErreur("Impossible de préparer la double authentification. Réessayez.");
      setEtape("email");
      return;
    }
    setQr({ svg: data.totp.qr_code, secret: data.totp.secret, factorId: data.id });
    setEtape("enrolement");
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) etapeSuivante();
      else setEtape("email");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function envoyerCode(e: FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    });
    setEnvoi(false);
    // Même message que le compte existe ou non : on ne révèle pas qui est client de Rituel.
    if (error && !/signups not allowed|user not found/i.test(error.message)) {
      setErreur("Envoi impossible pour le moment. Réessayez dans une minute.");
      return;
    }
    setEtape("code");
  }

  async function verifierCode(e: FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setEnvoi(false);
    if (error) {
      setErreur("Code incorrect ou expiré.");
      return;
    }
    setCode("");
    await etapeSuivante();
  }

  async function verifierTotp(e: FormEvent) {
    e.preventDefault();
    const id = qr?.factorId ?? factorId;
    if (!id) return;
    setEnvoi(true);
    setErreur(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: code.trim() });
    setEnvoi(false);
    if (error) {
      setErreur("Code incorrect. Vérifiez l'heure de votre téléphone et réessayez.");
      return;
    }
    navigate({ to: "/pro" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <p className="surtitre">Rituel Pro</p>
      <h1 className="mt-1 mb-6 text-3xl">Connexion</h1>

      {etape === "chargement" && <p className="text-gris">Un instant…</p>}

      {etape === "email" && (
        <form onSubmit={envoyerCode} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Adresse e-mail du salon</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border bg-white px-3 py-2.5" />
          </label>
          <button className="btn-marque w-full" disabled={envoi}>{envoi ? "Envoi…" : "Recevoir un code"}</button>
        </form>
      )}

      {etape === "code" && (
        <form onSubmit={verifierCode} className="space-y-4">
          <p className="text-sm text-gris">Si un compte existe pour {email}, un code à 6 chiffres vient d'y être envoyé.</p>
          <CodeInput value={code} onChange={setCode} libelle="Code reçu par e-mail" />
          <button className="btn-marque w-full" disabled={envoi || code.length < 6}>{envoi ? "Vérification…" : "Continuer"}</button>
          <button type="button" className="text-sm text-gris underline" onClick={() => setEtape("email")}>Changer d'adresse</button>
        </form>
      )}

      {etape === "enrolement" && qr && (
        <form onSubmit={verifierTotp} className="space-y-4">
          <p className="text-sm">
            <strong>Protégez votre salon.</strong> Scannez ce code avec une application d'authentification
            (Google Authenticator, Microsoft Authenticator, 1Password…). Elle vous sera demandée à chaque connexion.
          </p>
          <img src={qr.svg} alt="QR code de double authentification" className="mx-auto size-48 rounded-xl border bg-white p-2" />
          <p className="break-all text-center text-xs text-gris">Code manuel : {qr.secret}</p>
          <CodeInput value={code} onChange={setCode} libelle="Code affiché par l'application" />
          <button className="btn-marque w-full" disabled={envoi || code.length < 6}>{envoi ? "Vérification…" : "Activer et entrer"}</button>
        </form>
      )}

      {etape === "verification" && (
        <form onSubmit={verifierTotp} className="space-y-4">
          <CodeInput value={code} onChange={setCode} libelle="Code de votre application d'authentification" />
          <button className="btn-marque w-full" disabled={envoi || code.length < 6}>{envoi ? "Vérification…" : "Entrer"}</button>
        </form>
      )}

      {erreur && <p role="alert" className="mt-4 text-sm text-destructive">{erreur}</p>}
    </main>
  );
}

function CodeInput({ value, onChange, libelle }: { value: string; onChange: (v: string) => void; libelle: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{libelle}</span>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        className="w-full rounded-xl border bg-white px-3 py-2.5 text-center text-2xl tracking-[0.4em]"
      />
    </label>
  );
}
