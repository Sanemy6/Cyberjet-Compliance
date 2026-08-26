import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, download } from '@/api/client';
import { keys, useInvalidateAll, useMeta } from '@/api/queries';
import type { Candidate, Question, QuestionnaireDetail } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import {
  BandBadge, BusyButton, EmptyState, ErrorState, Loader, StatusBadge, fileLabel,
} from '@/components/Ui';
import { useToast } from '@/components/Toast';
import { useDialogs } from '@/components/Dialogs';
import { KbForm, type KbDraft } from '@/components/forms/KbForm';
import { PageMeta } from '@/components/layout/Shell';
import { fmtNum, plural, truncate } from '@/lib/format';

type Filter = 'all' | 'todo' | 'high' | 'weak' | 'validated' | 'na';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'todo', label: 'À traiter' },
  { key: 'high', label: 'Confiance haute' },
  { key: 'weak', label: 'À vérifier' },
  { key: 'validated', label: 'Validées' },
  { key: 'na', label: 'Sans objet' },
];

/** Revue d'un questionnaire : proposition, ajustement, validation, export. */
export function QuestionnaireDetailPage() {
  const { questionnaireId: raw } = useParams();
  const id = Number(raw);
  const [params, setParams] = useSearchParams();
  const filter = (params.get('f') ?? 'all') as Filter;

  const toast = useToast();
  const { confirm } = useDialogs();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAll();
  const { data: meta } = useMeta();
  const [exportOpen, setExportOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: keys.questionnaire(id),
    queryFn: () => api.get<QuestionnaireDetail>(`/api/questionnaires/${id}`),
  });

  // Le seuil de confiance haute vient du serveur : il est réglé en un seul
  // endroit, et l'interface ne doit pas en garder une copie qui dérive.
  const high = meta?.thresholds.high ?? 0.62;

  const reload = () => queryClient.invalidateQueries({ queryKey: keys.questionnaire(id) });

  if (error) {
    return (
      <>
        <PageMeta crumb={[{ label: 'Questionnaires', to: '/questionnaires' },
                          { label: 'Questionnaire' }]} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );
  }

  if (isLoading || !data) return <Loader />;

  const matches = (question: Question) => {
    const open = question.status !== 'validated' && question.status !== 'na';
    switch (filter) {
      case 'todo':
        return question.status === 'pending'
            || (question.status === 'auto' && question.confidence < high);
      case 'high': return question.confidence >= high && open;
      case 'weak': return question.confidence > 0 && question.confidence < high && open;
      case 'validated': return question.status === 'validated';
      case 'na': return question.status === 'na';
      default: return true;
    }
  };

  const counts: Record<Filter, number> = {
    all: data.questions.length,
    todo: data.questions.filter(q =>
      q.status === 'pending' || (q.status === 'auto' && q.confidence < high)).length,
    high: data.questions.filter(q =>
      q.confidence >= high && q.status !== 'validated' && q.status !== 'na').length,
    weak: data.questions.filter(q =>
      q.confidence > 0 && q.confidence < high
      && q.status !== 'validated' && q.status !== 'na').length,
    validated: data.questions.filter(q => q.status === 'validated').length,
    na: data.questions.filter(q => q.status === 'na').length,
  };

  const summary = data.summary;
  const done = summary.validated + summary.na;
  const progress = summary.total ? done / summary.total : 0;

  const rerun = async () => {
    const ok = await confirm({
      title: 'Relancer le rapprochement',
      message: 'Les propositions non validées seront recalculées avec l’état actuel de la '
             + 'base de connaissance. Vos réponses validées et vos modifications manuelles '
             + 'sont conservées.',
      confirmLabel: 'Relancer',
    });
    if (!ok) return;

    try {
      const result = await api.post<QuestionnaireDetail>(`/api/questionnaires/${id}/autoanswer`);
      queryClient.setQueryData(keys.questionnaire(id), result);
      const byBand = result.run?.byBand ?? {};
      toast('Rapprochement terminé',
            `${byBand.haute ?? 0} haute confiance · ${byBand.moyenne ?? 0} à vérifier · `
            + `${byBand.aucune ?? 0} sans correspondance`, 'ok', 6000);
      invalidate();
    } catch (error) {
      toast('Relance impossible', (error as Error).message, 'error');
    }
  };

  const validateHigh = async () => {
    try {
      const result = await api.post<QuestionnaireDetail>(
        `/api/questionnaires/${id}/validate-high`);
      queryClient.setQueryData(keys.questionnaire(id), result);
      toast('Propositions validées', `${result.validated ?? 0} réponse(s) validée(s).`, 'ok');
      invalidate();
    } catch (error) {
      toast('Validation impossible', (error as Error).message, 'error');
    }
  };

  const actions = (
    <>
      <BusyButton className="btn" onClick={rerun}
                  title="Relance le rapprochement sur les questions non validées">
        <Icon name="refresh" /><span className="nowrap">Relancer</span>
      </BusyButton>
      <button className="btn primary" onClick={() => setExportOpen(true)}>
        <Icon name="download" /><span className="nowrap">Exporter</span>
      </button>
    </>
  );

  const visible = data.questions.filter(matches);

  return (
    <>
      <PageMeta actions={actions} crumb={[
        { label: 'Questionnaires', to: '/questionnaires' },
        { label: data.clientName, to: `/clients/${data.clientId}?tab=questionnaires` },
        { label: data.name },
      ]} />

      <div className="page-head">
        <div>
          <h1>{data.name}</h1>
          <p className="sub flex wrap" style={{ gap: 8 }}>
            <Link to={`/clients/${data.clientId}`}>{data.clientName}</Link>
            <span className="dim">·</span>
            <span className="badge outline">{fileLabel(data.fileType)}</span>
            {data.originalFilename && <span className="dim">{data.originalFilename}</span>}
          </p>
        </div>
      </div>

      <div className="card mb-2">
        <div className="card-body">
          <div className="flex between wrap mb-1" style={{ gap: 12 }}>
            <div className="flex wrap" style={{ gap: 8 }}>
              <span className="badge">
                {fmtNum(summary.total)} {plural(summary.total, 'question')}
              </span>
              <span className="badge accent">{fmtNum(summary.answered)} avec proposition</span>
              <span className="badge ok">
                {fmtNum(summary.validated)} {plural(summary.validated, 'validée')}
              </span>
              {summary.pending > 0 && (
                <span className="badge warn">
                  {fmtNum(summary.pending)} sans correspondance
                </span>
              )}
            </div>
            {counts.high > 0 && (
              <BusyButton className="btn sm ok" onClick={validateHigh}>
                <Icon name="check" />
                Valider les {counts.high} propositions à haute confiance
              </BusyButton>
            )}
          </div>
          <div className="meter-row">
            <div className={`progress ${progress >= 1 ? 'ok' : ''}`}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="meter-val">{done}/{summary.total}</span>
          </div>
        </div>
      </div>

      <div className="tabs">
        {FILTERS.map(entry => (
          <button key={entry.key} className={`tab ${entry.key === filter ? 'active' : ''}`}
                  onClick={() => setParams({ f: entry.key }, { replace: true })}>
            {entry.label}<span className="count">{counts[entry.key]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState icon={filter === 'all' ? 'inbox' : 'checkCircle'}
            title={filter === 'all' ? 'Aucune question extraite' : 'Rien dans ce filtre'}
            text={filter === 'all'
              ? 'Le fichier n’a pas pu être découpé en questions. Réimportez-le en collant les questions manuellement.'
              : 'Toutes les questions de cette catégorie ont été traitées.'} />
        </div>
      ) : (
        visible.map(question => (
          <QuestionCard key={question.id} question={question} questionnaire={data}
                        onChanged={reload} />
        ))
      )}

      {exportOpen && (
        <ExportDialog id={id} name={data.name}
                      canExportOriginal={summary.canExportOriginal}
                      onClose={() => setExportOpen(false)} />
      )}
    </>
  );
}

// --------------------------------------------------------------------------
// Carte de question
// --------------------------------------------------------------------------

function QuestionCard({ question, questionnaire, onChanged }: {
  question: Question;
  questionnaire: QuestionnaireDetail;
  onChanged: () => Promise<unknown>;
}) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { confirm } = useDialogs();

  const [answer, setAnswer] = useState(question.finalAnswer ?? question.suggestedAnswer ?? '');
  const [saved, setSaved] = useState(false);
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const [promoting, setPromoting] = useState<KbDraft | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lastSaved = useRef(answer);

  // Le serveur reste la source de vérité : une relance du rapprochement ou une
  // validation en masse doit se voir dans le champ sans écraser une saisie en
  // cours, d'où la comparaison avec la dernière valeur envoyée.
  useEffect(() => {
    const incoming = question.finalAnswer ?? question.suggestedAnswer ?? '';
    if (incoming !== lastSaved.current) {
      lastSaved.current = incoming;
      setAnswer(incoming);
    }
  }, [question.finalAnswer, question.suggestedAnswer]);

  useEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight + 2, 460)}px`;
  }, [answer]);

  const validated = question.status === 'validated';
  const promoted = Boolean(question.promotedKbEntryId);
  const edited = Boolean(question.finalAnswer)
    && question.finalAnswer !== question.suggestedAnswer;

  const patch = async (body: { finalAnswer?: string; status?: string }) => {
    await api.patch(`/api/questions/${question.id}`, body);
    await onChanged();
    invalidate();
  };

  const saveOnBlur = async () => {
    if (answer === lastSaved.current) return;
    lastSaved.current = answer;
    try {
      await patch({ finalAnswer: answer });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (error) {
      toast('Enregistrement impossible', (error as Error).message, 'error');
    }
  };

  /* Bascule de validation : un second clic ne revient pas à un état neutre mais
     à celui qu'aurait produit le moteur — « proposée » s'il reste une
     proposition, « à traiter » sinon — sans quoi la question sortirait de tous
     les filtres et deviendrait introuvable. La réponse saisie est conservée :
     c'est le tampon qu'on retire, pas le travail. */
  const toggleValidation = async () => {
    const status = validated
      ? (question.suggestedAnswer ? 'auto' : 'pending')
      : 'validated';
    try {
      await patch({ finalAnswer: answer, status });
    } catch (error) {
      toast(validated ? 'Retrait impossible' : 'Validation impossible',
            (error as Error).message, 'error');
    }
  };

  const demote = async () => {
    const ok = await confirm({
      title: 'Retirer cette réponse de la base ?',
      message: 'L’entrée créée depuis cette question sera supprimée de la base de '
             + 'connaissance et ne sera plus proposée pour aucun questionnaire. '
             + 'La réponse saisie ici est conservée.',
      confirmLabel: 'Retirer de la base',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.del(`/api/questions/${question.id}/promotion`);
      await onChanged();
      invalidate();
      toast('Retirée de la base', '', 'ok');
    } catch (error) {
      toast('Retrait impossible', (error as Error).message, 'error');
    }
  };

  const promote = () => {
    if (promoted) { void demote(); return; }
    if (!answer.trim()) {
      toast('Réponse vide', 'Rédigez la réponse avant de la verser dans la base.', 'warn');
      return;
    }
    setPromoting({
      question: question.text,
      answer: answer.trim(),
      clientId: questionnaire.clientId,
      category: 'Général',
      status: 'validated',
      source: `Questionnaire « ${questionnaire.name} »`,
      controls: [],
    });
  };

  const sourceLabel = question.matchedKind === 'config'
    ? 'Configuration technique du client'
    : question.matchedKind === 'kb' ? 'Base de connaissance' : null;

  return (
    <div className="q-card" data-band={question.band} data-status={question.status}>
      <div className="q-head">
        <span className="q-index">{question.idx}</span>
        <div className="q-text">
          {question.text}
          <div className="q-meta">
            {question.ref && <span className="badge ref">{question.ref}</span>}
            {question.section && <span className="badge outline">{question.section}</span>}
            <StatusBadge status={question.status} />
            {question.status !== 'na' && (
              <BandBadge band={question.band} confidence={question.confidence} />
            )}
            {edited && <span className="badge accent">Reformulée</span>}
          </div>
        </div>
      </div>

      <div className="q-body">
        <textarea className="textarea" ref={textarea} value={answer}
                  placeholder={question.suggestedAnswer ? '' :
                    'Aucune correspondance trouvée — rédigez la réponse, puis versez-la dans la base pour la réutiliser.'}
                  onChange={event => setAnswer(event.target.value)}
                  onBlur={saveOnBlur} />

        {sourceLabel && (
          <div className="q-source"><Icon name="link" />Source : {sourceLabel}</div>
        )}

        <div className="q-actions">
          <BusyButton className={`btn sm ok${validated ? ' on' : ''}`}
                      title={validated ? 'Retirer la validation' : 'Valider cette réponse'}
                      onClick={toggleValidation}>
            <Icon name={validated ? 'checkCircle' : 'check'} />
            {validated ? 'Validée' : 'Valider'}
          </BusyButton>

          <button className="btn sm" onClick={() => setCandidatesOpen(true)}>
            <Icon name="search" />Autres propositions
            {question.candidates.length > 0 && ` (${question.candidates.length})`}
          </button>

          <button className={`btn sm${promoted ? ' subtle on' : ''}`} onClick={promote}
                  title={promoted
                    ? 'Retirer cette réponse de la base de connaissance'
                    : 'Ajouter cette réponse à la base pour la réutiliser'}>
            <Icon name={promoted ? 'bookCheck' : 'book'} />
            {promoted ? 'Versée dans la base' : 'Verser dans la base'}
          </button>

          <BusyButton className="btn sm ghost" onClick={() => patch({ status: 'na' })}>
            <Icon name="slash" />Sans objet
          </BusyButton>

          {saved && <span className="dim small">Enregistré</span>}
        </div>
      </div>

      {candidatesOpen && (
        <CandidatesDialog question={question}
                          onClose={() => setCandidatesOpen(false)}
                          onApplied={async text => {
                            lastSaved.current = text;
                            setAnswer(text);
                            await onChanged();
                            invalidate();
                          }} />
      )}

      {promoting && (
        <KbForm entry={promoting} clientId={questionnaire.clientId}
                onClose={() => setPromoting(null)}
                onSaved={async entry => {
                  toast('Ajoutée à la base',
                        'Cette réponse sera réutilisée automatiquement.', 'ok');
                  try {
                    // La liaison est posée après coup, avec l'entrée réellement
                    // créée : c'est elle qui permettra de retrouver quoi retirer.
                    await api.post(`/api/questions/${question.id}/promotion`,
                                   { kbEntryId: entry.id });
                    await onChanged();
                  } catch {
                    // L'entrée est bien en base : seul le lien a manqué. Un
                    // rechargement le rattrapera.
                  }
                }} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Autres propositions
// --------------------------------------------------------------------------

function CandidatesDialog({ question, onClose, onApplied }: {
  question: Question;
  onClose: () => void;
  onApplied: (text: string) => void | Promise<void>;
}) {
  const toast = useToast();
  const [query, setQuery] = useState(question.text);
  const [candidates, setCandidates] = useState<Candidate[]>(question.candidates);

  const search = async () => {
    try {
      const result = await api.post<{ candidates: Candidate[] }>(
        `/api/questions/${question.id}/rematch`, { q: query.trim() });
      setCandidates(result.candidates);
    } catch (error) {
      toast('Recherche impossible', (error as Error).message, 'error');
    }
  };

  const apply = async (candidate: Candidate) => {
    try {
      const updated = await api.post<Question>(`/api/questions/${question.id}/apply`, {
        kind: candidate.kind, sourceId: candidate.id,
      });
      onClose();
      await onApplied(updated.finalAnswer ?? '');
      toast('Réponse appliquée', '', 'ok', 2200);
    } catch (error) {
      toast('Application impossible', (error as Error).message, 'error');
    }
  };

  return (
    <Modal title="Propositions de la base" sub={truncate(question.text, 140)} wide
           onClose={onClose}
           footer={<button className="btn" onClick={onClose}>Fermer</button>}>
      <div className="field">
        <label htmlFor="cd-q">Reformuler la recherche</label>
        <div className="flex" style={{ gap: 8 }}>
          <input className="input" id="cd-q" value={query}
                 onChange={event => setQuery(event.target.value)} />
          <BusyButton className="btn" onClick={search}>
            <Icon name="search" />Chercher
          </BusyButton>
        </div>
        <span className="help">
          Utile quand la question du client est elliptique : reformulez-la comme vous
          l’auriez posée.
        </span>
      </div>

      {candidates.length === 0 ? (
        <p className="dim small">Aucune correspondance dans la base pour ce client.</p>
      ) : candidates.map(candidate => (
        <div className="candidate" key={`${candidate.kind}-${candidate.id}`}
             role="button" tabIndex={0}
             onClick={() => apply(candidate)}
             onKeyDown={event => { if (event.key === 'Enter') void apply(candidate); }}>
          <div className="c-head">
            <span className="c-q">{truncate(candidate.title, 120)}</span>
            <BandBadge band={candidate.band} confidence={candidate.confidence} />
          </div>
          <p className="c-a pre-wrap">{candidate.body}</p>
          <div className="flex wrap mt-1" style={{ gap: 6 }}>
            <span className="badge outline">
              {candidate.kind === 'config' ? 'Configuration' : 'Base de connaissance'}
            </span>
            {candidate.category && <span className="badge">{candidate.category}</span>}
            {candidate.refHit && (
              <span className="badge accent">Référence normative commune</span>
            )}
            {candidate.refs.slice(0, 3).map(ref => (
              <span className="badge ref" key={ref}>{ref}</span>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Export
// --------------------------------------------------------------------------

function ExportDialog({ id, name, canExportOriginal, onClose }: {
  id: number;
  name: string;
  canExportOriginal: boolean;
  onClose: () => void;
}) {
  const toast = useToast();

  const run = async (mode: 'original' | 'report') => {
    try {
      await download(`/api/questionnaires/${id}/export?mode=${mode}`);
      onClose();
      toast('Export généré', 'Le fichier a été téléchargé.', 'ok');
    } catch (error) {
      toast('Export impossible', (error as Error).message, 'error', 7000);
    }
  };

  // Deux pavés cliquables plutôt que deux boutons de barre : le choix engage un
  // fichier qui part au client, il mérite d'être lu avant d'être cliqué.
  const choiceStyle: React.CSSProperties = {
    justifyContent: 'flex-start', padding: 14, height: 'auto', textAlign: 'left',
  };
  const innerStyle: React.CSSProperties = {
    display: 'flex', gap: 11, alignItems: 'flex-start',
  };
  const captionStyle: React.CSSProperties = {
    display: 'block', marginTop: 2, whiteSpace: 'normal',
  };

  return (
    <Modal title="Exporter les réponses" sub={name} onClose={onClose}
           footer={<button className="btn" onClick={onClose}>Annuler</button>}>
      <div className="flex col" style={{ gap: 10 }}>
        <BusyButton className="btn block" style={choiceStyle} disabled={!canExportOriginal}
                    onClick={() => run('original')}>
          <span style={innerStyle}>
            <Icon name="file" />
            <span>
              <span style={{ display: 'block', fontWeight: 620 }}>
                Le fichier du client, complété
              </span>
              <span className="dim small" style={captionStyle}>
                {canExportOriginal
                  ? 'Les réponses sont réécrites dans le classeur Excel d’origine, à leur emplacement exact.'
                  : 'Disponible uniquement pour les questionnaires importés au format Excel.'}
              </span>
            </span>
          </span>
        </BusyButton>

        <BusyButton className="btn block" style={choiceStyle} onClick={() => run('report')}>
          <span style={innerStyle}>
            <Icon name="layers" />
            <span>
              <span style={{ display: 'block', fontWeight: 620 }}>Rapport de synthèse</span>
              <span className="dim small" style={captionStyle}>
                Classeur autonome : synthèse de couverture + détail question par question,
                avec niveau de confiance et source de chaque réponse.
              </span>
            </span>
          </span>
        </BusyButton>
      </div>
    </Modal>
  );
}
