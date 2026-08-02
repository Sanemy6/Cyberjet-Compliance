/* Assistant : interroger la base sans passer par un questionnaire complet. */

import { api } from '../api.js';
import { kbForm } from '../forms.js';
import {
  bandBadge, copyText, esc, icon, toast, truncate, withBusy,
} from '../ui.js';

const EXAMPLES = [
  'Quel type de chiffrement est en place pour les données au repos et en transit ?',
  'Décrivez votre processus de gestion des incidents de sécurité.',
  'Do you enforce multi-factor authentication for remote access?',
  'Comment répondez-vous à l’exigence IS.I.OR.205 ?',
  'Quelle est votre politique de sauvegarde et de test de restauration ?',
];

export default async function assistant(node, ctx, route) {
  ctx.setCrumb([{ label: 'Assistant réponse' }]);

  const clients = await api.get('/api/clients');
  const preselected = route.query.get('client') || clients[0]?.id || '';

  node.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Assistant réponse</h1>
        <p class="sub">
          Posez une question telle qu’un client la formulerait. Le moteur cherche dans les
          réponses de référence et les configurations techniques du dossier sélectionné,
          ainsi que dans la base générique.
        </p>
      </div>
    </div>

    <div class="grid side">
      <div class="flex col" style="gap:16px">
        <div class="card">
          <div class="card-body flex col" style="gap:14px">
            <div class="field">
              <label for="a-client">Dossier client</label>
              <select class="select" id="a-client">
                <option value="">Base générique uniquement</option>
                ${clients.map((c) => `<option value="${c.id}"${String(c.id) === String(preselected) ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="a-q">Question</label>
              <textarea class="textarea" id="a-q" style="min-height:96px"
                placeholder="Ex. Quels mécanismes de chiffrement protègent les données au repos ?"></textarea>
            </div>
            <div class="flex between wrap" style="gap:10px">
              <div class="chips" data-examples>
                ${EXAMPLES.map((ex, i) => `<span class="chip" data-ex="${i}">${esc(truncate(ex, 46))}</span>`).join('')}
              </div>
              <button class="btn primary" data-ask>${icon('wand')}Répondre</button>
            </div>
          </div>
        </div>

        <div data-result></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Comment ça marche</h2></div>
        <div class="card-body flex col" style="gap:13px">
          ${step('search', 'Rapprochement sémantique',
            'Normalisation bilingue FR/EN, thésaurus cybersécurité, BM25 et similarité par trigrammes — sans aucun appel réseau.')}
          ${step('shieldCheck', 'Ancrage normatif',
            'Une question citant IS.I.OR.205 ou A.8.24 fait remonter en priorité les réponses rattachées à ce contrôle.')}
          ${step('settings', 'Configurations injectées',
            'Les faits techniques du client (algorithmes, protocoles, périmètres) alimentent directement la réponse.')}
          ${step('lock', 'Cloisonnement strict',
            'Une réponse rattachée à un client n’est jamais proposée pour un autre dossier.')}
        </div>
      </div>
    </div>`;

  const questionNode = node.querySelector('#a-q');
  const resultNode = node.querySelector('[data-result]');

  node.querySelectorAll('[data-ex]').forEach((chip) =>
    chip.addEventListener('click', () => {
      questionNode.value = EXAMPLES[Number(chip.dataset.ex)];
      questionNode.focus();
    }));

  async function ask(button) {
    const question = questionNode.value.trim();
    if (question.length < 4) {
      toast('Question trop courte', 'Formulez une question complète.', 'warn');
      return;
    }
    const clientValue = node.querySelector('#a-client').value;
    const result = await api.post('/api/answer', {
      client_id: clientValue ? Number(clientValue) : null,
      question,
      top_k: 6,
    });
    renderResult(result, question, clientValue);
  }

  node.querySelector('[data-ask]').addEventListener('click', (event) =>
    withBusy(event.currentTarget, () => ask(event.currentTarget)));
  questionNode.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      node.querySelector('[data-ask]').click();
    }
  });

  function renderResult(result, question, clientValue) {
    if (!result.answer) {
      resultNode.innerHTML = `
        <div class="card">
          <div class="card-body flex" style="align-items:flex-start;gap:12px">
            ${icon('alert')}
            <div class="grow">
              <h3>Aucune réponse dans la base</h3>
              <p class="muted small mt-1">
                Le moteur a examiné ${result.indexed_documents} élément(s) sans trouver de
                correspondance exploitable. Rédigez la réponse une fois : elle servira pour
                tous les questionnaires suivants.
              </p>
              <button class="btn primary mt-2" data-create>${icon('plus')}Créer cette réponse</button>
            </div>
          </div>
        </div>`;
      resultNode.querySelector('[data-create]').addEventListener('click', () =>
        kbForm({
          entry: { question, answer: '', client_id: clientValue ? Number(clientValue) : null, controls: [] },
          clientList: clients,
          onSaved: () => { toast('Réponse ajoutée', '', 'ok'); ask(); },
        }));
      return;
    }

    resultNode.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>Réponse proposée</h2>
          <div class="flex" style="gap:8px">
            ${bandBadge(result.band, result.confidence)}
            <button class="icon-btn sm" data-copy title="Copier">${icon('copy')}</button>
          </div>
        </div>
        <div class="card-body">
          <p class="pre-wrap">${esc(result.answer)}</p>
          ${result.best ? `
            <div class="q-source mt-2">
              ${icon('link')}Source :
              ${result.best.kind === 'config' ? 'configuration technique' : 'base de connaissance'}
              — ${esc(truncate(result.best.title, 90))}
            </div>` : ''}
        </div>
      </div>

      ${result.candidates.length > 1 ? `
        <div class="card mt-2">
          <div class="card-head"><h2>Autres correspondances</h2></div>
          <div class="card-body">
            ${result.candidates.slice(1).map((candidate) => `
              <div class="candidate" style="cursor:default">
                <div class="c-head">
                  <span class="c-q">${esc(truncate(candidate.title, 110))}</span>
                  ${bandBadge(candidate.band, candidate.confidence)}
                </div>
                <p class="c-a pre-wrap">${esc(candidate.body)}</p>
              </div>`).join('')}
          </div>
        </div>` : ''}`;

    resultNode.querySelector('[data-copy]')?.addEventListener('click', () =>
      copyText(result.answer));
  }
}

function step(iconName, title, text) {
  return `
    <div class="flex" style="align-items:flex-start;gap:11px">
      <span class="stat-ico" style="position:static;flex:none">${icon(iconName)}</span>
      <div>
        <div class="row-title" style="font-size:.88rem">${esc(title)}</div>
        <p class="muted" style="font-size:.79rem;margin-top:2px">${esc(text)}</p>
      </div>
    </div>`;
}
