// Tests de la logique sans base de données : `bun test tests`
import { describe, expect, test } from "bun:test";
import { chiffrerSante, dechiffrerSante, nouvelleCleSante } from "../src/lib/sante";
import {
  ACTIONS_SALON,
  calculerAcompte,
  messageErreur,
  salonRembourse,
  slugValide,
  versSlug,
} from "../src/lib/regles";

describe("données de santé chiffrées", () => {
  const cle = nouvelleCleSante();

  test("aller-retour", async () => {
    const c = await chiffrerSante("Allergie au latex", "cliente-1", cle);
    expect(c).not.toContain("latex");
    expect(await dechiffrerSante(c, "cliente-1", cle)).toBe("Allergie au latex");
  });

  test("deux chiffrements du même texte sont différents", async () => {
    const a = await chiffrerSante("X", "c", cle);
    const b = await chiffrerSante("X", "c", cle);
    expect(a).not.toBe(b);
  });

  test("copié sur la fiche d'une autre cliente : illisible", async () => {
    const c = await chiffrerSante("Diabète", "cliente-1", cle);
    await expect(dechiffrerSante(c, "cliente-2", cle)).rejects.toThrow();
  });

  test("mauvaise clé : illisible", async () => {
    const c = await chiffrerSante("Diabète", "cliente-1", cle);
    await expect(dechiffrerSante(c, "cliente-1", nouvelleCleSante())).rejects.toThrow();
  });

  test("texte chiffré modifié : rejeté", async () => {
    const c = await chiffrerSante("Diabète", "cliente-1", cle);
    const abime = c.slice(0, -4) + (c.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(dechiffrerSante(abime, "cliente-1", cle)).rejects.toThrow();
  });

  test("clé de mauvaise taille refusée", async () => {
    await expect(chiffrerSante("x", "c", btoa("trop-courte"))).rejects.toThrow(/32 octets/);
  });
});

describe("règles", () => {
  test("acompte en pourcentage", () => {
    expect(calculerAcompte(50, 30)).toBe(15);
    expect(calculerAcompte(45, 30)).toBe(13.5);
  });
  test("acompte fixe prioritaire, jamais au-dessus du prix", () => {
    expect(calculerAcompte(50, 30, 20)).toBe(20);
    expect(calculerAcompte(10, 30, 20)).toBe(10);
  });
  test("acompte minimum 1 €", () => {
    expect(calculerAcompte(2, 10)).toBe(1);
  });
  test("adresses de salon", () => {
    expect(versSlug("Emerald Beauty")).toBe("emerald-beauty");
    expect(versSlug("  Ongles & Cils — Pau ")).toBe("ongles-cils-pau");
    expect(slugValide("emerald-beauty")).toBe(true);
    expect(slugValide("-mauvais")).toBe(false);
    expect(slugValide("AB")).toBe(false);
  });
  test("remboursement lors d'un refus ou d'une annulation par le salon", () => {
    expect(salonRembourse("refusee")).toBe(true);
    expect(salonRembourse("annulee")).toBe(true);
    expect(salonRembourse("absente")).toBe(false);
  });
  test("les actions proposées correspondent aux passages autorisés en base", () => {
    const autorises = new Set([
      "a_valider>confirmee", "a_valider>refusee", "confirmee>annulee", "confirmee>honoree",
      "confirmee>absente", "honoree>absente", "absente>honoree",
    ]);
    for (const [de, actions] of Object.entries(ACTIONS_SALON)) {
      for (const a of actions) expect(autorises.has(`${de}>${a.statut}`)).toBe(true);
    }
  });
  test("messages d'erreur lisibles", () => {
    expect(messageErreur(new Error('P0001: CRENEAU_INDISPONIBLE'))).toContain("vient d'être réservé");
    expect(messageErreur("inconnu")).toContain("Une erreur");
  });
});
