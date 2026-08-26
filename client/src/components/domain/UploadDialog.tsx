import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useClients, useInvalidateAll } from '@/api/queries';
import type { QuestionnaireDetail } from '@/api/types';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { BusyButton, Loader } from '../Ui';
import { useToast } from '../Toast';
import { plural } from '@/lib/format';

const ACCEPT = '.xlsx,.xlsm,.xls,.docx,.pdf,.csv';

/**
 * Import d'un questionnaire : fichier déposé, ou questions collées à la main.
 *
 * Le rapprochement automatique est enchaîné dans la foulée par défaut : c'est le
 * geste attendu dans la quasi-totalité des cas, et le décocher reste possible
 * pour importer d'abord et traiter plus tard.
 */
export function UploadDialog({ clientId = null, onClose }: {
  clientId?: number | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const { data: clients = [], isLoading } = useClients();

  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [target, setTarget] = useState<number | null>(clientId);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [runAuto, setRunAuto] = useState(true);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const effectiveClient = target ?? clients[0]?.id ?? null;

  const pick = (picked: File) => {
    setFile(picked);
    if (!name) setName(picked.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async () => {
    if (!effectiveClient) {
      toast('Aucun client', 'Créez d’abord un dossier client.', 'warn');
      return;
    }

    try {
      let created: QuestionnaireDetail;

      if (mode === 'file') {
        if (!file) {
          toast('Aucun fichier', 'Sélectionnez un questionnaire à importer.', 'warn');
          return;
        }
        const form = new FormData();
        form.append('clientId', String(effectiveClient));
        form.append('name', name);
        form.append('file', file);
        created = await api.upload<QuestionnaireDetail>('/api/questionnaires/upload', form);
      } else {
        if (!text.trim()) {
          toast('Aucune question', 'Collez au moins une question.', 'warn');
          return;
        }
        created = await api.post<QuestionnaireDetail>('/api/questionnaires/manual', {
          clientId: effectiveClient,
          name: name.trim() || 'Questions saisies',
          text,
        });
      }

      const count = created.questions.length;
      if (!count) {
        toast('Aucune question détectée',
              created.warnings?.[0] ?? 'Essayez l’onglet « Coller les questions ».',
              'warn', 8000);
      } else if (created.warnings?.length) {
        toast('Import partiel', created.warnings[0], 'warn', 8000);
      }

      if (runAuto && count) {
        await api.post(`/api/questionnaires/${created.id}/autoanswer`);
      }

      invalidate();
      onClose();
      toast('Questionnaire importé',
            `${count} ${plural(count, 'question')} ${plural(count, 'extraite')}.`, 'ok');
      navigate(`/questionnaires/${created.id}`);
    } catch (error) {
      toast('Import impossible', (error as Error).message, 'error', 8000);
    }
  };

  return (
    <Modal title="Traiter un questionnaire"
           sub="Excel, Word, PDF ou CSV — les questions sont extraites automatiquement."
           wide onClose={onClose}
           footer={
             <>
               <button className="btn" onClick={onClose}>Annuler</button>
               <BusyButton className="btn primary" onClick={submit}>
                 <Icon name="wand" />Importer et analyser
               </BusyButton>
             </>
           }>
      {isLoading ? <Loader /> : (
        <>
          <div className="field">
            <label htmlFor="u-client">Client concerné *</label>
            <select className="select" id="u-client" value={effectiveClient ?? ''}
                    onChange={event => setTarget(Number(event.target.value))}>
              {clients.map(client => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>

          <div className="tabs" style={{ marginBottom: 0 }}>
            <button className={`tab${mode === 'file' ? ' active' : ''}`}
                    onClick={() => setMode('file')}>
              <Icon name="upload" />Fichier
            </button>
            <button className={`tab${mode === 'text' ? ' active' : ''}`}
                    onClick={() => setMode('text')}>
              <Icon name="edit" />Coller les questions
            </button>
          </div>

          {mode === 'file' ? (
            <>
              <div className={`dropzone${dragging ? ' over' : ''}`}
                   role="button" tabIndex={0}
                   onClick={() => fileInput.current?.click()}
                   onKeyDown={event => { if (event.key === 'Enter') fileInput.current?.click(); }}
                   onDragEnter={event => { event.preventDefault(); setDragging(true); }}
                   onDragOver={event => { event.preventDefault(); setDragging(true); }}
                   onDragLeave={event => { event.preventDefault(); setDragging(false); }}
                   onDrop={event => {
                     event.preventDefault();
                     setDragging(false);
                     const dropped = event.dataTransfer?.files?.[0];
                     if (dropped) pick(dropped);
                   }}>
                <Icon name="upload" />
                <div className="dz-title">Déposez le fichier ici</div>
                <div className="dz-sub">ou cliquez pour parcourir — .xlsx, .docx, .pdf, .csv</div>
                {file && (
                  <span className="dz-file">
                    <Icon name="file" />{file.name}
                    <span className="dim"> ({(file.size / 1024).toFixed(0)} Ko)</span>
                  </span>
                )}
              </div>
              <input type="file" accept={ACCEPT} hidden ref={fileInput}
                     onChange={event => {
                       const picked = event.target.files?.[0];
                       if (picked) pick(picked);
                     }} />
            </>
          ) : (
            <div className="field">
              <label htmlFor="u-text">Une question par ligne</label>
              <textarea className="textarea" id="u-text" style={{ minHeight: 180 }}
                        placeholder={'1. Les données sont-elles chiffrées au repos ?\n'
                          + '2. Décrivez votre processus de gestion des incidents.\n'
                          + '3. Disposez-vous d\'une certification ISO 27001 ?'}
                        value={text} onChange={event => setText(event.target.value)} />
            </div>
          )}

          <div className="field">
            <label htmlFor="u-name">Nom du dossier</label>
            <input className="input" id="u-name"
                   placeholder="Repris du nom de fichier si laissé vide"
                   value={name} onChange={event => setName(event.target.value)} />
          </div>

          <label className="switch">
            <input type="checkbox" checked={runAuto}
                   onChange={event => setRunAuto(event.target.checked)} />
            <span className="track" />
            <span>Lancer le rapprochement automatique après l’import</span>
          </label>
        </>
      )}
    </Modal>
  );
}
