/**
 * Client HTTP de l'API.
 *
 * Volontairement mince : la mise en cache, la déduplication des requêtes en vol
 * et l'invalidation après écriture sont le travail de React Query. Ce qui reste
 * ici, c'est ce que React Query ne fait pas — la forme des erreurs, la session
 * expirée, et le téléchargement de fichiers.
 */

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload: unknown = null) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Appelé quand le serveur répond 401 hors des endpoints d'authentification :
 *  la session a expiré ou a été révoquée à distance. */
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(handler: () => void) {
  onSessionLost = handler;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {}, credentials: 'same-origin' };

  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(
      'Serveur injoignable. Vérifiez que l’application est démarrée.', 0);
  }

  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    // On prévient l'application — elle rebascule sur l'écran de connexion — puis
    // on lève, comme pour n'importe quelle erreur.
    //
    // Surtout pas une promesse qui ne se résout jamais : c'était le réflexe de
    // la version précédente, où `window.location` rechargeait la page et
    // emportait tout. Ici, une promesse en suspens laisse la requête « en
    // cours » pour toujours, et l'écran tourne indéfiniment au lieu d'afficher
    // quoi que ce soit.
    onSessionLost?.();
    throw new ApiError('Session expirée. Reconnectez-vous.', 401);
  }

  if (response.status === 204) return null as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? String((payload as { detail: unknown }).detail)
        : typeof payload === 'string' ? payload : '';
    throw new ApiError(detail || `Erreur ${response.status}`, response.status, payload);
  }

  return payload as T;
}

type QueryParams = Record<string, string | number | boolean | null | undefined>;

export function qs(params: QueryParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export const api = {
  get: <T>(path: string, params?: QueryParams) => request<T>('GET', path + qs(params)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

/**
 * Télécharge un fichier produit par l'API en respectant le nom donné par le
 * serveur. Passer par `window.location` perdrait le message d'erreur : une
 * réponse 400 s'afficherait comme une page blanche.
 */
export async function download(url: string): Promise<void> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    let detail = `Erreur ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.detail) detail = String(payload.detail);
    } catch { /* réponse non JSON : on garde le code */ }
    throw new ApiError(detail, response.status);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : 'export.xlsx';

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
