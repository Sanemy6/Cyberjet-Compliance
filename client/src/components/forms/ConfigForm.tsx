import { useState } from 'react';
import { api } from '@/api/client';
import { useInvalidateAll, useMeta } from '@/api/queries';
import type { ConfigItem } from '@/api/types';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { BusyButton, Loader } from '../Ui';
import { useToast } from '../Toast';

interface ConfigFormProps {
  config?: ConfigItem | null;
  clientId: number;
  onClose: () => void;
  onSaved?: () => void;
}

export function ConfigForm({ config, clientId, onClose, onSaved }: ConfigFormProps) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { data: meta } = useMeta();
  const isEdit = Boolean(config?.id);

  const [form, setForm] = useState({
    category: config?.category ?? 'Chiffrement',
    status: config?.status ?? 'en place',
    label: config?.label ?? '',
    value: config?.value ?? '',
    details: config?.details ?? '',
    scope: config?.scope ?? '',
  });

  const set = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));

  const save = async () => {
    const payload = {
      clientId,
      category: form.category,
      label: form.label.trim(),
      value: form.value.trim(),
      details: form.details.trim() || null,
      scope: form.scope.trim() || null,
      status: form.status,
    };
    if (!payload.label || !payload.value) {
      toast('Champs obligatoires', 'L’élément et la valeur sont requis.', 'warn');
      return;
    }

    try {
      if (isEdit) await api.put(`/api/configs/${config!.id}`, payload);
      else await api.post('/api/configs', payload);
      invalidate();
      onClose();
      toast(isEdit ? 'Configuration mise à jour' : 'Configuration ajoutée', '', 'ok');
      onSaved?.();
    } catch (error) {
      toast('Enregistrement impossible', (error as Error).message, 'error');
    }
  };

  return (
    <Modal title={isEdit ? 'Modifier la configuration' : 'Nouvelle configuration technique'}
           sub="Un fait technique précis, réutilisé automatiquement dans les réponses."
           onClose={onClose}
           footer={
             <>
               <button className="btn" onClick={onClose}>Annuler</button>
               <BusyButton className="btn primary" onClick={save}>
                 <Icon name="save" />{isEdit ? 'Enregistrer' : 'Ajouter'}
               </BusyButton>
             </>
           }>
      {!meta ? <Loader /> : (
        <>
          <div className="grid cols-2" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="c-category">Catégorie</label>
              <select className="select" id="c-category" value={form.category}
                      onChange={event => set({ category: event.target.value })}>
                {meta.configCategories.map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="c-status">État</label>
              <select className="select" id="c-status" value={form.status}
                      onChange={event => set({ status: event.target.value })}>
                {meta.configStatuses.map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="c-label">Élément *</label>
            <input className="input" id="c-label"
                   placeholder="Ex. Chiffrement des données au repos"
                   value={form.label} onChange={event => set({ label: event.target.value })} />
          </div>

          <div className="field">
            <label htmlFor="c-value">Valeur *</label>
            <input className="input" id="c-value"
                   placeholder="Ex. AES-256-GCM (chiffrement de volume et base de données)"
                   value={form.value} onChange={event => set({ value: event.target.value })} />
          </div>

          <div className="field">
            <label htmlFor="c-details">Précisions</label>
            <textarea className="textarea" id="c-details"
                      placeholder="Gestion des clés, rotation, module matériel, exceptions…"
                      value={form.details}
                      onChange={event => set({ details: event.target.value })} />
          </div>

          <div className="field">
            <label htmlFor="c-scope">Périmètre</label>
            <input className="input" id="c-scope"
                   placeholder="Ex. Ensemble des environnements de production Azure West Europe"
                   value={form.scope} onChange={event => set({ scope: event.target.value })} />
          </div>
        </>
      )}
    </Modal>
  );
}
