// ============================================================
// Fuseau horaire — stockage en UTC, affichage en Europe/Paris.
// Gère automatiquement le passage à l'heure d'été.
// ============================================================

export const PARIS = "Europe/Paris";

/** Décalage (en minutes) de Paris par rapport à UTC à un instant donné. */
export function parisOffsetMinutes(at: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS,
    timeZoneName: "shortOffset",
  });
  const part = fmt.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** Convertit une date/heure locale Paris (yyyy-mm-dd, HH:mm) en instant UTC. */
export function parisToUtc(dateISO: string, timeHHmm: string): Date {
  const naive = new Date(`${dateISO}T${timeHHmm}:00Z`);
  let utc = new Date(naive.getTime() - parisOffsetMinutes(naive) * 60000);
  // Deuxième passe pour les jours de changement d'heure
  utc = new Date(naive.getTime() - parisOffsetMinutes(utc) * 60000);
  return utc;
}

/** yyyy-mm-dd d'un instant, exprimé en heure de Paris. */
export function parisDateISO(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone: PARIS,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts;
}

/** HH:mm d'un instant, en heure de Paris. */
export function parisTime(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Ex. « mardi 12 août 2026 ». */
export function parisLongDate(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/** Ex. « mar. 12 août à 14:30 ». */
export function parisDateTime(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return `${new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS,
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(d)} à ${parisTime(d)}`;
}

/** Jour de la semaine (0 = dimanche) en heure de Paris. */
export function parisWeekday(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
  return dt.toISOString().slice(0, 10);
}

export function todayParisISO(): string {
  return parisDateISO(new Date());
}

export const formatEuros = (v: number) =>
  `${Number(v) % 1 === 0 ? Number(v).toFixed(0) : Number(v).toFixed(2).replace(".", ",")} €`;

export const formatDuree = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
};
