import { ghLoad, ghSave, mergeData, pruneTombstones, configComplete, ConflictError } from './github.js';

const LS_DATA = 'ag.data';
const LS_CONFIG = 'ag.config';
const DATA_PATH = 'data.json';
const SYNC_DEBOUNCE_MS = 2500;

const STATUS_LABELS = { idea: 'Idée', todo: 'À acheter', bought: 'Acheté' };
const STATUS_ORDER = { todo: 0, idea: 1, bought: 2 };

// Pastilles de pièce, attribuées dans l'ordre du tableau rooms.
const ROOM_COLORS = ['#B4552F', '#8A6BC1', '#6E8F6B', '#C08A2E', '#4E7C93', '#9A6A85', '#7A7F5C', '#8B6F4E'];
const NEUTRAL_DOT = '#A79E92';

const state = {
  data: { version: 1, updatedAt: '', rooms: [], items: [] },
  config: { owner: '', repo: '', branch: 'main', path: DATA_PATH, token: '' },
  sha: null,
  filters: { status: 'all', room: 'all', search: '' },
  editingItemId: null,
  syncState: 'off', // off | ok | dirty | syncing | error
  syncTimer: null,
  syncing: false,
  pendingSync: false,
};

const $ = (sel) => document.querySelector(sel);

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function now() {
  return new Date().toISOString();
}

// ---------- Persistance locale ----------

function loadConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_CONFIG) || 'null');
    if (stored) Object.assign(state.config, stored);
  } catch { /* config illisible, on repart des défauts */ }

  // Sur *.github.io, pré-remplit le propriétaire depuis l'URL. Le repo de
  // données (privé) est distinct du repo de l'app : il reste à saisir.
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (m && !state.config.owner) state.config.owner = m[1];
}

function saveConfig() {
  localStorage.setItem(LS_CONFIG, JSON.stringify(state.config));
}

// Configuration en un clic : l'app ouverte avec #cfg=<base64> (lien généré
// depuis les réglages d'un appareil déjà configuré) s'auto-configure puis
// nettoie l'URL pour ne pas laisser le token dans l'historique.
function applyHashConfig() {
  const m = location.hash.match(/^#cfg=(.+)$/);
  if (!m) return;
  try {
    const cfg = JSON.parse(atob(decodeURIComponent(m[1])));
    Object.assign(state.config, cfg, { path: DATA_PATH });
    saveConfig();
  } catch (err) {
    console.error('Lien de configuration invalide :', err);
  }
  history.replaceState(null, '', location.pathname + location.search);
}

function configLink() {
  const { owner, repo, branch, token } = settingsFromForm();
  const encoded = encodeURIComponent(btoa(JSON.stringify({ owner, repo, branch, token })));
  return `${location.origin}${location.pathname}#cfg=${encoded}`;
}

function saveLocal() {
  localStorage.setItem(LS_DATA, JSON.stringify(state.data));
}

function loadInitialData() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_DATA) || 'null');
    if (stored && Array.isArray(stored.items)) state.data = stored;
  } catch { /* cache illisible : on démarre vide, la sync remplira */ }
}

// ---------- Synchronisation GitHub ----------

function setSyncState(s) {
  state.syncState = s;
  const el = $('#sync-indicator');
  el.dataset.state = s;
  el.title = {
    off: 'Synchronisation non configurée — cliquer pour configurer',
    ok: 'Synchronisé avec GitHub',
    dirty: 'Modifications locales en attente de synchronisation',
    syncing: 'Synchronisation en cours…',
    error: 'Erreur de synchronisation — cliquer pour réessayer',
  }[s];
}

function touch() {
  state.data.updatedAt = now();
  saveLocal();
  render();
  scheduleSync();
}

function scheduleSync() {
  if (!configComplete(state.config)) return;
  setSyncState('dirty');
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(syncNow, SYNC_DEBOUNCE_MS);
}

async function syncNow() {
  if (!configComplete(state.config)) {
    setSyncState('off');
    return;
  }
  if (state.syncing) {
    state.pendingSync = true;
    return;
  }
  state.syncing = true;
  setSyncState('syncing');

  try {
    await pushMerged();
    setSyncState('ok');
  } catch (err) {
    console.error('Échec de synchronisation :', err);
    setSyncState('error');
  } finally {
    state.syncing = false;
    if (state.pendingSync) {
      state.pendingSync = false;
      scheduleSync();
    }
  }
}

async function pushMerged(attempt = 0) {
  const remote = await ghLoad(state.config);
  const merged = pruneTombstones(mergeData(state.data, remote.data));

  const mergedJson = JSON.stringify(merged);
  if (remote.data && mergedJson === JSON.stringify(remote.data)) {
    state.sha = remote.sha;
  } else {
    try {
      state.sha = await ghSave(state.config, merged, remote.sha);
    } catch (err) {
      // Quelqu'un (un autre appareil) a poussé entre notre lecture et notre
      // écriture : on recharge et on refusionne, une seule fois.
      if (err instanceof ConflictError && attempt === 0) return pushMerged(1);
      throw err;
    }
  }

  state.data = merged;
  saveLocal();
  render();
}

// ---------- Sélecteurs ----------

function visibleItems() {
  return state.data.items.filter((it) => !it.deletedAt);
}

function roomById(id) {
  return state.data.rooms.find((r) => r.id === id);
}

function roomLabel(room) {
  return room ? room.name : '—';
}

function roomColor(room) {
  const i = state.data.rooms.indexOf(room);
  return i === -1 ? NEUTRAL_DOT : ROOM_COLORS[i % ROOM_COLORS.length];
}

function filteredItems() {
  const q = state.filters.search.trim().toLowerCase();
  return visibleItems().filter((it) => {
    if (state.filters.status !== 'all' && it.status !== state.filters.status) return false;
    if (state.filters.room !== 'all' && it.roomId !== state.filters.room) return false;
    if (q && !`${it.name} ${it.description || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function sortItems(items) {
  return [...items].sort((a, b) =>
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
    a.name.localeCompare(b.name, 'fr'));
}

// ---------- Rendu ----------

function render() {
  renderProgress();
  renderRoomFilters();
  renderList();
}

function renderProgress() {
  const items = visibleItems();
  const count = (s) => items.filter((it) => it.status === s).length;
  const n = { todo: count('todo'), idea: count('idea'), bought: count('bought') };
  $('#progress-line').innerHTML =
    `<span><b class="n-todo">${n.todo}</b> à acheter</span>` +
    `<span><b class="n-idea">${n.idea}</b> idée${n.idea > 1 ? 's' : ''}</span>` +
    `<span><b class="n-bought">${n.bought}</b> acheté${n.bought > 1 ? 's' : ''}</span>`;
}

function renderRoomFilters() {
  const el = $('#room-filters');
  const items = visibleItems();
  const chips = [{ id: 'all', name: 'Toutes les pièces', color: NEUTRAL_DOT, count: null }];
  for (const room of state.data.rooms) {
    const todo = items.filter((it) => it.roomId === room.id && it.status !== 'bought').length;
    chips.push({ id: room.id, name: room.name, color: roomColor(room), count: todo || null });
  }
  el.innerHTML = chips.map((c) => `
    <button class="chip ${state.filters.room === c.id ? 'is-active' : ''}" data-room="${esc(c.id)}">
      <span class="dot" style="background:${c.color}"></span>${esc(c.name)}${c.count ? `<span class="count">${c.count}</span>` : ''}
    </button>`).join('');
}

function linkDisplayName(link) {
  if (link.label) return link.label;
  try {
    return new URL(link.url).hostname.replace(/^www\./, '');
  } catch {
    return link.url;
  }
}

function itemCard(item) {
  const links = item.links || [];
  const preferred = links.find((l) => l.id === item.preferredLinkId) || links[0];
  const others = links.length - (preferred ? 1 : 0);
  const price = item.status !== 'idea' && preferred?.price ? esc(preferred.price) : '—';

  let linksHtml = '';
  if (preferred) {
    linksHtml = `
      <div class="row-links">
        <a class="merchant" href="${esc(preferred.url)}" target="_blank" rel="noopener">${esc(linkDisplayName(preferred))}</a>
        ${others > 0 ? `<span class="row-more">+${others} option${others > 1 ? 's' : ''}</span>` : ''}
      </div>`;
  }

  return `
    <article class="row status-${esc(item.status)}" data-id="${esc(item.id)}">
      <button class="check" data-check type="button" aria-label="Basculer en acheté">✓</button>
      <div class="row-body">
        <span class="row-name">${esc(item.name)}</span>
        <span class="row-status">${STATUS_LABELS[item.status] || item.status}</span>
        ${item.description ? `<p class="row-desc">${esc(item.description)}</p>` : ''}
        ${linksHtml}
      </div>
      <span class="row-price">${price}</span>
    </article>`;
}

function renderList() {
  const el = $('#item-list');
  const items = filteredItems();

  if (items.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucun article ici pour l'instant.<br>Ajoute-en un avec le bouton ＋</p>`;
    return;
  }

  if (state.filters.room === 'all') {
    const parts = [];
    const orderedRooms = [...state.data.rooms, { id: null, name: 'Sans pièce', emoji: '❓' }];
    for (const room of orderedRooms) {
      const inRoom = items.filter((it) => (it.roomId || null) === room.id);
      if (inRoom.length === 0) continue;
      parts.push(`<h3 class="room-header"><span class="dot" style="background:${roomColor(room)}"></span>${esc(room.name)}<span class="spacer"></span><span class="count">${inRoom.length}</span></h3>`);
      parts.push(...sortItems(inRoom).map(itemCard));
    }
    el.innerHTML = parts.join('');
  } else {
    el.innerHTML = sortItems(items).map(itemCard).join('');
  }
}

// ---------- Éditeur d'article ----------

function fillRoomSelect() {
  $('#f-room').innerHTML = state.data.rooms
    .map((r) => `<option value="${esc(r.id)}">${esc(roomLabel(r))}</option>`)
    .join('');
}

function linkRowHtml(link) {
  return `
    <div class="link-row" data-link-id="${esc(link.id)}">
      <input type="radio" name="preferred-link" value="${esc(link.id)}" title="Choix préféré">
      <input type="text" class="link-label" placeholder="Libellé (ex : IKEA Malm)" value="${esc(link.label || '')}">
      <button type="button" class="link-remove" title="Retirer cette option">✕</button>
      <div class="link-detail">
        <input type="text" class="link-price" placeholder="Prix" value="${esc(link.price || '')}">
        <input type="text" class="link-specs" placeholder="60 min · 65 dB · station murale" value="${esc(link.specs || '')}">
      </div>
      <input type="url" class="link-url" placeholder="https://…" value="${esc(link.url || '')}" inputmode="url">
    </div>`;
}

function addLinkRow(link) {
  $('#f-links').insertAdjacentHTML('beforeend', linkRowHtml(link || { id: crypto.randomUUID() }));
}

function openItemDialog(itemId) {
  state.editingItemId = itemId || null;
  const item = itemId ? state.data.items.find((it) => it.id === itemId) : null;

  fillRoomSelect();
  $('#item-dialog-eyebrow').textContent = item
    ? `${roomById(item.roomId)?.name || 'Sans pièce'} · ${STATUS_LABELS[item.status] || item.status}`
    : 'Article';
  $('#item-dialog-title').textContent = item ? 'Modifier l’article' : 'Nouvel article';
  $('#f-name').value = item?.name || '';
  $('#f-room').value = item?.roomId || state.filters.room !== 'all' && state.filters.room || state.data.rooms[0]?.id || '';
  $('#f-status').value = item?.status || 'todo';
  $('#f-description').value = item?.description || '';
  $('#btn-delete-item').hidden = !item;

  $('#f-links').innerHTML = '';
  for (const link of item?.links || []) addLinkRow(link);
  if (item?.preferredLinkId) {
    const radio = $(`#f-links input[type="radio"][value="${CSS.escape(item.preferredLinkId)}"]`);
    if (radio) radio.checked = true;
  }

  $('#item-dialog').showModal();
}

function collectLinks() {
  const rows = document.querySelectorAll('#f-links .link-row');
  const links = [];
  for (const row of rows) {
    const url = row.querySelector('.link-url').value.trim();
    if (!url) continue;
    links.push({
      id: row.dataset.linkId,
      url,
      label: row.querySelector('.link-label').value.trim(),
      price: row.querySelector('.link-price').value.trim(),
      specs: row.querySelector('.link-specs').value.trim(),
    });
  }
  const checked = document.querySelector('#f-links input[type="radio"]:checked');
  const preferredLinkId = checked && links.some((l) => l.id === checked.value) ? checked.value : (links[0]?.id ?? null);
  return { links, preferredLinkId };
}

function saveItemFromForm() {
  const name = $('#f-name').value.trim();
  if (!name) return;

  const { links, preferredLinkId } = collectLinks();
  const ts = now();

  if (state.editingItemId) {
    const item = state.data.items.find((it) => it.id === state.editingItemId);
    if (item) {
      Object.assign(item, {
        name,
        roomId: $('#f-room').value,
        status: $('#f-status').value,
        description: $('#f-description').value.trim(),
        links,
        preferredLinkId,
        updatedAt: ts,
      });
    }
  } else {
    state.data.items.push({
      id: crypto.randomUUID(),
      name,
      roomId: $('#f-room').value,
      status: $('#f-status').value,
      description: $('#f-description').value.trim(),
      links,
      preferredLinkId,
      createdAt: ts,
      updatedAt: ts,
    });
  }
  touch();
}

function deleteEditingItem() {
  const item = state.data.items.find((it) => it.id === state.editingItemId);
  if (!item) return;
  if (!confirm(`Supprimer « ${item.name} » ?`)) return;
  item.deletedAt = now();
  item.updatedAt = item.deletedAt;
  $('#item-dialog').close();
  touch();
}

// ---------- Réglages ----------

function openSettings() {
  $('#s-owner').value = state.config.owner;
  $('#s-repo').value = state.config.repo;
  $('#s-branch').value = state.config.branch;
  $('#s-token').value = state.config.token;
  const result = $('#settings-test-result');
  result.hidden = true;
  result.className = 'hint';
  $('#settings-dialog').showModal();
}

function settingsFromForm() {
  return {
    owner: $('#s-owner').value.trim(),
    repo: $('#s-repo').value.trim(),
    branch: $('#s-branch').value.trim() || 'main',
    path: DATA_PATH,
    token: $('#s-token').value.trim(),
  };
}

async function testConnection() {
  const cfg = settingsFromForm();
  const result = $('#settings-test-result');
  result.hidden = false;
  result.className = 'hint';
  if (!configComplete(cfg)) {
    result.textContent = 'Renseigne au minimum propriétaire, repo et token.';
    return;
  }
  result.textContent = 'Test en cours…';
  try {
    const { data } = await ghLoad(cfg);
    result.className = 'hint ok';
    result.textContent = data
      ? `✓ Connexion OK — data.json trouvé (${data.items.length} articles).`
      : '✓ Connexion OK — data.json sera créé au premier enregistrement.';
  } catch (err) {
    result.className = 'hint error';
    result.textContent = `✗ Échec : ${err.message}. Vérifie le token et ses permissions (Contents : Read and write).`;
  }
}

// ---------- Événements ----------

function bindEvents() {
  $('#btn-add').addEventListener('click', () => openItemDialog(null));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#sync-indicator').addEventListener('click', () => {
    if (!configComplete(state.config)) openSettings();
    else syncNow();
  });

  $('#search').addEventListener('input', (e) => {
    state.filters.search = e.target.value;
    renderList();
  });

  $('#status-filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.filters.status = chip.dataset.status;
    for (const c of $('#status-filters').children) c.classList.toggle('is-active', c === chip);
    renderList();
  });

  $('#room-filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.filters.room = chip.dataset.room;
    render();
  });

  $('#item-list').addEventListener('click', (e) => {
    const check = e.target.closest('[data-check]');
    if (check) {
      e.stopPropagation();
      const row = check.closest('.row');
      const item = state.data.items.find((it) => it.id === row?.dataset.id);
      if (item) {
        if (item.status === 'bought') {
          item.status = item.prevStatus || 'todo';
        } else {
          item.prevStatus = item.status;
          item.status = 'bought';
        }
        item.updatedAt = now();
        touch();
      }
      return;
    }
    if (e.target.closest('a')) return; // laisser les liens s'ouvrir
    const card = e.target.closest('.row');
    if (card) openItemDialog(card.dataset.id);
  });

  $('#item-form').addEventListener('submit', (e) => {
    if (!$('#f-name').value.trim()) {
      e.preventDefault();
      return;
    }
    saveItemFromForm();
  });

  $('#btn-add-link').addEventListener('click', () => addLinkRow());
  $('#btn-delete-item').addEventListener('click', deleteEditingItem);

  $('#f-links').addEventListener('click', (e) => {
    const btn = e.target.closest('.link-remove');
    if (btn) btn.closest('.link-row').remove();
  });

  $('#settings-form').addEventListener('submit', () => {
    state.config = settingsFromForm();
    saveConfig();
    syncNow();
  });

  $('#btn-test-connection').addEventListener('click', testConnection);

  $('#btn-copy-link').addEventListener('click', () => {
    const result = $('#settings-test-result');
    result.hidden = false;
    if (!configComplete(settingsFromForm())) {
      result.className = 'hint error';
      result.textContent = 'Renseigne d\'abord propriétaire, repo et token.';
      $('#config-link-box').hidden = true;
      return;
    }

    const link = configLink();
    const input = $('#config-link-input');
    input.value = link;
    $('#config-link-box').hidden = false;

    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    $('#config-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });

    // Copie automatique si le navigateur veut bien ; sinon le lien reste
    // affiché et sélectionnable, et le QR code suffit pour un téléphone.
    input.select();
    navigator.clipboard?.writeText(link).then(
      () => {
        result.className = 'hint ok';
        result.textContent = '✓ Lien aussi copié dans le presse-papiers.';
      },
      () => {
        result.className = 'hint';
        result.textContent = 'Scanne le QR code, ou sélectionne le lien pour le copier.';
      },
    );
  });

  // Un tap sur le lien le sélectionne en entier (copie facile sur mobile).
  $('#config-link-input').addEventListener('focus', (e) => e.target.select());

  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  }

  // Resynchronise quand l'app revient au premier plan (retour de veille sur mobile).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && configComplete(state.config)) syncNow();
  });
}

// ---------- Démarrage ----------

async function init() {
  loadConfig();
  applyHashConfig();
  bindEvents();
  loadInitialData();
  render();
  if (configComplete(state.config)) {
    syncNow();
  } else {
    setSyncState('off');
  }
}

init();
