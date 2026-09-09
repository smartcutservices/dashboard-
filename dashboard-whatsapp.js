import { getAuthManager } from './auth.js';
import { db } from './firebase-init.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const API = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const root = document.getElementById('whatsapp-admin-app');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = (value) => value ? new Intl.DateTimeFormat('fr-HT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

class WhatsAppAdmin {
  constructor() { this.auth = getAuthManager(); this.user = null; this.data = null; }
  async api(action = 'overview', body = null) {
    const token = await this.user.getIdToken();
    const response = await fetch(`${API}/whatsappAdmin`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify({ action, ...body }) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || 'Opération WhatsApp impossible.');
    return payload;
  }
  async init() {
    await this.auth.waitForAuthReady?.(); this.user = this.auth.getCurrentUser?.();
    if (!this.user) return this.login();
    const profile = await getDoc(doc(db, 'clients', this.user.uid));
    if (!profile.exists() || String(profile.data()?.role || '').toLowerCase() !== 'admin') return this.denied();
    await this.load(); this.render(); this.bind();
  }
  async load() { this.data = await this.api(); }
  login() { root.innerHTML = '<div class="wa-shell"><section class="panel"><h1>Connexion administrateur requise</h1><p class="hint">Connectez-vous pour gérer les communications WhatsApp.</p><button class="button" data-login>Se connecter</button></section></div>'; root.querySelector('[data-login]').onclick = () => this.auth.openAuthModal?.('login'); document.addEventListener('authChanged', () => this.init(), { once: true }); }
  denied() { root.innerHTML = '<div class="wa-shell"><section class="panel"><h1>Accès refusé</h1><p class="hint">Ce module est réservé aux administrateurs Smart Cut.</p></section></div>'; }
  render() {
    const d = this.data || {}; const subscriptions = d.subscriptions || []; const deliveries = d.deliveries || []; const inbox = d.inbox || []; const campaigns = d.campaigns || []; const settings = d.settings || { templates: {} };
    const active = subscriptions.filter((item) => item.status === 'active').length; const marketing = subscriptions.filter((item) => item.marketingOptIn).length; const failed = deliveries.filter((item) => item.status === 'failed').length;
    root.innerHTML = `<div class="wa-shell"><header class="wa-head"><div><p class="eyebrow">Meta Business Cloud API</p><h1>WhatsApp Smart Cut</h1><p class="lead">Consentements vérifiables, messages transactionnels, campagnes ciblées et support humain dans le respect des règles Meta.</p></div><button class="button secondary" data-refresh><i class="fas fa-rotate"></i> Actualiser</button></header><section class="wa-grid"><article class="stat"><span>Abonnés actifs</span><strong>${active}</strong></article><article class="stat"><span>Publicité autorisée</span><strong>${marketing}</strong></article><article class="stat"><span>Campagnes</span><strong>${campaigns.length}</strong></article><article class="stat"><span>Erreurs d’envoi</span><strong>${failed}</strong></article></section><div class="layout"><div><section class="panel"><div class="panel-head"><h2>Boîte de réception</h2><span class="badge">${inbox.length} message(s)</span></div><div class="conversation">${inbox.map((message) => `<article class="message"><h3>${esc(message.profileName || 'Client')} <span class="badge ${esc(message.status)}">${esc(message.status || 'open')}</span></h3><p>${esc(message.text || '[Message non textuel]')}</p><footer><span>${esc(message.phoneMasked || 'Numéro masqué')}</span><span>${date(message.receivedAt)}</span></footer>${message.stopped ? '<p class="notice">STOP reçu : la publicité est désactivée pour ce numéro.</p>' : ''}<textarea class="reply-box" data-reply-text="${esc(message.id)}" placeholder="Répondre au client..."></textarea><button class="button" data-reply="${esc(message.id)}">Envoyer la réponse</button></article>`).join('') || '<p class="hint">Aucun message entrant pour le moment.</p>'}</div></section><section class="panel"><div class="panel-head"><h2>Livraisons récentes</h2><span class="badge">${deliveries.length}</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Type</th><th>Destinataire</th><th>Template</th><th>Statut</th><th>Date</th></tr></thead><tbody>${deliveries.map((item) => `<tr><td>${esc(item.kind)}</td><td>${esc(item.phoneMasked || '—')}</td><td>${esc(item.template || 'Fenêtre 24 h')}</td><td><span class="badge ${esc(item.status)}">${esc(item.status)}</span>${item.error ? `<small>${esc(item.error)}</small>` : ''}</td><td>${date(item.updatedAt || item.createdAt)}</td></tr>`).join('') || '<tr><td colspan="5" class="hint">Aucun envoi enregistré.</td></tr>'}</tbody></table></div></section></div><aside><section class="panel"><div class="panel-head"><h2>Configuration Meta</h2><span class="badge ${settings.marketingEnabled ? 'active' : 'pending'}">${settings.marketingEnabled ? 'Marketing actif' : 'Marketing désactivé'}</span></div><p class="notice">Active le marketing seulement après avoir créé et approuvé les templates dans Meta Business Manager.</p><form id="wa-settings"><label class="toggle"><input name="marketingEnabled" type="checkbox" ${settings.marketingEnabled ? 'checked' : ''}> Autoriser les campagnes de nouveautés</label><label class="field"><span>Langue des templates</span><input name="language" maxlength="12" value="${esc(settings.language || 'fr')}"></label><label class="field"><span>Template confirmation de commande (utility)</span><input name="utilityOrderConfirmation" value="${esc(settings.templates?.utilityOrderConfirmation || '')}" placeholder="order_confirmation"></label><label class="field"><span>Template nouveau produit (marketing)</span><input name="marketingNewProduct" value="${esc(settings.templates?.marketingNewProduct || '')}" placeholder="new_product"></label><label class="field"><span>Template support hors fenêtre 24 h</span><input name="supportFollowup" value="${esc(settings.templates?.supportFollowup || '')}" placeholder="support_followup"></label><button class="button">Enregistrer la configuration</button></form></section><section class="panel"><div class="panel-head"><h2>Campagnes produits</h2><span class="badge">${campaigns.length}</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Produit</th><th>Catégorie</th><th>Statut</th><th>Envoyés</th></tr></thead><tbody>${campaigns.map((item) => `<tr><td>${esc(item.productName || item.productId)}</td><td>${esc(item.categoryId || '—')}</td><td><span class="badge ${esc(item.status)}">${esc(item.status)}</span></td><td>${Number(item.sentCount || 0)}</td></tr>`).join('') || '<tr><td colspan="4" class="hint">Aucune campagne en attente.</td></tr>'}</tbody></table></div></section></aside></div></div>`;
  }
  bind() {
    root.querySelector('[data-refresh]')?.addEventListener('click', async () => { await this.load(); this.render(); this.bind(); });
    const settingsForm = root.querySelector('#wa-settings');
    if (settingsForm && !settingsForm.elements.utilityOptInConfirmation) {
      const field = document.createElement('label');
      field.className = 'field';
      field.innerHTML = '<span>Template confirmation d’activation WhatsApp (utility)</span><input name="utilityOptInConfirmation" placeholder="smartcut_whatsapp_activation">';
      field.querySelector('input').value = this.data?.settings?.templates?.utilityOptInConfirmation || '';
      settingsForm.insertBefore(field, settingsForm.querySelector('button'));
    }
    settingsForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await this.api('settings', {
          marketingEnabled: form.get('marketingEnabled') === 'on',
          language: form.get('language'),
          templates: {
            utilityOptInConfirmation: form.get('utilityOptInConfirmation'),
            utilityOrderConfirmation: form.get('utilityOrderConfirmation'),
            marketingNewProduct: form.get('marketingNewProduct'),
            supportFollowup: form.get('supportFollowup')
          }
        });
        this.toast('Configuration enregistrée.');
        await this.load(); this.render(); this.bind();
      } catch (error) { this.toast(error.message, true); }
    });
    root.querySelectorAll('[data-reply]').forEach((button) => button.addEventListener('click', async () => { const inboxId = button.dataset.reply; const message = root.querySelector(`[data-reply-text="${CSS.escape(inboxId)}"]`)?.value?.trim(); if (!message) return this.toast('Écrivez une réponse avant l’envoi.', true); button.disabled = true; try { const result = await this.api('reply', { inboxId, message }); this.toast(result.status === 'sent' ? 'Réponse envoyée.' : 'La réponse n’a pas pu être envoyée.', result.status !== 'sent'); await this.load(); this.render(); this.bind(); } catch (error) { this.toast(error.message, true); } finally { button.disabled = false; } }));
  }
  toast(message, error = false) { const node = document.createElement('div'); node.className = 'toast'; node.style.background = error ? '#b42318' : ''; node.textContent = message; document.body.append(node); setTimeout(() => node.remove(), 3600); }
}
new WhatsAppAdmin().init().catch((error) => { console.error(error); root.innerHTML = `<div class="wa-shell"><section class="panel"><h1>Chargement impossible</h1><p class="hint">${esc(error.message)}</p></section></div>`; });
