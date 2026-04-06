import { auth, db } from './firebase-init.js';
import { buildVendorSalesSummary, loadAllOrdersWithClients } from './vendor-analytics.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const CREATE_VENDOR_PAYOUT_FUNCTION_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/createVendorPayout';

const FORM_SETTINGS_REF = ['vendorApplicationSettings', 'form'];
const DEFAULT_FORM_SETTINGS = {
  title: 'Candidature vendeur',
  subtitle: 'Remplissez simplement le formulaire ci-dessous pour demander l ouverture de votre espace vendeur.',
  submitLabel: 'Envoyer ma candidature',
  fields: [
    { id: 'applicantName', type: 'text', label: 'Nom complet', required: true, placeholder: 'Votre nom complet' },
    { id: 'email', type: 'email', label: 'Email', required: true, placeholder: 'nom@exemple.com' },
    { id: 'phone', type: 'tel', label: 'Telephone', required: true, placeholder: '+509...' },
    { id: 'shopName', type: 'text', label: 'Nom de boutique', required: true, placeholder: 'Nom de votre boutique' },
    { id: 'city', type: 'text', label: 'Ville', required: true, placeholder: 'Votre ville' },
    { id: 'address', type: 'textarea', label: 'Adresse', required: true, placeholder: 'Adresse complete' },
    { id: 'category', type: 'select', label: 'Categorie principale', required: true, options: ['Mode', 'Accessoires', 'Maison & deco', 'Impression', 'Electronique', 'Beaute', 'Autre'] },
    { id: 'deliveryMode', type: 'radio', label: 'Gestion livraison', required: true, options: ['Le vendeur gere la livraison', 'Smart Cut gere la livraison', 'A definir'] },
    { id: 'socialLink', type: 'url', label: 'Reseau social ou site web', required: false, placeholder: 'https://...' },
    { id: 'description', type: 'textarea', label: 'Presentation de votre activite', required: true, placeholder: 'Decrivez votre activite, vos produits et votre positionnement.' },
    { id: 'agreementAccepted', type: 'checkbox', label: 'Je confirme que les informations envoyees sont exactes et j accepte la revue manuelle de ma candidature.', required: true }
  ]
};

class VendorsDashboard {
  constructor() {
    this.root = document.getElementById('vendors-dashboard-root');
    if (!this.root) return;
    this.applications = [];
    this.vendorProducts = [];
    this.commissionRules = [];
    this.categories = [];
    this.vendors = [];
    this.vendorSalesSummaries = [];
    this.vendorPayouts = [];
    this.allOrders = [];
    this.allClients = [];
    this.formSettings = DEFAULT_FORM_SETTINGS;
    this.activeSection = 'applications';
    this.init();
  }

  async init() {
    await this.loadData();
    this.render();
    this.attachEvents();
  }

  async loadData() {
    const [applicationSnapshot, productSnapshot, commissionSnapshot, categorySnapshot, vendorSnapshot, payoutSnapshot, ordersData, formSettingsSnap] = await Promise.all([
      getDocs(query(collection(db, 'vendorApplications'), orderBy('updatedAt', 'desc'))),
      getDocs(query(collection(db, 'vendorProducts'), orderBy('updatedAt', 'desc'))),
      getDocs(collection(db, 'vendorCommissionRules')),
      getDocs(query(collection(db, 'categories_list'), orderBy('name'))),
      getDocs(query(collection(db, 'vendors'), orderBy('updatedAt', 'desc'))),
      getDocs(query(collection(db, 'vendorPayouts'), orderBy('requestedAt', 'desc'))),
      loadAllOrdersWithClients(),
      getDoc(doc(db, ...FORM_SETTINGS_REF))
    ]);
    this.applications = applicationSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    this.vendorProducts = productSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    this.commissionRules = commissionSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => item.active !== false)
      .sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')));
    this.categories = categorySnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    this.vendors = vendorSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => item.status === 'active');
    this.vendorPayouts = payoutSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    this.allClients = Array.isArray(ordersData?.clients) ? ordersData.clients : [];
    this.allOrders = Array.isArray(ordersData?.orders) ? ordersData.orders : [];
    this.formSettings = formSettingsSnap.exists()
      ? {
          ...DEFAULT_FORM_SETTINGS,
          ...formSettingsSnap.data(),
          fields: Array.isArray(formSettingsSnap.data()?.fields) && formSettingsSnap.data().fields.length
            ? formSettingsSnap.data().fields
            : DEFAULT_FORM_SETTINGS.fields
        }
      : DEFAULT_FORM_SETTINGS;
    this.vendorSalesSummaries = this.vendors.map((vendor) => buildVendorSalesSummary({
      vendorId: vendor.id,
      vendorName: vendor.vendorName || vendor.shopName || 'Vendeur',
      orders: this.allOrders,
      vendorProductIds: new Set(this.vendorProducts.filter((item) => item.vendorId === vendor.id).map((item) => item.id))
    })).sort((a, b) => b.vendorNetAmount - a.vendorNetAmount);
  }

  normalizeCategory(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  getCategoryCommissionRule(category) {
    const normalized = this.normalizeCategory(category);
    return this.commissionRules.find((item) => this.normalizeCategory(item.category) === normalized) || null;
  }

  getCommissionRateValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  getCategoryNameById(categoryId) {
    const match = this.categories.find((item) => item.id === categoryId);
    return String(match?.name || '').trim();
  }

  resolveProductCategory(item) {
    return String(
      item?.category ||
      item?.categoryName ||
      this.getCategoryNameById(item?.categoryId) ||
      ''
    ).trim();
  }

  resolveProductCommissionState(item = {}) {
    const resolvedCategory = this.resolveProductCategory(item);
    const categoryFromId = this.getCategoryNameById(item?.categoryId);
    const categoryRule =
      this.getCategoryCommissionRule(resolvedCategory) ||
      this.getCategoryCommissionRule(categoryFromId);

    const existingRule = item?.commissionRule && typeof item.commissionRule === 'object'
      ? item.commissionRule
      : null;

    const explicitRate =
      this.getCommissionRateValue(existingRule?.categoryRate) ??
      this.getCommissionRateValue(existingRule?.rate) ??
      this.getCommissionRateValue(item?.commissionRate) ??
      this.getCommissionRateValue(item?.categoryRate);

    const categoryRate = this.getCommissionRateValue(categoryRule?.rate);
    const effectiveRate = explicitRate ?? categoryRate;

    const effectiveRule = effectiveRate === null
      ? null
      : {
          ...(existingRule || {}),
          category: String(
            existingRule?.category ||
            resolvedCategory ||
            categoryRule?.category ||
            categoryFromId ||
            ''
          ).trim(),
          categoryRate: effectiveRate,
          source: existingRule?.source || (explicitRate !== null ? 'product_override' : 'vendorCommissionRules')
        };

    return {
      resolvedCategory,
      categoryRule,
      effectiveRate,
      effectiveRule
    };
  }

  getCounts() {
    return {
      total: this.applications.length,
      pending: this.applications.filter((item) => item.status === 'pending' || !item.status).length,
      approved: this.applications.filter((item) => item.status === 'approved').length,
      rejected: this.applications.filter((item) => item.status === 'rejected').length,
      productPending: this.vendorProducts.filter((item) => item.status === 'pending_review' || !item.status).length,
      productActive: this.vendorProducts.filter((item) => item.status === 'active').length,
      productRejected: this.vendorProducts.filter((item) => item.status === 'rejected').length,
      payoutRequests: this.vendorPayouts.filter((item) => ['requested', 'pending', 'approved'].includes(String(item.status || '').toLowerCase())).length,
      payoutPaid: this.vendorPayouts.filter((item) => String(item.status || '').toLowerCase() === 'paid').length
    };
  }

  statusMeta(status) {
    switch (String(status || '').toLowerCase()) {
      case 'approved':
        return { label: 'Approuve', color: '#14532D', bg: 'rgba(20, 83, 45, 0.12)' };
      case 'rejected':
        return { label: 'Refuse', color: '#7F1D1D', bg: 'rgba(127, 29, 29, 0.12)' };
      default:
        return { label: 'En attente', color: '#92400E', bg: 'rgba(146, 64, 14, 0.12)' };
    }
  }

  productStatusMeta(status) {
    switch (String(status || '').toLowerCase()) {
      case 'active':
        return { label: 'Actif', color: '#14532D', bg: 'rgba(20, 83, 45, 0.12)' };
      case 'rejected':
        return { label: 'Refuse', color: '#7F1D1D', bg: 'rgba(127, 29, 29, 0.12)' };
      default:
        return { label: 'En revue', color: '#92400E', bg: 'rgba(146, 64, 14, 0.12)' };
    }
  }

  payoutStatusMeta(status) {
    switch (String(status || '').toLowerCase()) {
      case 'paid':
        return { label: 'Paye', color: '#14532D', bg: 'rgba(20, 83, 45, 0.12)' };
      case 'approved':
        return { label: 'Approuve', color: '#1D4ED8', bg: 'rgba(29, 78, 216, 0.12)' };
      case 'rejected':
        return { label: 'Rejete', color: '#7F1D1D', bg: 'rgba(127, 29, 29, 0.12)' };
      case 'pending':
        return { label: 'En attente', color: '#92400E', bg: 'rgba(146, 64, 14, 0.12)' };
      default:
        return { label: 'Demande recue', color: '#6D28D9', bg: 'rgba(109, 40, 217, 0.12)' };
    }
  }

  getProductStockLabel(item = {}) {
    const variations = Array.isArray(item.variations) ? item.variations : [];
    const variationStocks = variations
      .map((variation) => Number(variation?.stock))
      .filter((value) => Number.isFinite(value));

    if (variationStocks.length > 0) {
      const totalVariationStock = variationStocks.reduce((sum, value) => sum + value, 0);
      return `${totalVariationStock} (${variations.length} variation${variations.length > 1 ? 's' : ''})`;
    }

    const directStock = Number(item.stock);
    if (Number.isFinite(directStock)) {
      return String(directStock);
    }

    return '-';
  }

  getVendorDisplayName(vendor = {}) {
    return String(vendor?.shopName || vendor?.vendorName || vendor?.applicantName || 'Vendeur').trim();
  }

  formatDateTime(value) {
    const ms = Date.parse(String(value || ''));
    if (!Number.isFinite(ms)) return '-';
    return new Date(ms).toLocaleString('fr-FR');
  }

  toDateInputValue(value) {
    const ms = Date.parse(String(value || ''));
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toISOString().slice(0, 10);
  }

  getOrderRefPath(order = {}) {
    const clientId = String(order?.clientId || order?.clientUid || '').trim();
    const orderId = String(order?.id || '').trim();
    if (!clientId || !orderId) return '';
    return `clients/${clientId}/orders/${orderId}`;
  }

  getVendorProductIds(vendorId) {
    return new Set(
      this.vendorProducts
        .filter((item) => String(item.vendorId || '') === String(vendorId || ''))
        .map((item) => item.id)
    );
  }

  getVendorPayoutEntries(vendorId) {
    return this.vendorPayouts
      .filter((item) => String(item.vendorId || '') === String(vendorId || ''))
      .sort((a, b) => Date.parse(String(b?.requestedAt || b?.createdAt || '')) - Date.parse(String(a?.requestedAt || a?.createdAt || '')));
  }

  createVendorCoveredRef(refPath, vendorId) {
    const normalizedPath = String(refPath || '').trim();
    const normalizedVendorId = String(vendorId || '').trim();
    if (!normalizedPath) return '';
    if (!normalizedVendorId) return normalizedPath;
    return `${normalizedPath}::${normalizedVendorId}`;
  }

  buildVendorOutstandingSummary(vendor = {}) {
    const vendorId = String(vendor?.id || vendor?.vendorId || '').trim();
    if (!vendorId) {
      return buildVendorSalesSummary({
        vendorId: '',
        vendorName: 'Vendeur',
        orders: [],
        vendorProductIds: new Set()
      });
    }

    const vendorProductIds = this.getVendorProductIds(vendorId);
    const settledRefs = new Set();
    const settledOrderIds = new Set();

    this.getVendorPayoutEntries(vendorId).forEach((entry) => {
      if (String(entry?.status || '').toLowerCase() !== 'paid') return;
      const coveredRefs = Array.isArray(entry?.coveredVendorRefs) && entry.coveredVendorRefs.length
        ? entry.coveredVendorRefs
        : (Array.isArray(entry?.coveredOrderRefs) ? entry.coveredOrderRefs : []);
      coveredRefs.forEach((refPath) => {
        const normalized = String(refPath || '').trim();
        if (normalized) settledRefs.add(normalized);
      });
      (Array.isArray(entry?.coveredOrderIds) ? entry.coveredOrderIds : []).forEach((orderId) => {
        const normalized = String(orderId || '').trim();
        if (normalized) settledOrderIds.add(normalized);
      });
    });

    const outstandingOrders = this.allOrders.filter((order) => {
      const refPath = this.getOrderRefPath(order);
      const vendorRef = this.createVendorCoveredRef(refPath, vendorId);
      if (refPath && (settledRefs.has(refPath) || settledRefs.has(vendorRef))) return false;
      if (settledOrderIds.has(String(order?.id || '').trim())) return false;
      return true;
    });

    return buildVendorSalesSummary({
      vendorId,
      vendorName: this.getVendorDisplayName(vendor),
      orders: outstandingOrders,
      vendorProductIds
    });
  }

  buildVendorPayoutOverview() {
    const requestStatuses = new Set(['requested', 'pending', 'approved']);
    const openRequests = this.vendorPayouts
      .filter((item) => requestStatuses.has(String(item.status || '').toLowerCase()))
      .sort((a, b) => Date.parse(String(b?.requestedAt || b?.createdAt || '')) - Date.parse(String(a?.requestedAt || a?.createdAt || '')));
    const paidPayouts = this.vendorPayouts
      .filter((item) => String(item.status || '').toLowerCase() === 'paid')
      .sort((a, b) => Date.parse(String(b?.paidAt || b?.reviewedAt || b?.requestedAt || '')) - Date.parse(String(a?.paidAt || a?.reviewedAt || a?.requestedAt || '')));

    const vendorBalances = this.vendors.map((vendor) => {
      const outstanding = this.buildVendorOutstandingSummary(vendor);
      const payouts = this.getVendorPayoutEntries(vendor.id);
      const openRequest = payouts.find((entry) => requestStatuses.has(String(entry.status || '').toLowerCase())) || null;
      const lastPaid = payouts.find((entry) => String(entry.status || '').toLowerCase() === 'paid') || null;
      return {
        vendor,
        outstanding,
        openRequest,
        lastPaid
      };
    }).sort((a, b) => {
      const aHasRequest = a.openRequest ? 1 : 0;
      const bHasRequest = b.openRequest ? 1 : 0;
      if (aHasRequest !== bHasRequest) return bHasRequest - aHasRequest;
      return (b.outstanding?.vendorNetAmount || 0) - (a.outstanding?.vendorNetAmount || 0);
    });

    return {
      openRequests,
      paidPayouts,
      vendorBalances,
      totalOutstandingNet: vendorBalances.reduce((sum, entry) => sum + Number(entry?.outstanding?.vendorNetAmount || 0), 0),
      totalOpenRequestsNet: openRequests.reduce((sum, entry) => sum + Number(entry?.netAmount || 0), 0),
      totalPaidNet: paidPayouts.reduce((sum, entry) => sum + Number(entry?.netAmount || 0), 0)
    };
  }

  render() {
    const counts = this.getCounts();
    this.root.innerHTML = `
      <section class="hero">
        <small>Marketplace</small>
        <h1>Vendeurs & gouvernance</h1>
        <p>Centralisez ici les candidatures vendeurs, la validation admin et la preparation de la marketplace Smart Cut Services.</p>
      </section>

      <section class="stats">
        ${this.renderStat('Demandes', counts.total, 'fa-user-plus')}
        ${this.renderStat('En attente', counts.pending, 'fa-hourglass-half')}
        ${this.renderStat('Approuvees', counts.approved, 'fa-circle-check')}
        ${this.renderStat('Refusees', counts.rejected, 'fa-ban')}
        ${this.renderStat('Produits en revue', counts.productPending, 'fa-box-open')}
        ${this.renderStat('Produits actifs', counts.productActive, 'fa-store')}
        ${this.renderStat('Produits refuses', counts.productRejected, 'fa-circle-xmark')}
        ${this.renderStat('Demandes de paiement', counts.payoutRequests, 'fa-wallet')}
      </section>

      <section class="vendors-workspace">
        <aside class="vendors-sections-nav">
          ${this.renderSectionNav()}
        </aside>

        <div class="vendors-sections-content">
          <section class="panel vendors-section-panel ${this.activeSection === 'applications' ? 'is-active' : ''}" data-section-panel="applications">
            <div class="panel-head">
              <div>
                <small>Candidatures</small>
                <h2>Demandes recues</h2>
              </div>
            </div>
            ${this.applications.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>Aucune candidature vendeur pour le moment.</p>
              </div>
            ` : `
              <div class="applications">
                ${this.applications.map((item) => this.renderApplication(item)).join('')}
              </div>
            `}
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'form' ? 'is-active' : ''}" data-section-panel="form">
            <div class="panel-head">
              <div>
                <small>Formulaire vendeur</small>
                <h2>Configuration des champs</h2>
              </div>
            </div>
            <p>Cette section pilote directement la page publique de candidature. Vous pouvez changer les noms de champs, leur type, ajouter des options, en ajouter ou en supprimer.</p>
            ${this.renderFormBuilder()}
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'products' ? 'is-active' : ''}" data-section-panel="products">
            <div class="panel-head">
              <div>
                <small>Catalogue vendeur</small>
                <h2>Revue des produits vendeur</h2>
              </div>
            </div>
            <p>Les vendeurs peuvent maintenant soumettre leurs produits depuis leur back-office separe. Ici, l'admin controle la revue, la commission et le statut avant toute ouverture publique.</p>
            ${this.vendorProducts.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-box-open"></i>
                <p>Aucun produit vendeur soumis pour le moment.</p>
              </div>
            ` : `
              <div class="applications" style="margin-top:1.2rem;">
                ${this.vendorProducts.map((item) => this.renderProductReview(item)).join('')}
              </div>
            `}
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'commissions' ? 'is-active' : ''}" data-section-panel="commissions">
            <div class="panel-head">
              <div>
                <small>Commissions</small>
                <h2>Regles par categorie</h2>
              </div>
            </div>
            <p>Ces regles servent de source simple par categorie. Si un produit n'a pas de commission saisie manuellement, l'approbation reprend automatiquement le taux de sa categorie.</p>
            <div class="applications" style="margin-top:1.2rem;">
              ${this.renderCommissionRules()}
            </div>
            <div class="actions">
              <button type="button" data-add-commission-rule>Ajouter une categorie</button>
              <button type="button" data-save-commission-rules class="approve">Enregistrer les regles</button>
            </div>
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'performance' ? 'is-active' : ''}" data-section-panel="performance">
            <div class="panel-head">
              <div>
                <small>Revenus marketplace</small>
                <h2>Performance vendeurs</h2>
              </div>
            </div>
            <p>Cette vue admin expose les ventes par vendeur avec brut, commission et net. Le suivi des decaissements et des demandes de paiement se gere dans le module Decaissements.</p>
            ${this.vendorSalesSummaries.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-chart-line"></i>
                <p>Aucune vente vendeur exploitable pour le moment.</p>
              </div>
            ` : `
              <div class="applications" style="margin-top:1.2rem;">
                ${this.vendorSalesSummaries.map((item) => this.renderVendorSalesSummary(item)).join('')}
              </div>
            `}
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'payouts' ? 'is-active' : ''}" data-section-panel="payouts">
            <div class="panel-head">
              <div>
                <small>Decaissements</small>
                <h2>Payer les vendeurs</h2>
              </div>
            </div>
            <p>Traitez ici les demandes de decaissement, visualisez le brut et le net de chaque store, puis genereez un rapport PDF apres paiement.</p>
            ${this.renderPayoutWorkspace()}
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'overview' ? 'is-active' : ''}" data-section-panel="overview">
            <div class="panel-head">
              <div>
                <small>Vue d'ensemble</small>
                <h2>Organisation du module vendeurs</h2>
              </div>
            </div>
            <p>Le module vendeurs est maintenant separe en espaces distincts pour garder une gestion plus propre et plus claire.</p>
            <div class="roadmap">
              ${this.renderRoadmap('1', 'Candidatures', 'Toutes les demandes recues apparaissent dans une section separee avec statut et donnees detaillees.')}
              ${this.renderRoadmap('2', 'Formulaire', 'La structure du formulaire public se pilote a part, avec ajout, suppression et edition de champs.')}
              ${this.renderRoadmap('3', 'Produits', 'Les produits vendeurs soumis sont geres dans leur propre espace de revue admin.')}
              ${this.renderRoadmap('4', 'Commissions', 'Les taux par categorie sont modifies dans une section dediee.')}
              ${this.renderRoadmap('5', 'Performance', 'Les ventes et revenus vendeur restent visibles dans un espace separe pour l analyse.')}
              ${this.renderRoadmap('6', 'Decaissements', 'Les demandes vendeur, paiements admin, historique et rapports PDF sont centralises dans une section dediee.')}
            </div>
          </section>
        </div>
      </section>
    `;
  }

  renderSectionNav() {
    const sections = [
      { id: 'overview', icon: 'fa-compass', label: 'Vue globale', meta: 'Structure du module' },
      { id: 'applications', icon: 'fa-user-plus', label: 'Candidatures', meta: `${this.applications.length} demande(s)` },
      { id: 'form', icon: 'fa-pen-ruler', label: 'Formulaire', meta: `${this.formSettings.fields.length} champ(s)` },
      { id: 'products', icon: 'fa-box-open', label: 'Produits', meta: `${this.vendorProducts.length} soumission(s)` },
      { id: 'commissions', icon: 'fa-percent', label: 'Commissions', meta: `${this.commissionRules.length} regle(s)` },
      { id: 'performance', icon: 'fa-chart-line', label: 'Performance', meta: `${this.vendorSalesSummaries.length} vendeur(s)` },
      { id: 'payouts', icon: 'fa-wallet', label: 'Decaissements', meta: `${this.vendorPayouts.filter((item) => ['requested', 'pending', 'approved'].includes(String(item.status || '').toLowerCase())).length} demande(s)` }
    ];

    return sections.map((section) => `
      <button type="button" class="vendors-section-link ${this.activeSection === section.id ? 'active' : ''}" data-section-link="${section.id}">
        <i class="fas ${section.icon}"></i>
        <span>
          <strong>${section.label}</strong>
          <small>${section.meta}</small>
        </span>
      </button>
    `).join('');
  }

  renderStat(label, value, icon) {
    return `<div class="stat-card"><i class="fas ${icon}"></i><div><strong>${value}</strong><span>${label}</span></div></div>`;
  }

  renderApplication(item) {
    const meta = this.statusMeta(item.status);
    const responseEntries = this.getReadableApplicationFields(item);
    return `
      <div class="application-card">
        <div class="application-top">
          <div>
            <h3>${item.shopName || 'Boutique sans nom'}</h3>
            <p>${item.applicantName || 'Sans nom'} · ${item.category || 'Categorie non definie'}</p>
          </div>
          <div class="badge" style="color:${meta.color}; background:${meta.bg};">${meta.label}</div>
        </div>

        <div class="application-grid">
          ${responseEntries.map((entry) => `<div><strong>${this.escape(entry.label)}</strong><span>${this.escape(entry.value)}</span></div>`).join('')}
        </div>
        ${item.adminNote ? `<div class="application-copy admin-note"><strong>Note admin</strong><p>${item.adminNote}</p></div>` : ''}

        <div class="actions">
          <button type="button" data-action="pending" data-id="${item.id}">Mettre en attente</button>
          <button type="button" data-action="approved" data-id="${item.id}" class="approve">Approuver</button>
          <button type="button" data-action="rejected" data-id="${item.id}" class="reject">Refuser</button>
        </div>
      </div>
    `;
  }

  renderRoadmap(index, title, description) {
    return `<div class="roadmap-item"><div class="roadmap-index">${index}</div><div><strong>${title}</strong><span>${description}</span></div></div>`;
  }

  formatPrice(value) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency',
      currency: 'HTG',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }

  renderCommissionRules() {
    const rules = this.commissionRules.length > 0
      ? this.commissionRules
      : [{ id: `new-${Date.now()}`, category: '', rate: '' }];

    return rules.map((rule, index) => `
      <div class="application-card" data-commission-row="${index}">
        <div class="application-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));align-items:end;">
          <div>
            <strong>Categorie</strong>
            <input data-commission-field="category" data-commission-index="${index}" value="${rule.category || ''}" placeholder="Ex: Mode" style="width:100%;margin-top:.45rem;border:1px solid rgba(198,167,94,0.18);background:rgba(255,255,255,0.04);color:#f6f1e8;border-radius:14px;padding:.85rem .95rem;font:inherit;">
          </div>
          <div>
            <strong>Taux %</strong>
            <input type="number" min="0" max="100" step="0.01" data-commission-field="rate" data-commission-index="${index}" value="${rule.rate ?? ''}" placeholder="10" style="width:100%;margin-top:.45rem;border:1px solid rgba(198,167,94,0.18);background:rgba(255,255,255,0.04);color:#f6f1e8;border-radius:14px;padding:.85rem .95rem;font:inherit;">
          </div>
          <label class="check" style="align-self:center;">
            <input type="checkbox" data-commission-field="active" data-commission-index="${index}" ${rule.active !== false ? 'checked' : ''}>
            <span>Active</span>
          </label>
        </div>
      </div>
    `).join('');
  }

  getReadableApplicationFields(item) {
    const responses = item.responses || {};
    const configured = this.formSettings.fields.map((field) => {
      let value = responses[field.id];
      if (value === undefined || value === null || value === '') {
        value = item[field.id] ?? item[this.mapLegacyKey(field.id)] ?? '';
      }
      if (field.type === 'checkbox') {
        value = value === true ? 'Oui' : 'Non';
      }
      return {
        label: field.label || field.id,
        value: String(value || '-')
      };
    });
    return configured;
  }

  mapLegacyKey(id) {
    const map = {
      applicantName: 'applicantName',
      email: 'email',
      phone: 'phone',
      shopName: 'shopName',
      city: 'city',
      address: 'address',
      category: 'category',
      deliveryMode: 'deliveryMode',
      socialLink: 'socialLink',
      description: 'description',
      experience: 'experience',
      agreementAccepted: 'agreementAccepted'
    };
    return map[id] || id;
  }

  renderFormBuilder() {
    return `
      <div class="applications" style="margin-top:1.2rem;">
        <div class="application-card">
          <div class="application-grid" style="grid-template-columns:1fr 1fr;">
            <div>
              <strong>Titre</strong>
              <input id="vendorFormTitle" value="${this.escape(this.formSettings.title || DEFAULT_FORM_SETTINGS.title)}" style="${this.adminInputStyle()}">
            </div>
            <div>
              <strong>Bouton envoyer</strong>
              <input id="vendorFormSubmitLabel" value="${this.escape(this.formSettings.submitLabel || DEFAULT_FORM_SETTINGS.submitLabel)}" style="${this.adminInputStyle()}">
            </div>
          </div>
          <div class="application-copy">
            <strong>Sous-titre</strong>
            <textarea id="vendorFormSubtitle" rows="3" style="${this.adminInputStyle(true)}">${this.escape(this.formSettings.subtitle || DEFAULT_FORM_SETTINGS.subtitle)}</textarea>
          </div>
        </div>
        ${this.formSettings.fields.map((field, index) => this.renderFieldBuilder(field, index)).join('')}
      </div>
      <div class="actions">
        <button type="button" data-add-form-field>Ajouter un champ</button>
        <button type="button" data-save-form-settings class="approve">Enregistrer le formulaire</button>
      </div>
    `;
  }

  renderFieldBuilder(field, index) {
    const optionString = Array.isArray(field.options) ? field.options.join(' | ') : '';
    return `
      <div class="application-card" data-form-field-row="${index}">
        <div class="application-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));align-items:end;">
          <div>
            <strong>Nom du champ</strong>
            <input data-form-field="label" data-form-index="${index}" value="${this.escape(field.label || '')}" style="${this.adminInputStyle()}">
          </div>
          <div>
            <strong>Identifiant</strong>
            <input data-form-field="id" data-form-index="${index}" value="${this.escape(field.id || '')}" style="${this.adminInputStyle()}">
          </div>
          <div>
            <strong>Type</strong>
            <select data-form-field="type" data-form-index="${index}" style="${this.adminInputStyle()}">
              ${['text', 'email', 'tel', 'url', 'number', 'textarea', 'select', 'radio', 'checkbox'].map((type) => `<option value="${type}" ${field.type === type ? 'selected' : ''}>${type}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="application-grid" style="grid-template-columns:1fr auto auto;">
          <div>
            <strong>Placeholder</strong>
            <input data-form-field="placeholder" data-form-index="${index}" value="${this.escape(field.placeholder || '')}" style="${this.adminInputStyle()}">
          </div>
          <label class="check" style="align-self:center;">
            <input type="checkbox" data-form-field="required" data-form-index="${index}" ${field.required ? 'checked' : ''}>
            <span>Obligatoire</span>
          </label>
          <button type="button" data-remove-form-field="${index}" class="reject">Supprimer</button>
        </div>
        ${(field.type === 'select' || field.type === 'radio') ? `
          <div class="application-copy">
            <strong>Options</strong>
            <input data-form-field="options" data-form-index="${index}" value="${this.escape(optionString)}" placeholder="Option 1 | Option 2 | Option 3" style="${this.adminInputStyle()}">
          </div>
        ` : ''}
      </div>
    `;
  }

  adminInputStyle(isTextarea = false) {
    return `width:100%;margin-top:.45rem;border:1px solid rgba(198,167,94,0.18);background:rgba(255,255,255,0.04);color:#f6f1e8;border-radius:14px;padding:.85rem .95rem;font:inherit;${isTextarea ? 'min-height:100px;resize:vertical;' : ''}`;
  }

  renderProductReview(item) {
    const meta = this.productStatusMeta(item.status);
    const image = Array.isArray(item.images) && item.images[0] ? `<img src="${item.images[0]}" alt="${item.name || 'Produit vendeur'}" style="width:74px;height:74px;border-radius:18px;object-fit:cover;border:1px solid rgba(255,255,255,0.08);">` : '<div style="width:74px;height:74px;border-radius:18px;background:rgba(198,167,94,0.1);display:flex;align-items:center;justify-content:center;color:#c6a75e;font-weight:800;">IMG</div>';
    const { resolvedCategory, categoryRule, effectiveRate, effectiveRule } = this.resolveProductCommissionState(item);
    const stockLabel = this.getProductStockLabel(item);
    const commissionValue = effectiveRate ?? '';
    const commissionLabel = commissionValue !== '' ? `${commissionValue}%` : 'A definir';
    const commissionHint = effectiveRule?.source === 'product_override'
      ? 'Commission specifique a ce produit'
      : (categoryRule ? `Regle categorie: ${Number(categoryRule.rate) || 0}%` : 'Aucune regle de categorie trouvee');
    return `
      <div class="application-card">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:1rem;align-items:start;">
          ${image}
          <div>
            <div class="application-top">
              <div>
                <h3>${item.name || 'Produit vendeur'}</h3>
                <p>${item.vendorName || 'Vendeur'} · ${resolvedCategory || 'Categorie non definie'}</p>
              </div>
              <div class="badge" style="color:${meta.color}; background:${meta.bg};">${meta.label}</div>
            </div>
            <div class="application-grid">
              <div><strong>Prix</strong><span>${item.price ? `${item.price} HTG` : '-'}</span></div>
              <div><strong>Stock</strong><span>${stockLabel}</span></div>
              <div><strong>Livraison</strong><span>${item.deliveryMode || '-'}</span></div>
              <div><strong>Commission</strong><span>${commissionLabel}</span></div>
            </div>
            <div class="application-copy" style="padding-top:0;">
              <strong>Source commission</strong>
              <p>${commissionHint}</p>
            </div>
            ${item.shortDescription ? `<div class="application-copy"><strong>Description</strong><p>${item.shortDescription}</p></div>` : ''}
            ${item.adminReviewNote ? `<div class="application-copy admin-note"><strong>Note admin produit</strong><p>${item.adminReviewNote}</p></div>` : ''}
            <div class="actions" style="align-items:center;">
              <label style="display:flex;align-items:center;gap:.55rem;color:rgba(246,241,232,0.75);font-size:.85rem;">
                <span>Commission %</span>
                <input id="productCommission-${item.id}" type="number" min="0" max="100" step="0.01" value="${commissionValue}" style="width:92px;border:1px solid rgba(198,167,94,0.18);background:rgba(255,255,255,0.04);color:#f6f1e8;border-radius:999px;padding:.65rem .9rem;font:inherit;">
              </label>
              <button type="button" data-product-action="pending_review" data-product-id="${item.id}">Repasser en revue</button>
              <button type="button" data-product-action="active" data-product-id="${item.id}" class="approve">Approuver</button>
              <button type="button" data-product-action="rejected" data-product-id="${item.id}" class="reject">Refuser</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderVendorSalesSummary(summary) {
    return `
      <div class="application-card">
        <div class="application-top">
          <div>
            <h3>${summary.vendorName || 'Vendeur'}</h3>
            <p>${summary.totalOrders} commande(s) · ${summary.itemCount} article(s)</p>
          </div>
          <div class="badge" style="color:#14532D; background:rgba(20, 83, 45, 0.12);">Net ${this.formatPrice(summary.vendorNetAmount)}</div>
        </div>
        <div class="application-grid">
          <div><strong>Brut</strong><span>${this.formatPrice(summary.grossAmount)}</span></div>
          <div><strong>Commission</strong><span>${this.formatPrice(summary.commissionAmount)}</span></div>
          <div><strong>Net vendeur</strong><span>${this.formatPrice(summary.vendorNetAmount)}</span></div>
          <div><strong>Commandes</strong><span>${summary.totalOrders}</span></div>
        </div>
      </div>
    `;
  }

  renderPayoutWorkspace() {
    const overview = this.buildVendorPayoutOverview();
    const openRequests = overview.openRequests;
    const paidPayouts = overview.paidPayouts;
    const vendorBalances = overview.vendorBalances;

    return `
      <div class="applications" style="margin-top:1.2rem;">
        <div class="application-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
          <div class="application-card">
            <strong>Demandes ouvertes</strong>
            <p style="margin-top:.45rem;font-size:1.2rem;font-weight:800;color:#f6f1e8;">${openRequests.length}</p>
          </div>
          <div class="application-card">
            <strong>Net a decaisser</strong>
            <p style="margin-top:.45rem;font-size:1.2rem;font-weight:800;color:#f6f1e8;">${this.formatPrice(overview.totalOutstandingNet)}</p>
          </div>
          <div class="application-card">
            <strong>Net demande</strong>
            <p style="margin-top:.45rem;font-size:1.2rem;font-weight:800;color:#f6f1e8;">${this.formatPrice(overview.totalOpenRequestsNet)}</p>
          </div>
          <div class="application-card">
            <strong>Deja decaisse</strong>
            <p style="margin-top:.45rem;font-size:1.2rem;font-weight:800;color:#f6f1e8;">${this.formatPrice(overview.totalPaidNet)}</p>
          </div>
        </div>

        <div class="application-copy">
          <strong>Demandes de decaissement</strong>
          <p>Les vendeurs peuvent demander un decaissement tous les 30 jours. Ici, vous pouvez mettre la demande en attente, l approuver, la rejeter ou payer le vendeur apres verification.</p>
        </div>

        ${openRequests.length ? openRequests.map((entry) => this.renderPayoutRequestCard(entry)).join('') : `
          <div class="empty-state">
            <i class="fas fa-wallet"></i>
            <p>Aucune demande de decaissement en cours pour le moment.</p>
          </div>
        `}

        <div class="application-copy">
          <strong>Soldes vendeurs</strong>
          <p>Le net disponible tient compte des commissions et retire automatiquement les commandes deja couvertes par un decaissement paye.</p>
        </div>

        ${vendorBalances.length ? `
          <div class="applications">
            ${vendorBalances.map((entry) => this.renderVendorBalanceCard(entry)).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <i class="fas fa-store"></i>
            <p>Aucun vendeur actif pour le moment.</p>
          </div>
        `}

        <div class="application-copy">
          <strong>Historique des paiements</strong>
          <p>Chaque decaissement paye garde son rapport, sa periode, son montant net et les informations du vendeur pour toute future verification.</p>
        </div>

        ${paidPayouts.length ? `
          <div class="applications">
            ${paidPayouts.slice(0, 24).map((entry) => this.renderPaidPayoutCard(entry)).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <i class="fas fa-file-invoice-dollar"></i>
            <p>Aucun decaissement paye n a encore ete enregistre.</p>
          </div>
        `}
      </div>
    `;
  }

  renderPayoutRequestCard(entry = {}) {
    const meta = this.payoutStatusMeta(entry.status);
    const requestId = String(entry.id || '').trim();
    const canPay = ['requested', 'pending', 'approved'].includes(String(entry.status || '').toLowerCase());
    const defaultDateFrom = this.toDateInputValue(entry.periodStart);
    const defaultDateTo = this.toDateInputValue(entry.periodEnd);

    return `
      <div class="application-card">
        <div class="application-top">
          <div>
            <h3>${this.escape(entry.shopName || entry.vendorName || 'Store vendeur')}</h3>
            <p>${this.escape(entry.fullName || `${entry.firstName || ''} ${entry.lastName || ''}`.trim() || 'Vendeur')} Â· ${this.escape(entry.phone || 'Telephone indisponible')}</p>
          </div>
          <div class="badge" style="color:${meta.color}; background:${meta.bg};">${meta.label}</div>
        </div>

        <div class="application-grid">
          <div><strong>Rapport</strong><span>${this.escape(entry.reportNumber || requestId || '-')}</span></div>
          <div><strong>Date demande</strong><span>${this.escape(this.formatDateTime(entry.requestedAt || entry.createdAt))}</span></div>
          <div><strong>Montant brut</strong><span>${this.formatPrice(entry.grossAmount || 0)}</span></div>
          <div><strong>Commission</strong><span>${this.formatPrice(entry.commissionAmount || 0)}</span></div>
          <div><strong>Montant net</strong><span>${this.formatPrice(entry.netAmount || 0)}</span></div>
          <div><strong>Commandes</strong><span>${Number(entry.orderCount || 0)}</span></div>
        </div>

        <div class="application-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));">
          <div>
            <strong>Periode de debut</strong>
            <input id="payout-date-from-${requestId}" type="date" value="${this.escape(defaultDateFrom)}" style="${this.adminInputStyle()}">
          </div>
          <div>
            <strong>Periode de fin</strong>
            <input id="payout-date-to-${requestId}" type="date" value="${this.escape(defaultDateTo)}" style="${this.adminInputStyle()}">
          </div>
        </div>

        <div class="application-copy">
          <strong>Informations vendeur</strong>
          <p>${this.escape(entry.address || 'Adresse non renseignee')} ${entry.email ? `Â· ${this.escape(entry.email)}` : ''}</p>
        </div>

        <div class="actions">
          <button type="button" data-payout-status="pending" data-payout-id="${this.escape(requestId)}">Mettre en attente</button>
          <button type="button" data-payout-status="approved" data-payout-id="${this.escape(requestId)}" class="approve">Approuver</button>
          <button type="button" data-payout-status="rejected" data-payout-id="${this.escape(requestId)}" class="reject">Rejeter</button>
          ${canPay ? `<button type="button" data-pay-payout="${this.escape(requestId)}" data-vendor-id="${this.escape(entry.vendorId || '')}" class="approve">Payer le vendeur</button>` : ''}
        </div>
      </div>
    `;
  }

  renderVendorBalanceCard(entry = {}) {
    const vendor = entry.vendor || {};
    const summary = entry.outstanding || {};
    const openRequest = entry.openRequest;
    const lastPaid = entry.lastPaid;
    const requestMeta = openRequest ? this.payoutStatusMeta(openRequest.status) : null;

    return `
      <div class="application-card">
        <div class="application-top">
          <div>
            <h3>${this.escape(this.getVendorDisplayName(vendor))}</h3>
            <p>${this.escape(vendor.phone || vendor.email || 'Aucun contact')}</p>
          </div>
          ${requestMeta ? `<div class="badge" style="color:${requestMeta.color}; background:${requestMeta.bg};">${requestMeta.label}</div>` : ''}
        </div>
        <div class="application-grid">
          <div><strong>Brut disponible</strong><span>${this.formatPrice(summary.grossAmount || 0)}</span></div>
          <div><strong>Commission</strong><span>${this.formatPrice(summary.commissionAmount || 0)}</span></div>
          <div><strong>Net disponible</strong><span>${this.formatPrice(summary.vendorNetAmount || 0)}</span></div>
          <div><strong>Commandes ouvertes</strong><span>${Number(summary.totalOrders || 0)}</span></div>
          <div><strong>Articles</strong><span>${Number(summary.itemCount || 0)}</span></div>
          <div><strong>Dernier paiement</strong><span>${this.escape(lastPaid ? this.formatDateTime(lastPaid.paidAt || lastPaid.reviewedAt || lastPaid.requestedAt) : '-')}</span></div>
        </div>
      </div>
    `;
  }

  renderPaidPayoutCard(entry = {}) {
    return `
      <div class="application-card">
        <div class="application-top">
          <div>
            <h3>${this.escape(entry.reportNumber || entry.id || 'Decaissement')}</h3>
            <p>${this.escape(entry.shopName || entry.vendorName || 'Store vendeur')} Â· ${this.escape(this.formatDateTime(entry.paidAt || entry.reviewedAt || entry.requestedAt || entry.createdAt))}</p>
          </div>
          <div class="badge" style="color:#14532D; background:rgba(20, 83, 45, 0.12);">Paye</div>
        </div>
        <div class="application-grid">
          <div><strong>Net decaisse</strong><span>${this.formatPrice(entry.netAmount || 0)}</span></div>
          <div><strong>Brut</strong><span>${this.formatPrice(entry.grossAmount || 0)}</span></div>
          <div><strong>Commission</strong><span>${this.formatPrice(entry.commissionAmount || 0)}</span></div>
          <div><strong>Periode</strong><span>${this.escape(entry.periodStart ? new Date(entry.periodStart).toLocaleDateString('fr-FR') : '-')} -> ${this.escape(entry.periodEnd ? new Date(entry.periodEnd).toLocaleDateString('fr-FR') : '-')}</span></div>
        </div>
        <div class="actions">
          <button type="button" data-download-payout-pdf="${this.escape(entry.id || '')}">Telecharger le PDF</button>
        </div>
      </div>
    `;
  }

  attachEvents() {
    this.root.querySelectorAll('[data-action][data-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.updateStatus(button.dataset.id, button.dataset.action);
      });
    });

    this.root.querySelectorAll('[data-section-link]').forEach((button) => {
      button.addEventListener('click', () => {
        this.activeSection = button.dataset.sectionLink;
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-product-action][data-product-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.updateProductStatus(button.dataset.productId, button.dataset.productAction);
      });
    });

    this.root.querySelector('[data-add-commission-rule]')?.addEventListener('click', () => {
      this.commissionRules.push({ id: `new-${Date.now()}`, category: '', rate: '', active: true });
      this.render();
      this.attachEvents();
    });

    this.root.querySelector('[data-save-commission-rules]')?.addEventListener('click', async () => {
      await this.saveCommissionRules();
    });

    this.root.querySelector('[data-add-form-field]')?.addEventListener('click', () => {
      this.formSettings.fields.push({
        id: `field_${Date.now()}`,
        type: 'text',
        label: 'Nouveau champ',
        required: false,
        placeholder: ''
      });
      this.render();
      this.attachEvents();
    });

    this.root.querySelectorAll('[data-remove-form-field]').forEach((button) => {
      button.addEventListener('click', () => {
        this.formSettings.fields.splice(Number(button.dataset.removeFormField), 1);
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelector('[data-save-form-settings]')?.addEventListener('click', async () => {
      await this.saveFormSettings();
    });

    this.root.querySelectorAll('[data-payout-status][data-payout-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.updatePayoutStatus(button.dataset.payoutId, button.dataset.payoutStatus);
      });
    });

    this.root.querySelectorAll('[data-pay-payout][data-vendor-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.payVendorPayout(button.dataset.payPayout, button.dataset.vendorId);
      });
    });

    this.root.querySelectorAll('[data-download-payout-pdf]').forEach((button) => {
      button.addEventListener('click', () => {
        this.downloadPayoutPdf(button.dataset.downloadPayoutPdf);
      });
    });
  }

  async updateStatus(id, status) {
    const current = this.applications.find((item) => item.id === id);
    if (!current) return;

    const now = new Date().toISOString();
    const payload = {
      ...current,
      status,
      updatedAt: now,
      reviewedAt: now,
      reviewedBy: 'dashboard_admin',
      adminNote:
        status === 'approved'
          ? 'Candidature approuvee. Le profil vendeur peut passer a la phase suivante.'
          : status === 'rejected'
            ? 'Candidature refusee. Revoir les informations avant re-soumission.'
            : 'Candidature remise en attente de revue.',
      sellerActivatedAt: status === 'approved' ? (current.sellerActivatedAt || now) : ''
    };

    await setDoc(doc(db, 'vendorApplications', id), payload, { merge: true });

    if (status === 'approved') {
      const vendorProfile = {
        uid: current.uid || id,
        applicationId: id,
        vendorId: current.uid || id,
        vendorName: current.shopName || current.applicantName || 'Vendeur',
        shopName: current.shopName || '',
        applicantName: current.applicantName || '',
        email: current.email || '',
        phone: current.phone || '',
        city: current.city || '',
        address: current.address || '',
        category: current.category || '',
        deliveryMode: current.deliveryMode || '',
        status: 'active',
        role: 'vendor',
        commissionRule: current.commissionRule || null,
        createdAt: current.createdAt || now,
        updatedAt: now,
        approvedAt: now,
        approvedBy: 'dashboard_admin'
      };

      await setDoc(doc(db, 'vendors', vendorProfile.vendorId), vendorProfile, { merge: true });
      await setDoc(doc(db, 'clients', vendorProfile.vendorId), {
        uid: vendorProfile.vendorId,
        role: 'vendor',
        vendorStatus: 'active',
        vendorId: vendorProfile.vendorId,
        vendorName: vendorProfile.vendorName,
        updatedAt: now
      }, { merge: true });
    } else if (status === 'rejected') {
      await setDoc(doc(db, 'clients', current.uid || id), {
        uid: current.uid || id,
        vendorStatus: 'rejected',
        updatedAt: now
      }, { merge: true });
    }

    await this.loadData();
    this.render();
    this.attachEvents();
  }

  async updateProductStatus(id, status) {
    const current = this.vendorProducts.find((item) => item.id === id);
    if (!current) return;

    const now = new Date().toISOString();
    const commissionInput = document.getElementById(`productCommission-${id}`);
    const commissionRate = Number.parseFloat(commissionInput?.value || '');
    const { resolvedCategory, categoryRule, effectiveRule } = this.resolveProductCommissionState(current);
    const normalizedCommission = Number.isFinite(commissionRate)
      ? {
          ...(effectiveRule || {}),
          category: resolvedCategory || effectiveRule?.category || '',
          categoryRate: commissionRate,
          source: 'product_override',
          updatedAt: now,
          updatedBy: 'dashboard_admin'
        }
      : (effectiveRule || current.commissionRule || (
          categoryRule
            ? {
                category: categoryRule.category || resolvedCategory || '',
                categoryRate: Number(categoryRule.rate) || 0,
                source: 'vendorCommissionRules',
                updatedAt: now,
                updatedBy: 'dashboard_admin'
              }
            : null
        ));

    const adminReviewNote =
      status === 'active'
        ? 'Produit vendeur approuve pour la suite du workflow marketplace.'
        : status === 'rejected'
          ? 'Produit vendeur refuse. Une correction vendeur est necessaire avant nouvelle revue.'
          : 'Produit replace en revue admin.';

    await setDoc(doc(db, 'vendorProducts', id), {
      status,
      category: resolvedCategory || current.category || '',
      commissionRule: normalizedCommission,
      adminReviewNote,
      reviewedAt: now,
      reviewedBy: 'dashboard_admin',
      publishedAt: status === 'active' ? (current.publishedAt || now) : '',
      updatedAt: now
    }, { merge: true });

    await this.loadData();
    this.render();
    this.attachEvents();
  }

  async saveCommissionRules() {
    const rows = Array.from(this.root.querySelectorAll('[data-commission-row]'));
    const now = new Date().toISOString();
    const nextRules = rows.map((_, index) => {
      const category = this.root.querySelector(`[data-commission-field="category"][data-commission-index="${index}"]`)?.value?.trim() || '';
      const rate = Number.parseFloat(this.root.querySelector(`[data-commission-field="rate"][data-commission-index="${index}"]`)?.value || '');
      const active = !!this.root.querySelector(`[data-commission-field="active"][data-commission-index="${index}"]`)?.checked;
      if (!category) return null;
      return {
        id: this.normalizeCategory(category) || `commission-${index}`,
        category,
        rate: Number.isFinite(rate) ? rate : 0,
        active,
        updatedAt: now,
        updatedBy: 'dashboard_admin'
      };
    }).filter(Boolean);

    await Promise.all(nextRules.map((rule) => setDoc(doc(db, 'vendorCommissionRules', rule.id), rule, { merge: true })));
    await this.loadData();
    this.render();
    this.attachEvents();
  }

  async updatePayoutStatus(id, status) {
    const current = this.vendorPayouts.find((item) => String(item.id) === String(id));
    if (!current) return;

    const now = new Date().toISOString();
    const reviewer = auth.currentUser?.uid || 'dashboard_admin';
    await setDoc(doc(db, 'vendorPayouts', id), {
      status,
      updatedAt: now,
      reviewedAt: now,
      approvedBy: reviewer
    }, { merge: true });

    await this.loadData();
    this.render();
    this.attachEvents();
  }

  async payVendorPayout(requestId, vendorId) {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      window.alert('Session admin requise pour payer un vendeur.');
      return;
    }

    const dateFrom = this.root.querySelector(`#payout-date-from-${requestId}`)?.value || '';
    const dateTo = this.root.querySelector(`#payout-date-to-${requestId}`)?.value || '';
    const token = await currentUser.getIdToken();
    const response = await fetch(CREATE_VENDOR_PAYOUT_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        vendorId,
        requestId,
        dateFrom,
        dateTo
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      window.alert(payload?.message || payload?.error || `HTTP ${response.status}`);
      return;
    }

    await this.loadData();
    this.render();
    this.attachEvents();
  }

  downloadPayoutPdf(payoutId) {
    try {
      const payout = this.vendorPayouts.find((item) => String(item.id) === String(payoutId));
      if (!payout || String(payout.status || '').toLowerCase() !== 'paid') {
        window.alert('Le PDF est disponible uniquement pour un decaissement paye.');
        return;
      }

      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) {
        window.alert('Bibliotheque PDF indisponible.');
        return;
      }

      const docPdf = new jsPDF();
      let y = 22;
      docPdf.setFillColor(198, 167, 94);
      docPdf.rect(0, 0, 210, 28, 'F');
      docPdf.setTextColor(255, 255, 255);
      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(18);
      docPdf.text('Rapport de decaissement vendeur', 14, 18);

      docPdf.setTextColor(31, 30, 28);
      docPdf.setFontSize(11);
      y = 40;

      [
        `Numero: ${payout.reportNumber || payout.id || '-'}`,
        `Date: ${this.formatDateTime(payout.paidAt || payout.reviewedAt || payout.requestedAt || payout.createdAt)}`,
        `Nom du store: ${payout.shopName || payout.vendorName || '-'}`,
        `Nom complet: ${payout.fullName || `${payout.firstName || ''} ${payout.lastName || ''}`.trim() || '-'}`,
        `Prenom: ${payout.firstName || '-'}`,
        `Nom: ${payout.lastName || '-'}`,
        `Sexe: ${payout.gender || '-'}`,
        `Telephone: ${payout.phone || '-'}`,
        `Adresse: ${payout.address || '-'}`,
        `Montant decaisse: ${this.formatPrice(payout.netAmount || 0)}`,
        `Periode de decaissement: ${payout.periodStart ? new Date(payout.periodStart).toLocaleDateString('fr-FR') : '-'} -> ${payout.periodEnd ? new Date(payout.periodEnd).toLocaleDateString('fr-FR') : '-'}`,
        `Montant brut: ${this.formatPrice(payout.grossAmount || 0)}`,
        `Commission: ${this.formatPrice(payout.commissionAmount || 0)}`
      ].forEach((line) => {
        const wrapped = docPdf.splitTextToSize(line, 178);
        docPdf.text(wrapped, 14, y);
        y += wrapped.length * 6 + 2;
      });

      const safeName = String(payout.reportNumber || payout.id || 'decaissement-vendeur').replace(/[^A-Za-z0-9_-]/g, '-');
      docPdf.save(`decaissement-vendeur-${safeName}.pdf`);
    } catch (error) {
      console.error('Erreur generation PDF decaissement admin:', error);
      window.alert(error?.message || 'Impossible de generer le PDF du decaissement.');
    }
  }

  collectFormSettings() {
    const title = this.root.querySelector('#vendorFormTitle')?.value?.trim() || DEFAULT_FORM_SETTINGS.title;
    const subtitle = this.root.querySelector('#vendorFormSubtitle')?.value?.trim() || DEFAULT_FORM_SETTINGS.subtitle;
    const submitLabel = this.root.querySelector('#vendorFormSubmitLabel')?.value?.trim() || DEFAULT_FORM_SETTINGS.submitLabel;

    const rows = Array.from(this.root.querySelectorAll('[data-form-field-row]'));
    const fields = rows.map((_, index) => {
      const type = this.root.querySelector(`[data-form-field="type"][data-form-index="${index}"]`)?.value || 'text';
      const rawOptions = this.root.querySelector(`[data-form-field="options"][data-form-index="${index}"]`)?.value || '';
      return {
        id: this.root.querySelector(`[data-form-field="id"][data-form-index="${index}"]`)?.value?.trim() || `field_${index}`,
        label: this.root.querySelector(`[data-form-field="label"][data-form-index="${index}"]`)?.value?.trim() || `Champ ${index + 1}`,
        type,
        placeholder: this.root.querySelector(`[data-form-field="placeholder"][data-form-index="${index}"]`)?.value?.trim() || '',
        required: !!this.root.querySelector(`[data-form-field="required"][data-form-index="${index}"]`)?.checked,
        options: (type === 'select' || type === 'radio')
          ? rawOptions.split('|').map((item) => item.trim()).filter(Boolean)
          : []
      };
    }).filter((field) => field.id);

    return { title, subtitle, submitLabel, fields };
  }

  async saveFormSettings() {
    const nextSettings = this.collectFormSettings();
    if (!nextSettings.fields.length) return;

    await setDoc(doc(db, ...FORM_SETTINGS_REF), {
      ...nextSettings,
      updatedAt: new Date().toISOString(),
      updatedBy: 'dashboard_admin'
    }, { merge: true });

    this.formSettings = nextSettings;
    await this.loadData();
    this.render();
    this.attachEvents();
  }

  escape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export default VendorsDashboard;
