import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api } from '@/api/client';
import { useClients } from '@/api/queries';
import type { AnswerResult } from '@/api/types';
import { Icon, type IconName } from '@/components/Icon';
import { BandBadge, BusyButton } from '@/components/Ui';
import { useToast } from '@/components/Toast';
import { KbForm } from '@/components/forms/KbForm';
import { PageMeta } from '@/components/layout/Shell';
import { copyText } from '@/lib/clipboard';
import { truncate } from '@/lib/format';

const EXAMPLES = [
  'Quel type de chiffrement est en place pour les données au repos et en transit ?',
  'Décrivez votre processus de gestion des incidents de sécurité.',
  'Do you enforce multi-factor authentication for remote access?',
  'Comment répondez-vous à l’exigence IS.I.OR.205 ?',
  'Quelle est votre politique de sauvegarde et de test de restauration ?',
];

/**
 * Assistant : interroger la base sans passer par un questionnaire complet.
 *
 * Même chemin de code côté serveur que le traitement d'un import : un essai ici
 * prédit exactement ce que produira le rapprochement automatique.
 */
export function AssistantPage() {
  const toast = useToast();
  const [params] = useSearchParams();
  const { data: clients = [] } = useClients();

  const preselected = params.get('client') ?? '';
  const [clientId, setClientId] = useState<string>(preselected);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [creating, setCreating] = useState(false);

  // Le dossier retenu : celui de l'URL, sinon le premier de la liste — répondre
  // sur la seule base générique par défaut donnerait des résultats pauvres.
  const effectiveClient = clientId || String(clients[0]?.id ?? '');

  const ask = async () => {
    const text = question.trim();
    if (text.length < 4) {
      toast('Question trop courte', 'Formulez une question complète.', 'warn');
      return;
    }
    try {
      const answer = await api.post<AnswerResult>('/api/answer', {
        clientId: effectiveClient ? Number(effectiveClient) : null,
        question: text,
        topK: 6,
      });
      setResult(answer);
    } catch (error) {
      toast('Recherche impossible', (error as Error).message, 'error');
    }
  };

  return (
    <>
      <PageMeta crumb={[{ label: 'Assistant réponse' }]} />

      <div className="page-head">
        <div>
          <h1>Assistant réponse</h1>
          <p className="sub">
            Posez une question telle qu’un client la formulerait. Le moteur cherche dans les
            réponses de référence et les configurations techniques du dossier sélectionné,
            ainsi que dans la base générique.
          </p>
        </div>
      </div>

      <div className="grid side">
        <div className="flex col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-body flex col" style={{ gap: 14 }}>
              <div className="field">
                <label htmlFor="a-client">Dossier client</label>
                <select className="select" id="a-client" value={effectiveClient}
                        onChange={event => setClientId(event.target.value)}>
                  <option value="">Base générique uniquement</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="a-q">Question</label>
                <textarea className="textarea" id="a-q" style={{ minHeight: 96 }}
                          placeholder="Ex. Quels mécanismes de chiffrement protègent les données au repos ?"
                          value={question}
                          onChange={event => setQuestion(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                              void ask();
                          }} />
              </div>

              <div className="flex between wrap" style={{ gap: 10 }}>
                <div className="chips">
                  {EXAMPLES.map(example => (
                    <span className="chip" key={example} role="button" tabIndex={0}
                          onClick={() => setQuestion(example)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') setQuestion(example);
                          }}>
                      {truncate(example, 46)}
                    </span>
                  ))}
                </div>
                <BusyButton className="btn primary" onClick={ask}>
                  <Icon name="wand" />Répondre
                </BusyButton>
              </div>
            </div>
          </div>

          {result && (result.answer ? (
            <>
              <div className="card">
                <div className="card-head">
                  <h2>Réponse proposée</h2>
                  <div className="flex" style={{ gap: 8 }}>
                    <BandBadge band={result.band} confidence={result.confidence} />
                    <button className="icon-btn sm" title="Copier"
                            onClick={() => copyText(result.answer, toast)}>
                      <Icon name="copy" />
                    </button>
                  </div>
                </div>
                <div className="card-body">
                  <p className="pre-wrap">{result.answer}</p>
                  {result.best && (
                    <div className="q-source mt-2">
                      <Icon name="link" />Source :{' '}
                      {result.best.kind === 'config'
                        ? 'configuration technique' : 'base de connaissance'}
                      {' — '}{truncate(result.best.title, 90)}
                    </div>
                  )}
                </div>
              </div>

              {result.candidates.length > 1 && (
                <div className="card">
                  <div className="card-head"><h2>Autres correspondances</h2></div>
                  <div className="card-body">
                    {result.candidates.slice(1).map(candidate => (
                      <div className="candidate" style={{ cursor: 'default' }}
                           key={`${candidate.kind}-${candidate.id}`}>
                        <div className="c-head">
                          <span className="c-q">{truncate(candidate.title, 110)}</span>
                          <BandBadge band={candidate.band} confidence={candidate.confidence} />
                        </div>
                        <p className="c-a pre-wrap">{candidate.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="card">
              <div className="card-body flex" style={{ alignItems: 'flex-start', gap: 12 }}>
                <Icon name="alert" />
                <div className="grow">
                  <h3>Aucune réponse dans la base</h3>
                  <p className="muted small mt-1">
                    Le moteur a examiné {result.indexedDocuments} élément(s) sans trouver de
                    correspondance exploitable. Rédigez la réponse une fois : elle servira
                    pour tous les questionnaires suivants.
                  </p>
                  <button className="btn primary mt-2" onClick={() => setCreating(true)}>
                    <Icon name="plus" />Créer cette réponse
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-head"><h2>Comment ça marche</h2></div>
          <div className="card-body flex col" style={{ gap: 13 }}>
            <Step icon="search" title="Rapprochement sémantique"
                  text="Normalisation bilingue FR/EN, thésaurus cybersécurité, BM25 et similarité par trigrammes — sans aucun appel réseau." />
            <Step icon="shieldCheck" title="Ancrage normatif"
                  text="Une question citant IS.I.OR.205 ou A.8.24 fait remonter en priorité les réponses rattachées à ce contrôle." />
            <Step icon="settings" title="Configurations injectées"
                  text="Les faits techniques du client (algorithmes, protocoles, périmètres) alimentent directement la réponse." />
            <Step icon="lock" title="Cloisonnement strict"
                  text="Une réponse rattachée à un client n’est jamais proposée pour un autre dossier." />
          </div>
        </div>
      </div>

      {creating && (
        <KbForm onClose={() => setCreating(false)}
                clientId={effectiveClient ? Number(effectiveClient) : null}
                entry={{ question: question.trim(), answer: '', controls: [] }}
                onSaved={async () => { toast('Réponse ajoutée', '', 'ok'); await ask(); }} />
      )}
    </>
  );
}

function Step({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="flex" style={{ alignItems: 'flex-start', gap: 11 }}>
      <span className="stat-ico" style={{ position: 'static', flex: 'none' }}>
        <Icon name={icon} />
      </span>
      <div>
        <div className="row-title" style={{ fontSize: '.88rem' }}>{title}</div>
        <p className="muted" style={{ fontSize: '.79rem', marginTop: 2 }}>{text}</p>
      </div>
    </div>
  );
}
