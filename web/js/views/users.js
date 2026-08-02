/* Gestion des comptes — réservée aux administrateurs. */

import { api } from '../api.js';
import {
  confirmDialog, emptyState, esc, fmtDate, icon, modal, toast, withBusy,
} from '../ui.js';

export default async function usersView(node, ctx) {
  ctx.setCrumb([{ label: 'Comptes' }]);

  if (!ctx.session?.is_admin) {
    node.innerHTML = `<div class="card">${emptyState({
      iconName: 'lock',
      title: 'Accès réservé',
      text: 'Seuls les administrateurs peuvent gérer les comptes qui accèdent à l’application.',
    })}</div>`;
    return;
  }

  ctx.setActions(`<button class="btn primary" data-add>${icon('plus')}<span class="nowrap">Nouveau compte</span></button>`);
  document.querySelector('[data-add]').addEventListener('click', () => userForm(null, refresh));

  let list = [];

  async function refresh() {
    try {
      list = await api.get('/api/users');
    } catch (error) {
      node.innerHTML = `<div class="card">${emptyState({
        iconName: 'alert', title: 'Chargement impossible', text: error.message,
      })}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    node.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Comptes</h1>
          <p class="sub">
            Qui peut se connecter à l’application. Toute personne connectée peut consulter
            et modifier les dossiers clients ; seuls les administrateurs gèrent les comptes.
          </p>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Identifiant</th><th>Rôle</th><th>Statut</th>
                <th>Second facteur</th>
                <th>Créé le</th><th>Dernière connexion</th><th></th>
              </tr>
            </thead>
            <tbody>${list.map(row).join('')}</tbody>
          </table>
        </div>
      </div>`;
    bindRows();
  }

  function row(u) {
    const isMe = u.username === ctx.session.username;
    return `
      <tr>
        <td><strong>${esc(u.username)}</strong>${isMe ? ' <span class="badge outline">vous</span>' : ''}</td>
        <td>${u.is_admin ? '<span class="badge accent">Administrateur</span>' : '<span class="badge">Membre</span>'}</td>
        <td>${u.active ? '<span class="badge ok">Actif</span>' : '<span class="badge outline">Désactivé</span>'}</td>
        <td>
          ${u.mfa_enabled
            ? `<span class="badge ok"${u.mfa_enabled_at ? ` title="Activé le ${esc(fmtDate(u.mfa_enabled_at))}"` : ''}>${icon('shieldCheck')}Activé</span>`
            : '<span class="badge warn">Non activé</span>'}
        </td>
        <td class="dim small">${esc(fmtDate(u.created_at))}</td>
        <td class="dim small">${u.last_login_at ? esc(fmtDate(u.last_login_at, true)) : 'jamais'}</td>
        <td class="actions">
          ${u.mfa_enabled
            ? `<button class="icon-btn sm" data-mfa-reset="${u.id}"
                       title="Réinitialiser le second facteur (téléphone perdu)">${icon('refresh')}</button>`
            : ''}
          <button class="icon-btn sm" data-edit="${u.id}" title="Modifier">${icon('edit')}</button>
          <button class="icon-btn sm" data-del="${u.id}" title="Supprimer" ${isMe ? 'disabled' : ''}>${icon('trash')}</button>
        </td>
      </tr>`;
  }

  function bindRows() {
    const byId = new Map(list.map((u) => [u.id, u]));
    node.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () =>
        userForm(byId.get(Number(btn.dataset.edit)), refresh, ctx)));
    node.querySelectorAll('[data-mfa-reset]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const target = byId.get(Number(btn.dataset.mfaReset));
        const ok = await confirmDialog({
          title: 'Réinitialiser le second facteur ?',
          message: `${target.username} ne sera plus protégé que par son mot de passe et `
            + 'devra reconfigurer son application d’authentification. À n’utiliser que '
            + 'si la personne a perdu son téléphone et ses codes de récupération — '
            + 'et après avoir vérifié son identité autrement. L’opération est journalisée.',
          confirmLabel: 'Réinitialiser',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.post(`/api/users/${target.id}/mfa/reset`);
          toast('Second facteur réinitialisé', target.username, 'ok');
          refresh();
        } catch (error) {
          toast('Réinitialisation impossible', error.message, 'error');
        }
      }));

    node.querySelectorAll('[data-del]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const target = byId.get(Number(btn.dataset.del));
        const ok = await confirmDialog({
          title: 'Supprimer ce compte ?',
          message: `${target.username} ne pourra plus se connecter à l’application.`,
          confirmLabel: 'Supprimer',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/api/users/${target.id}`);
          toast('Compte supprimé', target.username, 'ok');
          refresh();
        } catch (error) {
          toast('Suppression impossible', error.message, 'error');
        }
      }));
  }

  await refresh();
}

function userForm(user, onSaved, ctx) {
  const isEdit = Boolean(user?.id);
  const isSelf = isEdit && user.username === ctx?.session?.username;

  const dialog = modal({
    title: isEdit ? 'Modifier le compte' : 'Nouveau compte',
    sub: isEdit ? user.username : 'Donnez accès à un collègue.',
    body: `
      <div class="field">
        <label for="uf-name">Identifiant${isEdit ? '' : ' *'}</label>
        <input class="input" id="uf-name" value="${esc(user?.username || '')}"
               ${isEdit ? 'disabled' : ''} minlength="3">
      </div>
      <div class="field">
        <label for="uf-pass">${isEdit ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe *'}</label>
        <input class="input" id="uf-pass" type="password" minlength="8" autocomplete="new-password">
        <span class="help">8 caractères minimum.</span>
      </div>
      <label class="switch" style="${isSelf ? 'opacity:.5;pointer-events:none' : ''}">
        <input type="checkbox" id="uf-admin" ${user?.is_admin ? 'checked' : ''} ${isSelf ? 'disabled' : ''}>
        <span class="track"></span>
        <span>Administrateur (peut gérer les comptes)</span>
      </label>
      ${isEdit ? `
      <label class="switch" style="${isSelf ? 'opacity:.5;pointer-events:none' : ''}">
        <input type="checkbox" id="uf-active" ${user.active ? 'checked' : ''} ${isSelf ? 'disabled' : ''}>
        <span class="track"></span>
        <span>Compte actif</span>
      </label>` : ''}
      ${isSelf ? '<p class="dim small">Vous ne pouvez pas modifier vos propres droits ou désactiver votre propre compte.</p>' : ''}`,
    foot: `
      <button class="btn" data-close>Annuler</button>
      <button class="btn primary" data-save>${icon('save')}${isEdit ? 'Enregistrer' : 'Créer le compte'}</button>`,
  });

  dialog.root.querySelector('[data-save]').addEventListener('click', (event) =>
    withBusy(event.currentTarget, async () => {
      const password = dialog.root.querySelector('#uf-pass').value;
      const isAdmin = dialog.root.querySelector('#uf-admin').checked;

      try {
        if (isEdit) {
          const payload = {};
          if (!isSelf) {
            payload.is_admin = isAdmin;
            payload.active = dialog.root.querySelector('#uf-active').checked;
          }
          if (password) payload.password = password;
          await api.patch(`/api/users/${user.id}`, payload);
        } else {
          const username = dialog.root.querySelector('#uf-name').value.trim();
          if (username.length < 3 || password.length < 8) {
            toast('Champs invalides',
              'Identifiant (3 caractères min.) et mot de passe (8 caractères min.) requis.', 'warn');
            return;
          }
          await api.post('/api/users', { username, password, is_admin: isAdmin });
        }
        dialog.close();
        toast(isEdit ? 'Compte mis à jour' : 'Compte créé', '', 'ok');
        onSaved?.();
      } catch (error) {
        toast('Enregistrement impossible', error.message, 'error');
      }
    }));
}
