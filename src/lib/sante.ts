// ============================================================
// Données de santé des clientes (allergies, contre-indications).
// Données sensibles au sens de l'article 9 du RGPD :
//  - chiffrées par le serveur en AES-256-GCM AVANT d'aller en base ;
//  - la clé (secret SANTE_CLE, 32 octets en base64) ne quitte jamais le serveur ;
//  - une copie de la base, un export ou une fuite ne contient que du texte illisible ;
//  - chaque texte chiffré est lié à sa cliente (données associées) : impossible de
//    recopier le chiffré d'une cliente sur la fiche d'une autre.
// Fonctionne partout où WebCrypto existe (Node, Cloudflare, navigateur de test).
// ============================================================

const VERSION = "v1";

function versOctets(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function versBase64(octets: Uint8Array): string {
  let bin = "";
  for (const o of octets) bin += String.fromCharCode(o);
  return btoa(bin);
}

async function importerCle(cleBase64: string): Promise<CryptoKey> {
  const brute = versOctets(cleBase64.trim());
  if (brute.length !== 32) {
    throw new Error("SANTE_CLE doit faire 32 octets encodés en base64.");
  }
  return crypto.subtle.importKey("raw", brute, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Chiffre le texte de santé d'une cliente. Renvoie « v1.<iv>.<chiffré> ». */
export async function chiffrerSante(texte: string, clienteId: string, cleBase64: string): Promise<string> {
  const cle = await importerCle(cleBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(clienteId) },
    cle,
    new TextEncoder().encode(texte),
  );
  return `${VERSION}.${versBase64(iv)}.${versBase64(new Uint8Array(chiffre))}`;
}

/** Déchiffre. Lève une erreur si le texte a été modifié ou déplacé sur une autre fiche. */
export async function dechiffrerSante(valeur: string, clienteId: string, cleBase64: string): Promise<string> {
  const [version, ivB64, donneesB64] = valeur.split(".");
  if (version !== VERSION || !ivB64 || !donneesB64) throw new Error("Format de donnée de santé inconnu.");
  const cle = await importerCle(cleBase64);
  const clair = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: versOctets(ivB64),
      additionalData: new TextEncoder().encode(clienteId),
    },
    cle,
    versOctets(donneesB64),
  );
  return new TextDecoder().decode(clair);
}

/** Génère une nouvelle clé (à faire une seule fois, à garder dans les secrets). */
export function nouvelleCleSante(): string {
  return versBase64(crypto.getRandomValues(new Uint8Array(32)));
}
