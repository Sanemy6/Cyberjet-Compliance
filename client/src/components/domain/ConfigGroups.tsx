import type { ConfigItem } from '@/api/types';
import { Icon } from '../Icon';

const TONE: Record<string, string> = {
  'en place': 'ok',
  partiel: 'warn',
  'planifié': '',
  'non applicable': 'outline',
};

/** Configurations techniques d'un client, regroupées par famille. */
export function ConfigGroups({ configs, onEdit, onDelete }: {
  configs: ConfigItem[];
  onEdit: (config: ConfigItem) => void;
  onDelete: (config: ConfigItem) => void;
}) {
  const groups = new Map<string, ConfigItem[]>();
  for (const config of configs) {
    const bucket = groups.get(config.category);
    if (bucket) bucket.push(config);
    else groups.set(config.category, [config]);
  }

  return (
    <>
      {[...groups.entries()].map(([category, items]) => (
        <div className="card" style={{ marginBottom: 14 }} key={category}>
          <div className="card-head">
            <h2>{category}</h2>
            <span className="badge">{items.length}</span>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Élément</th>
                  <th>Valeur en place</th>
                  <th style={{ width: 120 }}>État</th>
                  <th style={{ width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {items.map(config => (
                  <tr key={config.id}>
                    <td>
                      <strong>{config.label}</strong>
                      {config.scope && (
                        <div className="dim" style={{ fontSize: '.75rem', marginTop: 3 }}>
                          {config.scope}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="mono">{config.value}</span>
                      {config.details && (
                        <div className="muted small mt-1 pre-wrap">{config.details}</div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${TONE[config.status] ?? ''}`}>{config.status}</span>
                    </td>
                    <td className="actions">
                      <button className="icon-btn sm" title="Modifier"
                              onClick={() => onEdit(config)}>
                        <Icon name="edit" />
                      </button>
                      <button className="icon-btn sm" title="Supprimer"
                              onClick={() => onDelete(config)}>
                        <Icon name="trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
