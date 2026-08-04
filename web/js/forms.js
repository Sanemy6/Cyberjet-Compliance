/* Formulaires partagés : client, entrée de base de connaissance, configuration. */

import { api } from './api.js';
import {
  CLIENT_STATUSES, confirmDialog, debounce, esc, icon, modal, toast, withBusy,
} from './ui.js';

let metaCache = null;
export async function meta() {
  if (!metaCache) metaCache = await api.get('/api/meta');
  return metaCache;
}

function options(values, selected) {
  return values
    .map((value) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(value)}</option>`)
    .join('');
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */
export async function clientForm(client, onSaved) {
  const isEdit = Boolean(client?.id);

  const dialog = modal({
    title: isEdit ? 'Modifier le client' : 'Nouveau client',
    sub: isEdit ? client.name : 'Créez le dossier de conformité d’un client.',
    body: `
      <div class="field">
        <label for="f-name">Nom du client *</label>
        <input class="input" id="f-name" value="${esc(client?.name || '')}" placeholder="Ex. Nordic Wings Airlines" maxlength="200">
      </div>
      <div class="grid cols-2" style="gap:14px">
        <div class="field">
          <label for="f-country">Pays</label>
          <input class="input" id="f-country" value="${esc(client?.country || '')}" placeholder="France">
        </div>
        <div class="field">
          <label for="f-contact">Contact principal</label>
          <input class="input" id="f-contact" value="${esc(client?.contact || '')}" placeholder="Nom, fonction, e-mail">
        </div>
      </div>
      <div class="field">
        <label for="f-desc">Contexte et périmètre</label>
        <textarea class="textarea" id="f-desc" placeholder="Référentiels applicables, périmètre certifié, particularités…">${esc(client?.description || '')}</textarea>
      </div>
      <div class="field">
        <label for="f-status">Statut</label>
        <select class="select" id="f-status">
          ${options(CLIENT_STATUSES, client?.status || 'actif')}
        </select>
        <p class="dim small mt-1">Prospect : dossier ouvert avant signature du contrat.</p>
      </div>`,
    foot: `
      <button class="btn" data-close>Annuler</button>
      <button class="btn primary" data-save>${icon('save')}${isEdit ? 'Enregistrer' : 'Créer le client'}</button>`,
  });

  const value = (id) => dialog.root.querySelector(`#${id}`)?.value.trim() || '';
  dialog.root.querySelector('[data-save]').addEventListener('click', (event) =>
    withBusy(event.currentTarget, async () => {
      const payload = {
        name: value('f-name'),
        country: value('f-country') || null,
        contact: value('f-contact') || null,
        description: value('f-desc') || null,
        status: value('f-status') || 'actif',
      };
      if (!payload.name) {
        toast('Nom obligatoire', 'Renseignez le nom du client.', 'warn');
        return;
      }
      try {
        const saved = isEdit
          ? await api.put(`/api/clients/${client.id}`, payload)
          : await api.post('/api/clients', payload);
        dialog.close();
        toast(isEdit ? 'Client mis à jour' : 'Client créé', saved.name, 'ok');
        onSaved?.(saved);
      } catch (error) {
        toast('Enregistrement impossible', error.message, 'error');
      }
    }));
}

/* ------------------------------------------------------------------ */
/* Sélecteur de contrôles normatifs                                     */
/* ------------------------------------------------------------------ */
function controlPicker(container, initial = []) {
  const selected = new Map(initial.map((c) => [c.id, c]));

  container.innerHTML = `
    <div class="search-box" style="margin-bottom:8px">
      ${icon('search')}
      <input class="input" data-cp-search placeholder="Rechercher un contrôle : IS.I.OR.205, A.8.24, chiffrement…">
    </div>
    <div data-cp-selected class="chips" style="margin-bottom:8px"></div>
    <div data-cp-results style="max-height:190px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r-sm)"></div>`;

  const selectedNode = container.querySelector('[data-cp-selected]');
  const resultsNode = container.querySelector('[data-cp-results]');
  const searchNode = container.querySelector('[data-cp-search]');

  function drawSelected() {
    if (!selected.size) {
      selectedNode.innerHTML = '<span class="dim small">Aucun contrôle rattaché.</span>';
      return;
    }
    selectedNode.innerHTML = [...selected.values()]
      .map((c) => `
        <span class="chip on" title="${esc(c.title || '')}">
          <b>${esc(c.framework_code)}</b> ${esc(c.ref)}
          <span class="x" data-remove="${c.id}">${icon('x')}</span>
        </span>`)
      .join('');
    selectedNode.querySelectorAll('[data-remove]').forEach((node) =>
      node.addEventListener('click', () => {
        selected.delete(Number(node.dataset.remove));
        drawSelected();
      }));
  }

  async function search(term) {
    const list = await api.get('/api/controls', { q: term, limit: 60 });
    resultsNode.innerHTML = list.length
      ? list.map((c) => `
          <div class="row-item clickable" data-add='${esc(JSON.stringify(c))}' style="padding:8px 12px">
            <div class="row-main">
              <div class="flex" style="gap:7px">
                <span class="badge ref"><b>${esc(c.framework_code)}</b> ${esc(c.ref)}</span>
                <span class="small">${esc(c.title)}</span>
              </div>
            </div>
            ${icon('plus')}
          </div>`).join('')
      : '<p class="dim small" style="padding:12px">Aucun contrôle trouvé.</p>';

    resultsNode.querySelectorAll('[data-add]').forEach((node) =>
      node.addEventListener('click', () => {
        const control = JSON.parse(node.dataset.add);
        selected.set(control.id, control);
        drawSelected();
      }));
  }

  searchNode.addEventListener('input', debounce((event) => search(event.target.value), 220));
  drawSelected();
  search('');

  return () => [...selected.keys()];
}

/* ------------------------------------------------------------------ */
/* Entrée de base de connaissance                                       */
/* ------------------------------------------------------------------ */
export async function kbForm({ entry, clientId = null, clientList = [], onSaved }) {
  const m = await meta();
  const isEdit = Boolean(entry?.id);
  const currentClient = isEdit ? entry.client_id : clientId;

  const clientOptions = [
    `<option value=""${currentClient === null ? ' selected' : ''}>Générique — réutilisable pour tous les clients</option>`,
    ...clientList.map((c) =>
      `<option value="${c.id}"${Number(currentClient) === c.id ? ' selected' : ''}>${esc(c.name)}</option>`),
  ].join('');

  const dialog = modal({
    title: isEdit ? 'Modifier la réponse' : 'Nouvelle réponse',
    sub: 'Une question récurrente et la réponse de référence à réutiliser.',
    wide: true,
    body: `
      <div class="field">
        <label for="k-question">Question de référence *</label>
        <textarea class="textarea" id="k-question" style="min-height:64px" placeholder="Ex. Quels mécanismes de chiffrement protègent les données au repos ?">${esc(entry?.question || '')}</textarea>
        <span class="help">Formulez-la comme un client la poserait. Le moteur rapproche les questions par le sens, pas par les mots exacts.</span>
      </div>
      <div class="field">
        <label for="k-answer">Réponse de référence *</label>
        <textarea class="textarea" id="k-answer" style="min-height:150px" placeholder="Réponse complète, réutilisable telle quelle dans un questionnaire client.">${esc(entry?.answer || '')}</textarea>
      </div>
      <div class="grid cols-3" style="gap:14px">
        <div class="field">
          <label for="k-client">Portée</label>
          <select class="select" id="k-client">${clientOptions}</select>
        </div>
        <div class="field">
          <label for="k-category">Catégorie</label>
          <select class="select" id="k-category">${options(m.categories, entry?.category || 'Général')}</select>
        </div>
        <div class="field">
          <label for="k-status">Statut</label>
          <select class="select" id="k-status">
            <option value="validated"${entry?.status === 'validated' || !entry ? ' selected' : ''}>Validée</option>
            <option value="draft"${entry?.status === 'draft' ? ' selected' : ''}>Brouillon</option>
            <option value="obsolete"${entry?.status === 'obsolete' ? ' selected' : ''}>Obsolète</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="k-tags">Mots-clés</label>
        <input class="input" id="k-tags" value="${esc(entry?.tags || '')}" placeholder="chiffrement, TLS, AES, données au repos">
        <span class="help">Séparés par des virgules. Ils élargissent le rapprochement sémantique.</span>
      </div>
      <div class="grid cols-2" style="gap:14px">
        <div class="field">
          <label for="k-evidence">Preuve associée</label>
          <input class="input" id="k-evidence" value="${esc(entry?.evidence || '')}" placeholder="Politique de chiffrement v2.1, § 4">
        </div>
        <div class="field">
          <label for="k-source">Source</label>
          <input class="input" id="k-source" value="${esc(entry?.source || '')}" placeholder="Entretien RSSI, audit interne 2025…">
        </div>
      </div>
      <div class="field">
        <label>Contrôles normatifs couverts</label>
        <div data-picker></div>
      </div>`,
    foot: `
      <button class="btn" data-close>Annuler</button>
      <button class="btn primary" data-save>${icon('save')}${isEdit ? 'Enregistrer' : 'Ajouter à la base'}</button>`,
  });

  const getControlIds = controlPicker(dialog.root.querySelector('[data-picker]'), entry?.controls || []);
  const value = (id) => dialog.root.querySelector(`#${id}`).value.trim();

  dialog.root.querySelector('[data-save]').addEventListener('click', (event) =>
    withBusy(event.currentTarget, async () => {
      const clientValue = dialog.root.querySelector('#k-client').value;
      const payload = {
        client_id: clientValue ? Number(clientValue) : null,
        question: value('k-question'),
        answer: value('k-answer'),
        category: value('k-category'),
        tags: value('k-tags'),
        status: value('k-status'),
        evidence: value('k-evidence') || null,
        source: value('k-source') || null,
        control_ids: getControlIds(),
      };
      if (!payload.question || !payload.answer) {
        toast('Champs obligatoires', 'La question et la réponse sont requises.', 'warn');
        return;
      }
      try {
        const saved = isEdit
          ? await api.put(`/api/kb/${entry.id}`, payload)
          : await api.post('/api/kb', payload);
        dialog.close();
        toast(isEdit ? 'Réponse mise à jour' : 'Réponse ajoutée', '', 'ok');
        onSaved?.(saved);
      } catch (error) {
        toast('Enregistrement impossible', error.message, 'error');
      }
    }));
}

export async function deleteKb(entry, onDone) {
  const ok = await confirmDialog({
    title: 'Supprimer cette réponse ?',
    message: 'Elle ne sera plus proposée lors du traitement des questionnaires. Cette action est définitive.',
    confirmLabel: 'Supprimer',
    danger: true,
  });
  if (!ok) return;
  await api.del(`/api/kb/${entry.id}`);
  toast('Réponse supprimée', '', 'ok');
  onDone?.();
}

/* ------------------------------------------------------------------ */
/* Configuration technique client                                       */
/* ------------------------------------------------------------------ */
export async function configForm({ config, clientId, onSaved }) {
  const m = await meta();
  const isEdit = Boolean(config?.id);

  const dialog = modal({
    title: isEdit ? 'Modifier la configuration' : 'Nouvelle configuration technique',
    sub: 'Un fait technique précis, réutilisé automatiquement dans les réponses.',
    body: `
      <div class="grid cols-2" style="gap:14px">
        <div class="field">
          <label for="c-category">Catégorie</label>
          <select class="select" id="c-category">${options(m.config_categories, config?.category || 'Chiffrement')}</select>
        </div>
        <div class="field">
          <label for="c-status">État</label>
          <select class="select" id="c-status">${options(m.config_statuses, config?.status || 'en place')}</select>
        </div>
      </div>
      <div class="field">
        <label for="c-label">Élément *</label>
        <input class="input" id="c-label" value="${esc(config?.label || '')}" placeholder="Ex. Chiffrement des données au repos">
      </div>
      <div class="field">
        <label for="c-value">Valeur *</label>
        <input class="input" id="c-value" value="${esc(config?.value || '')}" placeholder="Ex. AES-256-GCM (chiffrement de volume et base de données)">
      </div>
      <div class="field">
        <label for="c-details">Précisions</label>
        <textarea class="textarea" id="c-details" placeholder="Gestion des clés, rotation, module matériel, exceptions…">${esc(config?.details || '')}</textarea>
      </div>
      <div class="field">
        <label for="c-scope">Périmètre</label>
        <input class="input" id="c-scope" value="${esc(config?.scope || '')}" placeholder="Ex. Ensemble des environnements de production Azure West Europe">
      </div>`,
    foot: `
      <button class="btn" data-close>Annuler</button>
      <button class="btn primary" data-save>${icon('save')}${isEdit ? 'Enregistrer' : 'Ajouter'}</button>`,
  });

  const value = (id) => dialog.root.querySelector(`#${id}`).value.trim();
  dialog.root.querySelector('[data-save]').addEventListener('click', (event) =>
    withBusy(event.currentTarget, async () => {
      const payload = {
        client_id: Number(clientId ?? config.client_id),
        category: value('c-category'),
        label: value('c-label'),
        value: value('c-value'),
        details: value('c-details') || null,
        scope: value('c-scope') || null,
        status: value('c-status'),
      };
      if (!payload.label || !payload.value) {
        toast('Champs obligatoires', 'L’élément et la valeur sont requis.', 'warn');
        return;
      }
      try {
        const saved = isEdit
          ? await api.put(`/api/configs/${config.id}`, payload)
          : await api.post('/api/configs', payload);
        dialog.close();
        toast(isEdit ? 'Configuration mise à jour' : 'Configuration ajoutée', '', 'ok');
        onSaved?.(saved);
      } catch (error) {
        toast('Enregistrement impossible', error.message, 'error');
      }
    }));
}
