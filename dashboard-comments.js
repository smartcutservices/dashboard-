import { auth } from './firebase-init.js';

const COMMENTS_API_BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const state = { comments: [], refreshInterval: null };
const elements = {
  list: document.getElementById('comments-list'),
  total: document.getElementById('total-comments'),
  today: document.getElementById('today-comments'),
  count: document.getElementById('result-count'),
  search: document.getElementById('comment-search'),
  refresh: document.getElementById('refresh-comments')
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function toDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return 'À l’instant';
  return new Intl.DateTimeFormat('fr-HT', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function isToday(value) {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

function filteredComments() {
  const search = String(elements.search?.value || '').trim().toLowerCase();
  if (!search) return state.comments;
  return state.comments.filter((comment) => String(comment.text || '').toLowerCase().includes(search));
}

function render() {
  const comments = filteredComments();
  elements.total.textContent = String(state.comments.length);
  elements.today.textContent = String(state.comments.filter((comment) => isToday(comment.createdAt)).length);
  elements.count.textContent = `${comments.length} message${comments.length > 1 ? 's' : ''}`;

  if (!comments.length) {
    elements.list.innerHTML = `<div class="empty-state">
      <i class="fas fa-comments" aria-hidden="true"></i>
      <span>${state.comments.length ? 'Aucun commentaire ne correspond à la recherche.' : 'Aucun commentaire enregistré pour le moment.'}</span>
    </div>`;
    return;
  }

  elements.list.innerHTML = comments.map((comment) => `<article class="comment-row">
    <div class="comment-avatar" aria-hidden="true">SC</div>
    <div class="comment-content">
      <div class="comment-meta">
        <strong>Client Smart Cut</strong>
        <span>${escapeHtml(formatDate(comment.createdAt))}</span>
        <span>Page d’accueil</span>
      </div>
      <p class="comment-text">${escapeHtml(comment.text)}</p>
    </div>
    <button class="delete-button" type="button" data-comment-id="${escapeHtml(comment.id)}" aria-label="Supprimer ce commentaire" title="Supprimer">
      <i class="fas fa-trash" aria-hidden="true"></i>
    </button>
  </article>`).join('');

  elements.list.querySelectorAll('[data-comment-id]').forEach((button) => {
    button.addEventListener('click', () => removeComment(button.dataset.commentId, button));
  });
}

async function removeComment(commentId, button) {
  const comment = state.comments.find((item) => item.id === commentId);
  if (!comment) return;
  const preview = String(comment.text || '').slice(0, 100);
  if (!window.confirm(`Supprimer définitivement ce commentaire ?\n\n${preview}`)) return;
  button.disabled = true;
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('admin-session-required');
    const response = await fetch(`${COMMENTS_API_BASE}/deleteSiteComment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ commentId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) throw new Error(payload.error || 'comment-delete-failed');
    await loadComments();
  } catch (error) {
    button.disabled = false;
    console.error('[COMMENTS_ADMIN] Suppression impossible:', error);
    window.alert('Impossible de supprimer ce commentaire pour le moment.');
  }
}

async function loadComments() {
  try {
    const response = await fetch(`${COMMENTS_API_BASE}/listSiteComments?limit=100`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) throw new Error(payload.error || 'comments-load-failed');
    state.comments = Array.isArray(payload.comments) ? payload.comments : [];
    render();
  } catch (error) {
    console.error('[COMMENTS_ADMIN] Chargement impossible:', error);
    elements.list.innerHTML = '<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><span>Impossible de charger les commentaires.</span></div>';
  }
}

function startCommentsModule() {
  loadComments();
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  state.refreshInterval = setInterval(loadComments, 30000);
}

elements.search?.addEventListener('input', render);
elements.refresh?.addEventListener('click', loadComments);
document.addEventListener('adminAccessGranted', startCommentsModule, { once: true });
window.addEventListener('beforeunload', () => clearInterval(state.refreshInterval));
setTimeout(() => {
  if (document.body.dataset.adminAccess === 'granted') startCommentsModule();
}, 300);
