import { db, auth } from './firebase-init.js';
import { buildVendorSalesSummary, loadAllOrdersWithClients } from './vendor-analytics.js?v=20260812-1';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const FORM_SETTINGS_REF = ['vendorApplicationSettings', 'form'];
const PLAN_SETTINGS_REF = ['vendorPlanSettings', 'main'];
const VENDOR_PAYOUTS_COLLECTION = 'vendorPayouts';
const VENDOR_SERVICE_FEES_COLLECTION = 'vendorServiceFees';
const VENDOR_PLAN_BONUSES_COLLECTION = 'vendorPlanBonuses';
const PRO_VENDOR_COMMISSION_RATE = 10;
const CREATE_VENDOR_PAYOUT_FUNCTION_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/createVendorPayout';
const REQUEST_VENDOR_SERVICE_FEE_FUNCTION_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/requestVendorServiceFee';
const DEFAULT_FORM_SETTINGS = {
  title: 'Candidature vendeur',
  subtitle: 'Remplissez simplement le formulaire ci-dessous pour demander l ouverture de votre espace vendeur.',
  submitLabel: 'Envoyer ma candidature',
  fields: [
    { id: 'applicantName', type: 'text', label: 'Nom complet', required: true, placeholder: 'Votre nom complet' },
    { id: 'email', type: 'email', label: 'Email', required: true, placeholder: 'nom@exemple.com' },
    { id: 'phone', type: 'tel', label: 'Telephone', required: true, placeholder: '+509...' },
    { id: 'address', type: 'textarea', label: 'Adresse', required: true, placeholder: 'Adresse complete' },
    { id: 'city', type: 'text', label: 'Ville', required: true, placeholder: 'Votre ville' },
    { id: 'identityType', type: 'select', label: 'Identification', required: true, options: ['CIN', 'NIF', 'Licence', 'Passeport'] },
    { id: 'identityNumber', type: 'text', label: 'Numero', required: true, placeholder: 'Numero de la piece choisie' },
    { id: 'shopName', type: 'text', label: 'Nom de la boutique', required: true, placeholder: 'Nom de votre boutique' },
    { id: 'bankName', type: 'select', label: 'Banque', required: true, options: ['UNIBANK', 'SOGEBANK', 'BNC', 'CAPITAL BANK', 'BUH'] },
    { id: 'bankCurrency', type: 'select', label: 'Devise', required: true, options: ['Gourdes', 'USD'] },
    { id: 'bankAccountHolder', type: 'text', label: 'Nom du compte', required: true, placeholder: 'Nom exact du compte' },
    { id: 'bankAccountNumber', type: 'text', label: 'Numero du compte', required: true, placeholder: 'Numero du compte' },
    { id: 'description', type: 'textarea', label: 'Presentation de votre activite', required: true, placeholder: 'Decrivez votre activite, vos produits et votre positionnement.' }
  ]
};
const VENDOR_DELIVERY_MODE = 'Le vendeur gere la livraison';
function mergeRequiredVendorFields(fields = []) {
  return DEFAULT_FORM_SETTINGS.fields.map((field) => ({
    ...field,
    options: Array.isArray(field.options) ? [...field.options] : field.options
  }));
}

const DEFAULT_PLAN_SETTINGS = {
  proPrice: 1750,
  currency: 'HTG',
  payoutDelayDays: 30,
  firstActivationBonus: {
    enabled: false,
    amount: 0,
    durationDays: 30
  }
};

class VendorsDashboard {
  constructor() {
    this.root = document.getElementById('vendors-dashboard-root');
    if (!this.root) return;
    this.applications = [];
    this.vendorProducts = [];
    this.commissionRules = [];
    this.categories = [];
    this.allVendors = [];
    this.vendors = [];
    this.vendorSalesSummaries = [];
    this.vendorPayouts = [];
    this.vendorServiceFees = [];
    this.vendorPlanBonuses = [];
    this.editingSpecialBonusId = '';
    this.formSettings = DEFAULT_FORM_SETTINGS;
    this.planSettings = DEFAULT_PLAN_SETTINGS;
    this.activeSection = 'applications';
    this.editingApplicationId = '';
    this.init();
  }

  async init() {
    await this.loadData();
    const removedExpiredBonuses = await this.cleanupExpiredVendorPlanBonuses();
    if (removedExpiredBonuses) await this.loadData();
    this.render();
    this.attachEvents();
  }

  async loadData() {
    const [applicationSnapshot, productSnapshot, commissionSnapshot, categorySnapshot, vendorSnapshot, ordersData, formSettingsSnap, planSettingsSnap, payoutSnapshot, serviceFeeSnapshot, bonusSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'vendorApplications'), orderBy('updatedAt', 'desc'))),
      getDocs(query(collection(db, 'vendorProducts'), orderBy('updatedAt', 'desc'))),
      getDocs(collection(db, 'vendorCommissionRules')),
      getDocs(query(collection(db, 'categories_list'), orderBy('name'))),
      getDocs(query(collection(db, 'vendors'), orderBy('updatedAt', 'desc'))),
      loadAllOrdersWithClients(),
      getDoc(doc(db, ...FORM_SETTINGS_REF)),
      getDoc(doc(db, ...PLAN_SETTINGS_REF)),
      getDocs(query(collection(db, VENDOR_PAYOUTS_COLLECTION), orderBy('createdAt', 'desc'))),
      getDocs(query(collection(db, VENDOR_SERVICE_FEES_COLLECTION), orderBy('createdAt', 'desc'))),
      getDocs(query(collection(db, VENDOR_PLAN_BONUSES_COLLECTION), orderBy('updatedAt', 'desc')))
    ]);
    this.applications = applicationSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    this.vendorProducts = productSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    this.commissionRules = commissionSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => item.active !== false)
      .sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')));
    this.categories = categorySnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    this.allVendors = vendorSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    this.vendors = this.allVendors.filter((item) => item.status === 'active');
    this.vendorPayouts = payoutSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => Date.parse(String(b.createdAt || '')) - Date.parse(String(a.createdAt || '')));
    this.vendorServiceFees = serviceFeeSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => Date.parse(String(b.createdAt || b.requestedAt || b.paidAt || '')) - Date.parse(String(a.createdAt || a.requestedAt || a.paidAt || '')));
    this.vendorPlanBonuses = bonusSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => Date.parse(String(b.updatedAt || b.createdAt || '')) - Date.parse(String(a.updatedAt || a.createdAt || '')));
    this.formSettings = formSettingsSnap.exists()
      ? {
          ...DEFAULT_FORM_SETTINGS,
          ...formSettingsSnap.data(),
          fields: mergeRequiredVendorFields(formSettingsSnap.data()?.fields)
        }
      : DEFAULT_FORM_SETTINGS;
    this.formSettings.fields = mergeRequiredVendorFields(this.formSettings.fields);
    this.planSettings = planSettingsSnap.exists()
      ? { ...DEFAULT_PLAN_SETTINGS, ...(planSettingsSnap.data() || {}) }
      : DEFAULT_PLAN_SETTINGS;
    this.vendorSalesSummaries = this.vendors.map((vendor) => buildVendorSalesSummary({
      vendorId: vendor.id,
      vendorName: vendor.vendorName || vendor.shopName || 'Vendeur',
      orders: ordersData.orders,
      vendorProductIds: new Set(this.vendorProducts.filter((item) => item.vendorId === vendor.id).map((item) => item.id)),
      vendorProducts: this.vendorProducts.filter((item) => item.vendorId === vendor.id),
      commissionRules: this.commissionRules,
      payouts: this.vendorPayouts.filter((item) => item.vendorId === vendor.id),
      vendorPlanActive: this.isVendorProPlanActive(vendor)
    })).sort((a, b) => b.vendorNetAmount - a.vendorNetAmount);
  }

  async cleanupExpiredVendorPlanBonuses() {
    const expiredBonuses = (this.vendorPlanBonuses || []).filter((bonus) => this.getVendorPlanBonusStatus(bonus) === 'expiree');
    if (!expiredBonuses.length) return 0;
    await Promise.all(expiredBonuses.map((bonus) => deleteDoc(doc(db, VENDOR_PLAN_BONUSES_COLLECTION, bonus.id))));
    this.vendorPlanBonuses = this.vendorPlanBonuses.filter((bonus) => this.getVendorPlanBonusStatus(bonus) !== 'expiree');
    return expiredBonuses.length;
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
      productRejected: this.vendorProducts.filter((item) => item.status === 'rejected').length
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

  getProductStockLabel(item = {}) {
    if (item?.isDigitalProduct) {
      return 'Produit digital';
    }

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
            ${this.renderPlanSettings()}
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
            <p>Cette vue admin expose les ventes vendeur, la commission Smart Cut Services, le net a payer et le montant deja decaisse.</p>
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
                <h2>Historique des paiements vendeur</h2>
              </div>
            </div>
            <p>Chaque decaissement cree un rapport horodate, avec le net vendeur paye, la commission retenue et les commandes couvertes. Le PDF peut etre telecharge a tout moment.</p>
            ${this.vendorPayouts.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-money-check-dollar"></i>
                <p>Aucun decaissement vendeur enregistre pour le moment.</p>
              </div>
            ` : `
              <div class="applications" style="margin-top:1.2rem;">
                ${this.vendorPayouts.map((item) => this.renderVendorPayout(item)).join('')}
              </div>
            `}
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'service-fees' ? 'is-active' : ''}" data-section-panel="service-fees">
            <div class="panel-head">
              <div>
                <small>Abonnements vendeurs</small>
                <h2>Frais de service mensuel</h2>
              </div>
            </div>
            <p>Ce module montre les stores qui ont un abonnement mensuel, leur dernier paiement et permet de demander le paiement du nouveau cycle de 30 jours.</p>
            ${this.renderVendorServiceFees()}
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
      { id: 'payouts', icon: 'fa-wallet', label: 'Decaissements', meta: `${this.vendorPayouts.length} rapport(s)` },
      { id: 'service-fees', icon: 'fa-receipt', label: 'Frais mensuel', meta: `${this.getMonthlyServiceVendors().length} store(s)` }
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
    const isEditing = this.editingApplicationId === item.id;
    return `
      <div class="application-card">
        <div class="application-top">
          <div>
            <h3>${item.shopName || 'Boutique sans nom'}</h3>
            <p>${item.applicantName || 'Sans nom'} - ${item.email || '-'}</p>
          </div>
          <div class="badge" style="color:${meta.color}; background:${meta.bg};">${meta.label}</div>
        </div>

        <div class="application-grid">
          ${responseEntries.map((entry) => `<div><strong>${this.escape(entry.label)}</strong><span>${this.escape(entry.value)}</span></div>`).join('')}
          <div><strong>Soumise le</strong><span>${this.escape(this.formatDateTime(item.createdAt))}</span></div>
          <div><strong>Revisee le</strong><span>${this.escape(this.formatDateTime(item.reviewedAt))}</span></div>
          <div><strong>Active depuis</strong><span>${this.escape(this.formatDateTime(item.sellerActivatedAt))}</span></div>
        </div>
        ${item.adminNote ? `<div class="application-copy admin-note"><strong>Note admin</strong><p>${item.adminNote}</p></div>` : ''}

        <div class="actions">
          <button type="button" data-edit-application="${this.escape(item.id)}">${isEditing ? 'Fermer edition admin' : 'Modifier candidature'}</button>
          <button type="button" data-action="pending" data-id="${item.id}">Mettre en attente</button>
          <button type="button" data-action="approved" data-id="${item.id}" class="approve">Approuver</button>
          <button type="button" data-action="rejected" data-id="${item.id}" class="reject">Refuser</button>
        </div>
        ${isEditing ? this.renderApplicationEditor(item) : ''}
      </div>
    `;
  }

  getApplicationFieldValue(item = {}, fieldId = '') {
    const responses = item.responses || {};
    let value = responses[fieldId];
    if (value === undefined || value === null || value === '') {
      value = item[fieldId] ?? item[this.mapLegacyKey(fieldId)] ?? '';
    }
    return fieldId === 'deliveryMode' ? VENDOR_DELIVERY_MODE : value;
  }

  renderApplicationEditField(item, field) {
    const value = this.getApplicationFieldValue(item, field.id);
    const label = `${field.label || field.id}${field.required ? ' *' : ''}`;
    const fieldId = this.escape(field.id);
    const fieldType = String(field.type || 'text').toLowerCase();
    const inputType = ['email', 'tel', 'url', 'number', 'text'].includes(fieldType) ? fieldType : 'text';

    if (fieldType === 'checkbox') {
      const checked = value === true || ['true', 'oui', '1', 'yes'].includes(String(value).toLowerCase());
      return `
        <div>
          <strong>${this.escape(label)}</strong>
          <label class="check" style="margin-top:.55rem;">
            <input type="checkbox" data-application-edit-field="${fieldId}" ${checked ? 'checked' : ''}>
            <span>${this.escape(field.label || field.id)}</span>
          </label>
        </div>
      `;
    }

    if (fieldType === 'textarea') {
      return `
        <div>
          <strong>${this.escape(label)}</strong>
          <textarea data-application-edit-field="${fieldId}" rows="3" style="${this.adminInputStyle(true)}">${this.escape(value)}</textarea>
        </div>
      `;
    }

    if (fieldType === 'select' || fieldType === 'radio') {
      const configuredOptions = field.id === 'deliveryMode'
        ? [VENDOR_DELIVERY_MODE]
        : (Array.isArray(field.options) ? field.options : []);
      const options = [...configuredOptions];
      if (value && !options.includes(value)) options.unshift(value);
      return `
        <div>
          <strong>${this.escape(label)}</strong>
          <select data-application-edit-field="${fieldId}" style="${this.adminInputStyle()}">
            ${options.map((option) => `<option value="${this.escape(option)}" ${String(option) === String(value) ? 'selected' : ''}>${this.escape(option)}</option>`).join('')}
          </select>
        </div>
      `;
    }

    return `
      <div>
        <strong>${this.escape(label)}</strong>
        <input type="${inputType}" data-application-edit-field="${fieldId}" value="${this.escape(value)}" style="${this.adminInputStyle()}">
      </div>
    `;
  }

  renderApplicationEditor(item) {
    const fields = mergeRequiredVendorFields(this.formSettings.fields);

    return `
      <div class="application-copy admin-note" data-application-editor="${this.escape(item.id)}" style="margin-top:1rem;">
        <strong>Edition admin candidature</strong>
        <p>Admin uniquement: corrigez ou completez les informations manquantes du vendeur. Le vendeur ne peut pas modifier cette fiche apres envoi.</p>

        <div class="application-grid" style="margin-top:1rem;">
          ${fields.map((field) => this.renderApplicationEditField(item, field)).join('')}
        </div>

        <div class="application-copy" style="margin-top:1rem;">
          <strong>Note admin</strong>
          <textarea data-application-edit-field="adminNote" rows="3" style="${this.adminInputStyle(true)}">${this.escape(item.adminNote || '')}</textarea>
        </div>

        <div class="actions">
          <button type="button" data-save-application-edit="${this.escape(item.id)}" class="approve">Enregistrer modifications admin</button>
          <button type="button" data-cancel-application-edit>Annuler</button>
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

  formatDateTime(value) {
    if (!value) return '-';
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('fr-FR');
  }

  addDays(value, days = 30) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return date.toISOString();
  }

  getVendorServiceFeeAmount(vendor = {}) {
    const configured = Number(vendor.monthlyServiceFee || vendor.serviceFeeAmount);
    if (Number.isFinite(configured) && configured > 0) return configured;
    const planPrice = Number(vendor.planPrice);
    const planId = String(vendor.planId || '').toLowerCase();
    const planPaymentRequired = Boolean(vendor.planPaymentRequired);
    if ((planPaymentRequired || planId === 'pro') && Number.isFinite(planPrice) && planPrice > 0) return planPrice;
    return 0;
  }

  isVendorProPlanActive(vendor = {}) {
    const planId = String(vendor?.planId || '').trim().toLowerCase();
    const planLabel = String(vendor?.planLabel || '').trim().toLowerCase();
    if (planId !== 'pro' && !planLabel.includes('pro')) return false;

    const serviceStatus = String(vendor?.serviceFeeStatus || '').trim().toLowerCase();
    if (['basic_limited', 'expired', 'unpaid'].includes(serviceStatus)) return false;

    const nextDueValue = vendor?.serviceFeeNextDueAt || vendor?.serviceFeePaidPeriodEndAt || '';
    const nextDueMs = nextDueValue
      ? (typeof nextDueValue?.toDate === 'function' ? nextDueValue.toDate().getTime() : Date.parse(String(nextDueValue)))
      : 0;
    return !Number.isFinite(nextDueMs) || nextDueMs <= 0 || nextDueMs > Date.now();
  }

  getMonthlyServiceVendors() {
    return this.allVendors
      .filter((vendor) => this.getVendorServiceFeeAmount(vendor) > 0)
      .sort((a, b) => String(a.vendorName || a.shopName || '').localeCompare(String(b.vendorName || b.shopName || '')));
  }

  getLatestServiceFee(vendorId, status = '') {
    const normalizedVendorId = String(vendorId || '').trim();
    const normalizedStatus = String(status || '').trim().toLowerCase();
    return this.vendorServiceFees.find((fee) => {
      if (String(fee.vendorId || '').trim() !== normalizedVendorId) return false;
      if (!normalizedStatus) return true;
      return String(fee.status || '').trim().toLowerCase() === normalizedStatus;
    }) || null;
  }

  getServiceFeePaymentLabel(method = '') {
    const value = String(method || '').toLowerCase();
    if (value === 'natcash') return 'NatCash';
    if (value === 'card') return 'Carte bancaire';
    if (value === 'moncash') return 'MonCash';
    return method || '-';
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
    const configured = mergeRequiredVendorFields(this.formSettings.fields).map((field) => {
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
      identityType: 'identityType',
      identityNumber: 'identityNumber',
      city: 'city',
      address: 'address',
      bankName: 'bankName',
      bankCurrency: 'bankCurrency',
      bankAccountHolder: 'bankAccountHolder',
      bankAccountNumber: 'bankAccountNumber',
      description: 'description',
    };
    return map[id] || id;
  }

  getVendorNameById(vendorId) {
    const id = String(vendorId || '').trim();
    const vendor = this.allVendors.find((item) => String(item.vendorId || item.uid || item.id) === id);
    return vendor?.vendorName || vendor?.shopName || vendor?.email || '';
  }

  getVendorPlanBonusStatus(bonus = {}) {
    if (String(bonus.status || '').toLowerCase() === 'consumed') return 'consommee';
    if (bonus.enabled === false || String(bonus.status || '').toLowerCase() === 'disabled') return 'desactivee';
    const now = Date.now();
    const startMs = Date.parse(String(bonus.startAt || ''));
    const endMs = Date.parse(String(bonus.endAt || ''));
    if (Number.isFinite(startMs) && startMs > now) return 'programmee';
    if (Number.isFinite(endMs) && endMs <= now) return 'expiree';
    return 'active';
  }

  normalizeBonusDurationDays(source = {}) {
    const days = Number(source.durationDays || source.bonusDurationDays || source.offerDurationDays || 0);
    if ([30, 90, 180].includes(days)) return days;
    const months = Number(source.durationMonths || source.bonusDurationMonths || source.offerDurationMonths || 0);
    if (months === 1) return 30;
    if (months === 3) return 90;
    if (months === 6) return 180;
    const startMs = Date.parse(String(source.startAt || source.bonusStartAt || source.offerStartAt || source.startDate || ''));
    const endMs = Date.parse(String(source.endAt || source.bonusEndAt || source.offerEndAt || source.endDate || ''));
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      const diffDays = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000));
      if (diffDays >= 150) return 180;
      if (diffDays >= 60) return 90;
      return 30;
    }
    return 30;
  }

  bonusDurationMonthsLabel(days = 30) {
    const durationDays = this.normalizeBonusDurationDays({ durationDays: days });
    return durationDays === 180 ? 6 : durationDays === 90 ? 3 : 1;
  }

  toIsoFromLocalInput(value = '') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
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

  renderPlanSettings() {
    const firstBonus = {
      ...DEFAULT_PLAN_SETTINGS.firstActivationBonus,
      ...(this.planSettings.firstActivationBonus || {})
    };
    const firstBonusDurationDays = this.normalizeBonusDurationDays(this.planSettings.firstActivationBonus || firstBonus);
    const editingSpecialBonus = this.vendorPlanBonuses.find((bonus) => String(bonus.id) === String(this.editingSpecialBonusId)) || null;
    const editingVendorId = editingSpecialBonus?.vendorId || '';
    const editingDurationDays = editingSpecialBonus ? this.normalizeBonusDurationDays(editingSpecialBonus) : 30;
    return `
      <div class="application-card" style="margin-top:1.2rem;">
        <div class="application-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
          <div>
            <strong>Prix Plan PRO</strong>
            <input id="vendorPlanProPrice" type="number" min="0" step="1" value="${this.escape(this.planSettings.proPrice || DEFAULT_PLAN_SETTINGS.proPrice)}" style="${this.adminInputStyle()}">
          </div>
          <div>
            <strong>Devise</strong>
            <input id="vendorPlanCurrency" value="${this.escape(this.planSettings.currency || DEFAULT_PLAN_SETTINGS.currency)}" style="${this.adminInputStyle()}">
          </div>
          <div>
            <strong>Request payment chaque</strong>
            <input id="vendorPlanPayoutDelay" type="number" min="1" step="1" value="${this.escape(this.planSettings.payoutDelayDays || DEFAULT_PLAN_SETTINGS.payoutDelayDays)}" style="${this.adminInputStyle()}">
          </div>
        </div>
        <p class="application-copy" style="margin-top:.8rem;">Ces reglages pilotent les plans affiches avant la candidature vendeur. Le Plan Basic reste gratuit.</p>
        <div class="actions">
          <button type="button" data-save-plan-settings class="approve">Enregistrer les plans</button>
        </div>
      </div>
      <div class="application-card" style="margin-top:1.2rem;">
        <div class="application-top">
          <div>
            <h3>Bonification de premiere activation</h3>
            <p>Offre globale appliquee aux vendeurs admissibles. Le montant est un prix bonifie par periode de 30 jours.</p>
          </div>
          <div class="badge" style="color:${firstBonus.enabled ? '#14532D' : '#7F1D1D'};background:${firstBonus.enabled ? 'rgba(20,83,45,.12)' : 'rgba(127,29,29,.12)'};">${firstBonus.enabled ? 'Activee' : 'Desactivee'}</div>
        </div>
        <div class="application-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));align-items:end;">
          <label>
            <strong>Etat</strong>
            <select id="vendorFirstBonusEnabled" style="${this.adminInputStyle()}">
              <option value="false" ${firstBonus.enabled ? '' : 'selected'}>Desactivee</option>
              <option value="true" ${firstBonus.enabled ? 'selected' : ''}>Activee</option>
            </select>
          </label>
          <label>
            <strong>Montant mensuel bonifie</strong>
            <input id="vendorFirstBonusAmount" type="number" min="0" step="1" value="${this.escape(firstBonus.amount || 0)}" style="${this.adminInputStyle()}">
          </label>
          <label>
            <strong>Duree</strong>
            <select id="vendorFirstBonusDuration" style="${this.adminInputStyle()}">
              ${[30, 90, 180].map((days) => `<option value="${days}" ${firstBonusDurationDays === days ? 'selected' : ''}>${days} jours</option>`).join('')}
            </select>
          </label>
          <div>
            <strong>Prix normal</strong>
            <span style="display:block;margin-top:.75rem;font-weight:800;">${this.formatPrice(this.planSettings.proPrice || DEFAULT_PLAN_SETTINGS.proPrice)}</span>
          </div>
        </div>
        <p class="application-copy" style="margin-top:.8rem;">Le backend verifie l historique des paiements Pro avant d appliquer cette offre. Chaque paiement donne uniquement 30 jours de Plan Pro; la duree indique seulement la fenetre pendant laquelle le prix bonifie reste disponible.</p>
        <div class="actions">
          <button type="button" data-save-plan-settings class="approve">Enregistrer la bonification</button>
        </div>
      </div>
      <div class="application-card" style="margin-top:1.2rem;">
        <div class="application-top">
          <div>
            <h3>Bonifications speciales</h3>
            <p>Accordez un prix Plan Pro temporaire a un store precis. Le montant est paye tous les 30 jours; une offre speciale active passe avant l offre globale.</p>
          </div>
        </div>
        <div class="application-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));align-items:end;">
          <label>
            <strong>Vendeur</strong>
            <select id="vendorSpecialBonusVendor" style="${this.adminInputStyle()}">
              <option value="">Selectionner...</option>
              ${this.allVendors.map((vendor) => {
                const vendorId = vendor.vendorId || vendor.uid || vendor.id;
                const label = vendor.vendorName || vendor.shopName || vendor.email || vendorId;
                return `<option value="${this.escape(vendorId)}" ${String(editingVendorId) === String(vendorId) ? 'selected' : ''}>${this.escape(label)}</option>`;
              }).join('')}
            </select>
          </label>
          <label>
            <strong>Montant mensuel special</strong>
            <input id="vendorSpecialBonusAmount" type="number" min="0" step="1" value="${this.escape(editingSpecialBonus?.amount || '')}" style="${this.adminInputStyle()}">
          </label>
          <label>
            <strong>Duree</strong>
            <select id="vendorSpecialBonusDuration" style="${this.adminInputStyle()}">
              ${[30, 90, 180].map((days) => `<option value="${days}" ${editingDurationDays === days ? 'selected' : ''}>${days} jours</option>`).join('')}
            </select>
          </label>
          <label>
            <strong>Etat</strong>
            <select id="vendorSpecialBonusEnabled" style="${this.adminInputStyle()}">
              <option value="true" ${editingSpecialBonus?.enabled === false ? '' : 'selected'}>Activee</option>
              <option value="false" ${editingSpecialBonus?.enabled === false ? 'selected' : ''}>Desactivee</option>
            </select>
          </label>
        </div>
        <div class="actions">
          <button type="button" data-save-special-bonus class="approve">${editingSpecialBonus ? 'Mettre a jour la bonification speciale' : 'Enregistrer la bonification speciale'}</button>
          ${editingSpecialBonus ? '<button type="button" data-cancel-special-bonus-edit>Annuler la modification</button>' : ''}
        </div>
        ${this.renderVendorPlanBonusesTable()}
      </div>
    `;
  }

  renderVendorPlanBonusesTable() {
    if (!this.vendorPlanBonuses.length) {
      return '<p class="application-copy" style="margin-top:1rem;">Aucune bonification speciale enregistree pour le moment.</p>';
    }

    return `
      <div class="applications" style="margin-top:1rem;">
        ${this.vendorPlanBonuses.map((bonus) => {
          const status = this.getVendorPlanBonusStatus(bonus);
          const vendorName = bonus.vendorName || this.getVendorNameById(bonus.vendorId) || bonus.vendorId || 'Vendeur';
          const durationDays = this.normalizeBonusDurationDays(bonus);
          return `
            <div class="application-card" style="box-shadow:none;">
              <div class="application-top">
                <div>
                  <h3>${this.escape(vendorName)}</h3>
                  <p>Duree activee a partir du paiement confirme.</p>
                </div>
                <div class="badge">${this.escape(status)}</div>
              </div>
              <div class="application-grid">
                <div><strong>Montant / 30 jours</strong><span>${this.formatPrice(bonus.amount || 0)}</span></div>
                <div><strong>Duree</strong><span>${durationDays} jours</span></div>
                <div><strong>Prix normal</strong><span>${this.formatPrice(bonus.normalAmount || this.planSettings.proPrice || DEFAULT_PLAN_SETTINGS.proPrice)}</span></div>
                <div><strong>Etat</strong><span>${bonus.enabled === false ? 'Desactivee' : 'Activee'}</span></div>
                <div><strong>Derniere mise a jour</strong><span>${this.escape(this.formatDateTime(bonus.updatedAt))}</span></div>
              </div>
              <div class="actions">
                <button type="button" data-edit-special-bonus="${this.escape(bonus.id)}">Modifier</button>
                <button type="button" data-toggle-special-bonus="${this.escape(bonus.id)}" data-next-enabled="${bonus.enabled === false ? 'true' : 'false'}">
                  ${bonus.enabled === false ? 'Activer' : 'Desactiver'}
                </button>
                <button type="button" class="reject" data-delete-special-bonus="${this.escape(bonus.id)}">Supprimer</button>
              </div>
            </div>
          `;
        }).join('')}
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
    const vendor = this.allVendors.find((entry) => String(entry.vendorId || entry.uid || entry.id) === String(item.vendorId || '')) || {};
    const vendorProActive = this.isVendorProPlanActive(vendor);
    const stockLabel = this.getProductStockLabel(item);
    const commissionValue = vendorProActive ? PRO_VENDOR_COMMISSION_RATE : (effectiveRate ?? '');
    const commissionLabel = commissionValue !== '' ? `${commissionValue}%` : 'A definir';
    const commissionHint = vendorProActive
      ? 'Plan Pro actif : commission uniforme de 10% sur toutes les categories'
      : (effectiveRule?.source === 'product_override'
      ? 'Commission specifique a ce produit'
      : (categoryRule ? `Regle categorie: ${Number(categoryRule.rate) || 0}%` : 'Aucune regle de categorie trouvee'));
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
              <div><strong>Envoye le</strong><span>${this.escape(this.formatDateTime(item.submittedAt || item.createdAt))}</span></div>
              <div><strong>Derniere mise a jour</strong><span>${this.escape(this.formatDateTime(item.updatedAt || item.createdAt))}</span></div>
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
                <input id="productCommission-${item.id}" type="number" min="0" max="100" step="0.01" value="${commissionValue}" ${vendorProActive ? 'disabled title="Le Plan Pro applique automatiquement 10% a toutes les categories"' : ''} style="width:92px;border:1px solid rgba(198,167,94,0.18);background:rgba(255,255,255,0.04);color:#f6f1e8;border-radius:999px;padding:.65rem .9rem;font:inherit;">
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
    const pendingPayout = Number(summary.pendingPayoutAmount || 0);
    const settledAmount = Number(summary.settledNetAmount || 0);
    return `
      <div class="application-card">
        <div class="application-top">
          <div>
            <h3>${summary.vendorName || 'Vendeur'}</h3>
            <p>${summary.totalOrders} commande(s) · ${summary.itemCount} article(s)</p>
          </div>
          <div class="badge" style="color:#14532D; background:rgba(20, 83, 45, 0.12);">A payer ${this.formatPrice(pendingPayout)}</div>
        </div>
        <div class="application-grid">
          <div><strong>Base commission (produits)</strong><span>${this.formatPrice(summary.grossAmount)}</span></div>
          <div><strong>Livraison vendeur</strong><span>${this.formatPrice(summary.deliveryAmount)}</span></div>
          <div><strong>Commission</strong><span>${this.formatPrice(summary.commissionAmount)}</span></div>
          <div><strong>Net vendeur</strong><span>${this.formatPrice(summary.vendorNetAmount)}</span></div>
          <div><strong>Commandes</strong><span>${summary.totalOrders}</span></div>
          <div><strong>Deja decaisse</strong><span>${this.formatPrice(settledAmount)}</span></div>
          <div><strong>Solde a payer</strong><span>${this.formatPrice(pendingPayout)}</span></div>
        </div>
        <div class="application-copy">
          <p>La commission est calculée uniquement sur le prix des produits. Les frais de livraison sont ajoutés intégralement au net du vendeur.</p>
        </div>
        <div class="actions">
          <button type="button" data-create-payout="${summary.vendorId}" class="approve" ${pendingPayout <= 0 ? 'disabled' : ''}>Payer le vendeur</button>
        </div>
      </div>
    `;
  }

  renderVendorPayout(payout) {
    const coveredOrders = Array.isArray(payout?.coveredOrders) ? payout.coveredOrders : [];
    return `
      <div class="application-card">
        <div class="application-top">
          <div>
            <h3>${this.escape(payout.vendorName || 'Vendeur')}</h3>
            <p>${this.escape(payout.reportNumber || payout.id || 'Rapport')} · ${coveredOrders.length} commande(s)</p>
          </div>
          <div class="badge" style="color:#14532D; background:rgba(20, 83, 45, 0.12);">${this.formatPrice(payout.netAmount)}</div>
        </div>
        <div class="application-grid">
          <div><strong>Brut couvert</strong><span>${this.formatPrice(payout.grossAmount)}</span></div>
          <div><strong>Commission</strong><span>${this.formatPrice(payout.commissionAmount)}</span></div>
          <div><strong>Net verse</strong><span>${this.formatPrice(payout.netAmount)}</span></div>
          <div><strong>Date</strong><span>${payout.createdAt ? new Date(payout.createdAt).toLocaleString('fr-FR') : '-'}</span></div>
        </div>
        <div class="application-copy">
          <strong>Commandes couvertes</strong>
          <p>${coveredOrders.length ? coveredOrders.map((item) => item.uniqueCode || item.orderId).join(', ') : 'Aucune commande detaillee.'}</p>
        </div>
        <div class="actions">
          <button type="button" data-download-payout="${payout.id}">
            <i class="fas fa-file-pdf"></i>
            Telecharger le PDF
          </button>
        </div>
      </div>
    `;
  }

  renderVendorServiceFees() {
    const vendors = this.getMonthlyServiceVendors();
    if (!vendors.length) {
      return `
        <div class="empty-state">
          <i class="fas fa-receipt"></i>
          <p>Aucun store avec abonnement mensuel pour le moment.</p>
        </div>
      `;
    }

    return `
      <div class="applications" style="margin-top:1.2rem;">
        ${vendors.map((vendor) => this.renderVendorServiceFeeCard(vendor)).join('')}
      </div>
    `;
  }

  renderVendorServiceFeeCard(vendor) {
    const vendorId = vendor.vendorId || vendor.uid || vendor.id;
    const pending = this.getLatestServiceFee(vendorId, 'pending') || this.getLatestServiceFee(vendorId, 'payment_initiated') || this.getLatestServiceFee(vendorId, 'redirect_ready') || this.getLatestServiceFee(vendorId, 'payment_pending');
    const paid = this.getLatestServiceFee(vendorId, 'paid');
    const amount = this.getVendorServiceFeeAmount(vendor);
    const paidAt = paid?.paidAt || vendor.serviceFeeLastPaidAt || '';
    const nextDueAt = paid?.nextDueAt || vendor.serviceFeeNextDueAt || (paidAt ? this.addDays(paidAt, 30) : '');
    const isCyclePaid = paidAt && Date.parse(nextDueAt || '') > Date.now();
    const storeName = vendor.vendorName || vendor.shopName || 'Store vendeur';
    const paymentLine = isCyclePaid
      ? `Paye le ${this.formatDateTime(paidAt)} - ${this.getServiceFeePaymentLabel(paid?.paymentMethod || vendor.serviceFeePaymentMethod)}`
      : pending
        ? 'Request payment for this store'
        : 'Request payment for this store';
    const badge = isCyclePaid
      ? '<div class="badge" style="color:#14532D;background:rgba(20,83,45,.12);">A jour</div>'
      : '<div class="badge" style="color:#7F1D1D;background:rgba(127,29,29,.12);">Paiement requis</div>';

    return `
      <div class="application-card">
        <div class="application-top">
          <div>
            <h3>${this.escape(storeName)}</h3>
            <p>${this.escape(vendor.email || '-')} Â· ${this.escape(vendor.planLabel || vendor.planId || 'Abonnement mensuel')}</p>
          </div>
          ${badge}
        </div>
        <div class="application-grid">
          <div><strong>Montant mensuel</strong><span>${this.formatPrice(amount)}</span></div>
          <div><strong>Statut store</strong><span>${this.escape(vendor.status || vendor.vendorStatus || '-')}</span></div>
          <div><strong>Date paiement</strong><span>${this.escape(this.formatDateTime(paidAt))}</span></div>
          <div><strong>Methode paiement</strong><span>${this.escape(this.getServiceFeePaymentLabel(paid?.paymentMethod || vendor.serviceFeePaymentMethod))}</span></div>
          <div><strong>Prochaine echeance</strong><span>${this.escape(this.formatDateTime(nextDueAt))}</span></div>
          <div><strong>Request actuel</strong><span>${this.escape(pending?.id || '-')}</span></div>
        </div>
        <div class="application-copy" style="border-color:${isCyclePaid ? 'rgba(20,83,45,.18)' : 'rgba(127,29,29,.22)'};">
          <strong style="color:${isCyclePaid ? '#14532D' : '#B91C1C'};">${this.escape(paymentLine)}</strong>
          <p>${isCyclePaid ? 'Le bouton reste bloque jusqu au prochain cycle de 30 jours.' : 'Le store sera suspendu tant que le paiement du frais mensuel n est pas confirme.'}</p>
        </div>
        <div class="actions">
          <button type="button" data-request-service-fee="${this.escape(vendorId)}" class="approve" ${isCyclePaid || Boolean(pending) ? 'disabled' : ''}>
            Request frais de service mensuel
          </button>
          ${pending ? `
            <button type="button" data-confirm-service-fee="${this.escape(pending.id)}" class="approve">
              Marquer paye
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  async ensureJsPdfLoaded() {
    if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;

    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-jspdf-loader="true"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Impossible de charger la bibliotheque PDF.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.async = true;
      script.dataset.jspdfLoader = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Impossible de charger la bibliotheque PDF.'));
      document.head.appendChild(script);
    });

    if (!window.jspdf?.jsPDF) {
      throw new Error('Bibliotheque PDF indisponible.');
    }

    return window.jspdf.jsPDF;
  }

  async createVendorPayout(vendorId) {
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Session admin indisponible.');
      }

      const confirmed = window.confirm('Confirmer le decaissement de ce vendeur ? Cette action va enregistrer un rapport PDF.');
      if (!confirmed) return;

      const token = await user.getIdToken();
      const response = await fetch(CREATE_VENDOR_PAYOUT_FUNCTION_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ vendorId })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      }

      await this.loadData();
      this.render();
      this.attachEvents();

      const payout = payload?.payout || this.vendorPayouts.find((item) => item.vendorId === vendorId);
      if (payout) {
        await this.downloadPayoutPdf(payout);
      }

      window.alert('Decaissement enregistre avec succes.');
    } catch (error) {
      console.error('Erreur creation decaissement vendeur:', error);
      window.alert(error?.message || 'Impossible de creer le decaissement vendeur.');
    }
  }

  async downloadPayoutPdf(payout) {
    try {
      const JsPdf = await this.ensureJsPdfLoaded();
      const docPdf = new JsPdf();
      const coveredOrders = Array.isArray(payout?.coveredOrders) ? payout.coveredOrders : [];
      let y = 22;

      docPdf.setFillColor(31, 30, 28);
      docPdf.rect(0, 0, 210, 30, 'F');
      docPdf.setTextColor(255, 255, 255);
      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(18);
      docPdf.text('Rapport de decaissement vendeur', 14, 18);

      docPdf.setTextColor(31, 30, 28);
      docPdf.setFontSize(11);
      y = 42;
      docPdf.text(`Vendeur: ${String(payout?.vendorName || 'Vendeur')}`, 14, y);
      y += 8;
      docPdf.text(`Rapport: ${String(payout?.reportNumber || payout?.id || '-')}`, 14, y);
      y += 8;
      docPdf.text(`Date: ${payout?.createdAt ? new Date(payout.createdAt).toLocaleString('fr-FR') : '-'}`, 14, y);
      y += 12;

      [
        `Brut couvert: ${this.formatPrice(payout?.grossAmount)}`,
        `Commission Smart Cut Services: ${this.formatPrice(payout?.commissionAmount)}`,
        `Net verse au vendeur: ${this.formatPrice(payout?.netAmount)}`,
        `Nombre de commandes: ${coveredOrders.length}`
      ].forEach((line) => {
        docPdf.text(line, 14, y);
        y += 8;
      });

      y += 4;
      docPdf.setFont('helvetica', 'bold');
      docPdf.text('Commandes couvertes', 14, y);
      y += 8;
      docPdf.setFont('helvetica', 'normal');

      coveredOrders.forEach((order, index) => {
        if (y > 270) {
          docPdf.addPage();
          y = 20;
        }
        const line = `${index + 1}. ${order?.uniqueCode || order?.orderId || '-'} | Net ${this.formatPrice(order?.netAmount)} | Commission ${this.formatPrice(order?.commissionAmount)}`;
        const wrapped = docPdf.splitTextToSize(line, 180);
        docPdf.text(wrapped, 14, y);
        y += wrapped.length * 6 + 3;
      });

      const safeName = String(payout?.reportNumber || payout?.id || 'decaissement')
        .replace(/[^A-Za-z0-9_-]/g, '-');
      docPdf.save(`decaissement-${safeName}.pdf`);
    } catch (error) {
      console.error('Erreur generation PDF decaissement:', error);
      window.alert(error?.message || 'Impossible de generer le PDF de decaissement.');
    }
  }

  attachEvents() {
    this.root.querySelectorAll('[data-action][data-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.updateStatus(button.dataset.id, button.dataset.action);
      });
    });

    this.root.querySelectorAll('[data-edit-application]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.editApplication || '';
        this.editingApplicationId = this.editingApplicationId === id ? '' : id;
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-cancel-application-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        this.editingApplicationId = '';
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-save-application-edit]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.saveApplicationEdits(button.dataset.saveApplicationEdit);
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

    this.root.querySelectorAll('[data-create-payout]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.createVendorPayout(button.dataset.createPayout);
      });
    });

    this.root.querySelectorAll('[data-download-payout]').forEach((button) => {
      button.addEventListener('click', async () => {
        const payout = this.vendorPayouts.find((item) => item.id === button.dataset.downloadPayout);
        if (!payout) return;
        await this.downloadPayoutPdf(payout);
      });
    });

    this.root.querySelectorAll('[data-request-service-fee]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.requestVendorServiceFee(button.dataset.requestServiceFee, button);
      });
    });

    this.root.querySelectorAll('[data-confirm-service-fee]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.confirmVendorServiceFeePaid(button.dataset.confirmServiceFee, button);
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

    this.root.querySelectorAll('[data-save-plan-settings]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.savePlanSettings();
      });
    });

    this.root.querySelector('[data-save-special-bonus]')?.addEventListener('click', async () => {
      await this.saveSpecialVendorBonus();
    });

    this.root.querySelector('[data-cancel-special-bonus-edit]')?.addEventListener('click', () => {
      this.editingSpecialBonusId = '';
      this.render();
      this.attachEvents();
    });

    this.root.querySelectorAll('[data-edit-special-bonus]').forEach((button) => {
      button.addEventListener('click', () => {
        this.editingSpecialBonusId = button.dataset.editSpecialBonus || '';
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-toggle-special-bonus]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.toggleSpecialVendorBonus(button.dataset.toggleSpecialBonus, button.dataset.nextEnabled === 'true');
      });
    });

    this.root.querySelectorAll('[data-delete-special-bonus]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.deleteSpecialVendorBonus(button.dataset.deleteSpecialBonus);
      });
    });
  }

  getApplicationEditControl(fieldId) {
    return Array.from(this.root.querySelectorAll('[data-application-edit-field]'))
      .find((input) => input.dataset.applicationEditField === fieldId) || null;
  }

  parseDeliveryZonesText(value = '') {
    return String(value || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [country, department, commune, fee] = line.split('|').map((part) => String(part || '').trim());
        return {
          country: country || 'Haiti',
          department: department || '',
          commune: commune || '',
          fee: Number(fee || 0)
        };
      })
      .filter((zone) => zone.department || zone.commune || Number(zone.fee || 0) > 0);
  }

  collectApplicationEditPayload(current) {
    const now = new Date().toISOString();
    const fields = mergeRequiredVendorFields(this.formSettings.fields);
    const responses = { ...(current.responses || {}) };
    const payload = {
      updatedAt: now,
      updatedBy: 'dashboard_admin',
      adminEditedAt: now,
      adminEditedBy: 'dashboard_admin'
    };

    fields.forEach((field) => {
      const input = this.getApplicationEditControl(field.id);
      if (!input) return;
      const value = field.type === 'checkbox'
        ? Boolean(input.checked)
        : String(input.value || '').trim();
      const normalizedValue = field.id === 'deliveryMode' ? VENDOR_DELIVERY_MODE : value;
      responses[field.id] = normalizedValue;
      payload[field.id] = normalizedValue;
    });

    const adminNote = String(this.getApplicationEditControl('adminNote')?.value || '').trim();

    payload.responses = responses;
    payload.deliveryMode = VENDOR_DELIVERY_MODE;
    payload.adminNote = adminNote;

    return payload;
  }

  buildVendorProfileFromApplication(application, now = new Date().toISOString()) {
    const value = (key, fallback = '') => {
      const direct = application[key];
      if (direct !== undefined && direct !== null && direct !== '') return direct;
      const responseValue = application.responses?.[key];
      if (responseValue !== undefined && responseValue !== null && responseValue !== '') return responseValue;
      return fallback;
    };
    const vendorId = application.uid || application.id;
    const planId = String(application.planId || 'basic').toLowerCase();
    const planPaymentRequired = planId === 'pro' || Boolean(application.planPaymentRequired);

    return {
      uid: vendorId,
      applicationId: application.id || vendorId,
      vendorId,
      vendorName: value('shopName', value('applicantName', 'Vendeur')),
      shopName: value('shopName'),
      applicantName: value('applicantName'),
      email: value('email'),
      phone: value('phone'),
      identityNumber: value('identityNumber'),
      city: value('city'),
      address: value('address'),
      category: value('category'),
      deliveryMode: VENDOR_DELIVERY_MODE,
      bankAccountHolder: value('bankAccountHolder'),
      bankName: value('bankName'),
      bankAccountNumber: value('bankAccountNumber'),
      bankSwiftBic: value('bankSwiftBic'),
      businessName: value('businessName'),
      businessNif: value('businessNif'),
      businessAddress: value('businessAddress'),
      businessBankAccountHolder: value('businessBankAccountHolder'),
      businessBankName: value('businessBankName'),
      businessBankAccountNumber: value('businessBankAccountNumber'),
      socialLink: value('socialLink'),
      description: value('description'),
      planId,
      planLabel: application.planLabel || (planId === 'pro' ? 'PRO' : 'BASIC'),
      planPrice: Number(application.planPrice || 0),
      planCurrency: application.planCurrency || this.planSettings.currency || 'HTG',
      planPaymentRequired,
      planPaymentStatus: application.planPaymentStatus || (planPaymentRequired ? 'pending' : 'not_required'),
      payoutRequestIntervalDays: Number(application.payoutRequestIntervalDays || this.planSettings.payoutDelayDays || 30),
      kycStatus: application.kycStatus || '',
      kycDocuments: application.kycDocuments || null,
      deliveryCoverage: application.deliveryCoverage || null,
      deliveryZones: Array.isArray(application.deliveryZones)
        ? application.deliveryZones
        : (Array.isArray(application.deliveryCoverage?.zones) ? application.deliveryCoverage.zones : []),
      status: 'active',
      role: 'vendor',
      commissionRule: application.commissionRule || null,
      createdAt: application.createdAt || now,
      updatedAt: now,
      approvedAt: application.approvedAt || application.sellerActivatedAt || now,
      approvedBy: 'dashboard_admin'
    };
  }

  async syncApplicationToVendorProfile(application, now = new Date().toISOString()) {
    const vendorProfile = this.buildVendorProfileFromApplication(application, now);
    await setDoc(doc(db, 'vendors', vendorProfile.vendorId), vendorProfile, { merge: true });
    await setDoc(doc(db, 'clients', vendorProfile.vendorId), {
      uid: vendorProfile.vendorId,
      role: 'vendor',
      vendorStatus: 'active',
      vendorId: vendorProfile.vendorId,
      vendorName: vendorProfile.vendorName,
      shopName: vendorProfile.shopName,
      email: vendorProfile.email,
      phone: vendorProfile.phone,
      updatedAt: now
    }, { merge: true });
  }

  async saveApplicationEdits(id) {
    const current = this.applications.find((item) => item.id === id);
    if (!current) return;

    try {
      const payload = this.collectApplicationEditPayload(current);
      const nextApplication = {
        ...current,
        ...payload,
        responses: {
          ...(current.responses || {}),
          ...(payload.responses || {})
        }
      };

      await setDoc(doc(db, 'vendorApplications', id), payload, { merge: true });

      const vendorId = nextApplication.uid || id;
      const alreadyVendor = this.allVendors.some((vendor) => vendor.id === vendorId || vendor.vendorId === vendorId);
      if (String(nextApplication.status || '').toLowerCase() === 'approved' || alreadyVendor) {
        await this.syncApplicationToVendorProfile(nextApplication, payload.updatedAt);
      }

      this.editingApplicationId = '';
      await this.loadData();
      this.render();
      this.attachEvents();
      window.alert('Candidature vendeur mise a jour par admin.');
    } catch (error) {
      console.error('Erreur edition candidature vendeur:', error);
      window.alert(error?.message || 'Impossible de mettre a jour la candidature vendeur.');
    }
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
      await this.syncApplicationToVendorProfile(payload, now);
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
    const vendor = this.allVendors.find((entry) => String(entry.vendorId || entry.uid || entry.id) === String(current.vendorId || '')) || {};
    const vendorProActive = this.isVendorProPlanActive(vendor);
    const normalizedCommission = vendorProActive
      ? (categoryRule
          ? {
              category: categoryRule.category || resolvedCategory || '',
              categoryRate: Number(categoryRule.rate) || 0,
              source: 'vendorCommissionRules',
              updatedAt: now,
              updatedBy: 'dashboard_admin'
            }
          : null)
      : Number.isFinite(commissionRate)
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

  async requestVendorServiceFee(vendorId, button = null) {
    const user = auth.currentUser;
    if (!user) {
      window.alert('Session admin indisponible.');
      return;
    }

    const confirmed = window.confirm('Demander le frais de service mensuel pour ce store ? Le store sera suspendu jusqu au paiement confirme.');
    if (!confirmed) return;

    try {
      if (button) {
        button.disabled = true;
        button.textContent = 'Request en cours...';
      }

      const token = await user.getIdToken();
      const response = await fetch(REQUEST_VENDOR_SERVICE_FEE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ vendorId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      }

      await this.loadData();
      this.render();
      this.attachEvents();

      if (payload?.alreadyPaid) {
        window.alert('Ce store a deja paye son cycle courant. Nouveau request bloque jusqu au prochain cycle.');
      } else {
        window.alert('Request frais mensuel envoye. Le store est suspendu jusqu au paiement.');
      }
    } catch (error) {
      console.error('Erreur request frais mensuel vendeur:', error);
      window.alert(error?.message || 'Impossible de demander le frais mensuel.');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Request frais de service mensuel';
      }
    }
  }

  async confirmVendorServiceFeePaid(feeId, button = null) {
    const fee = this.vendorServiceFees.find((item) => String(item.id) === String(feeId));
    if (!fee) return;

    const methodInput = window.prompt('Methode de paiement confirmee ? (MonCash, NatCash ou Carte bancaire)', fee.paymentMethod || 'MonCash');
    if (methodInput === null) return;

    const method = String(methodInput || 'MonCash').trim() || 'MonCash';
    const now = new Date().toISOString();
    const nextDueAt = this.addDays(now, 30);
    const vendorId = fee.vendorId;

    try {
      if (button) {
        button.disabled = true;
        button.textContent = 'Confirmation...';
      }

      const productSnapshot = await getDocs(query(collection(db, 'vendorProducts'), where('vendorId', '==', vendorId)));
      const productUpdates = productSnapshot.docs.map((item) => setDoc(item.ref, {
        vendorServiceFeeStatus: 'active',
        vendorServiceFeeUpdatedAt: now,
        updatedAt: now
      }, { merge: true }));

      await Promise.all([
        setDoc(doc(db, VENDOR_SERVICE_FEES_COLLECTION, feeId), {
          status: 'paid',
          paidAt: now,
          nextDueAt,
          paymentMethod: method,
          paymentProvider: method,
          updatedAt: now,
          confirmedBy: 'dashboard_admin'
        }, { merge: true }),
        setDoc(doc(db, 'vendors', vendorId), {
          status: 'active',
          vendorStatus: 'active',
          serviceFeeStatus: 'paid',
          serviceFeeCurrentId: feeId,
          serviceFeeLastPaidAt: now,
          serviceFeeNextDueAt: nextDueAt,
          serviceFeePaymentMethod: method,
          updatedAt: now
        }, { merge: true }),
        setDoc(doc(db, 'clients', vendorId), {
          uid: vendorId,
          role: 'vendor',
          vendorStatus: 'active',
          serviceFeeStatus: 'paid',
          serviceFeeCurrentId: feeId,
          serviceFeeLastPaidAt: now,
          serviceFeeNextDueAt: nextDueAt,
          updatedAt: now
        }, { merge: true }),
        ...productUpdates
      ]);

      await this.loadData();
      this.render();
      this.attachEvents();
      window.alert('Frais mensuel confirme. Store reactive automatiquement.');
    } catch (error) {
      console.error('Erreur confirmation frais mensuel:', error);
      window.alert(error?.message || 'Impossible de confirmer ce paiement.');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Marquer paye';
      }
    }
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

    return {
      title,
      subtitle,
      submitLabel,
      fields: mergeRequiredVendorFields(fields)
    };
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

  async savePlanSettings() {
    const firstBonusEnabled = this.root.querySelector('#vendorFirstBonusEnabled')?.value === 'true';
    const firstBonusAmount = Number(this.root.querySelector('#vendorFirstBonusAmount')?.value || 0);
    const firstBonusDuration = Number(this.root.querySelector('#vendorFirstBonusDuration')?.value || 30);
    if (firstBonusEnabled && firstBonusAmount <= 0) {
      window.alert('Montant promotionnel invalide.');
      return;
    }

    const payload = {
      proPrice: Number(this.root.querySelector('#vendorPlanProPrice')?.value || DEFAULT_PLAN_SETTINGS.proPrice),
      currency: String(this.root.querySelector('#vendorPlanCurrency')?.value || DEFAULT_PLAN_SETTINGS.currency).trim() || 'HTG',
      payoutDelayDays: Number(this.root.querySelector('#vendorPlanPayoutDelay')?.value || DEFAULT_PLAN_SETTINGS.payoutDelayDays),
      firstActivationBonus: {
        enabled: firstBonusEnabled,
        amount: Math.max(0, firstBonusAmount),
        durationDays: [30, 90, 180].includes(firstBonusDuration) ? firstBonusDuration : 30
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'dashboard_admin'
    };

    await setDoc(doc(db, ...PLAN_SETTINGS_REF), payload, { merge: true });
    this.planSettings = { ...DEFAULT_PLAN_SETTINGS, ...payload };
    await this.loadData();
    this.render();
    this.attachEvents();
  }

  async saveSpecialVendorBonus() {
    const vendorId = String(this.root.querySelector('#vendorSpecialBonusVendor')?.value || '').trim();
    const amount = Number(this.root.querySelector('#vendorSpecialBonusAmount')?.value || 0);
    const durationDays = Number(this.root.querySelector('#vendorSpecialBonusDuration')?.value || 30);
    const normalizedDurationDays = [30, 90, 180].includes(durationDays) ? durationDays : 30;
    const enabled = this.root.querySelector('#vendorSpecialBonusEnabled')?.value !== 'false';
    const vendorName = this.getVendorNameById(vendorId);

    if (!vendorId) {
      window.alert('Selectionnez un vendeur.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert('Montant special invalide.');
      return;
    }
    const editingId = String(this.editingSpecialBonusId || '').trim();
    const existingBonus = editingId ? this.vendorPlanBonuses.find((bonus) => String(bonus.id) === editingId) : null;
    const hasOverlap = this.vendorPlanBonuses.some((bonus) => {
      if (editingId && String(bonus.id) === editingId) return false;
      if (String(bonus.vendorId || '') !== vendorId) return false;
      if (bonus.enabled === false) return false;
      const status = this.getVendorPlanBonusStatus(bonus);
      return ['active', 'programmee'].includes(status);
    });
    if (hasOverlap) {
      window.alert('Une bonification active ou programmee existe deja pour ce vendeur.');
      return;
    }

    const now = new Date().toISOString();
    const id = editingId || `bonus-${vendorId}-${Date.now()}`;
    await setDoc(doc(db, VENDOR_PLAN_BONUSES_COLLECTION, id), {
      id,
      type: 'special_vendor',
      vendorId,
      vendorName,
      amount,
      normalAmount: Number(this.planSettings.proPrice || DEFAULT_PLAN_SETTINGS.proPrice),
      currency: this.planSettings.currency || DEFAULT_PLAN_SETTINGS.currency,
      durationDays: normalizedDurationDays,
      durationMonths: this.bonusDurationMonthsLabel(normalizedDurationDays),
      startAt: '',
      endAt: '',
      enabled,
      status: enabled ? 'active' : 'disabled',
      createdAt: existingBonus?.createdAt || now,
      updatedAt: now,
      updatedBy: 'dashboard_admin'
    }, { merge: true });

    this.editingSpecialBonusId = '';
    await this.loadData();
    this.render();
    this.attachEvents();
    window.alert(editingId ? 'Bonification speciale mise a jour.' : 'Bonification speciale enregistree.');
  }

  async toggleSpecialVendorBonus(id, enabled) {
    const bonus = this.vendorPlanBonuses.find((item) => String(item.id) === String(id));
    if (!bonus) return;
    const confirmed = window.confirm(`${enabled ? 'Activer' : 'Desactiver'} cette bonification speciale ?`);
    if (!confirmed) return;

    await setDoc(doc(db, VENDOR_PLAN_BONUSES_COLLECTION, id), {
      enabled,
      status: enabled ? this.getVendorPlanBonusStatus({ ...bonus, enabled }) : 'disabled',
      updatedAt: new Date().toISOString(),
      updatedBy: 'dashboard_admin'
    }, { merge: true });

    await this.loadData();
    this.render();
    this.attachEvents();
  }

  async deleteSpecialVendorBonus(id) {
    const bonus = this.vendorPlanBonuses.find((item) => String(item.id) === String(id));
    if (!bonus) return;
    const vendorName = bonus.vendorName || this.getVendorNameById(bonus.vendorId) || 'ce vendeur';
    const confirmed = window.confirm(`Supprimer definitivement la bonification speciale de ${vendorName} ?`);
    if (!confirmed) return;

    await deleteDoc(doc(db, VENDOR_PLAN_BONUSES_COLLECTION, id));
    if (this.editingSpecialBonusId === id) this.editingSpecialBonusId = '';
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
