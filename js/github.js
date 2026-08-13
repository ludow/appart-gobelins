// Synchronisation avec l'API GitHub Contents.
// Le fichier data.json du repo est la source de vérité partagée entre appareils.

const API = 'https://api.github.com';

export class ConflictError extends Error {
  constructor() { super('Conflit de version (sha obsolète)'); }
}

function headers(token) {
  const h = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function b64decode(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function configComplete(cfg) {
  return Boolean(cfg && cfg.owner && cfg.repo && cfg.token);
}

// Retourne { data, sha } — data vaut null si le fichier n'existe pas encore.
export async function ghLoad(cfg) {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, { headers: headers(cfg.token), cache: 'no-store' });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status} au chargement`);
  const json = await res.json();
  return { data: JSON.parse(b64decode(json.content)), sha: json.sha };
}

// Retourne le nouveau sha du fichier.
export async function ghSave(cfg, data, sha) {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;
  const body = {
    message: 'données : mise à jour depuis l’app',
    content: b64encode(JSON.stringify(data, null, 2) + '\n'),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: headers(cfg.token),
    body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 422) throw new ConflictError();
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status} à l'enregistrement`);
  const json = await res.json();
  return json.content.sha;
}

// Fusionne deux versions des données : article par article, la modification
// la plus récente gagne (updatedAt). Les suppressions sont des tombstones
// (deletedAt) pour ne pas ressusciter un article supprimé sur un autre appareil.
export function mergeData(a, b) {
  if (!a) return b;
  if (!b) return a;

  const byId = new Map();
  for (const item of a.items) byId.set(item.id, item);
  for (const item of b.items) {
    const existing = byId.get(item.id);
    if (!existing || (item.updatedAt || '') > (existing.updatedAt || '')) {
      byId.set(item.id, item);
    }
  }

  const roomIds = new Set();
  const rooms = [];
  for (const room of [...a.rooms, ...b.rooms]) {
    if (!roomIds.has(room.id)) {
      roomIds.add(room.id);
      rooms.push(room);
    }
  }

  return {
    version: 1,
    updatedAt: [a.updatedAt, b.updatedAt].sort().pop() || new Date().toISOString(),
    rooms,
    items: [...byId.values()],
  };
}

// Purge les tombstones de plus de 30 jours pour que le fichier ne gonfle pas.
export function pruneTombstones(data) {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  data.items = data.items.filter((it) => !it.deletedAt || it.deletedAt > cutoff);
  return data;
}
