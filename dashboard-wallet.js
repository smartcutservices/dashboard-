import { auth, authReadyPromise } from './firebase-init.js';

const API = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/walletAdminOverview';
const money = (minor) => `${(Number(minor || 0) / 100).toLocaleString('fr-HT', { maximumFractionDigits: 2 })} HTG`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const date = (value) => { const parsed = new Date(value || ''); return Number.isNaN(parsed.getTime()) ? 'Date indisponible' : parsed.toLocaleString('fr-HT', { dateStyle:'medium', timeStyle:'short' }); };

class WalletAdminPage {
  constructor() { this.query = ''; this.load(); this.bind(); }
  async request({ userId = '' } = {}) {
    await authReadyPromise;
    if (!auth.currentUser) throw new Error('Connexion administrateur requise.');
    const token = await auth.currentUser.getIdToken();
    const url = new URL(API); if (this.query) url.searchParams.set('q', this.query); if (userId) url.searchParams.set('userId', userId);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || data.error || 'Impossible de charger les Wallets.');
    return data;
  }
  bind() {
    document.getElementById('refresh').addEventListener('click', () => this.load());
    document.getElementById('searchForm').addEventListener('submit', (event) => { event.preventDefault(); this.query = document.getElementById('searchInput').value.trim(); this.load(); });
  }
  async load(userId = '') {
    const rows = document.getElementById('walletRows'); rows.innerHTML = '<tr><td colspan="5" class="empty">Chargement…</td></tr>';
    try { const data = await this.request({ userId }); this.render(data); } catch (error) { rows.innerHTML = `<tr><td colspan="5" class="empty">${esc(error.message)}</td></tr>`; }
  }
  render(data) {
    const overview = data.overview || {}; document.getElementById('totalBalance').textContent = money(overview.totalMinor); document.getElementById('availableBalance').textContent = money(overview.availableMinor); document.getElementById('reservedBalance').textContent = money(overview.reservedMinor); document.getElementById('activeWallets').textContent = Number(overview.activeWalletCount || 0).toLocaleString('fr-FR'); document.getElementById('walletCount').textContent = `${Number(overview.walletCount || 0).toLocaleString('fr-FR')} Wallets créés`;
    const wallets = data.wallets || []; document.getElementById('resultCount').textContent = wallets.length; const rows = document.getElementById('walletRows'); rows.innerHTML = wallets.length ? wallets.map((wallet) => `<tr><td><strong>${esc(wallet.client?.name || 'Utilisateur Smart Cut')}</strong><small>${esc(wallet.client?.email || wallet.client?.phone || wallet.userId)}</small></td><td><span class="status ${wallet.status === 'ACTIVE' ? '' : 'blocked'}">${esc(wallet.status)}</span></td><td>${money(wallet.availableMinor)}</td><td>${money(wallet.reservedMinor)}</td><td><button class="view" data-user-id="${esc(wallet.userId)}">Voir</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Aucun Wallet ne correspond à cette recherche.</td></tr>';
    rows.querySelectorAll('[data-user-id]').forEach((button) => button.addEventListener('click', () => this.load(button.dataset.userId)));
    this.renderDetail(data.detail);
  }
  renderDetail(detail) {
    const panel = document.getElementById('detailPanel'); if (!detail?.wallet) { panel.innerHTML = '<div class="panel-head"><div><p class="eyebrow">Traçabilité</p><h2>Détail Wallet</h2></div></div><div class="empty">Sélectionnez un utilisateur pour voir ses dépôts, paiements, remboursements et réservations.</div>'; return; }
    const wallet = detail.wallet; const client = wallet.client || {}; const movements = [...(detail.ledger || []), ...(detail.holds || [])].sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const movement = (item) => { const credit = item.direction === 'CREDIT' || item.direction === 'RELEASE'; return `<div class="movement ${credit ? 'credit' : 'debit'}"><i class="fas ${credit ? 'fa-arrow-down' : 'fa-arrow-up'}"></i><div><strong>${esc(item.type)}</strong><small>${esc(item.referenceId || item.status || 'Smart Wallet')} · ${date(item.createdAt)}</small></div><span>${credit ? '+' : '-'}${money(item.amountMinor)}</span></div>`; };
    panel.innerHTML = `<div class="panel-head"><div><p class="eyebrow">Traçabilité</p><h2>Détail Wallet</h2></div></div><div class="detail-user"><h3>${esc(client.name || 'Utilisateur Smart Cut')}</h3><p>${esc(client.email || client.phone || wallet.userId)}</p><p>UID : ${esc(wallet.userId)}</p></div><div class="detail-balances"><div><span>Disponible</span><strong>${money(wallet.availableMinor)}</strong></div><div><span>Réservé</span><strong>${money(wallet.reservedMinor)}</strong></div></div><h3 class="movement-title">Historique des mouvements</h3>${movements.length ? movements.map(movement).join('') : '<div class="empty">Aucun mouvement enregistré.</div>'}<h3 class="movement-title">Recharges initiées</h3>${(detail.topups || []).length ? detail.topups.map(movement).join('') : '<div class="empty">Aucune recharge initiée.</div>'}`;
  }
}
new WalletAdminPage();
