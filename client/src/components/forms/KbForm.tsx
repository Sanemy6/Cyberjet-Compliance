import { useState } from 'react';
import { api } from '@/api/client';
import { useClients, useInvalidateAll, useMeta } from '@/api/queries';
import type { ControlChip, KbEntry, KbStatus } from '@/api/types';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { BusyButton, Loader } from '../Ui';
import { useToast } from '../Toast';
import { ControlPicker, useControlSelection } from './ControlPicker';

/** Entrée en cours de création : elle n'a pas encore d'identifiant. */
export type KbDraft = Partial<KbEntry> & { question: string; answer: string };

interface KbFormProps {
  /** Entrée existante à modifier, ou brouillon pré-rempli à créer. */
  entry?: KbEntry | KbDraft | null;
  /** Portée par défaut pour une création depuis une fiche client. */
  clientId?: number | null;
  onClose: () => void;
  onSaved?: (entry: KbEntry) => void | Promise<void>;
}

export function KbForm({ entry, clientId = null, onClose, onSaved }: KbFormProps) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { data: meta } = useMeta();
  const { data: clients = [] } = useClients();

  const isEdit = Boolean(entry && 'id' in entry && entry.id);
  const [controls, setControls] = useControlSelection((entry?.controls ?? []) as ControlChip[]);

  const [form, setForm] = useState({
    clientId: (entry?.clientId ?? clientId) as number | null,
    question: entry?.question ?? '',
    answer: entry?.answer ?? '',
    category: entry?.category ?? 'Général',
    tags: entry?.tags ?? '',
    status: (entry?.status ?? 'validated') as KbStatus,
    evidence: entry?.evidence ?? '',
    source: entry?.source ?? '',
  });

  const set = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));

  const save = async () => {
    const payload = {
      clientId: form.clientId,
      question: form.question.trim(),
      answer: form.answer.trim(),
      category: form.category,
      tags: form.tags.trim(),
      status: form.status,
      evidence: form.evidence.trim() || null,
      source: form.source.trim() || null,
      controlIds: controls.map(control => control.id),
    };
    if (!payload.question || !payload.answer) {
      toast('Champs obligatoires', 'La question et la réponse sont requises.', 'warn');
      return;
    }

    try {
      const saved = isEdit
        ? await api.put<KbEntry>(`/api/kb/${(entry as KbEntry).id}`, payload)
        : await api.post<KbEntry>('/api/kb', payload);
      invalidate();
      onClose();
      toast(isEdit ? 'Réponse mise à jour' : 'Réponse ajoutée', '', 'ok');
      await onSaved?.(saved);
    } catch (error) {
      toast('Enregistrement impossible', (error as Error).message, 'error');
    }
  };

  return (
    <Modal title={isEdit ? 'Modifier la réponse' : 'Nouvelle réponse'}
           sub="Une question récurrente et la réponse de référence à réutiliser."
           wide onClose={onClose}
           footer={
             <>
               <button className="btn" onClick={onClose}>Annuler</button>
               <BusyButton className="btn primary" onClick={save}>
                 <Icon name="save" />{isEdit ? 'Enregistrer' : 'Ajouter à la base'}
               </BusyButton>
             </>
           }>
      {!meta ? <Loader /> : (
        <>
          <div className="field">
            <label htmlFor="k-question">Question de référence *</label>
            <textarea className="textarea" id="k-question" style={{ minHeight: 64 }}
                      placeholder="Ex. Quels mécanismes de chiffrement protègent les données au repos ?"
                      value={form.question}
                      onChange={event => set({ question: event.target.value })} />
            <span className="help">
              Formulez-la comme un client la poserait. Le moteur rapproche les questions
              par le sens, pas par les mots exacts.
            </span>
          </div>

          <div className="field">
            <label htmlFor="k-answer">Réponse de référence *</label>
            <textarea className="textarea" id="k-answer" style={{ minHeight: 150 }}
                      placeholder="Réponse complète, réutilisable telle quelle dans un questionnaire client."
                      value={form.answer}
                      onChange={event => set({ answer: event.target.value })} />
          </div>

          <div className="grid cols-3" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="k-client">Portée</label>
              <select className="select" id="k-client" value={form.clientId ?? ''}
                      onChange={event => set({
                        clientId: event.target.value ? Number(event.target.value) : null,
                      })}>
                <option value="">Générique — réutilisable pour tous les clients</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="k-category">Catégorie</label>
              <select className="select" id="k-category" value={form.category}
                      onChange={event => set({ category: event.target.value })}>
                {meta.categories.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="k-status">Statut</label>
              <select className="select" id="k-status" value={form.status}
                      onChange={event => set({ status: event.target.value as KbStatus })}>
                <option value="validated">Validée</option>
                <option value="draft">Brouillon</option>
                <option value="obsolete">Obsolète</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="k-tags">Mots-clés</label>
            <input className="input" id="k-tags"
                   placeholder="chiffrement, TLS, AES, données au repos"
                   value={form.tags} onChange={event => set({ tags: event.target.value })} />
            <span className="help">
              Séparés par des virgules. Ils élargissent le rapprochement sémantique.
            </span>
          </div>

          <div className="grid cols-2" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="k-evidence">Preuve associée</label>
              <input className="input" id="k-evidence"
                     placeholder="Politique de chiffrement v2.1, § 4"
                     value={form.evidence}
                     onChange={event => set({ evidence: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="k-source">Source</label>
              <input className="input" id="k-source"
                     placeholder="Entretien RSSI, audit interne 2025…"
                     value={form.source} onChange={event => set({ source: event.target.value })} />
            </div>
          </div>

          <div className="field">
            <label>Contrôles normatifs couverts</label>
            <ControlPicker selected={controls} onChange={setControls} />
          </div>
        </>
      )}
    </Modal>
  );
}
