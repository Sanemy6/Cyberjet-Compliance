/* Sécurité du compte : activation et gestion du second facteur. */

import { api } from '../api.js';
import { copyText, esc, fmtDate, icon, modal, toast, withBusy } from '../ui.js';

export default async function security(node, ctx) {
  ctx.setCrumb([{ label: 'Sécurité du compte' }]);
  ctx.setActions('');

  const status = await api.get('/api/auth/status');
  ctx.setSession(status);
  draw(node, ctx, status);
}

function draw(node, ctx, status) {
  const enabled = status.mfa_enabled;
  const remaining = status.recovery_codes_remaining;
  const lowCodes = enabled && remaining <= 2;

  node.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Sécurité du compte</h1>
        <p class="sub">
          Connecté en tant que <b>${esc(status.username)}</b>${status.is_admin ? ' · administrateur' : ''}.
        </p>
      </div>
    </div>

    <div class="grid side">
      <div class="flex col" style="gap:16px">
        <div class="card">
          <div class="card-head">
            <h2>Vérification en deux étapes</h2>
            ${enabled
              ? '<span class="badge ok">' + icon('shieldCheck') + 'Activée</span>'
              : '<span class="badge warn">' + icon('alert') + 'Non activée</span>'}
          </div>
          <div class="card-body">
            ${enabled ? activeBlock(status, remaining) : inactiveBlock()}
          </div>
          <div class="card-foot" style="justify-content:flex-start">
            ${enabled
              ? `<button class="btn" data-regen>${icon('refresh')}Régénérer les codes de récupération</button>
                 <button class="btn danger" data-disable>${icon('slash')}Désactiver</button>`
              : `<button class="btn primary" data-enable>${icon('lock')}Activer la vérification en deux étapes</button>`}
          </div>
        </div>

        ${lowCodes ? `
          <div class="callout danger">
            ${icon('alert')}
            <div>
              <p><b>Il ne vous reste que ${remaining} code${remaining > 1 ? 's' : ''} de récupération.</b></p>
              <p class="muted small mt-1">
                Sans code valide et sans accès à votre téléphone, seul un administrateur
                pourra rétablir votre accès. Régénérez-en un jeu complet dès maintenant.
              </p>
            </div>
          </div>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><h2>À propos des méthodes</h2></div>
        <div class="card-body flex col" style="gap:14px">
          ${method('shieldCheck', 'Application d’authentification',
            'Google Authenticator, Microsoft Authenticator, Authy, 1Password, Bitwarden… '
            + 'Le code change toutes les 30 secondes et se calcule hors ligne : aucun SMS, '
            + 'aucun réseau requis.', true)}
          ${method('key', 'Codes de récupération',
            'Dix codes à usage unique, à conserver hors de l’ordinateur (coffre-fort de mots '
            + 'de passe ou impression rangée). C’est votre seule porte de sortie si vous '
            + 'perdez votre téléphone.', true)}
          ${method('user', 'Clé d’accès (passkey, biométrie)',
            'Indisponible pour l’instant : le navigateur n’autorise les clés d’accès que sur '
            + 'une connexion HTTPS. Cette application est servie en HTTP sur le réseau local. '
            + 'Mettre un certificat en place débloquerait cette méthode.', false)}
        </div>
      </div>
    </div>`;

  node.querySelector('[data-enable]')?.addEventListener('click', () => enrollDialog(ctx));
  node.querySelector('[data-disable]')?.addEventListener('click', () => disableDialog(ctx));
  node.querySelector('[data-regen]')?.addEventListener('click', () => regenerateDialog(ctx));
}

function activeBlock(status, remaining) {
  // Pas de repli sur la date du jour : afficher une date fabriquée serait pire
  // que ne rien afficher, sur un écran de sécurité.
  const since = status.mfa_enabled_at
    ? ` depuis le <b>${esc(fmtDate(status.mfa_enabled_at))}</b>`
    : '';
  return `
    <p class="muted">
      Une application d’authentification est associée à ce compte${since}.
      Un code vous est demandé à chaque nouvelle connexion.
    </p>
    <div class="flex wrap mt-2" style="gap:8px">
      <span class="badge ${remaining <= 2 ? 'danger' : 'ok'}">
        ${icon('key')}${remaining} code${remaining > 1 ? 's' : ''} de récupération restant${remaining > 1 ? 's' : ''}
      </span>
    </div>`;
}

function inactiveBlock() {
  return `
    <p class="muted">
      Votre compte n’est protégé que par son mot de passe. La vérification en deux
      étapes ajoute un code temporaire généré par votre téléphone : un mot de passe
      volé ne suffit alors plus à entrer.
    </p>
    <p class="muted small mt-2">
      Particulièrement recommandé ici : cette application contient les configurations
      de sécurité de vos clients.
    </p>`;
}

function method(iconName, title, text, available) {
  return `
    <div class="flex" style="align-items:flex-start;gap:11px;${available ? '' : 'opacity:.62'}">
      <span class="stat-ico" style="position:static;flex:none">${icon(iconName)}</span>
      <div>
        <div class="row-title" style="font-size:.88rem">
          ${esc(title)}
          ${available ? '' : '<span class="badge outline" style="margin-left:6px">Indisponible</span>'}
        </div>
        <p class="muted" style="font-size:.79rem;margin-top:2px">${esc(text)}</p>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Enrôlement                                                          */
/* ------------------------------------------------------------------ */
async function enrollDialog(ctx) {
  let setup;
  try {
    setup = await api.post('/api/auth/mfa/totp/init');
  } catch (error) {
    toast('Impossible de démarrer la configuration', error.message, 'error');
    return;
  }

  const dialog = modal({
    title: 'Activer la vérification en deux étapes',
    sub: 'Étape 1 sur 2 — associer votre application',
    wide: true,
    body: `
      <div class="enroll">
        <div class="enroll-qr">${setup.qr_svg}</div>
        <div class="enroll-steps">
          <p><b>1.</b> Ouvrez votre application d’authentification (Google Authenticator,
             Microsoft Authenticator, Authy, 1Password…).</p>
          <p class="mt-1"><b>2.</b> Scannez ce QR code.</p>
          <details class="mt-1">
            <summary class="small muted" style="cursor:pointer">Impossible de scanner ?</summary>
            <p class="small muted mt-1">Saisissez cette clé manuellement dans l’application :</p>
            <div class="secret-box mt-1">
              <span class="mono">${esc(setup.secret)}</span>
              <button class="icon-btn sm" data-copy-secret title="Copier">${icon('copy')}</button>
            </div>
          </details>
          <p class="mt-2"><b>3.</b> Saisissez le code à 6 chiffres affiché :</p>
          <div class="field mt-1">
            <input class="input code-input" id="enroll-code" inputmode="numeric"
                   autocomplete="one-time-code" maxlength="6" placeholder="000000">
          </div>
        </div>
      </div>`,
    foot: `
      <button class="btn" data-close>Annuler</button>
      <button class="btn primary" data-confirm>${icon('check')}Vérifier et activer</button>`,
  });

  const input = dialog.root.querySelector('#enroll-code');
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
  });
  setTimeout(() => input.focus(), 80);

  dialog.root.querySelector('[data-copy-secret]').addEventListener('click', () =>
    copyText(setup.secret.replace(/\s/g, '')));

  dialog.root.querySelector('[data-confirm]').addEventListener('click', (event) =>
    withBusy(event.currentTarget, async () => {
      try {
        const result = await api.post('/api/auth/mfa/totp/activate', { code: input.value });
        dialog.close();
        showRecoveryCodes(result.recovery_codes, ctx, true);
      } catch (error) {
        toast('Code refusé', error.message, 'error');
        input.value = '';
        input.focus();
      }
    }));
}

/* ------------------------------------------------------------------ */
/* Codes de récupération                                               */
/* ------------------------------------------------------------------ */
function showRecoveryCodes(codes, ctx, isFirstTime) {
  const text = codes.join('\n');
  const dialog = modal({
    title: isFirstTime ? 'Vérification activée' : 'Nouveaux codes de récupération',
    sub: 'Étape 2 sur 2 — conservez ces codes maintenant',
    body: `
      <div class="callout danger">
        ${icon('alert')}
        <div>
          <p><b>Ces codes ne seront plus jamais affichés.</b></p>
          <p class="muted small mt-1">
            Seules leurs empreintes sont conservées : personne, pas même un administrateur,
            ne peut les retrouver. Sans eux et sans votre téléphone, votre accès devra être
            rétabli par un administrateur.
          </p>
        </div>
      </div>
      <div class="recovery-grid">
        ${codes.map((code) => `<span class="recovery-code mono">${esc(code)}</span>`).join('')}
      </div>
      <p class="muted small">
        Chaque code ne fonctionne qu’une seule fois. Rangez-les dans votre gestionnaire de
        mots de passe, ou imprimez-les et conservez-les hors de cet ordinateur.
      </p>`,
    foot: `
      <button class="btn" data-copy-codes>${icon('copy')}Copier</button>
      <button class="btn" data-download>${icon('download')}Télécharger</button>
      <button class="btn primary" data-close>J’ai conservé mes codes</button>`,
    onClose: () => ctx.refresh(),
  });

  dialog.root.querySelector('[data-copy-codes]').addEventListener('click', () => copyText(text));
  dialog.root.querySelector('[data-download]').addEventListener('click', () => {
    const header = 'Codes de récupération — Conformité GRC\n'
      + `Compte : ${ctx.session?.username || ''}\n`
      + 'Chaque code ne fonctionne qu\'une seule fois.\n\n';
    const blob = new Blob([header + text + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), {
      href: url, download: 'codes-recuperation-grc.txt',
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

function regenerateDialog(ctx) {
  passwordPrompt({
    title: 'Régénérer les codes de récupération',
    message: 'Vos codes actuels seront immédiatement invalidés et remplacés par dix nouveaux.',
    confirmLabel: 'Régénérer',
    endpoint: '/api/auth/mfa/recovery/regenerate',
    onSuccess: (result) => showRecoveryCodes(result.recovery_codes, ctx, false),
  });
}

function disableDialog(ctx) {
  passwordPrompt({
    title: 'Désactiver la vérification en deux étapes ?',
    message: 'Votre compte ne sera plus protégé que par son mot de passe. '
      + 'Vos codes de récupération seront supprimés.',
    confirmLabel: 'Désactiver',
    endpoint: '/api/auth/mfa/disable',
    danger: true,
    onSuccess: () => {
      toast('Vérification désactivée', 'Le compte n’est plus protégé que par son mot de passe.',
        'warn', 6000);
      ctx.refresh();
    },
  });
}

/* Confirmation par mot de passe : une session ouverte ne doit pas suffire à
   retirer ou contourner le second facteur. */
function passwordPrompt({ title, message, confirmLabel, endpoint, onSuccess, danger = false }) {
  const dialog = modal({
    title,
    body: `
      <p class="muted">${esc(message)}</p>
      <div class="field">
        <label for="pw-confirm">Confirmez avec votre mot de passe</label>
        <input class="input" id="pw-confirm" type="password" autocomplete="current-password">
      </div>`,
    foot: `
      <button class="btn" data-close>Annuler</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-confirm>${esc(confirmLabel)}</button>`,
  });

  const input = dialog.root.querySelector('#pw-confirm');
  const submit = async (event) => {
    await withBusy(event.currentTarget, async () => {
      try {
        const result = await api.post(endpoint, { password: input.value });
        dialog.close();
        onSuccess(result);
      } catch (error) {
        toast('Refusé', error.message, 'error');
        input.value = '';
        input.focus();
      }
    });
  };

  dialog.root.querySelector('[data-confirm]').addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') dialog.root.querySelector('[data-confirm]').click();
  });
}
