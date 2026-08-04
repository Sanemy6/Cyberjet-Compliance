/* Briques d'interface : échappement, icônes, modales, notifications, formats. */

/* ------------------------------------------------------------------ */
/* Échappement — toute donnée dynamique passe par là avant innerHTML.   */
/* ------------------------------------------------------------------ */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function el(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

export function frag(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content;
}

/* ------------------------------------------------------------------ */
/* Icônes                                                              */
/* ------------------------------------------------------------------ */
const ICONS = {
  home: '<path d="M3 12 12 4l9 8"/><path d="M5 10.5V20h14v-9.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  users: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.2"/><path d="M22 20v-2a4 4 0 0 0-3-3.8"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20v-1.2A4.8 4.8 0 0 1 9.8 14h4.4a4.8 4.8 0 0 1 4.8 4.8V20"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
  fileText: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M20 18v3H6.5A2.5 2.5 0 0 1 4 18.5"/>',
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
  lock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
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
  /* Nuancier : trois pastilles qui se chevauchent. Les quatre points dans un
     cercle de la version précédente se lisaient comme un visage à 17 px. */
  palette: '<circle cx="9" cy="9.5" r="5.5"/><circle cx="15" cy="9.5" r="5.5"/><circle cx="12" cy="15" r="5.5"/>',
  rows: '<rect x="3" y="4" width="18" height="6" rx="1.8"/><rect x="3" y="14" width="18" height="6" rx="1.8"/>',
  waves: '<path d="M2 7.5c2.5-2 4.5 2 7 0s4.5 2 7 0 4.5 2 6 0"/><path d="M2 13c2.5-2 4.5 2 7 0s4.5 2 7 0 4.5 2 6 0"/><path d="M2 18.5c2.5-2 4.5 2 7 0s4.5 2 7 0 4.5 2 6 0"/>',
  idCard: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.4"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5 16.5c.6-1.6 2-2.4 3.5-2.4s2.9.8 3.5 2.4"/><path d="M15 10h4M15 13.5h4"/>',
  devices: '<rect x="2.5" y="5" width="13" height="9.5" rx="1.8"/><path d="M6 18h6"/><rect x="17" y="9.5" width="4.5" height="9.5" rx="1.4"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4.5V10h5.5"/><path d="M12 8v4.3l3 1.8"/>',
};

export function icon(name, cls = '') {
  const body = ICONS[name] || ICONS.info;
  return `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ''}>${body}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Formats                                                             */
/* ------------------------------------------------------------------ */
export function fmtNum(value) {
  return new Intl.NumberFormat('fr-FR').format(value || 0);
}

export function fmtPct(ratio, digits = 0) {
  return `${((ratio || 0) * 100).toFixed(digits)} %`;
}

export function fmtBytes(bytes) {
  const value = bytes || 0;
  if (value < 1024) return `${value} o`;
  const units = ['Ko', 'Mo', 'Go'];
  let n = value / 1024;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit += 1; }
  return `${n.toFixed(n < 10 ? 1 : 0).replace('.', ',')} ${units[unit]}`;
}

export function fmtDate(iso, withTime = false) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const options = withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat('fr-FR', options).format(date);
}

export function fmtRelative(iso) {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate(iso);
}

export function truncate(text, max = 160) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/* ------------------------------------------------------------------ */
/* Badges de confiance et de statut                                    */
/* ------------------------------------------------------------------ */
const BAND_STYLE = {
  haute: { cls: 'ok', label: 'Confiance haute' },
  moyenne: { cls: 'warn', label: 'À vérifier' },
  faible: { cls: 'danger', label: 'Confiance faible' },
  aucune: { cls: '', label: 'Sans correspondance' },
};

export function bandBadge(band, confidence) {
  const style = BAND_STYLE[band] || BAND_STYLE.aucune;
  const pct = confidence ? ` · ${Math.round(confidence * 100)} %` : '';
  return `<span class="badge ${style.cls}"><span class="dot ${style.cls}"></span>${esc(style.label)}${pct}</span>`;
}

const STATUS_STYLE = {
  validated: { cls: 'ok', label: 'Validée' },
  auto: { cls: 'accent', label: 'Proposée' },
  pending: { cls: '', label: 'À traiter' },
  na: { cls: 'outline', label: 'Sans objet' },
};

export function statusBadge(status) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return `<span class="badge ${style.cls}">${esc(style.label)}</span>`;
}

const KB_STATUS = {
  validated: { cls: 'ok', label: 'Validée' },
  draft: { cls: 'warn', label: 'Brouillon' },
  obsolete: { cls: 'danger', label: 'Obsolète' },
};

export function kbStatusBadge(status) {
  const style = KB_STATUS[status] || KB_STATUS.draft;
  return `<span class="badge ${style.cls}">${esc(style.label)}</span>`;
}

/* Cycle de vie d'un dossier client : avant signature, sous contrat, clos. */
export const CLIENT_STATUSES = ['prospect', 'actif', 'archivé'];

const CLIENT_STATUS = {
  prospect: { cls: 'warn', label: 'Prospect', tip: 'Contrat non signé' },
  archivé: { cls: 'outline', label: 'Archivé', tip: 'Dossier clos' },
};

/* Aucun badge pour « actif » : c'est l'état nominal, il n'apporte rien. */
export function clientStatusBadge(status) {
  if (status === 'actif') return '';
  const style = CLIENT_STATUS[status] || { cls: 'outline', label: status, tip: '' };
  return `<span class="badge ${style.cls} nowrap" title="${esc(style.tip)}">${esc(style.label)}</span>`;
}

export function controlChips(controls, limit = 4) {
  if (!controls || !controls.length) return '';
  const shown = controls.slice(0, limit).map(
    (c) => `<span class="badge ref" title="${esc(c.title)}"><b>${esc(c.framework_code)}</b> ${esc(c.ref)}</span>`
  );
  if (controls.length > limit) {
    shown.push(`<span class="badge ref">+${controls.length - limit}</span>`);
  }
  return `<span class="chips">${shown.join('')}</span>`;
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */
const TOAST_ICON = { ok: 'checkCircle', error: 'xCircle', warn: 'alert', info: 'info' };

export function toast(title, message = '', type = 'info', duration = 4200) {
  const root = document.getElementById('toast-root');
  const node = el(`
    <div class="toast ${type}">
      ${icon(TOAST_ICON[type] || 'info')}
      <div class="t-body">
        <div class="t-title">${esc(title)}</div>
        ${message ? `<div class="t-msg">${esc(message)}</div>` : ''}
      </div>
      <button class="icon-btn sm" aria-label="Fermer">${icon('x')}</button>
    </div>`);
  const dismiss = () => {
    node.style.transition = 'opacity .15s, transform .15s';
    node.style.opacity = '0';
    node.style.transform = 'translateX(16px)';
    setTimeout(() => node.remove(), 160);
  };
  node.querySelector('button').addEventListener('click', dismiss);
  root.appendChild(node);
  if (duration) setTimeout(dismiss, duration);
  return dismiss;
}

/* ------------------------------------------------------------------ */
/* Modales                                                             */
/* ------------------------------------------------------------------ */
export function modal({ title, sub = '', body = '', foot = '', wide = false, onClose }) {
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div>
            <h2>${esc(title)}</h2>
            ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
          </div>
          <button class="icon-btn" data-close aria-label="Fermer">${icon('x')}</button>
        </div>
        <div class="modal-body"></div>
        ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
      </div>
    </div>`);

  const bodyNode = backdrop.querySelector('.modal-body');
  if (typeof body === 'string') bodyNode.innerHTML = body;
  else bodyNode.appendChild(body);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    document.body.style.overflow = '';
    if (onClose) onClose();
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.getElementById('modal-root').appendChild(backdrop);

  const firstInput = backdrop.querySelector('input, textarea, select');
  if (firstInput) setTimeout(() => firstInput.focus(), 60);

  return { root: backdrop, body: bodyNode, close };
}

/* Confirmation renforcée : l'utilisateur doit ressaisir un libellé exact.
   Réservée aux suppressions en cascade, qu'aucun « Annuler » ne rattrape. */
export function confirmByTyping({ title, sub = '', warning = '', expected, confirmLabel }) {
  return new Promise((resolve) => {
    let settled = false;
    const dialog = modal({
      title,
      sub,
      body: `
        ${warning}
        <div class="field">
          <label for="ct-input">Saisissez <b>${esc(expected)}</b> pour confirmer</label>
          <input class="input" id="ct-input" autocomplete="off" spellcheck="false">
        </div>`,
      foot: `
        <button class="btn" data-close>Annuler</button>
        <button class="btn danger" data-confirm disabled>${esc(confirmLabel)}</button>`,
      onClose: () => { if (!settled) { settled = true; resolve(false); } },
    });

    const input = dialog.root.querySelector('#ct-input');
    const button = dialog.root.querySelector('[data-confirm]');
    const matches = () => input.value.trim() === expected;

    input.addEventListener('input', () => { button.disabled = !matches(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && matches()) button.click();
    });
    button.addEventListener('click', () => {
      if (!matches()) return;
      settled = true;
      dialog.close();
      resolve(true);
    });
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const dialog = modal({
      title,
      body: `<p class="muted">${esc(message)}</p>`,
      foot: `
        <button class="btn" data-close>Annuler</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-confirm>${esc(confirmLabel)}</button>`,
      onClose: () => { if (!settled) { settled = true; resolve(false); } },
    });
    dialog.root.querySelector('[data-confirm]').addEventListener('click', () => {
      settled = true;
      dialog.close();
      resolve(true);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Menus déroulants                                                     */
/* ------------------------------------------------------------------ */
/* Un seul menu ouvert à la fois dans l'application : ouvrir le second
   referme le premier, sinon deux panneaux se superposent au même endroit. */
let openMenu = null;

export function closeMenus() {
  if (openMenu) openMenu();
}

/* Fermeture au clic extérieur, à Échap, et à la navigation. Le déclencheur
   porte `aria-expanded` : sans lui, un lecteur d'écran annonce un bouton
   muet là où il y a un menu. */
export function dropdown(trigger, panel, { onOpen } = {}) {
  const close = () => {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('on');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    if (openMenu === close) openMenu = null;
  };
  const onOutside = (event) => {
    if (!panel.contains(event.target) && !trigger.contains(event.target)) close();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') { close(); trigger.focus(); }
  };
  const open = () => {
    closeMenus();
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('on');
    openMenu = close;
    onOpen?.(panel);
    // Différé : le clic qui vient d'ouvrir ne doit pas refermer aussitôt.
    setTimeout(() => {
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  };

  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    if (panel.hidden) open(); else close();
  });
  panel.addEventListener('click', (event) => {
    // Tout élément marqué ferme le menu : un item de navigation laissé ouvert
    // reste affiché par-dessus la vue qu'il vient de charger.
    if (event.target.closest('[data-menu-close]')) close();
  });

  return { open, close, isOpen: () => !panel.hidden };
}

/* ------------------------------------------------------------------ */
/* Panneau latéral (réglages)                                          */
/* ------------------------------------------------------------------ */
/* Une modale conviendrait mal aux réglages : on y entre pour comparer et
   ajuster plusieurs onglets, pas pour répondre à une question fermée. */
export function drawer({ title, sub = '', tabs = [], initial = 0, onClose }) {
  const root = el(`
    <div class="drawer-backdrop">
      <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="drawer-head">
          <div class="grow">
            <h2>${esc(title)}</h2>
            ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
          </div>
          <button class="icon-btn" data-close aria-label="Fermer">${icon('x')}</button>
        </header>
        <div class="drawer-main">
          <nav class="drawer-tabs" role="tablist">
            ${tabs.map((tab, i) => `
              <button class="drawer-tab" role="tab" data-tab="${i}"
                      aria-selected="${i === initial ? 'true' : 'false'}">
                ${icon(tab.icon)}<span>${esc(tab.label)}</span>
              </button>`).join('')}
          </nav>
          <div class="drawer-panel" id="drawer-panel" role="tabpanel"></div>
        </div>
      </aside>
    </div>`);

  const panel = root.querySelector('#drawer-panel');
  const buttons = [...root.querySelectorAll('.drawer-tab')];
  let current = -1;

  const select = (index) => {
    if (index === current) return;
    current = index;
    buttons.forEach((button, i) => {
      button.classList.toggle('active', i === index);
      button.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    panel.scrollTop = 0;
    panel.innerHTML = loading();
    Promise.resolve(tabs[index].render(panel, api)).catch((error) => {
      panel.innerHTML = emptyState({
        iconName: 'alert', title: 'Affichage impossible', text: error.message || String(error),
      });
    });
  };

  const close = () => {
    document.removeEventListener('keydown', onKey);
    root.classList.add('closing');
    document.body.style.overflow = '';
    setTimeout(() => root.remove(), 180);
    onClose?.();
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };

  // `api` : ce que chaque onglet reçoit pour se redessiner ou piloter le panneau.
  const api = { close, select, reload: () => { const i = current; current = -1; select(i); } };

  buttons.forEach((button, i) => button.addEventListener('click', () => select(i)));
  root.querySelector('[data-close]').addEventListener('click', close);
  root.addEventListener('mousedown', (event) => { if (event.target === root) close(); });
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.getElementById('modal-root').appendChild(root);
  select(initial);

  return api;
}

/* ------------------------------------------------------------------ */
/* Sélecteur segmenté                                                  */
/* ------------------------------------------------------------------ */
/* Trois à cinq choix exclusifs, tous visibles : plus lisible qu'un menu
   déroulant qui cache l'éventail derrière un clic. */
export function segmented(name, options, value) {
  return `
    <div class="segmented" role="radiogroup" data-seg="${esc(name)}">
      ${options.map((option) => `
        <button type="button" role="radio" class="seg${option.value === value ? ' active' : ''}"
                data-value="${esc(option.value)}"
                aria-checked="${option.value === value ? 'true' : 'false'}"
                ${option.hint ? `title="${esc(option.hint)}"` : ''}>
          ${option.icon ? icon(option.icon) : ''}<span>${esc(option.label)}</span>
        </button>`).join('')}
    </div>`;
}

/* Câble un groupe segmenté et signale la valeur retenue. */
export function onSegment(root, name, handler) {
  const group = root.querySelector(`[data-seg="${name}"]`);
  if (!group) return;
  group.addEventListener('click', (event) => {
    const button = event.target.closest('.seg');
    if (!button || button.classList.contains('active')) return;
    group.querySelectorAll('.seg').forEach((node) => {
      node.classList.toggle('active', node === button);
      node.setAttribute('aria-checked', node === button ? 'true' : 'false');
    });
    handler(button.dataset.value);
  });
}

/* ------------------------------------------------------------------ */
/* Identité visuelle d'un compte                                       */
/* ------------------------------------------------------------------ */
/* Deux lettres : initiales du nom complet s'il existe, sinon les deux
   premières de l'identifiant. Un avatar vide fait douter du chargement. */
export function initials(...candidates) {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    const words = value.split(/[\s._-]+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return value.slice(0, 2).toUpperCase();
  }
  return '??';
}

/* ------------------------------------------------------------------ */
/* États vides et chargement                                           */
/* ------------------------------------------------------------------ */
export function emptyState({ iconName = 'inbox', title, text = '', action = '' }) {
  return `
    <div class="empty">
      ${icon(iconName)}
      <h3>${esc(title)}</h3>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${action}
    </div>`;
}

export function loading() {
  return '<div class="loader"><span class="spinner"></span></div>';
}

/* ------------------------------------------------------------------ */
/* Divers                                                              */
/* ------------------------------------------------------------------ */
export function debounce(fn, delay = 260) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function on(root, selector, event, handler) {
  root.querySelectorAll(selector).forEach((node) => node.addEventListener(event, handler));
}

export async function withBusy(button, task) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>';
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

export function copyText(value) {
  navigator.clipboard?.writeText(value).then(
    () => toast('Copié dans le presse-papiers', '', 'ok', 1800),
    () => toast('Copie impossible', '', 'error')
  );
}
