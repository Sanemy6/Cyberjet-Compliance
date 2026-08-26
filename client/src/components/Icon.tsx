/**
 * Jeu d'icônes de l'application : un seul trait, une seule grille 24×24, aucune
 * dépendance. Une bibliothèque d'icônes coûterait ici plus cher en poids et en
 * cohérence visuelle qu'elle ne rapporterait — la feuille de style applique
 * déjà `fill: none; stroke: currentColor` à tous les `svg`.
 */

export const ICONS = {
  home: '<path d="M3 12 12 4l9 8"/><path d="M5 10.5V20h14v-9.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  users: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.2"/><path d="M22 20v-2a4 4 0 0 0-3-3.8"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20v-1.2A4.8 4.8 0 0 1 9.8 14h4.4a4.8 4.8 0 0 1 4.8 4.8V20"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
  fileText: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M20 18v3H6.5A2.5 2.5 0 0 1 4 18.5"/>',
  /* Même silhouette que `book`, plus une coche : l'état « déjà en base » doit se
     distinguer d'un coup d'œil, sans changer de famille d'icône. */
  bookCheck: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M20 18v3H6.5A2.5 2.5 0 0 1 4 18.5"/><path d="m9 10.5 2 2 4-4.5"/>',
  shield: '<path d="M12 2.5 20 6v6.2c0 5-3.3 9.4-8 10.8-4.7-1.4-8-5.8-8-10.8V6l8-3.5Z"/>',
  shieldCheck: '<path d="M12 2.5 20 6v6.2c0 5-3.3 9.4-8 10.8-4.7-1.4-8-5.8-8-10.8V6l8-3.5Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7.5 9 4.5-4.5L16.5 9"/><path d="M12 4.5V16"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7.5 11.5 4.5 4.5 4.5-4.5"/><path d="M12 16V4"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15.3-6.4L21 8"/><path d="M21 4v4h-4"/><path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"/><path d="M3 20v-4h4"/>',
  wand: '<path d="M4 20 16.5 7.5"/><path d="M18 3.5 19 6l2.5 1L19 8l-1 2.5L17 8l-2.5-1L17 6Z"/><path d="M7 3.5 7.7 5 9 5.7 7.7 6.4 7 8l-.7-1.6L5 5.7 6.3 5Z"/>',
  chevronRight: '<path d="m9 5 7 7-7 7"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 5-7 7 7 7"/>',
  alert: '<path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  layoutGrid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  gripVertical: '<circle cx="9" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  // Même corps que `lock`, anse relevée à droite : le cadenas ouvert se lit
  // d'un coup d'œil à côté de son pendant fermé.
  unlock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 7.5-1.9"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="m11 11 8-8 2 2-2 2 2 2-2 2-2-2-2 2"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  folder: '<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  arrowUpRight: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  sparkle: '<path d="M12 3.5 13.9 9l5.6 1.9L13.9 13 12 18.5 10.1 13 4.5 10.9 10.1 9Z"/><path d="M18.5 16.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6Z"/>',
  slash: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  inbox: '<path d="M21 12h-5l-2 3h-4l-2-3H3"/><path d="M5.5 5h13l2.5 7v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6Z"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  plane: '<path d="M10.5 20.5 12 22l1.5-1.5V16l7 3.5V17l-7-5.5V5a1.5 1.5 0 0 0-3 0v6.5L3.5 17v2.5L10.5 16Z"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="2.2"/><path d="m3 6.5 9 6 9-6"/>',
  phone: '<path d="M7.2 3.5H4.8A1.8 1.8 0 0 0 3 5.4C3 13.8 10.2 21 18.6 21a1.8 1.8 0 0 0 1.9-1.8v-2.4a1.4 1.4 0 0 0-1.1-1.4l-3-.6a1.4 1.4 0 0 0-1.4.5l-1 1.2a14 14 0 0 1-5-5l1.2-1a1.4 1.4 0 0 0 .5-1.4l-.6-3a1.4 1.4 0 0 0-1.4-1.1Z"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a2.5 2.5 0 0 0 5 0v-1a9 9 0 1 0-3.5 7.1"/>',
  briefcase: '<rect x="2.5" y="7.5" width="19" height="12.5" rx="2.2"/><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5"/><path d="M2.5 12.5h19"/>',
  panelLeft: '<rect x="3" y="3.5" width="18" height="17" rx="2.4"/><path d="M9.5 3.5v17"/><path d="m16.5 9.5-2.5 2.5 2.5 2.5"/>',
  panelRight: '<rect x="3" y="3.5" width="18" height="17" rx="2.4"/><path d="M9.5 3.5v17"/><path d="m14 9.5 2.5 2.5L14 14.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="12.5" rx="2.2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  command: '<path d="M8.5 3.5A2.5 2.5 0 1 1 6 6h12a2.5 2.5 0 1 1-2.5-2.5v17A2.5 2.5 0 1 1 18 18H6a2.5 2.5 0 1 1 2.5 2.5Z"/>',
  logOut: '<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  trendUp: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  zap: '<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z"/>',
  gauge: '<path d="M4 18a9 9 0 1 1 16 0"/><path d="m12 14 4.5-4.5"/><circle cx="12" cy="15" r="1.6" fill="currentColor"/>',
  /* Nuancier : trois pastilles qui se chevauchent. Quatre points dans un cercle
     se lisaient comme un visage à 17 px. */
  palette: '<circle cx="9" cy="9.5" r="5.5"/><circle cx="15" cy="9.5" r="5.5"/><circle cx="12" cy="15" r="5.5"/>',
  rows: '<rect x="3" y="4" width="18" height="6" rx="1.8"/><rect x="3" y="14" width="18" height="6" rx="1.8"/>',
  waves: '<path d="M2 7.5c2.5-2 4.5 2 7 0s4.5 2 7 0 4.5 2 6 0"/><path d="M2 13c2.5-2 4.5 2 7 0s4.5 2 7 0 4.5 2 6 0"/><path d="M2 18.5c2.5-2 4.5 2 7 0s4.5 2 7 0 4.5 2 6 0"/>',
  idCard: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.4"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5 16.5c.6-1.6 2-2.4 3.5-2.4s2.9.8 3.5 2.4"/><path d="M15 10h4M15 13.5h4"/>',
  devices: '<rect x="2.5" y="5" width="13" height="9.5" rx="1.8"/><path d="M6 18h6"/><rect x="17" y="9.5" width="4.5" height="9.5" rx="1.4"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4.5V10h5.5"/><path d="M12 8v4.3l3 1.8"/>',
  /* Afficher / masquer un mot de passe. La variante barrée reprend exactement
     la même silhouette : seul le trait change, l'œil ne doit pas « sauter »
     d'une bascule à l'autre. */
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.6 6.1A9.9 9.9 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17.6 17.6 0 0 1-3.4 4.1"/><path d="M6.3 7.9A17.4 17.4 0 0 0 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3.5 3.5 17 17"/>',
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  // Le contenu vient exclusivement de la constante ci-dessus : aucune donnée
  // utilisateur ne transite par ici.
  return (
    <svg viewBox="0 0 24 24" className={className}
         dangerouslySetInnerHTML={{ __html: ICONS[name] ?? ICONS.info }} />
  );
}
