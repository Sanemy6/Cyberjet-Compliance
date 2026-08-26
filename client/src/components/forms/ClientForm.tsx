import { useState } from 'react';
import { api } from '@/api/client';
import { useInvalidateAll } from '@/api/queries';
import type { ClientRow, ClientStatus } from '@/api/types';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { BusyButton, CLIENT_STATUSES } from '../Ui';
import { useToast } from '../Toast';

interface ClientFormProps {
  client?: ClientRow | null;
  onClose: () => void;
  onSaved?: (client: ClientRow) => void;
}

export function ClientForm({ client, onClose, onSaved }: ClientFormProps) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const isEdit = Boolean(client?.id);

  const [form, setForm] = useState({
    name: client?.name ?? '',
    country: client?.country ?? '',
    contact: client?.contact ?? '',
    description: client?.description ?? '',
    status: (client?.status ?? 'actif') as ClientStatus,
  });

  const set = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));

  const save = async () => {
    const payload = {
      name: form.name.trim(),
      country: form.country.trim() || null,
      contact: form.contact.trim() || null,
      description: form.description.trim() || null,
      status: form.status,
    };
    if (!payload.name) {
      toast('Nom obligatoire', 'Renseignez le nom du client.', 'warn');
      return;
    }

    try {
      const saved = isEdit
        ? await api.put<ClientRow>(`/api/clients/${client!.id}`, payload)
        : await api.post<ClientRow>('/api/clients', payload);
      invalidate();
      onClose();
      toast(isEdit ? 'Client mis à jour' : 'Client créé', saved.name, 'ok');
      onSaved?.(saved);
    } catch (error) {
      toast('Enregistrement impossible', (error as Error).message, 'error');
    }
  };

  return (
    <Modal title={isEdit ? 'Modifier le client' : 'Nouveau client'}
           sub={isEdit ? client!.name : 'Créez le dossier de conformité d’un client.'}
           onClose={onClose}
           footer={
             <>
               <button className="btn" onClick={onClose}>Annuler</button>
               <BusyButton className="btn primary" onClick={save}>
                 <Icon name="save" />{isEdit ? 'Enregistrer' : 'Créer le client'}
               </BusyButton>
             </>
           }>
      <div className="field">
        <label htmlFor="f-name">Nom du client *</label>
        <input className="input" id="f-name" maxLength={200} placeholder="Ex. Nordic Wings Airlines"
               value={form.name} onChange={event => set({ name: event.target.value })} />
      </div>

      <div className="grid cols-2" style={{ gap: 14 }}>
        <div className="field">
          <label htmlFor="f-country">Pays</label>
          <input className="input" id="f-country" placeholder="France"
                 value={form.country} onChange={event => set({ country: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="f-contact">Contact principal</label>
          <input className="input" id="f-contact" placeholder="Nom, fonction, e-mail"
                 value={form.contact} onChange={event => set({ contact: event.target.value })} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="f-desc">Contexte et périmètre</label>
        <textarea className="textarea" id="f-desc"
                  placeholder="Référentiels applicables, périmètre certifié, particularités…"
                  value={form.description}
                  onChange={event => set({ description: event.target.value })} />
      </div>

      <div className="field">
        <label htmlFor="f-status">Statut</label>
        <select className="select" id="f-status" value={form.status}
                onChange={event => set({ status: event.target.value as ClientStatus })}>
          {CLIENT_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
        </select>
        <p className="dim small mt-1">Prospect : dossier ouvert avant signature du contrat.</p>
      </div>
    </Modal>
  );
}
