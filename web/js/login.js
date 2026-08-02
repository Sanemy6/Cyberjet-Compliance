/* Page de connexion et de création du premier compte administrateur. */

import { api } from './api.js';
import { esc, icon, toast } from './ui.js';

const formRoot = document.getElementById('auth-form');

async function boot() {
  let status;
  try {
    status = await api.get('/api/auth/status');
  } catch (error) {
    formRoot.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    return;
  }

  if (status.authenticated) {
    window.location.href = '/';
    return;
  }
  if (status.needs_setup) renderSetup();
  else if (status.mfa_pending) renderMfa();
  else renderLogin();
}

function renderLogin() {
  formRoot.innerHTML = `
    <h1>Connexion</h1>
    <p class="sub mt-1">Connectez-vous pour accéder à l’application.</p>
    <form id="f" class="flex col mt-2" style="gap:14px">
      <div class="field">
        <label for="u">Identifiant</label>
        <input class="input" id="u" autocomplete="username" required autofocus>
      </div>
      <div class="field">
        <label for="p">Mot de passe</label>
        <input class="input" id="p" type="password" autocomplete="current-password" required>
      </div>
      <button class="btn primary block" type="submit">${icon('key')}Se connecter</button>
    </form>`;
  bindForm('/api/auth/login');
}

function renderSetup() {
  formRoot.innerHTML = `
    <h1>Créer le compte administrateur</h1>
    <p class="sub mt-1">
      Première ouverture de l’application sur ce poste : créez le compte qui
      administrera les accès. Vous pourrez ajouter vos collègues ensuite,
      depuis <span class="mono">Comptes</span>.
    </p>
    <form id="f" class="flex col mt-2" style="gap:14px">
      <div class="field">
        <label for="u">Identifiant</label>
        <input class="input" id="u" autocomplete="username" required minlength="3" autofocus>
      </div>
      <div class="field">
        <label for="p">Mot de passe</label>
        <input class="input" id="p" type="password" autocomplete="new-password" required minlength="8">
        <span class="help">8 caractères minimum.</span>
      </div>
      <button class="btn primary block" type="submit">${icon('shieldCheck')}Créer le compte et continuer</button>
    </form>`;
  bindForm('/api/auth/setup');
}

function bindForm(endpoint) {
  const form = document.getElementById('f');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    const original = button.innerHTML;
    button.disabled = true;
    try {
      const result = await api.post(endpoint, {
        username: document.getElementById('u').value.trim(),
        password: document.getElementById('p').value,
      });
      if (result?.mfa_required) {
        renderMfa();
        return;
      }
      window.location.href = '/';
    } catch (error) {
      toast('Connexion refusée', error.message, 'error');
      button.disabled = false;
      button.innerHTML = original;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Second facteur                                                      */
/* ------------------------------------------------------------------ */
function renderMfa(useRecovery = false) {
  formRoot.innerHTML = `
    <h1>Vérification en deux étapes</h1>
    <p class="sub mt-1">
      ${useRecovery
        ? 'Saisissez l’un de vos codes de récupération. Chaque code ne sert qu’une fois.'
        : 'Saisissez le code à 6 chiffres affiché par votre application d’authentification.'}
    </p>
    <form id="f" class="flex col mt-2" style="gap:14px">
      <div class="field">
        <label for="c">${useRecovery ? 'Code de récupération' : 'Code à 6 chiffres'}</label>
        <input class="input ${useRecovery ? 'mono' : 'code-input'}" id="c" required autofocus
               autocomplete="one-time-code" spellcheck="false"
               inputmode="${useRecovery ? 'text' : 'numeric'}"
               placeholder="${useRecovery ? 'XXXX-XXXX-XXXX' : '000000'}"
               maxlength="${useRecovery ? 14 : 6}">
      </div>
      <button class="btn primary block" type="submit">${icon('shieldCheck')}Vérifier</button>
    </form>
    <div class="flex col mt-2" style="gap:8px;align-items:stretch">
      <button class="btn ghost sm" data-toggle>
        ${useRecovery ? 'Utiliser mon application d’authentification' : 'Utiliser un code de récupération'}
      </button>
      <button class="btn ghost sm" data-cancel>Annuler et changer de compte</button>
    </div>`;

  const input = document.getElementById('c');
  if (!useRecovery) {
    // Confort de saisie : le code TOTP ne contient que des chiffres.
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
    });
  }

  document.getElementById('f').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    const original = button.innerHTML;
    button.disabled = true;
    try {
      const result = await api.post('/api/auth/mfa/verify', { code: input.value.trim() });
      if (result.recovery_codes_remaining <= 2) {
        sessionStorage.setItem('grc_recovery_warning', String(result.recovery_codes_remaining));
      }
      window.location.href = '/';
    } catch (error) {
      toast('Vérification refusée', error.message, 'error');
      button.disabled = false;
      button.innerHTML = original;
      input.value = '';
      input.focus();
    }
  });

  document.querySelector('[data-toggle]').addEventListener('click', () => renderMfa(!useRecovery));
  document.querySelector('[data-cancel]').addEventListener('click', async () => {
    try { await api.post('/api/auth/mfa/cancel'); } catch { /* on repart de zéro quoi qu'il arrive */ }
    renderLogin();
  });
}

boot();
