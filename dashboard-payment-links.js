import { getAuthManager } from './auth.js';
import { db } from './firebase-init.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const API = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const app = document.getElementById('payment-links-app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => new Intl.NumberFormat('fr-HT', { style: 'currency', currency: 'HTG', maximumFractionDigits: 0 }).format(Number(v || 0));
const date = (v) => v ? new Intl.DateTimeFormat('fr-HT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '—';

class PaymentLinksAdmin {
  constructor() { this.auth = getAuthManager(); this.user = null; this.links = []; }

  async api(path, options = {}) {
    const token = await this.user.getIdToken();
    const response = await fetch(`${API}/${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(payload.message || payload.error || 'Opération impossible.');
    return payload;
  }

  async init() {
    await this.auth.waitForAuthReady?.(); this.user = this.auth.getCurrentUser?.();
    if (!this.user) return this.login();
    const profile = await getDoc(doc(db, 'clients', this.user.uid));
    if (!profile.exists() || String(profile.data()?.role || '').toLowerCase() !== 'admin') return this.denied();
    await this.load(); this.render(); this.bind();
  }

  async load() { this.links = (await this.api('managePaymentLinks')).links || []; }
  status(link) { return link.status === 'deleted' ? 'deleted' : (link.expiresAt && new Date(link.expiresAt) <= new Date() ? 'expired' : 'active'); }
  login() { app.innerHTML = '<div class="pl-shell"><section class="panel"><h1>Connexion administrateur requise</h1><p>Connectez-vous pour gérer les liens de paiement.</p><button class="button" data-login>Se connecter</button></section></div>'; app.querySelector('[data-login]').onclick = () => this.auth.openAuthModal?.('login'); document.addEventListener('authChanged', () => this.init(), { once: true }); }
  denied() { app.innerHTML = '<div class="pl-shell"><section class="panel"><h1>Accès refusé</h1><p>Seuls les administrateurs Smart Cut peuvent gérer les liens de paiement.</p></section></div>'; }

  render() {
    const active = this.links.filter((link) => this.status(link) === 'active');
    const total = this.links.reduce((sum, link) => sum + Number(link.paidTotal || 0), 0);
    const payments = this.links.reduce((sum, link) => sum + Number(link.paymentCount || 0), 0);
    const rows = this.links.map((link) => {
      const status = this.status(link); const url = `https://smartcutservices.com/payment-link.html?ref=${encodeURIComponent(link.reference)}`;
      return `<tr><td><strong>${esc(link.title)}</strong><small>${esc(link.description)}</small></td><td><strong>${money(link.amount)}</strong><small>${link.expiresAt ? `Expire ${date(link.expiresAt)}` : 'Sans expiration'}</small></td><td class="hide-sm"><div class="link-code"><input readonly value="${esc(url)}"><button class="button secondary small" data-copy="${esc(url)}">Copier</button></div></td><td><strong>${money(link.paidTotal)}</strong><small>${Number(link.paymentCount || 0)} paiement(s)</small></td><td><span class="badge ${status}">${status === 'active' ? 'Actif' : status === 'expired' ? 'Expiré' : 'Supprimé'}</span></td><td><div class="actions"><button class="button secondary small" data-payments="${esc(link.reference)}">Paiements</button>${status !== 'deleted' ? `<button class="button secondary small" data-edit="${esc(link.reference)}">Modifier</button><button class="button danger small" data-delete="${esc(link.reference)}">Supprimer</button>` : ''}</div></td></tr>`;
    }).join('') || '<tr><td colspan="6"><div class="empty">Aucun lien créé pour le moment.</div></td></tr>';
    app.innerHTML = `<div class="pl-shell"><header class="pl-head"><div><p class="eyebrow">Encaissement direct</p><h1>Liens de paiement</h1><p>Créez une demande MonCash, partagez-la et identifiez chaque personne ayant payé.</p></div><button class="button" data-new><i class="fas fa-plus"></i> Nouveau lien</button></header><section class="stats"><article class="stat"><span>Liens actifs</span><strong>${active.length}</strong></article><article class="stat"><span>Paiements confirmés</span><strong>${payments}</strong></article><article class="stat"><span>Total encaissé</span><strong>${money(total)}</strong></article><article class="stat"><span>Liens archivés</span><strong>${this.links.length - active.length}</strong></article></section><section class="panel"><div class="panel-head"><h2>Vos demandes de paiement</h2><span class="badge">${this.links.length} lien(s)</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Titre interne</th><th>Montant</th><th class="hide-sm">Lien à partager</th><th>Encaissements</th><th>Statut</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section></div>`;
  }

  bind() {
    app.querySelector('[data-new]')?.addEventListener('click', () => this.form());
    app.querySelectorAll('[data-copy]').forEach((button) => button.onclick = async () => { await navigator.clipboard.writeText(button.dataset.copy); this.toast('Lien copié.'); });
    app.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => this.form(this.links.find((link) => link.reference === button.dataset.edit)));
    app.querySelectorAll('[data-delete]').forEach((button) => button.onclick = () => this.remove(button.dataset.delete));
    app.querySelectorAll('[data-payments]').forEach((button) => button.onclick = () => this.showPayments(button.dataset.payments));
  }

  modal(content) { const modal = document.createElement('div'); modal.className = 'modal'; modal.innerHTML = `<section class="modal-card">${content}</section>`; modal.onclick = (event) => { if (event.target === modal) modal.remove(); }; document.body.append(modal); return modal; }

  form(link = null) {
    const editing = Boolean(link); const expiresAt = link?.expiresAt ? new Date(link.expiresAt).toISOString().slice(0, 16) : '';
    const modal = this.modal(`<div class="panel-head"><h2>${editing ? 'Modifier le lien' : 'Nouveau lien de paiement'}</h2><button class="button secondary small" data-close>Fermer</button></div><p class="notice">Le titre est réservé à votre suivi interne. Le payeur verra uniquement le montant et le texte.</p><form class="form-grid" id="link-form"><label class="field full">Titre interne<input name="title" required maxlength="160" value="${esc(link?.title || '')}" placeholder="Ex. Acompte Marie Dupont"></label><label class="field">Montant en HTG<input name="amount" required min="1" max="10000000" step="1" type="number" value="${Number(link?.amount || '')}" placeholder="1000"></label><label class="field">Expiration facultative<input name="expiresAt" type="datetime-local" value="${expiresAt}"></label><label class="field full">Texte pour le payeur<textarea name="description" maxlength="500" placeholder="Paiement sécurisé via Smart Cut Services.">${esc(link?.description || '')}</textarea></label><div class="modal-actions" style="grid-column:1/-1"><button type="button" class="button secondary" data-close>Annuler</button><button class="button">${editing ? 'Enregistrer' : 'Créer le lien'}</button></div></form>`);
    modal.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => modal.remove());
    modal.querySelector('form').onsubmit = async (event) => { event.preventDefault(); const values = new FormData(event.currentTarget); try { await this.api('managePaymentLinks', { method: 'POST', body: JSON.stringify({ action: editing ? 'update' : 'create', reference: link?.reference || '', title: values.get('title'), amount: values.get('amount'), description: values.get('description'), expiresAt: values.get('expiresAt') ? new Date(values.get('expiresAt')).toISOString() : '' }) }); modal.remove(); await this.load(); this.render(); this.bind(); this.toast(editing ? 'Lien modifié.' : 'Lien créé avec succès.'); } catch (error) { this.toast(error.message, true); } };
  }

  async remove(reference) { if (!confirm('Supprimer ce lien ? Il deviendra immédiatement invalide, mais son historique restera accessible.')) return; try { await this.api('managePaymentLinks', { method: 'POST', body: JSON.stringify({ action: 'delete', reference }) }); await this.load(); this.render(); this.bind(); this.toast('Lien supprimé et désactivé.'); } catch (error) { this.toast(error.message, true); } }

  async showPayments(reference) {
    const link = this.links.find((item) => item.reference === reference);
    const modal = this.modal(`<div class="panel-head"><div><h2>${esc(link?.title || 'Paiements')}</h2><p style="color:#66758a;margin:5px 0 0">Historique des personnes ayant payé</p></div><button class="button secondary small" data-close>Fermer</button></div><div id="payments-view"></div>`);
    modal.querySelector('[data-close]').onclick = () => modal.remove(); const view = modal.querySelector('#payments-view');
    try {
      const payments = (await this.api('managePaymentLinks', { method: 'POST', body: JSON.stringify({ action: 'payments', reference }) })).payments || [];
      view.innerHTML = '<div class="filters"><select id="payment-status"><option value="">Tous les statuts</option><option value="paid">Payés</option><option value="pending">En attente</option><option value="failed">Échoués</option></select><input id="payment-from" type="date" aria-label="Depuis le"><input id="payment-to" type="date" aria-label="Jusqu’au"></div><div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>Payeur</th><th>Montant</th><th>Confirmé le</th><th>Référence Smart Cut</th><th>Transaction MonCash</th><th>Statut</th></tr></thead><tbody id="payments-body"></tbody></table></div>';
      const renderRows = () => { const status = view.querySelector('#payment-status').value; const from = view.querySelector('#payment-from').value ? new Date(`${view.querySelector('#payment-from').value}T00:00:00`).getTime() : 0; const to = view.querySelector('#payment-to').value ? new Date(`${view.querySelector('#payment-to').value}T23:59:59`).getTime() : 0; const rows = payments.filter((payment) => { const at = new Date(payment.paidAt || payment.createdAt || 0).getTime(); return (!status || payment.status === status) && (!from || at >= from) && (!to || at <= to); }); view.querySelector('#payments-body').innerHTML = rows.map((payment) => `<tr><td><strong>${esc(payment.payerName || '—')}</strong><small>${esc(payment.payerPhone || '—')}</small></td><td>${money(payment.amount)}</td><td>${date(payment.paidAt || payment.createdAt)}</td><td><small>${esc(payment.orderId || '—')}</small></td><td><small>${esc(payment.transactionId || '—')}</small></td><td><span class="badge ${esc(payment.status)}">${esc(payment.status || 'pending')}</span></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Aucun paiement correspondant.</div></td></tr>'; };
      view.querySelectorAll('#payment-status,#payment-from,#payment-to').forEach((input) => input.onchange = renderRows); renderRows();
    } catch (error) { view.innerHTML = `<div class="payment-error">${esc(error.message)}</div>`; }
  }

  toast(message, isError = false) { const toast = document.createElement('div'); toast.className = 'toast'; toast.style.background = isError ? '#b42318' : ''; toast.textContent = message; document.body.append(toast); setTimeout(() => toast.remove(), 3200); }
}

new PaymentLinksAdmin().init().catch((error) => { console.error(error); app.innerHTML = '<div class="pl-shell"><section class="panel"><h1>Chargement impossible</h1><p>Reconnectez-vous puis réessayez.</p></section></div>'; });
