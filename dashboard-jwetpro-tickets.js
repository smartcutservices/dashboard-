import { auth } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';

const API_BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const state = { tickets: [], orders: [], payouts: [], credits: [], settings: { enabled: false, globalCommissionRate: 10, specialRates: {} } };
const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('fr-HT', { style: 'currency', currency: 'HTG', maximumFractionDigits: 0 }).format(Number(value) || 0);
const safe = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

async function token() {
  if (!auth.currentUser) await new Promise(resolve => { const stop = onAuthStateChanged(auth, () => { stop(); resolve(); }); });
  if (!auth.currentUser) throw new Error('Session administrateur requise.');
  return auth.currentUser.getIdToken();
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}/${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}`, ...options.headers } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function filteredOrders() {
  const search = $('search-input').value.trim().toLowerCase(), status = $('status-filter').value, date = $('date-filter').value;
  return state.orders.filter(order => (!search || JSON.stringify(order).toLowerCase().includes(search)) && (!status || order.status === status) && (!date || String(order.paidAt || order.createdAt || '').startsWith(date)));
}

function render() {
  const paid = state.orders.filter(order => order.status === 'paid');
  const gross = paid.reduce((sum, order) => sum + Number(order.grossAmount || order.amount || 0), 0);
  const commission = paid.reduce((sum, order) => sum + Number(order.commissionAmount || 0), 0);
  const net = paid.reduce((sum, order) => sum + Number(order.netAmount || 0), 0);
  const completedIds = new Set(state.tickets.filter(ticket => ticket.status === 'completed').map(ticket => ticket.championshipId || ticket.id));
  const directPending = paid.filter(order => order.payoutStatus !== 'paid' && order.payoutStatus !== 'credit_pending');
  const payable = directPending.filter(order => completedIds.has(order.payoutChampionshipId || order.championshipId)).reduce((sum, order) => sum + Number(order.netAmount || 0), 0) + state.credits.filter(credit => credit.status === 'upcoming' && completedIds.has(credit.targetChampionshipId)).reduce((sum, credit) => sum + Number(credit.netAmount || 0), 0);
  const upcoming = directPending.filter(order => !completedIds.has(order.payoutChampionshipId || order.championshipId)).reduce((sum, order) => sum + Number(order.netAmount || 0), 0) + state.credits.filter(credit => credit.status === 'upcoming' && !completedIds.has(credit.targetChampionshipId)).reduce((sum, credit) => sum + Number(credit.netAmount || 0), 0);
  const reversed = state.payouts.reduce((sum, payout) => sum + Number(payout.netAmount || 0), 0);
  $('stats').innerHTML = [['Tickets vendus', paid.length], ['Chiffre d’affaires', money(gross)], ['Commission Smart Cut', money(commission)], ['Net JwetPro', money(net)], ['À venir', money(upcoming)], ['Payable', money(payable)], ['Déjà reversé', money(reversed)]].map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
  const orders = filteredOrders(); $('result-count').textContent = `${orders.length} paiement(s)`;
  const groups = state.tickets.map(ticket => ({ ticket, orders: orders.filter(order => order.championshipId === ticket.championshipId || order.championshipId === ticket.id) }));
  $('championship-list').innerHTML = groups.length ? groups.map(({ ticket, orders: ticketOrders }) => {
    const id = ticket.championshipId || ticket.id, paidOrders = ticketOrders.filter(order => order.status === 'paid');
    const totals = paidOrders.reduce((result, order) => { result.commission += Number(order.commissionAmount || 0); result.net += Number(order.netAmount || 0); return result; }, { commission: 0, net: 0 });
    const available = Math.max(0, Number(ticket.capacity || 0) - Number(ticket.paidCount || 0) - Number(ticket.reservedCount || 0));
    const specialRate = state.settings.specialRates?.[id];
    return `<article class="championship"><div class="championship-head"><div><h3>${safe(ticket.name || ticket.id)}</h3><span class="badge">${safe(ticket.status || 'fermé')}</span></div>${ticket.status === 'completed' && paidOrders.some(order => order.payoutStatus !== 'paid') ? `<button class="button payout-btn" data-id="${safe(id)}">Créer le reversement</button>` : ''}</div><div class="metrics"><div class="metric"><small>Disponibles</small><strong>${available}</strong></div><div class="metric"><small>Réservées</small><strong>${Number(ticket.reservedCount || 0)}</strong></div><div class="metric"><small>Vendues</small><strong>${paidOrders.length}</strong></div><div class="metric"><small>Commission</small><strong>${money(totals.commission)}</strong></div><div class="metric"><small>Net</small><strong>${money(totals.net)}</strong></div></div><div class="rate-editor"><label>Commission spéciale (%)<input class="special-rate" data-id="${safe(id)}" type="number" min="0" max="100" step="0.1" value="${specialRate ?? ''}" placeholder="Taux global"></label><button class="button compact save-rate" data-id="${safe(id)}">Appliquer</button></div><div class="orders">${ticketOrders.slice(0, 25).map(order => `<div class="order"><span>${safe(order.playerName || order.playerEmail || order.playerUid)}</span><span>${safe(order.providerTransactionId || 'Sans référence')}</span><span>${money(order.amount)}</span><span class="badge">${safe(order.status)}</span></div>`).join('') || '<span class="empty">Aucune vente.</span>'}</div></article>`;
  }).join('') : '<p class="empty">Aucun championnat synchronisé.</p>';
  $('alerts').innerHTML = [...state.tickets.filter(ticket => Number(ticket.capacity || 0) > 0 && Number(ticket.paidCount || 0) + Number(ticket.reservedCount || 0) >= Number(ticket.capacity || 0)).map(ticket => `<div class="alert">Capacité atteinte : ${safe(ticket.name)}</div>`), ...state.orders.filter(order => order.jwetproCallbackStatus === 'failed').map(order => `<div class="alert">Synchronisation échouée : ${safe(order.championshipName || order.id)}</div>`), ...state.orders.filter(order => order.jwetproRegistrationStatus === 'credited').map(order => `<div class="alert">Paiement tardif transformé en crédit : ${safe(order.championshipName || order.id)}</div>`)].join('') || '<p class="empty">Aucune alerte.</p>';
  $('credits').innerHTML = state.credits.map(credit => `<div class="alert"><strong>${money(credit.grossAmount)}</strong><br>${safe(credit.sourceIntentId)} → ${safe(credit.targetChampionshipId)}<br><small>${safe(credit.status || 'à venir')}</small></div>`).join('') || '<p class="empty">Aucun crédit réutilisé.</p>';
  $('payouts').innerHTML = state.payouts.map(payout => `<div class="alert"><strong>${safe(payout.championshipName || payout.championshipId)}</strong><br>${money(payout.netAmount)} · ${safe(payout.status || 'créé')}<br><small>${safe(payout.createdAt || '')}</small></div>`).join('') || '<p class="empty">Aucun reversement.</p>';
  $('enabled-input').checked = state.settings.enabled === true; $('rate-input').value = state.settings.globalCommissionRate ?? 10;
  document.querySelectorAll('.payout-btn').forEach(button => { button.onclick = () => createPayout(button.dataset.id); });
  document.querySelectorAll('.save-rate').forEach(button => { button.onclick = () => saveSpecialRate(button.dataset.id).catch(error => alert(error.message)); });
}

async function load() { Object.assign(state, await api('getJwetproTicketAdminData')); render(); }
async function saveSettings() { await api('manageJwetproTickets', { method: 'POST', body: JSON.stringify({ action: 'save-settings', enabled: $('enabled-input').checked, globalCommissionRate: Number($('rate-input').value), specialRates: state.settings.specialRates || {} }) }); await load(); }
async function saveSpecialRate(championshipId) {
  const input = document.querySelector(`.special-rate[data-id="${CSS.escape(championshipId)}"]`), raw = input?.value.trim(), next = { ...(state.settings.specialRates || {}) };
  if (raw === '') delete next[championshipId]; else { const rate = Number(raw); if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('Le taux doit être compris entre 0 et 100.'); next[championshipId] = rate; }
  await api('manageJwetproTickets', { method: 'POST', body: JSON.stringify({ action: 'save-settings', enabled: state.settings.enabled === true, globalCommissionRate: Number(state.settings.globalCommissionRate ?? 10), specialRates: next }) }); await load();
}
async function createPayout(championshipId) { if (!confirm('Confirmer le reversement JwetPro pour ce championnat terminé ?')) return; await api('manageJwetproTickets', { method: 'POST', body: JSON.stringify({ action: 'create-payout', championshipId, method: 'manuel' }) }); await load(); }

$('refresh-btn').onclick = () => load().catch(error => alert(error.message)); $('export-btn').onclick = () => window.print(); $('save-settings-btn').onclick = () => saveSettings().catch(error => alert(error.message));
['search-input', 'status-filter', 'date-filter'].forEach(id => $(id).addEventListener('input', render));
document.addEventListener('adminAccessGranted', () => load().catch(error => { $('championship-list').innerHTML = `<p class="empty">${safe(error.message)}</p>`; }), { once: true });
setTimeout(() => { if (document.body.dataset.adminAccess === 'granted') load(); }, 300);
