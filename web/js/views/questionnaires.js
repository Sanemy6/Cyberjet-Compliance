/* Liste des questionnaires et boîte de dialogue de téléversement. */

import { api } from '../api.js';
import { questionnaireRow } from '../components.js';
import { clientForm } from '../forms.js';
import {
  confirmDialog, emptyState, esc, icon, modal, toast, withBusy,
} from '../ui.js';

const ACCEPT = '.xlsx,.xlsm,.xls,.docx,.pdf,.csv';

export default async function questionnaires(node, ctx) {
  ctx.setCrumb([{ label: 'Questionnaires' }]);

  const [list, clients] = await Promise.all([
    api.get('/api/questionnaires'),
    api.get('/api/clients'),
  ]);

  ctx.setActions(`<button class="btn primary" data-upload>${icon('upload')}<span class="nowrap">Téléverser</span></button>`);
  document.querySelector('[data-upload]').addEventListener('click', () =>
    uploadDialog({ clients, ctx }));

  node.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Questionnaires</h1>
        <p class="sub">
          Téléversez le questionnaire reçu du client : les questions sont extraites,
          puis rapprochées de votre base pour proposer une réponse à chacune.
        </p>
      </div>
    </div>
    ${list.length
      ? `<div class="card"><div class="rows">${list.map((q) => questionnaireRow(q)).join('')}</div></div>`
      : `<div class="card">${emptyState({
          iconName: 'inbox',
          title: 'Aucun questionnaire',
          text: clients.length
            ? 'Déposez un fichier Excel, Word ou PDF pour lancer le traitement.'
            : 'Créez d’abord un client, puis téléversez son questionnaire.',
          action: clients.length
            ? '<button class="btn primary" data-empty-upload>Téléverser un questionnaire</button>'
            : '<button class="btn primary" data-empty-client>Créer un client</button>',
        })}</div>`}`;

  node.querySelector('[data-empty-upload]')?.addEventListener('click', () =>
    uploadDialog({ clients, ctx }));
  node.querySelector('[data-empty-client]')?.addEventListener('click', () =>
    clientForm(null, () => ctx.refresh()));

  node.querySelectorAll('[data-qq-del]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Supprimer ce questionnaire ?',
        message: 'Les questions et les réponses saisies seront perdues. La base de connaissance n’est pas affectée.',
        confirmLabel: 'Supprimer',
        danger: true,
      });
      if (!ok) return;
      await api.del(`/api/questionnaires/${btn.dataset.qqDel}`);
      toast('Questionnaire supprimé', '', 'ok');
      ctx.refresh();
    }));
}

/* ------------------------------------------------------------------ */
/* Téléversement                                                        */
/* ------------------------------------------------------------------ */
export async function uploadDialog({ clientId = null, clients = null, ctx }) {
  const clientList = clients || (await api.get('/api/clients'));
  if (!clientList.length) {
    toast('Aucun client', 'Créez d’abord un dossier client.', 'warn');
    return;
  }

  const dialog = modal({
    title: 'Traiter un questionnaire',
    sub: 'Excel, Word, PDF ou CSV — les questions sont extraites automatiquement.',
    wide: true,
    body: `
      <div class="field">
        <label for="u-client">Client concerné *</label>
        <select class="select" id="u-client">
          ${clientList.map((c) => `<option value="${c.id}"${Number(clientId) === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>

      <div class="tabs" style="margin-bottom:0">
        <button class="tab active" data-mode="file">${icon('upload')}Fichier</button>
        <button class="tab" data-mode="text">${icon('edit')}Coller les questions</button>
      </div>

      <div data-pane="file">
        <div class="dropzone" data-dz>
          ${icon('upload')}
          <div class="dz-title">Déposez le fichier ici</div>
          <div class="dz-sub">ou cliquez pour parcourir — .xlsx, .docx, .pdf, .csv</div>
          <div data-dz-file></div>
        </div>
        <input type="file" accept="${ACCEPT}" hidden data-file>
      </div>

      <div data-pane="text" hidden>
        <div class="field">
          <label for="u-text">Une question par ligne</label>
          <textarea class="textarea" id="u-text" style="min-height:180px"
            placeholder="1. Les données sont-elles chiffrées au repos ?&#10;2. Décrivez votre processus de gestion des incidents.&#10;3. Disposez-vous d'une certification ISO 27001 ?"></textarea>
        </div>
      </div>

      <div class="field">
        <label for="u-name">Nom du dossier</label>
        <input class="input" id="u-name" placeholder="Repris du nom de fichier si laissé vide">
      </div>

      <label class="switch">
        <input type="checkbox" data-auto checked>
        <span class="track"></span>
        <span>Lancer le rapprochement automatique après l’import</span>
      </label>`,
    foot: `
      <button class="btn" data-close>Annuler</button>
      <button class="btn primary" data-go>${icon('wand')}Importer et analyser</button>`,
  });

  const root = dialog.root;
  const fileInput = root.querySelector('[data-file]');
  const dropzone = root.querySelector('[data-dz]');
  const fileLabelNode = root.querySelector('[data-dz-file]');
  let mode = 'file';
  let picked = null;

  root.querySelectorAll('[data-mode]').forEach((tab) =>
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      root.querySelectorAll('[data-mode]').forEach((t) =>
        t.classList.toggle('active', t === tab));
      root.querySelectorAll('[data-pane]').forEach((pane) => {
        pane.hidden = pane.dataset.pane !== mode;
      });
    }));

  function showFile(file) {
    picked = file;
    fileLabelNode.innerHTML = `
      <span class="dz-file">${icon('file')}${esc(file.name)}
        <span class="dim">(${(file.size / 1024).toFixed(0)} Ko)</span></span>`;
    const nameInput = root.querySelector('#u-name');
    if (!nameInput.value) nameInput.value = file.name.replace(/\.[^.]+$/, '');
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) showFile(fileInput.files[0]);
  });
  ['dragenter', 'dragover'].forEach((type) =>
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('over');
    }));
  ['dragleave', 'drop'].forEach((type) =>
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove('over');
    }));
  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) showFile(file);
  });

  root.querySelector('[data-go]').addEventListener('click', (event) =>
    withBusy(event.currentTarget, async () => {
      const targetClient = root.querySelector('#u-client').value;
      const name = root.querySelector('#u-name').value.trim();
      const runAuto = root.querySelector('[data-auto]').checked;

      try {
        let created;
        if (mode === 'file') {
          if (!picked) {
            toast('Aucun fichier', 'Sélectionnez un questionnaire à importer.', 'warn');
            return;
          }
          const form = new FormData();
          form.append('client_id', targetClient);
          form.append('name', name);
          form.append('file', picked);
          created = await api.upload('/api/questionnaires/upload', form);
        } else {
          const text = root.querySelector('#u-text').value.trim();
          if (!text) {
            toast('Aucune question', 'Collez au moins une question.', 'warn');
            return;
          }
          created = await api.post('/api/questionnaires/manual', {
            client_id: Number(targetClient),
            name: name || 'Questions saisies',
            text,
          });
        }

        const count = created.questions?.length || 0;
        if (!count) {
          toast('Aucune question détectée',
            created.warnings?.[0] || 'Essayez l’onglet « Coller les questions ».', 'warn', 8000);
        }
        if (created.warnings?.length && count) {
          toast('Import partiel', created.warnings[0], 'warn', 8000);
        }

        if (runAuto && count) {
          await api.post(`/api/questionnaires/${created.id}/autoanswer`);
        }

        dialog.close();
        toast('Questionnaire importé',
          `${count} question${count > 1 ? 's' : ''} extraite${count > 1 ? 's' : ''}.`, 'ok');
        ctx.navigate(`#/questionnaires/${created.id}`);
      } catch (error) {
        toast('Import impossible', error.message, 'error', 8000);
      }
    }));
}
