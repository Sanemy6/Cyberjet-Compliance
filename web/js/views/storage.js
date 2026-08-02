/* Volumétrie : ce qui est stocké, comment ça grossit, ce qu'il reste à saisir. */

import { api } from '../api.js';
import { coverageList } from '../components.js';
import { emptyState, esc, fmtBytes, fmtNum, icon } from '../ui.js';

/* Mesures relevées sur ce projet avec des réponses de longueur réaliste
   (75 mots en moyenne). Elles servent de repère de dimensionnement. */
const BENCHMARK = [
  { entries: 250, bytes: 0.3, seconds: 0.4 },
  { entries: 1000, bytes: 0.9, seconds: 1.4 },
  { entries: 2500, bytes: 2.1, seconds: 3.7 },
  { entries: 5000, bytes: 4.1, seconds: 7.4 },
  { entries: 10000, bytes: 8.0, seconds: 15.0 },
];

const MONTH_FMT = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' });

export default async function storage(node, ctx) {
  ctx.setCrumb([{ label: 'Volumétrie' }]);

  const s = await api.get('/api/storage');
  const { disk, counts, backlog } = s;

  node.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Volumétrie et stockage</h1>
        <p class="sub">
          Ce que l’application conserve aujourd’hui, la vitesse à laquelle la base
          s’enrichit, et ce qu’il reste à saisir pour qu’elle réponde seule.
        </p>
      </div>
    </div>

    <div class="grid cols-4 mb-2">
      ${stat('Espace disque total', fmtBytes(disk.total), 'database',
        `${fmtNum(disk.uploads.count + disk.exports.count)} fichier(s) hors base`)}
      ${stat('Réponses de référence', fmtNum(counts.kb), 'book',
        `${fmtNum(counts.kb_generic)} génériques · ${fmtNum(counts.configs)} configurations`)}
      ${stat('Questions traitées', fmtNum(counts.questions), 'fileText',
        `${fmtNum(counts.questionnaires)} questionnaire(s)`)}
      ${stat('Éléments indexés', fmtNum(counts.indexed), 'layers',
        `${fmtNum(counts.control_links)} lien(s) vers un contrôle`)}
    </div>

    <div class="grid side">
      <div class="flex col" style="gap:16px">
        <div class="card">
          <div class="card-head">
            <h2>Occupation disque</h2>
            <span class="badge">${esc(fmtBytes(disk.total))}</span>
          </div>
          <div class="card-body">
            ${diskBars(disk)}
            <p class="dim small mt-2">
              ${icon('folder')} Tout se trouve dans <span class="mono">${esc(disk.path)}</span> —
              c’est le seul dossier à sauvegarder.
            </p>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h2>Croissance de la base</h2>
            <span class="dim small">Réponses ajoutées par mois</span>
          </div>
          <div class="card-body">${growth(s.growth)}</div>
        </div>

        <div class="card">
          <div class="card-head">
            <h2>Couverture des référentiels</h2>
            <span class="dim small">Contrôles reliés à au moins une réponse</span>
          </div>
          <div class="card-body">${coverageList(s.coverage)}</div>
        </div>

        ${s.per_client.length ? `
          <div class="card">
            <div class="card-head"><h2>Répartition par client</h2></div>
            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th class="num">Réponses</th>
                    <th class="num">Configurations</th>
                    <th class="num">Questions traitées</th>
                  </tr>
                </thead>
                <tbody>
                  ${s.per_client.map((c) => `
                    <tr>
                      <td><a href="#/clients/${c.id}">${esc(c.name)}</a></td>
                      <td class="num">${fmtNum(c.n_kb)}</td>
                      <td class="num">${fmtNum(c.n_configs)}</td>
                      <td class="num">${fmtNum(c.n_questions)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>` : ''}
      </div>

      <div class="flex col" style="gap:16px">
        <div class="card">
          <div class="card-head"><h2>À alimenter en priorité</h2></div>
          <div class="card-body">${backlogList(backlog, counts)}</div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Repères de dimensionnement</h2></div>
          <div class="card-body">
            <p class="muted small mb-2">
              Mesures relevées sur cette machine, avec des réponses de longueur
              réaliste. La dernière colonne correspond au traitement complet d’un
              questionnaire de 60 questions, application fraîchement démarrée.
            </p>
            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th class="num">Réponses</th>
                    <th class="num">Base</th>
                    <th class="num">60 questions</th>
                  </tr>
                </thead>
                <tbody>
                  ${BENCHMARK.map((row) => `
                    <tr${row.entries === nearest(counts.kb) ? ' style="background:var(--accent-soft)"' : ''}>
                      <td class="num">${fmtNum(row.entries)}</td>
                      <td class="num">${String(row.bytes).replace('.', ',')} Mo</td>
                      <td class="num">${String(row.seconds).replace('.', ',')} s</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <p class="muted small mt-2">
              Le stockage n’est pas un facteur limitant : <b>10 000 réponses tiennent
              dans 8 Mo</b>. C’est le temps de traitement qui croît, de façon linéaire,
              et il reste confortable bien au-delà des volumes réalistes. L’index est
              gardé en mémoire entre deux requêtes : seul le premier traitement après
              démarrage paie la construction.
            </p>
          </div>
        </div>
      </div>
    </div>`;
}

function nearest(count) {
  return BENCHMARK.reduce(
    (best, row) => (Math.abs(row.entries - count) < Math.abs(best - count) ? row.entries : best),
    BENCHMARK[0].entries,
  );
}

function stat(label, value, iconName, hint) {
  return `
    <div class="stat">
      <span class="stat-ico">${icon(iconName)}</span>
      <span class="label">${esc(label)}</span>
      <span class="value">${esc(value)}</span>
      <span class="hint">${esc(hint)}</span>
    </div>`;
}

function diskBars(disk) {
  const items = [
    ['Base de données', disk.database.bytes, 'toutes vos réponses, clients et questionnaires'],
    ['Fichiers reçus', disk.uploads.bytes, `${disk.uploads.count} questionnaire(s) client`],
    ['Exports produits', disk.exports.bytes, `${disk.exports.count} fichier(s) générés`],
  ];
  const max = Math.max(...items.map(([, b]) => b), 1);

  return `
    <div class="bar-list">
      ${items.map(([label, bytes, hint]) => `
        <div class="bar-row" title="${esc(hint)}">
          <span class="bar-label">${esc(label)}</span>
          <span class="bar-track">
            <span class="bar-fill" style="width:${Math.max(2, (bytes / max) * 100)}%"></span>
          </span>
          <span class="bar-value" style="min-width:64px">${esc(fmtBytes(bytes))}</span>
        </div>`).join('')}
    </div>`;
}

function growth(series) {
  const firstActive = series.findIndex((row) => row.kb > 0);
  if (firstActive === -1) {
    return emptyState({
      iconName: 'activity',
      title: 'Pas encore d’historique',
      text: 'Les réponses ajoutées apparaîtront ici, mois par mois.',
    });
  }

  const visible = series.slice(firstActive);
  const max = Math.max(...visible.map((row) => row.kb), 1);
  const total = visible.reduce((sum, row) => sum + row.kb, 0);
  const average = total / visible.length;

  return `
    <div class="bar-list">
      ${visible.map((row) => `
        <div class="bar-row">
          <span class="bar-label">${esc(monthLabel(row.month))}</span>
          <span class="bar-track">
            <span class="bar-fill" style="width:${Math.max(2, (row.kb / max) * 100)}%"></span>
          </span>
          <span class="bar-value">${fmtNum(row.kb)}</span>
        </div>`).join('')}
    </div>
    <p class="dim small mt-2">
      ${fmtNum(total)} réponse(s) sur ${visible.length} mois, soit
      ${average.toFixed(average < 10 ? 1 : 0).replace('.', ',')} par mois en moyenne.
    </p>`;
}

function monthLabel(iso) {
  const [year, month] = iso.split('-');
  return MONTH_FMT.format(new Date(Number(year), Number(month) - 1, 1));
}

function backlogList(backlog, counts) {
  const items = [
    {
      n: backlog.uncapitalised,
      title: 'réponse(s) rédigée(s) à la main, absente(s) de la base',
      hint: 'Validées pendant une revue sans correspondance trouvée. Tant qu’elles ne sont pas versées dans la base, il faudra les réécrire au prochain client.',
      tone: 'danger',
      href: '#/questionnaires',
    },
    {
      n: backlog.corrected,
      title: 'proposition(s) corrigée(s) avant validation',
      hint: 'La réponse de la base ne convenait pas telle quelle : l’entrée d’origine mérite d’être mise à jour.',
      tone: 'warn',
      href: '#/questionnaires',
    },
    {
      n: backlog.drafts,
      title: 'réponse(s) au statut brouillon',
      hint: 'Elles sont proposées avec une confiance minorée tant qu’elles ne sont pas validées.',
      tone: 'warn',
      href: '#/kb',
    },
    {
      n: backlog.stale,
      title: 'réponse(s) sans revue depuis plus d’un an',
      hint: 'Les certifications, versions et prestataires changent — une réponse périmée dans un questionnaire client coûte cher.',
      tone: 'warn',
      href: '#/kb',
    },
    {
      n: backlog.clients_without_config,
      title: 'client(s) sans aucune configuration technique',
      hint: 'Sans configurations, les questions factuelles (chiffrement, MFA, hébergement) restent sans réponse précise.',
      tone: 'danger',
      href: '#/clients',
    },
  ].filter((item) => item.n > 0);

  if (!items.length) {
    return `
      <div class="flex" style="align-items:flex-start;gap:11px">
        ${icon('checkCircle')}
        <div>
          <div class="row-title">Rien à rattraper</div>
          <p class="muted small mt-1">
            Toutes les réponses validées sont dans la base et à jour.
            ${counts.kb ? '' : 'La base est encore vide — commencez par y verser vos réponses récurrentes.'}
          </p>
        </div>
      </div>`;
  }

  return `
    <div class="flex col" style="gap:14px">
      ${items.map((item) => `
        <a href="${item.href}" class="flex" style="align-items:flex-start;gap:11px;text-decoration:none;color:inherit">
          <span class="badge ${item.tone} nowrap" style="margin-top:2px">${fmtNum(item.n)}</span>
          <div>
            <div class="row-title" style="font-size:.87rem">${esc(item.title)}</div>
            <p class="muted" style="font-size:.78rem;margin-top:2px">${esc(item.hint)}</p>
          </div>
        </a>`).join('')}
    </div>`;
}
