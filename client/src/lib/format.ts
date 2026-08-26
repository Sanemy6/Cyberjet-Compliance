/** Formats d'affichage — français, unités SI françaises, dates localisées. */

const NUMBER = new Intl.NumberFormat('fr-FR');
const RELATIVE = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' });

export const fmtNum = (value: number | null | undefined) => NUMBER.format(value ?? 0);

export const fmtPct = (ratio: number | null | undefined, digits = 0) =>
  `${((ratio ?? 0) * 100).toFixed(digits)} %`;

export function fmtBytes(bytes: number | null | undefined): string {
  const value = bytes ?? 0;
  if (value < 1024) return `${value} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let n = value / 1024;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit += 1; }
  return `${n.toFixed(n < 10 ? 1 : 0).replace('.', ',')} ${units[unit]}`;
}

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const date = parse(iso);
  if (!date) return '—';
  return new Intl.DateTimeFormat('fr-FR', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = parse(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = parse(iso);
  if (!date) return '—';

  const diff = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return RELATIVE.format(Math.round(diff), 'second');
  if (abs < 3600) return RELATIVE.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return RELATIVE.format(Math.round(diff / 3600), 'hour');
  if (abs < 2592000) return RELATIVE.format(Math.round(diff / 86400), 'day');
  return fmtDate(iso);
}

export function fmtMonth(isoMonth: string): string {
  const [year, month] = isoMonth.split('-');
  return MONTH.format(new Date(Number(year), Number(month) - 1, 1));
}

export const truncate = (text: string | null | undefined, max = 160) => {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/** Accord du pluriel, cas simple : `plural(3, 'réponse')` → « réponses ». */
export const plural = (count: number, singular: string, many = `${singular}s`) =>
  count > 1 ? many : singular;

/**
 * Deux lettres : initiales du nom complet s'il existe, sinon les deux premières
 * de l'identifiant. Un avatar vide fait douter du chargement.
 */
export function initials(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (!value) continue;
    const words = value.split(/[\s._-]+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return value.slice(0, 2).toUpperCase();
  }
  return '??';
}

/**
 * L'API rend des horodatages UTC sans suffixe de fuseau (`datetime2`
 * sérialisé). Sans le `Z`, le navigateur les lirait comme des heures locales et
 * afficherait « il y a 2 heures » sur un événement qui vient d'avoir lieu.
 */
function parse(iso: string): Date | null {
  const normalised = /(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}
