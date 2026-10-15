/** Clé publique d'envoi (base64url) au format attendu par le navigateur. */
export function depuisB64urlNavigateur(texte: string) {
  const b64 = texte.replace(/-/g, "+").replace(/_/g, "/");
  const s = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
