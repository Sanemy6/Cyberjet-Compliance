/* Client HTTP minimal pour l'API locale. */

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function request(method, path, body, options = {}) {
  const init = { method, headers: {} };

  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch (cause) {
    throw new ApiError('Serveur injoignable. Vérifiez que l’application est démarrée.', 0, null);
  }

  // Session expirée ou absente : direction la page de connexion, sauf pour
  // les appels d'authentification eux-mêmes qui gèrent leur propre 401/429.
  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    window.location.href = '/login';
    return new Promise(() => {}); // la navigation coupe court, rien à résoudre
  }

  if (options.raw) return response;

  if (response.status === 204) return null;

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!response.ok) {
    const detail = payload && typeof payload === 'object' ? payload.detail : payload;
    throw new ApiError(formatDetail(detail) || `Erreur ${response.status}`, response.status, payload);
  }
  return payload;
}

/* FastAPI renvoie soit une chaîne, soit la liste d'erreurs de validation. */
function formatDetail(detail) {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : '';
        return field ? `${field} : ${item.msg}` : item.msg;
      })
      .join(' — ');
  }
  return JSON.stringify(detail);
}

function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, value);
  }
  const string = search.toString();
  return string ? `?${string}` : '';
}

export const api = {
  qs,
  get: (path, params) => request('GET', path + qs(params)),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
  upload: (path, formData) => request('POST', path, formData),
};
