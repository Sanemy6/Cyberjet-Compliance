import { api } from '@/api/client';
import { useInvalidateAll } from '@/api/queries';
import type { KbEntry } from '@/api/types';
import { Icon } from '../Icon';
import { ControlChips, KbStatusBadge } from '../Ui';
import { useToast } from '../Toast';
import { useDialogs } from '../Dialogs';
import { copyText } from '@/lib/clipboard';
import { fmtDate, truncate } from '@/lib/format';

/** Une entrée de la base de connaissance, telle qu'elle apparaît en liste. */
export function KbCard({ entry, showScope = true, onEdit }: {
  entry: KbEntry;
  showScope?: boolean;
  onEdit: (entry: KbEntry) => void;
}) {
  const toast = useToast();
  const { confirm } = useDialogs();
  const invalidate = useInvalidateAll();

  const remove = async () => {
    const ok = await confirm({
      title: 'Supprimer cette réponse ?',
      message: 'Elle ne sera plus proposée lors du traitement des questionnaires. '
             + 'Cette action est définitive.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.del(`/api/kb/${entry.id}`);
      invalidate();
      toast('Réponse supprimée', '', 'ok');
    } catch (error) {
      toast('Suppression impossible', (error as Error).message, 'error');
    }
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-body">
        <div className="flex between" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div className="grow">
            <h3 style={{ lineHeight: 1.45 }}>{entry.question}</h3>
          </div>
          <div className="row-actions">
            <button className="icon-btn sm" title="Modifier" onClick={() => onEdit(entry)}>
              <Icon name="edit" />
            </button>
            <button className="icon-btn sm" title="Copier la réponse"
                    onClick={() => copyText(entry.answer, toast)}>
              <Icon name="copy" />
            </button>
            <button className="icon-btn sm" title="Supprimer" onClick={remove}>
              <Icon name="trash" />
            </button>
          </div>
        </div>

        <p className="muted small mt-1 pre-wrap">{truncate(entry.answer, 420)}</p>

        <div className="flex wrap mt-2" style={{ gap: 6 }}>
          {showScope && (entry.clientId
            ? <span className="badge accent"><Icon name="user" />{entry.clientName ?? 'Client'}</span>
            : <span className="badge"><Icon name="layers" />Générique</span>)}
          <span className="badge outline">{entry.category}</span>
          <KbStatusBadge status={entry.status} />
          <ControlChips controls={entry.controls} />
        </div>

        {(entry.evidence || entry.tags) && (
          <div className="flex wrap mt-1 dim" style={{ gap: 12, fontSize: '.75rem' }}>
            {entry.tags && <span><Icon name="filter" /> {entry.tags}</span>}
            {entry.evidence && <span><Icon name="file" /> {entry.evidence}</span>}
            <span title="Dernière mise à jour">
              <Icon name="clock" /> {fmtDate(entry.updatedAt)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
