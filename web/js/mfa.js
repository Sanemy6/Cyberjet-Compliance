/* Second facteur — enrôlement, désactivation, codes de récupération.
 *
 * Partagé entre la vue « Sécurité du compte » et le panneau de réglages : les
 * deux points d'entrée doivent conduire au même dialogue, faute de quoi l'un
 * des deux finirait par prendre du retard sur l'autre.
 */

import { api } from './api.js';
import { copyText, esc, icon, modal, toast, withBusy } from './ui.js';

/* Toute opération réussie remet la session à jour avant de rendre la main :
   la pastille d'alerte de la barre supérieure doit suivre immédiatement. */
async function syncSession(ctx) {
  try {
    const status = await api.get('/api/auth/status');
    ctx.setSession(status);
    return status;
  } catch {
    return ctx.session;
  }
}

/* ------------------------------------------------------------------ */
/* Enrôlement                                                          */
/* ------------------------------------------------------------------ */
export async function enrollMfa(ctx, onDone) {
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

  const submit = (event) =>
    withBusy(event.currentTarget, async () => {
      try {
        const result = await api.post('/api/auth/mfa/totp/activate', { code: input.value });
        dialog.close();
        await syncSession(ctx);
        showRecoveryCodes(result.recovery_codes, ctx, true, onDone);
      } catch (error) {
        toast('Code refusé', error.message, 'error');
        input.value = '';
        input.focus();
      }
    });

  dialog.root.querySelector('[data-confirm]').addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && input.value.length === 6) {
      dialog.root.querySelector('[data-confirm]').click();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Codes de récupération                                               */
/* ------------------------------------------------------------------ */
export function showRecoveryCodes(codes, ctx, isFirstTime, onDone) {
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
    onClose: () => onDone?.(),
  });

  dialog.root.querySelector('[data-copy-codes]').addEventListener('click', () => copyText(text));
  dialog.root.querySelector('[data-download]').addEventListener('click', () => {
    const header = 'Codes de récupération — Cyberjet Compliance\n'
      + `Compte : ${ctx.session?.username || ''}\n`
      + 'Chaque code ne fonctionne qu\'une seule fois.\n\n';
    const blob = new Blob([header + text + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), {
      href: url, download: 'codes-recuperation-cyberjet.txt',
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

export function regenerateMfaCodes(ctx, onDone) {
  passwordPrompt({
    title: 'Régénérer les codes de récupération',
    message: 'Vos codes actuels seront immédiatement invalidés et remplacés par dix nouveaux.',
    confirmLabel: 'Régénérer',
    endpoint: '/api/auth/mfa/recovery/regenerate',
    onSuccess: async (result) => {
      await syncSession(ctx);
      showRecoveryCodes(result.recovery_codes, ctx, false, onDone);
    },
  });
}

export function disableMfa(ctx, onDone) {
  passwordPrompt({
    title: 'Désactiver la vérification en deux étapes ?',
    message: 'Votre compte ne sera plus protégé que par son mot de passe. '
      + 'Vos codes de récupération seront supprimés.',
    confirmLabel: 'Désactiver',
    endpoint: '/api/auth/mfa/disable',
    danger: true,
    onSuccess: async () => {
      toast('Vérification désactivée', 'Le compte n’est plus protégé que par son mot de passe.',
        'warn', 6000);
      await syncSession(ctx);
      onDone?.();
    },
  });
}

/* Confirmation par mot de passe : une session ouverte ne doit pas suffire à
   retirer ou contourner le second facteur. */
export function passwordPrompt({
  title, message, confirmLabel, endpoint, onSuccess, danger = false, payload = {},
}) {
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
        const result = await api.post(endpoint, { ...payload, password: input.value });
        dialog.close();
        await onSuccess(result);
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
