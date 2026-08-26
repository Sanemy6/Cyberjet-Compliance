import { useEffect, useState } from 'react';

/**
 * Valeur retardée : le filtre ne part au serveur qu'une fois la frappe calmée.
 * Sans cela, « chiffrement » déclencherait onze requêtes dont dix inutiles.
 */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
