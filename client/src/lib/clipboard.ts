type Notify = (title: string, message?: string, kind?: 'ok' | 'error' | 'warn' | 'info',
               duration?: number) => void;

/**
 * Copie dans le presse-papiers avec retour visible.
 *
 * L'API n'est offerte qu'en contexte sécurisé : servie en HTTP sur un réseau
 * interne, elle est absente. On le dit plutôt que de laisser croire à une copie
 * silencieuse qui n'a pas eu lieu.
 */
export async function copyText(value: string, notify: Notify): Promise<void> {
  if (!navigator.clipboard) {
    notify('Copie impossible',
           'Le navigateur ne l’autorise que sur une connexion sécurisée (HTTPS).', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    notify('Copié dans le presse-papiers', '', 'ok', 1800);
  } catch {
    notify('Copie impossible', '', 'error');
  }
}
