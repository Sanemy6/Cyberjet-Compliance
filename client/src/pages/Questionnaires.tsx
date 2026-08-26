import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { api } from '@/api/client';
import { keys, useClients, useInvalidateAll } from '@/api/queries';
import type { QuestionnaireRow as Row } from '@/api/types';
import { Icon } from '@/components/Icon';
import { EmptyState, Loader } from '@/components/Ui';
import { useToast } from '@/components/Toast';
import { useDialogs } from '@/components/Dialogs';
import { QuestionnaireRow } from '@/components/domain/QuestionnaireRow';
import { UploadDialog } from '@/components/domain/UploadDialog';
import { ClientForm } from '@/components/forms/ClientForm';
import { PageMeta } from '@/components/layout/Shell';

export function QuestionnairesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const { confirm } = useDialogs();

  const [uploading, setUploading] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);

  const { data: list = [], isLoading } = useQuery({
    queryKey: [...keys.questionnaires, 'all'],
    queryFn: () => api.get<Row[]>('/api/questionnaires'),
  });
  const { data: clients = [] } = useClients();

  const remove = async (questionnaire: Row) => {
    const ok = await confirm({
      title: 'Supprimer ce questionnaire ?',
      message: 'Les questions et les réponses saisies seront perdues. '
             + 'La base de connaissance n’est pas affectée.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.del(`/api/questionnaires/${questionnaire.id}`);
      invalidate();
      toast('Questionnaire supprimé', '', 'ok');
    } catch (error) {
      toast('Suppression impossible', (error as Error).message, 'error');
    }
  };

  const actions = (
    <button className="btn primary" onClick={() => setUploading(true)}>
      <Icon name="upload" /><span className="nowrap">Téléverser</span>
    </button>
  );

  return (
    <>
      <PageMeta crumb={[{ label: 'Questionnaires' }]} actions={actions} />

      <div className="page-head">
        <div>
          <h1>Questionnaires</h1>
          <p className="sub">
            Téléversez le questionnaire reçu du client : les questions sont extraites,
            puis rapprochées de votre base pour proposer une réponse à chacune.
          </p>
        </div>
      </div>

      {isLoading ? <Loader /> : list.length ? (
        <div className="card">
          <div className="rows">
            {list.map(questionnaire => (
              <QuestionnaireRow key={questionnaire.id} questionnaire={questionnaire}
                                onDelete={remove} />
            ))}
          </div>
        </div>
      ) : (
        <div className="card">
          <EmptyState icon="inbox" title="Aucun questionnaire"
            text={clients.length
              ? 'Déposez un fichier Excel, Word ou PDF pour lancer le traitement.'
              : 'Créez d’abord un client, puis téléversez son questionnaire.'}
            action={clients.length
              ? <button className="btn primary" onClick={() => setUploading(true)}>
                  Téléverser un questionnaire
                </button>
              : <button className="btn primary" onClick={() => setCreatingClient(true)}>
                  Créer un client
                </button>} />
        </div>
      )}

      {uploading && <UploadDialog onClose={() => setUploading(false)} />}
      {creatingClient && (
        <ClientForm onClose={() => setCreatingClient(false)}
                    onSaved={client => navigate(`/clients/${client.id}`)} />
      )}
    </>
  );
}
