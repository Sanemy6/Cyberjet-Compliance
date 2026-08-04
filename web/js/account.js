/* Panneau du compte — fiche, connexion, apparence, appareils.
 *
 * Un seul endroit pour tout ce qui concerne la personne connectée, atteignable
 * depuis l'avatar ou l'icône d'engrenage. Le panneau latéral est préféré à une
 * modale : on y vient pour parcourir et ajuster plusieurs onglets, pas pour
 * répondre à une question fermée.
 */

import { api } from './api.js';
import { disableMfa, enrollMfa, passwordPrompt, regenerateMfaCodes } from './mfa.js';
import { ACCENTS, getPrefs, setPrefs } from './prefs.js';
import {
  drawer, esc, fmtDate, fmtRelative, icon, initials, modal, onSegment, segmented,
  toast, withBusy,
} from './ui.js';

const TABS = [
  { id: 'profil', label: 'Ma fiche', icon: 'idCard', render: renderProfile },
  { id: 'securite', label: 'Connexion & sécurité', icon: 'lock', render: renderSecurity },
  { id: 'apparence', label: 'Apparence', icon: 'palette', render: renderAppearance },
  { id: 'sessions', label: 'Appareils connectés', icon: 'devices', render: renderSessions },
];

let openPanel = null;

export function openSettings(ctx, tab = 'profil') {
  const index = Math.max(0, TABS.findIndex((entry) => entry.id === tab));

  // Déjà ouvert : on change d'onglet plutôt que d'empiler un second panneau.
  if (openPanel) {
    openPanel.select(index);
    return openPanel;
  }

  openPanel = drawer({
    title: 'Mon compte',
    sub: 'Fiche, connexion et préférences d’affichage',
    initial: index,
    onClose: () => { openPanel = null; },
    tabs: TABS.map((entry) => ({
      label: entry.label,
      icon: entry.icon,
      render: (node, panel) => entry.render(node, ctx, panel),
    })),
  });
  return openPanel;
}

/* ------------------------------------------------------------------ */
/* Onglet « Ma fiche »                                                 */
/* ------------------------------------------------------------------ */
async function renderProfile(node, ctx, panel) {
  const account = await api.get('/api/account');

  node.innerHTML = `
    <div class="id-banner">
      <span class="avatar">${esc(initials(account.full_name, account.username))}</span>
      <div class="ib-text">
        <b>${esc(account.full_name || account.username)}</b>
        <small>
          ${esc(account.job_title || (account.is_admin ? 'Administrateur' : 'Membre'))}
          · compte créé le ${esc(fmtDate(account.created_at))}
        </small>
      </div>
    </div>

    <p class="muted small mt-2 mb-2">
      Ces informations servent à savoir qui contacter au sein de l’équipe. Elles ne
      sont utilisées ni pour se connecter, ni pour envoyer quoi que ce soit :
      l’application n’émet ni courriel ni SMS.
    </p>

    <div class="grid cols-2" style="gap:15px">
      <div class="field">
        <label for="ac-first">Prénom</label>
        <div class="input-ico">
          ${icon('user')}
          <input class="input" id="ac-first" maxlength="80" autocomplete="given-name"
                 placeholder="Camille" value="${esc(account.first_name || '')}">
        </div>
      </div>

      <div class="field">
        <label for="ac-last">Nom</label>
        <div class="input-ico">
          ${icon('user')}
          <input class="input" id="ac-last" maxlength="80" autocomplete="family-name"
                 placeholder="Martin" value="${esc(account.last_name || '')}">
        </div>
      </div>

      <div class="field">
        <label for="ac-job">Intitulé de poste</label>
        <div class="input-ico">
          ${icon('briefcase')}
          <input class="input" id="ac-job" maxlength="120" autocomplete="organization-title"
                 placeholder="RSSI" value="${esc(account.job_title || '')}">
        </div>
      </div>

      <div class="field">
        <label for="ac-mail">Adresse électronique</label>
        <div class="input-ico">
          ${icon('mail')}
          <input class="input" id="ac-mail" type="email" maxlength="200" autocomplete="email"
                 placeholder="prenom.nom@exemple.fr" value="${esc(account.email || '')}">
        </div>
      </div>

      <div class="field">
        <label for="ac-phone">Téléphone</label>
        <div class="input-ico">
          ${icon('phone')}
          <input class="input" id="ac-phone" type="tel" maxlength="40" autocomplete="tel"
                 placeholder="+33 6 12 34 56 78" value="${esc(account.phone || '')}">
        </div>
      </div>
    </div>

    <p class="help mt-2">Tous ces champs sont facultatifs : laisser vide n’associe rien.</p>

    <div class="flex between mt-3" style="gap:12px;flex-wrap:wrap">
      <span class="dim small">
        ${account.last_login_at
          ? `Dernière connexion ${esc(fmtRelative(account.last_login_at))}`
          : 'Première session'}
      </span>
      <button class="btn primary" data-save>${icon('save')}Enregistrer la fiche</button>
    </div>`;

  node.querySelector('[data-save]').addEventListener('click', (event) =>
    withBusy(event.currentTarget, async () => {
      const payload = {
        first_name: node.querySelector('#ac-first').value,
        last_name: node.querySelector('#ac-last').value,
        job_title: node.querySelector('#ac-job').value,
        email: node.querySelector('#ac-mail').value,
        phone: node.querySelector('#ac-phone').value,
      };
      try {
        await api.patch('/api/account', payload);
        // La barre supérieure porte le nom et l'avatar : elle doit suivre
        // immédiatement, sans attendre un rechargement de page.
        ctx.setSession(await api.get('/api/auth/status'));
        toast('Fiche enregistrée', '', 'ok');
        panel.reload();
      } catch (error) {
        toast('Enregistrement impossible', error.message, 'error');
      }
    }));
}

/* ------------------------------------------------------------------ */
/* Onglet « Connexion & sécurité »                                     */
/* ------------------------------------------------------------------ */
async function renderSecurity(node, ctx, panel) {
  const account = await api.get('/api/account');
  const enabled = account.mfa_enabled;
  const remaining = account.recovery_codes_remaining;
  const low = enabled && remaining <= 2;
  const reload = () => panel.reload();

  node.innerHTML = `
    <div class="callout ${enabled ? (low ? 'warn' : 'ok') : 'warn'}">
      ${icon(enabled && !low ? 'shieldCheck' : 'alert')}
      <div>
        <p><b>${enabled
          ? (low
            ? `Second facteur actif, mais plus que ${remaining} code${remaining > 1 ? 's' : ''} de récupération`
            : 'Ce compte est protégé par une vérification en deux étapes')
          : 'Ce compte n’est protégé que par son mot de passe'}</b></p>
        <p class="muted small mt-1">
          ${enabled
            ? 'Un code temporaire vous est demandé à chaque nouvelle connexion.'
            : 'Un mot de passe volé suffirait à entrer. La vérification en deux étapes ajoute un code généré par votre téléphone, hors ligne.'}
        </p>
      </div>
    </div>

    <div class="setting mt-2">
      <div class="setting-text">
        <b>Vérification en deux étapes</b>
        <p>
          ${enabled
            ? `Application d’authentification associée${account.mfa_enabled_at
              ? ` le ${esc(fmtDate(account.mfa_enabled_at))}` : ''}.
               ${remaining} code${remaining > 1 ? 's' : ''} de récupération restant${remaining > 1 ? 's' : ''}.`
            : 'Vous décidez de l’activer : rien ne vous y oblige, mais c’est vivement recommandé pour un outil qui contient les configurations de sécurité de vos clients.'}
        </p>
      </div>
      <div class="setting-control flex" style="gap:8px;flex-wrap:wrap">
        ${enabled
          ? `<button class="btn" data-regen>${icon('refresh')}Nouveaux codes</button>
             <button class="btn danger" data-disable>${icon('slash')}Désactiver</button>`
          : `<button class="btn primary" data-enable>${icon('lock')}Activer</button>`}
      </div>
    </div>

    <div class="setting">
      <div class="setting-text">
        <b>Mot de passe</b>
        <p>
          Le mot de passe actuel est demandé, et vos autres sessions sont fermées :
          un accès resté ouvert ailleurs ne doit pas survivre au changement.
        </p>
      </div>
      <div class="setting-control">
        <button class="btn" data-password>${icon('key')}Changer le mot de passe</button>
      </div>
    </div>

    <div class="setting">
      <div class="setting-text">
        <b>Détail et méthodes disponibles</b>
        <p>Applications compatibles, codes de récupération, clés d’accès.</p>
      </div>
      <div class="setting-control">
        <a class="btn ghost" href="#/security" data-goto>Ouvrir la page Sécurité ${icon('chevronRight')}</a>
      </div>
    </div>`;

  node.querySelector('[data-enable]')?.addEventListener('click', () => enrollMfa(ctx, reload));
  node.querySelector('[data-disable]')?.addEventListener('click', () => disableMfa(ctx, reload));
  node.querySelector('[data-regen]')?.addEventListener('click', () => regenerateMfaCodes(ctx, reload));
  node.querySelector('[data-password]').addEventListener('click', () => passwordDialog(reload));
  node.querySelector('[data-goto]').addEventListener('click', () => panel.close());
}

/* Changement de mot de passe : ancien + nouveau + confirmation. La saisie en
   double évite d'enfermer quelqu'un dehors sur une faute de frappe. */
function passwordDialog(onDone) {
  const dialog = modal({
    title: 'Changer le mot de passe',
    sub: 'Vos autres sessions seront fermées',
    body: `
      <div class="field">
        <label for="pw-old">Mot de passe actuel</label>
        <input class="input" id="pw-old" type="password" autocomplete="current-password">
      </div>
      <div class="field">
        <label for="pw-new">Nouveau mot de passe</label>
        <input class="input" id="pw-new" type="password" autocomplete="new-password" minlength="8">
        <span class="help">8 caractères minimum. Une phrase longue vaut mieux qu’un mot court et tordu.</span>
      </div>
      <div class="field">
        <label for="pw-rep">Confirmer le nouveau mot de passe</label>
        <input class="input" id="pw-rep" type="password" autocomplete="new-password">
        <span class="err" id="pw-err" hidden>Les deux saisies diffèrent.</span>
      </div>`,
    foot: `
      <button class="btn" data-close>Annuler</button>
      <button class="btn primary" data-confirm>${icon('save')}Changer le mot de passe</button>`,
  });

  const oldInput = dialog.root.querySelector('#pw-old');
  const newInput = dialog.root.querySelector('#pw-new');
  const repInput = dialog.root.querySelector('#pw-rep');
  const error = dialog.root.querySelector('#pw-err');

  repInput.addEventListener('input', () => {
    error.hidden = !repInput.value || repInput.value === newInput.value;
  });

  dialog.root.querySelector('[data-confirm]').addEventListener('click', (event) =>
    withBusy(event.currentTarget, async () => {
      if (newInput.value.length < 8) {
        toast('Mot de passe trop court', '8 caractères minimum.', 'warn');
        return;
      }
      if (newInput.value !== repInput.value) {
        error.hidden = false;
        return;
      }
      try {
        const result = await api.post('/api/account/password', {
          current_password: oldInput.value,
          new_password: newInput.value,
        });
        dialog.close();
        toast('Mot de passe changé',
          result.revoked_sessions
            ? `${result.revoked_sessions} autre(s) session(s) fermée(s).`
            : 'Aucune autre session n’était ouverte.',
          'ok');
        onDone?.();
      } catch (err) {
        toast('Changement refusé', err.message, 'error');
        oldInput.value = '';
        oldInput.focus();
      }
    }));
}

/* ------------------------------------------------------------------ */
/* Onglet « Apparence »                                                */
/* ------------------------------------------------------------------ */
/* Seul onglet à ne rien demander au serveur pour s'afficher : les préférences
   sont déjà en mémoire, et chaque réglage s'applique immédiatement. */
function renderAppearance(node) {
  const prefs = getPrefs();

  node.innerHTML = `
    <p class="muted small mb-2">
      Ces réglages sont enregistrés sur votre compte : vous les retrouverez sur
      n’importe quel poste, sans les refaire.
    </p>

    <div class="setting">
      <div class="setting-text">
        <b>Thème</b>
        <p>« Automatique » suit le réglage clair/sombre de votre système d’exploitation.</p>
      </div>
      <div class="setting-control">
        ${segmented('theme', [
          { value: 'auto', label: 'Auto', icon: 'monitor' },
          { value: 'light', label: 'Clair', icon: 'sun' },
          { value: 'dark', label: 'Sombre', icon: 'moon' },
        ], prefs.theme)}
      </div>
    </div>

    <div class="setting">
      <div class="setting-text">
        <b>Teinte de l’interface</b>
        <p>
          Boutons, liens et éléments actifs. Les couleurs des graphiques ne changent
          pas : une valeur ne doit pas changer de sens parce qu’on a changé de teinte.
        </p>
      </div>
      <div class="setting-control">
        <div class="swatches" data-accents>
          ${ACCENTS.map((accent) => `
            <button type="button" class="swatch${accent.value === prefs.accent ? ' active' : ''}"
                    data-accent="${accent.value}" title="${esc(accent.label)}"
                    aria-label="${esc(accent.label)}"
                    aria-pressed="${accent.value === prefs.accent ? 'true' : 'false'}"
                    style="--sw-1:${accent.from};--sw-2:${accent.to}"><i></i></button>`).join('')}
        </div>
      </div>
    </div>

    <div class="setting">
      <div class="setting-text">
        <b>Densité</b>
        <p>« Compact » resserre les marges et réduit légèrement le texte : plus de lignes visibles d’un coup.</p>
      </div>
      <div class="setting-control">
        ${segmented('density', [
          { value: 'confort', label: 'Confort', icon: 'rows' },
          { value: 'compact', label: 'Compact', icon: 'sliders' },
        ], prefs.density)}
      </div>
    </div>

    <div class="setting">
      <div class="setting-text">
        <b>Animations</b>
        <p>
          « Réduites » supprime transitions et apparitions. Le réglage système
          « mouvement réduit » est de toute façon respecté.
        </p>
      </div>
      <div class="setting-control">
        ${segmented('motion', [
          { value: 'full', label: 'Complètes', icon: 'waves' },
          { value: 'reduced', label: 'Réduites', icon: 'slash' },
        ], prefs.motion)}
      </div>
    </div>

    <div class="setting">
      <div class="setting-text">
        <b>Barre latérale</b>
        <p>Réduite, elle ne montre que les icônes ; le libellé apparaît au survol.</p>
      </div>
      <div class="setting-control">
        ${segmented('sidebar', [
          { value: 'expanded', label: 'Déployée', icon: 'panelRight' },
          { value: 'collapsed', label: 'Réduite', icon: 'panelLeft' },
        ], prefs.sidebar)}
      </div>
    </div>`;

  onSegment(node, 'theme', (value) => setPrefs({ theme: value }));
  onSegment(node, 'density', (value) => setPrefs({ density: value }));
  onSegment(node, 'motion', (value) => setPrefs({ motion: value }));
  onSegment(node, 'sidebar', (value) => {
    setPrefs({ sidebar: value });
    // Le bouton de la barre porte un libellé et un état pressé : il doit
    // refléter le changement décidé ici.
    window.dispatchEvent(new CustomEvent('shell:rail-sync'));
  });

  node.querySelector('[data-accents]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-accent]');
    if (!button) return;
    setPrefs({ accent: button.dataset.accent });
    node.querySelectorAll('[data-accent]').forEach((node2) => {
      const on = node2 === button;
      node2.classList.toggle('active', on);
      node2.setAttribute('aria-pressed', String(on));
    });
  });
}

/* ------------------------------------------------------------------ */
/* Onglet « Appareils connectés »                                      */
/* ------------------------------------------------------------------ */
async function renderSessions(node, _ctx, panel) {
  const account = await api.get('/api/account');
  const others = account.sessions.filter((session) => !session.current).length;

  node.innerHTML = `
    <p class="muted small mb-2">
      Une session est ouverte par navigateur et par poste. L’application
      n’enregistre ni le nom de l’appareil ni son adresse : seules les dates de
      la session sont connues — annoncer un « iPhone à Paris » serait une
      invention.
    </p>

    <div class="card">
      <div class="card-head">
        <h2>${account.sessions.length} session${account.sessions.length > 1 ? 's' : ''} ouverte${account.sessions.length > 1 ? 's' : ''}</h2>
        ${others
          ? `<span class="badge warn">${others} ailleurs</span>`
          : '<span class="badge ok">Celle-ci uniquement</span>'}
      </div>
      <div class="card-body" style="padding-top:4px;padding-bottom:4px">
        ${account.sessions.map(sessionRow).join('') || '<p class="dim small">Aucune session.</p>'}
      </div>
    </div>

    <div class="setting mt-2">
      <div class="setting-text">
        <b>Fermer les autres sessions</b>
        <p>
          Utile après une connexion sur un poste partagé. La session courante reste
          ouverte ; toutes les autres devront se reconnecter.
        </p>
      </div>
      <div class="setting-control">
        <button class="btn danger" data-revoke ${others ? '' : 'disabled'}>
          ${icon('logOut')}Déconnecter les autres appareils
        </button>
      </div>
    </div>`;

  node.querySelector('[data-revoke]').addEventListener('click', () => {
    passwordPrompt({
      title: 'Déconnecter les autres appareils ?',
      message: `${others} session${others > 1 ? 's' : ''} ${others > 1 ? 'seront fermées' : 'sera fermée'}. `
        + 'Cette session-ci reste ouverte.',
      confirmLabel: 'Déconnecter',
      endpoint: '/api/account/sessions/revoke',
      danger: true,
      onSuccess: (result) => {
        toast('Sessions fermées', `${result.revoked_sessions} session(s) déconnectée(s).`, 'ok');
        panel.reload();
      },
    });
  });
}

function sessionRow(session) {
  return `
    <div class="session-row${session.current ? ' current' : ''}">
      <span class="sr-ico">${icon(session.current ? 'monitor' : 'devices')}</span>
      <div class="sr-main">
        <div class="row-title" style="font-size:.875rem">
          ${session.current ? 'Cet appareil' : 'Autre appareil'}
          ${session.current ? '<span class="badge accent" style="margin-left:6px">session courante</span>' : ''}
        </div>
        <div class="dim small">
          Ouverte ${esc(fmtRelative(session.created_at))}
          · expire le ${esc(fmtDate(session.expires_at, true))}
        </div>
      </div>
    </div>`;
}
