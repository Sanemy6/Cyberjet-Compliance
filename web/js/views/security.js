/* Sécurité du compte : état du second facteur et accès aux réglages.
 *
 * Les dialogues eux-mêmes vivent dans mfa.js — cette vue et le panneau de
 * réglages y conduisent tous les deux.
 */

import { api } from '../api.js';
import { disableMfa, enrollMfa, regenerateMfaCodes } from '../mfa.js';
import { openSettings } from '../account.js';
import { esc, fmtDate, icon } from '../ui.js';

export default async function security(node, ctx) {
  ctx.setCrumb([{ label: 'Sécurité du compte' }]);
  ctx.setActions(`
    <button class="btn" data-open-settings>${icon('sliders')}<span class="nowrap">Réglages du compte</span></button>`);

  const status = await api.get('/api/auth/status');
  ctx.setSession(status);
  draw(node, ctx, status);

  document.querySelector('[data-open-settings]')
    ?.addEventListener('click', () => openSettings(ctx, 'securite'));
}

function draw(node, ctx, status) {
  const enabled = status.mfa_enabled;
  const remaining = status.recovery_codes_remaining;
  const lowCodes = enabled && remaining <= 2;
  const refresh = () => ctx.refresh();

  node.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${icon('lock')}Mon compte</p>
        <h1>Sécurité du compte</h1>
        <p class="sub">
          Connecté en tant que <b>${esc(status.full_name || status.username)}</b>${status.is_admin ? ' · administrateur' : ''}.
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

        <div class="card">
          <div class="card-head"><h2>Mot de passe et appareils</h2></div>
          <div class="card-body">
            <p class="muted">
              Le changement de mot de passe et la liste des appareils connectés se règlent
              dans le panneau du compte, accessible aussi depuis votre avatar en haut à droite.
            </p>
          </div>
          <div class="card-foot" style="justify-content:flex-start">
            <button class="btn" data-tab="securite">${icon('key')}Changer mon mot de passe</button>
            <button class="btn" data-tab="sessions">${icon('devices')}Appareils connectés</button>
          </div>
        </div>
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

  node.querySelector('[data-enable]')?.addEventListener('click', () => enrollMfa(ctx, refresh));
  node.querySelector('[data-disable]')?.addEventListener('click', () => disableMfa(ctx, refresh));
  node.querySelector('[data-regen]')?.addEventListener('click', () => regenerateMfaCodes(ctx, refresh));
  node.querySelectorAll('[data-tab]').forEach((button) =>
    button.addEventListener('click', () => openSettings(ctx, button.dataset.tab)));
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
