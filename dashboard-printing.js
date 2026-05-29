import { db } from './firebase-init.js';
import { deleteStorageFile } from './firebase-storage.js';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const MODULES = [
  {
    id: 'documents',
    title: 'POD Documents',
    description: 'Configuration des formats PDF, types de papier, quantite et regles de prix pour les documents standards.',
    metric: 'pages / copies',
    defaults: {
      enabled: true,
      dimensions: [
        { label: '8.5x11', enabled: true, price: 0 },
        { label: '8.5x14', enabled: true, price: 0 },
        { label: '11x17', enabled: true, price: 0 },
        { label: '12x18', enabled: true, price: 0 }
      ],
      papers: [
        { label: 'Bond', enabled: true, price: 0 },
        { label: 'Glossy', enabled: true, price: 0 },
        { label: 'Bristol Glossy', enabled: true, price: 0 },
        { label: 'Autocollant', enabled: true, price: 0 }
      ],
      pricing: { basePrice: 0, perPagePrice: 0, perCopyPrice: 0 },
      notes: ''
    }
  },
  {
    id: 'photo',
    title: 'Impression Photo',
    description: 'Formats photo, papiers premium et logique de calcul unitaire pour les demandes photo.',
    metric: 'tirages',
    defaults: {
      enabled: true,
      dimensions: [
        { label: '4x6', enabled: true, price: 0 },
        { label: '5x7', enabled: true, price: 0 },
        { label: '8.5x11', enabled: true, price: 0 },
        { label: '11x17', enabled: true, price: 0 },
        { label: '13x19', enabled: true, price: 0 }
      ],
      papers: [
        { label: 'Matte', enabled: true, price: 0 },
        { label: 'Ultra Glossy', enabled: true, price: 0 },
        { label: 'Premium Glossy', enabled: true, price: 0 },
        { label: 'Premium Semiglossy', enabled: true, price: 0 }
      ],
      pricing: { basePrice: 0, perUnitPrice: 0, rushPrice: 0 },
      notes: ''
    }
  },
  {
    id: 'cad',
    title: 'Plans CAD',
    description: 'Formats techniques pour architecture, plans grands formats et regles specifiques de calcul.',
    metric: 'plans',
    defaults: {
      enabled: true,
      dimensions: [
        { label: '17x24', enabled: true, price: 0 },
        { label: '24x36', enabled: true, price: 0 },
        { label: '24x24', enabled: true, price: 0 },
        { label: '24x48', enabled: true, price: 0 },
        { label: '36x48', enabled: true, price: 0 },
        { label: '8.5x11', enabled: true, price: 0 },
        { label: '8.5x14', enabled: true, price: 0 },
        { label: '11x17', enabled: true, price: 0 }
      ],
      papers: [
        { label: 'Papier plan standard', enabled: true, price: 0 }
      ],
      pricing: { basePrice: 0, perSheetPrice: 0, oversizedPrice: 0 },
      notes: ''
    }
  },
  {
    id: 'grand-format',
    title: 'Stickers & Grand Format',
    description: 'Pilotage du flux WhatsApp, prise de brief et estimation manuelle par equipe specialisee.',
    metric: 'devis',
    defaults: {
      enabled: true,
      whatsappNumber: '',
      whatsappMessage: 'Bonjour, je souhaite demander un devis Smart Cut Services pour un sticker ou un format grand format.',
      notes: 'Calcul manuel par pied carre via equipe specialisee.'
    }
  }
];

const DEFAULT_DELIVERY_SETTINGS = {
  pickupPoints: [
    { id: 'smart-cut-main', name: 'Smart Cut Services', address: 'Adresse Smart Cut Services', phone: '', isActive: true }
  ],
  homeZones: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeOptionLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getSelectedOptionValue(item, labels = []) {
  const normalizedLabels = labels.map((label) => normalizeOptionLabel(label));
  const options = Array.isArray(item?.selectedOptions) ? item.selectedOptions : [];
  const match = options.find((option) => normalizedLabels.includes(normalizeOptionLabel(option?.label)));
  return match?.value || '';
}

function isPrintingItem(item = {}) {
  const sourceType = String(item.sourceType || item.type || '').toLowerCase();
  const productId = String(item.productId || item.id || '').toLowerCase();
  return sourceType === 'printing'
    || productId.startsWith('printing-')
    || !!item.printingDelivery
    || !!getSelectedOptionValue(item, ['URL fichier', 'Url fichier', 'Lien fichier']);
}

function makeFileRecordId(value = '') {
  const source = String(value || `file_${Date.now()}`);
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }
  const safe = source
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
  return `${safe || 'printing_file'}_${Math.abs(hash)}`;
}

function inferFileKind(fileName = '', url = '') {
  const target = `${fileName} ${url}`.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/.test(target)) return 'Image';
  if (/\.pdf(\?|$)/.test(target)) return 'PDF';
  return 'Fichier';
}

function getOrderDate(order = {}) {
  const value = order.createdAt || order.date || order.paidAt || order.updatedAt;
  if (!value) return '-';
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString('fr-FR');
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('fr-FR');
  }
  return String(value);
}

function buildPrintingFilesFromItem(item = {}, order = {}, itemIndex = 0) {
  const explicitFiles = Array.isArray(item.printingFiles) ? item.printingFiles : [];
  if (explicitFiles.length) {
    return explicitFiles
      .map((file, fileIndex) => {
        const fileUrl = file.fileUrl || file.url || file.downloadUrl || '';
        if (!fileUrl) return null;
        const storagePath = file.storagePath || file.path || '';
        const fileName = file.fileName || file.name || `fichier-impression-${itemIndex + 1}-${fileIndex + 1}`;
        const id = makeFileRecordId(storagePath || fileUrl);
        return {
          id,
          orderId: order.id || '',
          orderPath: order.path || '',
          orderCode: order.code || order.codeUnique || order.uniqueCode || order.id || '',
          orderDate: getOrderDate(order),
          clientName: order.customerName || order.clientName || order.name || order.customer?.name || '-',
          itemName: item.name || item.title || `Impression ${itemIndex + 1}`,
          fileName,
          fileUrl,
          storagePath,
          kind: inferFileKind(fileName, fileUrl)
        };
      })
      .filter(Boolean);
  }

  const fileUrl = getSelectedOptionValue(item, ['URL fichier', 'Url fichier', 'Lien fichier'])
    || item.fileUrl
    || item.fileURL
    || item.downloadUrl
    || item.downloadURL
    || '';
  if (!fileUrl) return [];

  const storagePath = getSelectedOptionValue(item, ['Chemin storage', 'Storage path'])
    || item.storagePath
    || item.filePath
    || item.path
    || '';
  const fileName = getSelectedOptionValue(item, ['Fichier', 'Nom du fichier'])
    || item.fileName
    || item.name
    || `fichier-impression-${itemIndex + 1}`;
  const id = makeFileRecordId(storagePath || fileUrl);

  return [{
    id,
    orderId: order.id || '',
    orderPath: order.path || '',
    orderCode: order.code || order.codeUnique || order.uniqueCode || order.id || '',
    orderDate: getOrderDate(order),
    clientName: order.customerName || order.clientName || order.name || order.customer?.name || '-',
    itemName: item.name || item.title || `Impression ${itemIndex + 1}`,
    fileName,
    fileUrl,
    storagePath,
    kind: inferFileKind(fileName, fileUrl)
  }];
}

function normalizeDeliverySettings(data = {}) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    pickupPoints: (Array.isArray(source.pickupPoints) && source.pickupPoints.length ? source.pickupPoints : DEFAULT_DELIVERY_SETTINGS.pickupPoints)
      .map((point, index) => ({
        id: String(point.id || `pickup_${index}`).trim(),
        name: String(point.name || '').trim(),
        address: String(point.address || '').trim(),
        phone: String(point.phone || '').trim(),
        isActive: point.isActive !== false
      })),
    homeZones: (Array.isArray(source.homeZones) ? source.homeZones : [])
      .map((zone, index) => ({
        id: String(zone.id || `home_${index}`).trim(),
        country: String(zone.country || 'Haiti').trim() || 'Haiti',
        department: String(zone.department || '').trim(),
        commune: String(zone.commune || '').trim(),
        fee: Number(zone.fee || 0),
        delay: String(zone.delay || zone.deliveryDelay || '').trim(),
        isActive: zone.isActive !== false
      }))
  };
}

class PrintingDashboard {
  constructor(rootId = 'printing-dashboard-root') {
    this.root = document.getElementById(rootId);
    this.state = {};
    this.deliverySettings = normalizeDeliverySettings(DEFAULT_DELIVERY_SETTINGS);
    this.printingFiles = [];
    this.deletedPrintingFileIds = new Set();
    if (!this.root) return;
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.render();
    this.attachEvents();
  }

  async loadSettings() {
    const [entries, deliverySnapshot] = await Promise.all([
      Promise.all(MODULES.map(async (module) => {
        const snapshot = await getDoc(doc(db, 'printingSettings', module.id));
        const merged = snapshot.exists()
          ? this.mergeModuleState(module.defaults, snapshot.data())
          : clone(module.defaults);
        return [module.id, merged];
      })),
      getDoc(doc(db, 'printingDeliverySettings', 'main'))
    ]);
    this.state = Object.fromEntries(entries);
    this.deliverySettings = normalizeDeliverySettings(deliverySnapshot.exists() ? deliverySnapshot.data() : DEFAULT_DELIVERY_SETTINGS);
    await this.loadPrintingFiles();
  }

  async loadPrintingFiles() {
    try {
      const deletedSnapshot = await getDocs(collection(db, 'printingDeletedFiles'));
      this.deletedPrintingFileIds = new Set(deletedSnapshot.docs.map((entry) => entry.id));
    } catch (error) {
      console.warn('Impossible de charger les fichiers impression deja supprimes.', error);
      this.deletedPrintingFileIds = new Set();
    }

    const orders = await this.loadPrintingOrders();
    const filesById = new Map();

    orders.forEach((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      items.forEach((item, itemIndex) => {
        if (!isPrintingItem(item)) return;

        buildPrintingFilesFromItem(item, order, itemIndex).forEach((file) => {
          if (this.deletedPrintingFileIds.has(file.id) || filesById.has(file.id)) return;
          filesById.set(file.id, file);
        });
      });
    });

    this.printingFiles = Array.from(filesById.values())
      .sort((left, right) => String(right.orderDate || '').localeCompare(String(left.orderDate || '')));
  }

  async loadPrintingOrders() {
    const docsByPath = new Map();
    const sources = [
      { label: 'orders', ref: collection(db, 'orders') },
      { label: 'client-orders', ref: collectionGroup(db, 'orders') }
    ];

    for (const source of sources) {
      try {
        const snapshot = await getDocs(source.ref);
        snapshot.docs.forEach((entry) => {
          docsByPath.set(entry.ref.path, {
            id: entry.id,
            path: entry.ref.path,
            ...entry.data()
          });
        });
      } catch (error) {
        console.warn(`Impossible de charger les commandes impression depuis ${source.label}.`, error);
      }
    }

    return Array.from(docsByPath.values());
  }

  mergeModuleState(defaults, data) {
    const base = clone(defaults);
    if (!data || typeof data !== 'object') return base;
    return {
      ...base,
      ...data,
      dimensions: Array.isArray(data.dimensions) ? data.dimensions : base.dimensions,
      papers: Array.isArray(data.papers) ? data.papers : base.papers,
      pricing: { ...(base.pricing || {}), ...(data.pricing || {}) }
    };
  }

  getStats() {
    const activeModules = MODULES.filter((module) => this.state[module.id]?.enabled).length;
    const totalDimensions = MODULES.reduce((total, module) => total + (this.state[module.id]?.dimensions?.length || 0), 0);
    const totalPapers = MODULES.reduce((total, module) => total + (this.state[module.id]?.papers?.length || 0), 0);
    return { activeModules, totalDimensions, totalPapers };
  }

  render() {
    const stats = this.getStats();
    this.root.innerHTML = `
      <section class="hero">
        <small>Pole impression</small>
        <h1>Configuration impression & production</h1>
        <p>Cette couche admin prepare les sous-modules impression proprement avant le parcours client. On y gere les activations, les dimensions, les types de papier, les prix de base et le flux WhatsApp specialise.</p>
      </section>

      <section class="stats">
        <article class="stat-card"><strong>${MODULES.length}</strong><span>Sous-modules relies</span></article>
        <article class="stat-card"><strong>${stats.activeModules}</strong><span>Modules actifs</span></article>
        <article class="stat-card"><strong>${stats.totalDimensions}</strong><span>Formats configures</span></article>
        <article class="stat-card"><strong>${stats.totalPapers}</strong><span>Papiers configures</span></article>
      </section>

      <section class="config-grid">
        ${this.renderDeliverySettings()}
        ${this.renderPrintingFilesPanel()}
        ${MODULES.map((module) => this.renderModule(module)).join('')}
      </section>
    `;
  }

  renderPrintingFilesPanel() {
    const files = Array.isArray(this.printingFiles) ? this.printingFiles : [];
    return `
      <article class="panel" data-printing-files-panel style="grid-column:1/-1;">
        <div class="panel-head">
          <div>
            <small>Nettoyage Firebase</small>
            <h2>Fichiers envoyes pour impression</h2>
          </div>
          <div class="status-chip">
            <i class="fas fa-file-arrow-down"></i>
            <span>${files.length} fichier(s) stocke(s)</span>
          </div>
        </div>
        <p>Telechargez les fichiers dont vous avez besoin, puis supprimez-les ici pour eviter qu'ils restent stockes inutilement dans Firebase Storage. Chaque fichier possede son propre bouton de suppression.</p>

        <div class="actions" style="justify-content:flex-start;margin:0.8rem 0 1rem;">
          <button class="btn-secondary" type="button" data-refresh-printing-files>
            <i class="fas fa-rotate"></i>
            Actualiser les fichiers
          </button>
        </div>

        ${files.length ? `
          <div class="option-list" style="gap:0.85rem;">
            ${files.map((file) => this.renderPrintingFileRow(file)).join('')}
          </div>
        ` : `
          <div class="hint" style="padding:1rem;border:1px dashed rgba(15,23,42,0.16);border-radius:18px;">
            Aucun fichier impression actif trouve dans les commandes pour le moment.
          </div>
        `}
      </article>
    `;
  }

  renderPrintingFileRow(file) {
    return `
      <article class="option-row" style="grid-template-columns:1fr auto;align-items:center;">
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;gap:0.55rem;flex-wrap:wrap;">
            <strong>${escapeHtml(file.fileName || 'Fichier impression')}</strong>
            <span class="status-chip" style="padding:0.3rem 0.55rem;font-size:0.72rem;">${escapeHtml(file.kind || 'Fichier')}</span>
          </div>
          <div class="hint" style="margin-top:0.35rem;">
            ${escapeHtml(file.itemName || 'Impression')} · Commande ${escapeHtml(file.orderCode || file.orderId || '-')} · ${escapeHtml(file.clientName || '-')} · ${escapeHtml(file.orderDate || '-')}
          </div>
          ${file.storagePath ? `<div class="hint" style="margin-top:0.25rem;word-break:break-word;">${escapeHtml(file.storagePath)}</div>` : '<div class="hint" style="margin-top:0.25rem;">Chemin Storage manquant: suppression directe indisponible.</div>'}
        </div>
        <div style="display:flex;gap:0.55rem;flex-wrap:wrap;justify-content:flex-end;">
          <a class="btn-secondary" href="${escapeHtml(file.fileUrl)}" download="${escapeHtml(file.fileName || 'fichier-impression')}" target="_blank" rel="noopener noreferrer">
            <i class="fas fa-download"></i>
            Telecharger
          </a>
          <a class="btn-secondary" href="${escapeHtml(file.fileUrl)}" target="_blank" rel="noopener noreferrer">
            <i class="fas fa-up-right-from-square"></i>
            Ouvrir
          </a>
          <button class="btn-danger" type="button" data-delete-printing-file="${escapeHtml(file.id)}" ${file.storagePath ? '' : 'disabled'}>
            <i class="fas fa-trash"></i>
            Supprimer
          </button>
        </div>
      </article>
    `;
  }

  renderDeliverySettings() {
    const settings = this.deliverySettings || normalizeDeliverySettings(DEFAULT_DELIVERY_SETTINGS);
    return `
      <article class="panel" data-printing-delivery-panel style="grid-column:1/-1;">
        <div class="panel-head">
          <div>
            <small>Reception impression</small>
            <h2>Livraison & points de retrait</h2>
          </div>
          <div class="status-chip">
            <i class="fas fa-location-dot"></i>
            <span>${settings.pickupPoints.length} point(s) / ${settings.homeZones.length} zone(s)</span>
          </div>
        </div>
        <p>Ces reglages sont utilises uniquement par les modules impression. Les points de retrait restent gratuits; les zones domicile ajoutent un frais au total impression avant le paiement.</p>

        <div class="option-list">
          <div class="option-title">Points de retrait gratuits</div>
          ${settings.pickupPoints.map((point, index) => this.renderPickupPointRow(point, index)).join('')}
          <button class="btn-secondary" type="button" data-add-printing-pickup>Ajouter un point de retrait</button>
        </div>

        <div class="option-list">
          <div class="option-title">Zones livraison a domicile</div>
          ${settings.homeZones.map((zone, index) => this.renderHomeZoneRow(zone, index)).join('')}
          <button class="btn-secondary" type="button" data-add-printing-home-zone>Ajouter une zone domicile</button>
        </div>

        <div class="actions">
          <button class="btn-primary" type="button" data-save-printing-delivery>Enregistrer livraison impression</button>
        </div>
      </article>
    `;
  }

  renderPickupPointRow(point, index) {
    return `
      <div class="option-row" data-printing-pickup-row="${index}" style="grid-template-columns:1fr 1.5fr 1fr auto auto;">
        <input class="mini-input" data-pickup-field="name" value="${point.name || ''}" placeholder="Nom du point">
        <input class="mini-input" data-pickup-field="address" value="${point.address || ''}" placeholder="Adresse">
        <input class="mini-input" data-pickup-field="phone" value="${point.phone || ''}" placeholder="Telephone">
        <label class="check">
          <input type="checkbox" data-pickup-field="isActive" ${point.isActive ? 'checked' : ''}>
          <span>Actif</span>
        </label>
        <button class="btn-danger" type="button" data-remove-printing-pickup="${index}">Retirer</button>
      </div>
    `;
  }

  renderHomeZoneRow(zone, index) {
    return `
      <div class="option-row" data-printing-home-zone-row="${index}" style="grid-template-columns:.8fr 1fr 1fr .8fr 1fr auto auto;">
        <input class="mini-input" data-home-zone-field="country" value="${zone.country || 'Haiti'}" placeholder="Pays">
        <input class="mini-input" data-home-zone-field="department" value="${zone.department || ''}" placeholder="Departement">
        <input class="mini-input" data-home-zone-field="commune" value="${zone.commune || ''}" placeholder="Commune">
        <input class="mini-input" type="number" min="0" step="1" data-home-zone-field="fee" value="${zone.fee ?? 0}" placeholder="Prix">
        <input class="mini-input" data-home-zone-field="delay" value="${zone.delay || ''}" placeholder="Delai">
        <label class="check">
          <input type="checkbox" data-home-zone-field="isActive" ${zone.isActive ? 'checked' : ''}>
          <span>Actif</span>
        </label>
        <button class="btn-danger" type="button" data-remove-printing-home-zone="${index}">Retirer</button>
      </div>
    `;
  }

  renderModule(module) {
    const state = this.state[module.id] || clone(module.defaults);
    const isManualQuote = module.id === 'grand-format';
    return `
      <article class="panel" data-module="${module.id}">
        <div class="panel-head">
          <div>
            <small>${module.metric}</small>
            <h2>${module.title}</h2>
          </div>
          <div class="status-chip ${state.enabled ? '' : 'off'}">
            <i class="fas ${state.enabled ? 'fa-circle-check' : 'fa-circle-pause'}"></i>
            <span>${state.enabled ? 'Actif' : 'Inactif'}</span>
          </div>
        </div>
        <p>${module.description}</p>

        <div class="stack" style="margin-top:1rem;">
          <label class="toggle">
            <input type="checkbox" data-field="enabled" ${state.enabled ? 'checked' : ''}>
            <span>Module actif</span>
          </label>

          ${isManualQuote ? this.renderGrandFormatFields(module.id, state) : this.renderStructuredFields(module.id, state)}

          <div class="actions">
            <button class="btn-primary" type="button" data-save-module="${module.id}">Enregistrer</button>
            ${!isManualQuote ? `
              <button class="btn-secondary" type="button" data-add-dimension="${module.id}">Ajouter une dimension</button>
              <button class="btn-secondary" type="button" data-add-paper="${module.id}">Ajouter un papier</button>
            ` : ''}
            <button class="btn-secondary" type="button" data-reset-module="${module.id}">Reinitialiser</button>
          </div>
        </div>
      </article>
    `;
  }

  renderStructuredFields(moduleId, state) {
    const pricingEntries = Object.entries(state.pricing || {});
    return `
      <div class="field-grid">
        ${pricingEntries.map(([key, value]) => `
          <label class="field">
            <span>${this.getPricingLabel(key)}</span>
            <input class="input" type="number" step="0.01" min="0" data-pricing-module="${moduleId}" data-pricing-key="${key}" value="${value ?? 0}">
          </label>
        `).join('')}
      </div>

      <div class="option-list">
        <div class="option-title">Dimensions</div>
        ${(state.dimensions || []).map((item, index) => this.renderOptionRow(moduleId, 'dimensions', item, index)).join('')}
      </div>

      <div class="option-list">
        <div class="option-title">Types de papier</div>
        ${(state.papers || []).map((item, index) => this.renderOptionRow(moduleId, 'papers', item, index)).join('')}
      </div>

      <label class="field">
        <span>Note admin</span>
        <textarea class="textarea" data-field="notes">${state.notes || ''}</textarea>
      </label>
    `;
  }

  renderGrandFormatFields(moduleId, state) {
    return `
      <div class="field-grid">
        <label class="field">
          <span>Numero WhatsApp</span>
          <input class="input" data-field="whatsappNumber" value="${state.whatsappNumber || ''}" placeholder="+509...">
        </label>
        <label class="field">
          <span>Canal</span>
          <input class="input" value="WhatsApp / devis manuel" disabled>
        </label>
      </div>
      <label class="field">
        <span>Message WhatsApp par defaut</span>
        <textarea class="textarea" data-field="whatsappMessage">${state.whatsappMessage || ''}</textarea>
      </label>
      <label class="field">
        <span>Note admin</span>
        <textarea class="textarea" data-field="notes">${state.notes || ''}</textarea>
      </label>
      <p class="hint">Le calcul public n'est pas active ici. Ce module reste sur un workflow de brief et devis manuel, comme prevu dans le plan.</p>
    `;
  }

  renderOptionRow(moduleId, listKey, item, index) {
    return `
      <div class="option-row" data-option-row="${moduleId}-${listKey}-${index}">
        <input class="mini-input" data-list-module="${moduleId}" data-list-key="${listKey}" data-list-index="${index}" data-list-field="label" value="${item.label || ''}" placeholder="Label">
        <input class="mini-input" type="number" step="0.01" min="0" data-list-module="${moduleId}" data-list-key="${listKey}" data-list-index="${index}" data-list-field="price" value="${item.price ?? 0}" placeholder="Prix">
        <label class="check">
          <input type="checkbox" data-list-module="${moduleId}" data-list-key="${listKey}" data-list-index="${index}" data-list-field="enabled" ${item.enabled ? 'checked' : ''}>
          <span>Actif</span>
        </label>
        <button class="btn-danger" type="button" data-remove-option="${moduleId}" data-remove-list="${listKey}" data-remove-index="${index}">Retirer</button>
      </div>
    `;
  }

  getPricingLabel(key) {
    const labels = {
      basePrice: 'Prix de base',
      perPagePrice: 'Prix / page',
      perCopyPrice: 'Prix / copie',
      perUnitPrice: 'Prix / tirage',
      rushPrice: 'Supplement urgence',
      perSheetPrice: 'Prix / plan',
      oversizedPrice: 'Supplement grand format'
    };
    return labels[key] || key;
  }

  attachEvents() {
    this.root.querySelectorAll('[data-save-module]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.saveModule(button.dataset.saveModule);
      });
    });

    this.root.querySelectorAll('[data-reset-module]').forEach((button) => {
      button.addEventListener('click', () => {
        const module = MODULES.find((entry) => entry.id === button.dataset.resetModule);
        if (!module) return;
        this.state[module.id] = clone(module.defaults);
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-add-dimension]').forEach((button) => {
      button.addEventListener('click', () => {
        this.addOption(button.dataset.addDimension, 'dimensions');
      });
    });

    this.root.querySelectorAll('[data-add-paper]').forEach((button) => {
      button.addEventListener('click', () => {
        this.addOption(button.dataset.addPaper, 'papers');
      });
    });

    this.root.querySelectorAll('[data-remove-option]').forEach((button) => {
      button.addEventListener('click', () => {
        this.removeOption(button.dataset.removeOption, button.dataset.removeList, Number.parseInt(button.dataset.removeIndex || '0', 10));
      });
    });

    this.root.querySelector('[data-add-printing-pickup]')?.addEventListener('click', () => {
      this.deliverySettings.pickupPoints.push({ id: `pickup_${Date.now()}`, name: '', address: '', phone: '', isActive: true });
      this.render();
      this.attachEvents();
    });

    this.root.querySelector('[data-add-printing-home-zone]')?.addEventListener('click', () => {
      this.deliverySettings.homeZones.push({ id: `home_${Date.now()}`, country: 'Haiti', department: '', commune: '', fee: 0, delay: '', isActive: true });
      this.render();
      this.attachEvents();
    });

    this.root.querySelectorAll('[data-remove-printing-pickup]').forEach((button) => {
      button.addEventListener('click', () => {
        this.deliverySettings.pickupPoints.splice(Number.parseInt(button.dataset.removePrintingPickup || '0', 10), 1);
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-remove-printing-home-zone]').forEach((button) => {
      button.addEventListener('click', () => {
        this.deliverySettings.homeZones.splice(Number.parseInt(button.dataset.removePrintingHomeZone || '0', 10), 1);
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelector('[data-save-printing-delivery]')?.addEventListener('click', async () => {
      await this.saveDeliverySettings();
    });

    this.root.querySelector('[data-refresh-printing-files]')?.addEventListener('click', async () => {
      await this.loadPrintingFiles();
      this.render();
      this.attachEvents();
      this.showToast('Liste des fichiers impression actualisee.');
    });

    this.root.querySelectorAll('[data-delete-printing-file]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.deletePrintingFile(button.dataset.deletePrintingFile);
      });
    });
  }

  collectDeliverySettings() {
    const pickupPoints = Array.from(this.root.querySelectorAll('[data-printing-pickup-row]')).map((row, index) => ({
      id: this.deliverySettings.pickupPoints[index]?.id || `pickup_${index}`,
      name: row.querySelector('[data-pickup-field="name"]')?.value || '',
      address: row.querySelector('[data-pickup-field="address"]')?.value || '',
      phone: row.querySelector('[data-pickup-field="phone"]')?.value || '',
      isActive: Boolean(row.querySelector('[data-pickup-field="isActive"]')?.checked)
    })).filter((point) => point.name || point.address || point.phone);

    const homeZones = Array.from(this.root.querySelectorAll('[data-printing-home-zone-row]')).map((row, index) => ({
      id: this.deliverySettings.homeZones[index]?.id || `home_${index}`,
      country: row.querySelector('[data-home-zone-field="country"]')?.value || 'Haiti',
      department: row.querySelector('[data-home-zone-field="department"]')?.value || '',
      commune: row.querySelector('[data-home-zone-field="commune"]')?.value || '',
      fee: Number.parseFloat(row.querySelector('[data-home-zone-field="fee"]')?.value || '0') || 0,
      delay: row.querySelector('[data-home-zone-field="delay"]')?.value || '',
      isActive: Boolean(row.querySelector('[data-home-zone-field="isActive"]')?.checked)
    })).filter((zone) => zone.department || zone.commune || Number(zone.fee || 0) > 0);

    return normalizeDeliverySettings({ pickupPoints, homeZones });
  }

  async saveDeliverySettings() {
    const payload = {
      ...this.collectDeliverySettings(),
      updatedAt: new Date().toISOString(),
      updatedBy: 'dashboard_admin'
    };
    await setDoc(doc(db, 'printingDeliverySettings', 'main'), payload, { merge: true });
    this.deliverySettings = normalizeDeliverySettings(payload);
    this.render();
    this.attachEvents();
    this.showToast('Livraison impression enregistree dans Firebase.');
  }

  async deletePrintingFile(fileId) {
    const file = this.printingFiles.find((entry) => entry.id === fileId);
    if (!file || !file.storagePath) return;

    const confirmed = window.confirm(`Supprimer definitivement ce fichier de Firebase Storage ?\n\n${file.fileName}`);
    if (!confirmed) return;

    try {
      await deleteStorageFile(file.storagePath);
    } catch (error) {
      if (error?.code !== 'storage/object-not-found') {
        console.error('Suppression fichier impression impossible:', error);
        this.showToast('Suppression impossible. Verifiez les permissions Firebase Storage.');
        return;
      }
    }

    await setDoc(doc(db, 'printingDeletedFiles', file.id), {
      ...file,
      deletedAt: new Date().toISOString(),
      deletedBy: 'dashboard_admin'
    }, { merge: true });

    this.deletedPrintingFileIds.add(file.id);
    this.printingFiles = this.printingFiles.filter((entry) => entry.id !== file.id);
    this.render();
    this.attachEvents();
    this.showToast('Fichier impression supprime de Firebase Storage.');
  }

  addOption(moduleId, listKey) {
    const state = this.state[moduleId];
    if (!state) return;
    state[listKey] = Array.isArray(state[listKey]) ? state[listKey] : [];
    state[listKey].push({ label: '', enabled: true, price: 0 });
    this.render();
    this.attachEvents();
  }

  removeOption(moduleId, listKey, index) {
    const state = this.state[moduleId];
    if (!state || !Array.isArray(state[listKey])) return;
    state[listKey].splice(index, 1);
    this.render();
    this.attachEvents();
  }

  collectModuleState(moduleId) {
    const panel = this.root.querySelector(`[data-module="${moduleId}"]`);
    const current = this.state[moduleId];
    if (!panel || !current) return current;

    const nextState = {
      ...clone(current),
      enabled: !!panel.querySelector('[data-field="enabled"]')?.checked
    };

    panel.querySelectorAll('[data-field]').forEach((field) => {
      const key = field.dataset.field;
      if (!key || key === 'enabled') return;
      nextState[key] = field.value;
    });

    panel.querySelectorAll('[data-pricing-module]').forEach((field) => {
      const pricingKey = field.dataset.pricingKey;
      nextState.pricing = nextState.pricing || {};
      nextState.pricing[pricingKey] = Number.parseFloat(field.value || '0') || 0;
    });

    const listMap = { dimensions: [], papers: [] };
    panel.querySelectorAll('[data-list-module]').forEach((field) => {
      const listKey = field.dataset.listKey;
      const index = Number.parseInt(field.dataset.listIndex || '0', 10);
      const itemField = field.dataset.listField;
      if (!listMap[listKey]) return;
      listMap[listKey][index] = listMap[listKey][index] || {};
      listMap[listKey][index][itemField] = itemField === 'enabled'
        ? !!field.checked
        : itemField === 'price'
          ? Number.parseFloat(field.value || '0') || 0
          : field.value;
    });

    if (Array.isArray(current.dimensions)) {
      nextState.dimensions = listMap.dimensions.filter(Boolean);
    }
    if (Array.isArray(current.papers)) {
      nextState.papers = listMap.papers.filter(Boolean);
    }

    return nextState;
  }

  async saveModule(moduleId) {
    const module = MODULES.find((entry) => entry.id === moduleId);
    if (!module) return;
    const nextState = this.collectModuleState(moduleId);
    const payload = {
      ...nextState,
      updatedAt: new Date().toISOString(),
      updatedBy: 'dashboard_admin'
    };
    await setDoc(doc(db, 'printingSettings', moduleId), payload, { merge: true });
    this.state[moduleId] = nextState;
    this.render();
    this.attachEvents();
    this.showToast(`${module.title} enregistre dans Firebase.`);
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 99999;
      background: #0f9f6e;
      color: #fff;
      padding: 0.9rem 1rem;
      border-radius: 14px;
      box-shadow: 0 18px 40px rgba(0,0,0,0.18);
      font: 600 0.9rem Manrope, sans-serif;
      opacity: 0;
      transform: translateY(12px);
      transition: all .2s ease;
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      setTimeout(() => toast.remove(), 220);
    }, 2200);
  }
}

new PrintingDashboard();
