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

/* ------------------------------------------------------------------ */
/* Cache mémoire des lectures                                          */
/* ------------------------------------------------------------------ */
/* Revenir sur une page déjà visitée ne doit pas repayer l'aller-retour réseau :
   la navigation paraît alors instantanée. Deux garde-fous contre le contenu
   périmé : une durée de vie courte, et toute écriture qui vide tout — mieux
   vaut une requête de plus qu'une liste qui ignore ce qu'on vient d'y créer. */
const READ_TTL = 10_000;
const reads = new Map();    // chemin complet → { at, payload }
const pending = new Map();  // chemin complet → requête en vol

function invalidate() {
  reads.clear();
}

/* Reprendre la main sur l'onglet peut vouloir dire « j'ai été absent un
   moment » : on repart du réseau plutôt que de servir une vue d'il y a dix
   minutes restée en mémoire. */
window.addEventListener('focus', invalidate);

/* Les vues reçoivent une copie : deux d'entre elles peuvent lire la même entrée,
   aucune ne doit pouvoir corrompre le cache en retouchant l'objet servi. */
function copy(payload) {
  return payload && typeof payload === 'object' ? structuredClone(payload) : payload;
}

function read(path) {
  const hit = reads.get(path);
  if (hit && Date.now() - hit.at < READ_TTL) return Promise.resolve(copy(hit.payload));

  /* Deux demandes simultanées du même chemin ne partent qu'une fois : c'est ce
     qui rend un survol qui préchauffe, suivi du clic, gratuit. */
  const inFlight = pending.get(path);
  if (inFlight) return inFlight.then(copy);

  /* Le cache garde son propre exemplaire et rend l'original à l'appelant : les
     vues retouchent couramment ce qu'elles ont reçu (fusion d'une réponse
     PATCH dans la question affichée, par exemple), et ces retouches ne doivent
     pas se retrouver servies au suivant. */
  const promise = request('GET', path)
    .then((payload) => {
      reads.set(path, { at: Date.now(), payload: copy(payload) });
      return payload;
    })
    .finally(() => pending.delete(path));

  pending.set(path, promise);
  return promise;
}

function write(method, path, body) {
  invalidate();
  return request(method, path, body);
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
  invalidate,
  get: (path, params) => read(path + qs(params)),
  post: (path, body) => write('POST', path, body),
  put: (path, body) => write('PUT', path, body),
  patch: (path, body) => write('PATCH', path, body),
  del: (path) => write('DELETE', path),
  upload: (path, formData) => write('POST', path, formData),
};
