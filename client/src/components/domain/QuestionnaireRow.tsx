import { Link } from 'react-router-dom';
import type { QuestionnaireRow as Row } from '@/api/types';
import { Icon } from '../Icon';
import { fileLabel } from '../Ui';
import { fmtRelative, plural } from '@/lib/format';

/** Ligne de questionnaire : avancement lisible d'un coup d'œil. */
export function QuestionnaireRow({ questionnaire, showClient = true, onDelete }: {
  questionnaire: Row;
  showClient?: boolean;
  onDelete: (questionnaire: Row) => void;
}) {
  const total = questionnaire.nQuestions;
  const done = questionnaire.nValidated + questionnaire.nNa;
  const progress = total ? done / total : 0;
  const complete = total > 0 && done >= total;

  return (
    <div className="row-item">
      <div className="row-main">
        <Link className="row-title" to={`/questionnaires/${questionnaire.id}`}
              style={{ color: 'inherit' }}>
          {questionnaire.name}
        </Link>
        <div className="row-sub flex wrap" style={{ gap: 7 }}>
          {showClient && (
            <>
              <span>{questionnaire.clientName}</span>
              <span className="dim">·</span>
            </>
          )}
          <span className="badge outline">{fileLabel(questionnaire.fileType)}</span>
          <span className="dim">·</span>
          <span className="dim">{total} {plural(total, 'question')}</span>
          <span className="dim">·</span>
          <span className="dim">{fmtRelative(questionnaire.updatedAt)}</span>
          {complete && <span className="badge ok">Terminé</span>}
        </div>
        <div className="meter-row mt-1" style={{ maxWidth: 420 }}>
          <div className={`progress ${complete ? 'ok' : ''}`}>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="meter-val">{done}/{total}</span>
        </div>
      </div>
      <div className="row-actions">
        <Link className="btn sm" to={`/questionnaires/${questionnaire.id}`}>Ouvrir</Link>
        <button className="icon-btn sm" title="Supprimer" onClick={() => onDelete(questionnaire)}>
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}
