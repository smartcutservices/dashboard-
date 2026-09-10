import { getAuthManager } from './auth.js';
import { db } from './firebase-init.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const API = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const root = document.getElementById('whatsapp-admin-app');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = (value) => value ? new Intl.DateTimeFormat('fr-HT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const time = (value) => value ? new Intl.DateTimeFormat('fr-HT', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '';
const stamp = (value) => new Date(value || 0).getTime() || 0;

class WhatsAppAdmin {
  constructor() { this.auth = getAuthManager(); this.user = null; this.data = null; this.selectedConversation = ''; this.search = ''; this.showContactList = window.matchMedia('(max-width: 760px)').matches; }
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
  conversations() {
    const d = this.data || {}; const byId = new Map();
    const ensure = (key, values = {}) => { if (!byId.has(key)) byId.set(key, { id: key, messages: [], ...values }); return byId.get(key); };
    (d.subscriptions || []).filter((item) => item.status === 'active').forEach((item) => {
      const entry = ensure(`uid:${item.id}`, { uid: item.id, name: item.profileName || 'Client Smart Cut', phoneMasked: item.phoneMasked || 'Numéro masqué', subscription: item });
      entry.subscription = item; entry.name = item.profileName || entry.name;
    });
    (d.inbox || []).forEach((item) => {
      const key = item.uid ? `uid:${item.uid}` : `phone:${item.phoneMasked || item.id}`;
      const entry = ensure(key, { uid: item.uid || '', name: item.profileName || 'Client WhatsApp', phoneMasked: item.phoneMasked || 'Numéro masqué' });
      entry.name = item.profileName || entry.name; entry.phoneMasked = item.phoneMasked || entry.phoneMasked;
      entry.messages.push({ ...item, direction: 'in', when: item.receivedAt });
    });
    (d.deliveries || []).forEach((item) => {
      const key = item.uid ? `uid:${item.uid}` : `phone:${item.phoneMasked || item.id}`;
      const entry = ensure(key, { uid: item.uid || '', name: 'Client Smart Cut', phoneMasked: item.phoneMasked || 'Numéro masqué' });
      entry.phoneMasked = item.phoneMasked || entry.phoneMasked;
      entry.messages.push({ ...item, direction: 'out', when: item.sentAt || item.updatedAt || item.createdAt });
    });
    return [...byId.values()].filter((item) => item.subscription?.status === 'active').map((item) => {
      item.messages.sort((a, b) => stamp(a.when) - stamp(b.when));
      item.last = item.messages.at(-1); item.lastInbox = [...item.messages].reverse().find((message) => message.direction === 'in');
      return item;
    }).sort((a, b) => stamp(b.last?.when || b.subscription?.updatedAt) - stamp(a.last?.when || a.subscription?.updatedAt));
  }
  render() {
    const d = this.data || {}; const settings = d.settings || { templates: {} }; const conversations = this.conversations();
    const active = (d.subscriptions || []).filter((item) => item.status === 'active').length; const marketing = (d.subscriptions || []).filter((item) => item.marketingOptIn).length; const failed = (d.deliveries || []).filter((item) => item.status === 'failed').length;
    const filtered = conversations.filter((item) => `${item.name} ${item.phoneMasked}`.toLowerCase().includes(this.search.toLowerCase()));
    if (!filtered.some((item) => item.id === this.selectedConversation)) this.selectedConversation = filtered[0]?.id || '';
    const selected = conversations.find((item) => item.id === this.selectedConversation) || null;
    const canReply = selected?.lastInbox && Date.now() - stamp(selected.lastInbox.receivedAt) <= 86400000;
    const conversationItems = selected?.messages.map((message) => {
      const text = message.direction === 'in'
        ? (message.text || '[Message non textuel]')
        : (message.template ? `Template : ${message.template}` : (message.kind || 'Message envoyé'));
      return `<div class="chat-line ${message.direction === 'out' ? 'outgoing' : 'incoming'}"><div class="chat-bubble"><p>${esc(text)}</p><span>${time(message.when)} ${message.status === 'read' ? '<i class="fas fa-check-double"></i>' : ''}</span></div></div>`;
    }).join('') || '<div class="empty-thread"><i class="fab fa-whatsapp"></i><p>Aucun message échangé avec ce contact.</p></div>';
    root.innerHTML = `<div class="wa-shell"><header class="wa-head"><div><p class="eyebrow">Centre de conversations</p><h1>WhatsApp Smart Cut</h1><p class="lead">Une boîte de réception unique pour les utilisateurs qui ont accepté les communications Smart Cut.</p></div><button class="button secondary" data-refresh><i class="fas fa-rotate"></i> Actualiser</button></header><section class="wa-grid"><article class="stat"><span>Consentements actifs</span><strong>${active}</strong></article><article class="stat"><span>Publicité autorisée</span><strong>${marketing}</strong></article><article class="stat"><span>Conversations</span><strong>${conversations.length}</strong></article><article class="stat"><span>Envois en erreur</span><strong>${failed}</strong></article></section><section class="messenger ${this.showContactList ? 'show-list' : ''}"><aside class="chat-list"><div class="chat-list-head"><div><i class="fab fa-whatsapp"></i><strong>Discussions</strong></div><span>${filtered.length}</span></div><label class="chat-search"><i class="fas fa-search"></i><input data-search placeholder="Rechercher un utilisateur" value="${esc(this.search)}"></label><div class="contacts">${filtered.map((item) => `<button class="contact ${item.id === this.selectedConversation ? 'selected' : ''}" data-conversation="${esc(item.id)}"><span class="avatar">${esc(item.name.charAt(0).toUpperCase())}</span><span class="contact-copy"><strong>${esc(item.name)}</strong><small>${item.last?.direction === 'out' ? 'Vous : ' : ''}${esc(item.last?.text || item.last?.kind || (item.subscription?.marketingOptIn ? 'Notifications activées' : 'Consentement actif'))}</small></span><span class="contact-meta"><time>${time(item.last?.when || item.subscription?.updatedAt)}</time>${item.subscription?.marketingOptIn ? '<i class="fas fa-bullhorn" title="Publicité autorisée"></i>' : '<i class="fas fa-shield-heart" title="Suivi autorisé"></i>'}</span></button>`).join('') || '<p class="empty-contacts">Aucun utilisateur correspondant.</p>'}</div></aside><main class="chat-thread">${selected ? `<header class="thread-head"><button class="back-contacts" data-back aria-label="Retour aux discussions"><i class="fas fa-arrow-left"></i></button><div class="avatar large">${esc(selected.name.charAt(0).toUpperCase())}</div><div><h2>${esc(selected.name)}</h2><p><i class="fas fa-circle"></i> ${selected.subscription?.marketingOptIn ? 'Publicité et suivi autorisés' : 'Suivi de commande autorisé'} · ${esc(selected.phoneMasked)}</p></div></header><div class="thread-messages">${conversationItems}</div><footer class="composer">${selected.lastInbox ? (canReply ? `<textarea data-reply-text="${esc(selected.lastInbox.id)}" placeholder="Écrire un message..." aria-label="Répondre à ${esc(selected.name)}"></textarea><button class="button send" data-reply="${esc(selected.lastInbox.id)}" aria-label="Envoyer"><i class="fas fa-paper-plane"></i></button>` : `<p class="window-note"><i class="fas fa-clock"></i> Fenêtre de réponse de 24 h terminée. Un template support approuvé est requis.</p>`) : '<p class="window-note">Un message entrant est nécessaire avant de répondre.</p>'}</footer>` : '<div class="empty-thread"><i class="fab fa-whatsapp"></i><h2>Sélectionnez une discussion</h2><p>Les utilisateurs ayant donné leur accord apparaissent ici.</p></div>'}</main><aside class="contact-panel">${selected ? `<section><p class="eyebrow">Fiche contact</p><h2>${esc(selected.name)}</h2><dl><div><dt>Numéro</dt><dd>${esc(selected.phoneMasked)}</dd></div><div><dt>Suivi commande</dt><dd class="ok"><i class="fas fa-check"></i> ${selected.subscription?.serviceOptIn ? 'Autorisé' : 'Non activé'}</dd></div><div><dt>Publicité</dt><dd class="${selected.subscription?.marketingOptIn ? 'ok' : ''}">${selected.subscription?.marketingOptIn ? '<i class="fas fa-check"></i> Autorisée' : 'Non autorisée'}</dd></div><div><dt>Dernier accord</dt><dd>${date(selected.subscription?.updatedAt)}</dd></div></dl></section><section class="meta-note"><i class="fas fa-shield-halved"></i><p>Le consentement est enregistré et les communications sont soumises aux règles Meta.</p></section>` : ''}<details class="admin-settings"><summary><i class="fas fa-sliders"></i> Configuration Meta</summary><form id="wa-settings"><label class="toggle"><input name="marketingEnabled" type="checkbox" ${settings.marketingEnabled ? 'checked' : ''}> Autoriser les campagnes de nouveautés</label><label class="field"><span>Langue des templates</span><input name="language" maxlength="12" value="${esc(settings.language || 'fr')}"></label><label class="field"><span>Template d’activation WhatsApp</span><input name="utilityOptInConfirmation" value="${esc(settings.templates?.utilityOptInConfirmation || '')}"></label><label class="field"><span>Template de commande</span><input name="utilityOrderConfirmation" value="${esc(settings.templates?.utilityOrderConfirmation || '')}"></label><label class="field"><span>Template de nouveauté</span><input name="marketingNewProduct" value="${esc(settings.templates?.marketingNewProduct || '')}"></label><label class="field"><span>Template support hors 24 h</span><input name="supportFollowup" value="${esc(settings.templates?.supportFollowup || '')}"></label><button class="button">Enregistrer</button></form></details></aside></section></div>`;
  }
  bind() {
    root.querySelector('[data-refresh]')?.addEventListener('click', async () => { await this.load(); this.render(); this.bind(); });
    root.querySelector('[data-search]')?.addEventListener('input', (event) => { this.search = event.target.value; this.render(); this.bind(); });
    root.querySelectorAll('[data-conversation]').forEach((button) => button.addEventListener('click', () => { this.selectedConversation = button.dataset.conversation; this.showContactList = false; this.render(); this.bind(); }));
    root.querySelector('[data-back]')?.addEventListener('click', () => { this.showContactList = true; this.render(); this.bind(); });
    const settingsForm = root.querySelector('#wa-settings');
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
