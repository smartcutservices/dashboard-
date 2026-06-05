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

function normalizeDimensionOption(option = {}) {
  return {
    label: String(option?.label || '').trim(),
    enabled: option?.enabled !== false,
    price: Number(option?.price) || 0
  };
}

function normalizePaperOption(paper = {}, fallbackDimensions = []) {
  const dimensions = Array.isArray(paper?.dimensions) && paper.dimensions.length
    ? paper.dimensions
    : fallbackDimensions;

  return {
    label: String(paper?.label || '').trim(),
    enabled: paper?.enabled !== false,
    dimensions: (Array.isArray(dimensions) ? dimensions : [])
      .map((dimension) => normalizeDimensionOption(dimension))
      .filter((dimension) => dimension.label)
  };
}

function collectUniqueDimensionsFromPapers(papers = [], fallbackDimensions = []) {
  const map = new Map();

  (Array.isArray(papers) ? papers : []).forEach((paper) => {
    (Array.isArray(paper?.dimensions) ? paper.dimensions : []).forEach((dimension) => {
      const normalized = normalizeDimensionOption(dimension);
      if (!normalized.label || map.has(normalized.label)) return;
      map.set(normalized.label, normalized);
    });
  });

  if (map.size) return Array.from(map.values());

  return (Array.isArray(fallbackDimensions) ? fallbackDimensions : [])
    .map((dimension) => normalizeDimensionOption(dimension))
    .filter((dimension) => dimension.label);
}

const DEFAULT_DELIVERY_SETTINGS = {
  pickupPoints: [
    { id: 'smart-cut-main', name: 'Smart Cut Services', address: 'Adresse Smart Cut Services', phone: '', isActive: true }
  ],
  homeZones: [],
  moduleRules: {
    documents: [],
    cad: [],
    photo: []
  }
};

const PRINTING_INTERVAL_RANGES = [
  { id: '1-100', label: '1-100', min: 1, max: 100 },
  { id: '101-250', label: '101-250', min: 101, max: 250 },
  { id: '251-500', label: '251-500', min: 251, max: 500 }
];

const DELIVERY_RULE_MODULES = [
  { id: 'documents', title: 'POD Documents', metric: 'pages imprimees', usesRange: true },
  { id: 'cad', title: 'Plan CAD', metric: 'zone livraison', usesRange: false },
  { id: 'photo', title: 'Impression Photos', metric: 'zone livraison', usesRange: false }
];

const DELIVERY_RULES_PAGE_SIZE = 4;

const HAITI_DEPARTMENTS = {
  'Artibonite': ['Dessalines', 'Desdunes', 'Ennery', 'Gonaives', 'Gros-Morne', 'L Estere', 'Marmelade', 'Saint-Marc', 'Verrettes'],
  'Centre': ['Belladere', 'Cerca-Carvajal', 'Cerca-la-Source', 'Hinche', 'Lascahobas', 'Mirebalais', 'Saut-d Eau'],
  'Grand Anse': ['Anse-d Hainault', 'Beaumont', 'Chambellan', 'Dame-Marie', 'Jeremie', 'Moron'],
  'Nippes': ['Anse-a-Veau', 'Baraderes', 'Fond-des-Negres', 'Miragoane', 'Petite-Riviere-de-Nippes'],
  'Nord': ['Acul-du-Nord', 'Bahon', 'Borgne', 'Cap-Haitien', 'Grande-Riviere-du-Nord', 'Limonade', 'Milot', 'Pignon', 'Plaine-du-Nord', 'Port-Margot', 'Quartier-Morin', 'Ranquitte', 'Saint-Raphael'],
  'Nord-Est': ['Caracol', 'Ferrier', 'Fort-Liberte', 'Mombin-Crochu', 'Mont-Organise', 'Ouanaminthe', 'Perches', 'Sainte-Suzanne', 'Trou-du-Nord', 'Vallieres'],
  'Nord-Ouest': ['Anse-a-Foleur', 'Baie-de-Henne', 'Bombardopolis', 'Jean-Rabel', 'La Tortue', 'Mole-Saint-Nicolas', 'Port-de-Paix', 'Saint-Louis-du-Nord'],
  'Ouest': ['Arcahaie', 'Cabaret', 'Carrefour', 'Cite Soleil', 'Cornillon', 'Croix-des-Bouquets', 'Delmas', 'Fond-Verrettes', 'Ganthier', 'Gressier', 'Kenscoff', 'Leogane', 'Petion-Ville', 'Petit-Goave', 'Port-au-Prince', 'Tabarre'],
  'Sud': ['Aquin', 'Camp-Perrin', 'Cavaillon', 'Chantal', 'Chardonniere', 'Coteaux', 'Ile-a-Vache', 'Les Anglais', 'Les Cayes', 'Maniche', 'Port-a-Piment', 'Roche-a-Bateau', 'Saint-Jean-du-Sud', 'Tiburon', 'Torbeck'],
  'Sud-Est': ['Anse-a-Pitres', 'Bainet', 'Belle-Anse', 'Cayes-Jacmel', 'Cote-de-Fer', 'Grand-Gosier', 'Jacmel', 'La Vallee-de-Jacmel', 'Marigot', 'Thiotte']
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
  const sourceRules = source.moduleRules && typeof source.moduleRules === 'object' ? source.moduleRules : {};
  const moduleRules = DELIVERY_RULE_MODULES.reduce((acc, module) => {
    acc[module.id] = (Array.isArray(sourceRules[module.id]) ? sourceRules[module.id] : [])
      .map((rule, index) => {
        const range = PRINTING_INTERVAL_RANGES.find((entry) => entry.id === rule.rangeId)
          || PRINTING_INTERVAL_RANGES.find((entry) => Number(entry.min) === Number(rule.min) && Number(entry.max) === Number(rule.max))
          || PRINTING_INTERVAL_RANGES[0];
        const usesRange = module.usesRange !== false;
        return {
          id: String(rule.id || `${module.id}_rule_${index}`).trim(),
          country: String(rule.country || 'Haiti').trim() || 'Haiti',
          department: String(rule.department || '').trim(),
          commune: String(rule.commune || '').trim(),
          rangeId: usesRange ? String(rule.rangeId || range.id).trim() : '',
          label: usesRange ? String(rule.label || range.label).trim() : '',
          min: usesRange ? (Number(rule.min ?? range.min) || range.min) : 1,
          max: usesRange ? (Number(rule.max ?? range.max) || range.max) : 999999,
          fee: Number(rule.fee || 0),
          delay: String(rule.delay || rule.deliveryDelay || '').trim(),
          isActive: rule.isActive !== false
        };
      })
      .filter((rule) => rule.department || rule.commune || Number(rule.fee || 0) > 0);
    return acc;
  }, {});
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
      })),
    moduleRules
  };
}

class PrintingDashboard {
  constructor(rootId = 'printing-dashboard-root') {
    this.root = document.getElementById(rootId);
    this.state = {};
    this.deliverySettings = normalizeDeliverySettings(DEFAULT_DELIVERY_SETTINGS);
    this.deliveryUi = {
      openModules: new Set(['documents']),
      pages: DELIVERY_RULE_MODULES.reduce((acc, module) => {
        acc[module.id] = 1;
        return acc;
      }, {})
    };
    this.moduleUi = {
      openModules: new Set()
    };
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
          : this.mergeModuleState(module.defaults, {});
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
    const fallbackDimensions = Array.isArray(data.dimensions) && data.dimensions.length
      ? data.dimensions
      : (base.dimensions || []);
    const papersSource = Array.isArray(data.papers) && data.papers.length
      ? data.papers
      : (base.papers || []);
    const papers = papersSource
      .map((paper) => normalizePaperOption(paper, fallbackDimensions))
      .filter((paper) => paper.label);
    const dimensions = collectUniqueDimensionsFromPapers(papers, fallbackDimensions);

    return {
      ...base,
      ...data,
      dimensions,
      papers,
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
        <p>Cette couche admin prepare les sous-modules impression proprement avant le parcours client. On y gere les formats, les types de papier, les prix par dimension et le flux WhatsApp specialise.</p>
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
    const moduleRuleCount = DELIVERY_RULE_MODULES.reduce((total, module) => total + (settings.moduleRules?.[module.id]?.length || 0), 0);
    return `
      <article class="panel" data-printing-delivery-panel style="grid-column:1/-1;">
        <div class="panel-head">
          <div>
            <small>Reception impression</small>
            <h2>Livraison & points de retrait</h2>
          </div>
          <div class="status-chip">
            <i class="fas fa-location-dot"></i>
            <span>${settings.pickupPoints.length} point(s) / ${moduleRuleCount} regle(s)</span>
          </div>
        </div>
        <p>Ces reglages sont utilises uniquement par les modules impression. Les points de retrait restent gratuits. Les frais de livraison domicile sont maintenant definis directement dans chaque module.</p>

        <div class="option-list">
          <div class="option-title">Points de retrait gratuits</div>
          ${settings.pickupPoints.map((point, index) => this.renderPickupPointRow(point, index)).join('')}
          <button class="btn-secondary" type="button" data-add-printing-pickup>Ajouter un point de retrait</button>
        </div>

        ${DELIVERY_RULE_MODULES.map((module) => this.renderModuleDeliveryRules(module, settings.moduleRules?.[module.id] || [])).join('')}

        <div class="actions">
          <button class="btn-primary" type="button" data-save-printing-delivery>Enregistrer livraison impression</button>
        </div>
      </article>
    `;
  }

  renderPickupPointRow(point, index) {
    return `
      <div class="option-row" data-printing-pickup-row="${index}" style="grid-template-columns:1fr 1.5fr 1fr auto auto;">
        <input class="mini-input" data-pickup-field="name" value="${escapeHtml(point.name || '')}" placeholder="Nom du point">
        <input class="mini-input" data-pickup-field="address" value="${escapeHtml(point.address || '')}" placeholder="Adresse">
        <input class="mini-input" data-pickup-field="phone" value="${escapeHtml(point.phone || '')}" placeholder="Telephone">
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
        <select class="mini-input" data-home-zone-field="country">
          <option value="Haiti" ${(zone.country || 'Haiti') === 'Haiti' ? 'selected' : ''}>Haiti</option>
        </select>
        <select class="mini-input" data-home-zone-field="department" data-home-zone-department="${index}">
          ${this.renderDepartmentOptions(zone.department || '')}
        </select>
        <select class="mini-input" data-home-zone-field="commune" data-home-zone-commune="${index}" ${zone.department ? '' : 'disabled'}>
          ${this.renderCommuneOptions(zone.department || '', zone.commune || '')}
        </select>
        <input class="mini-input" type="number" min="0" step="1" data-home-zone-field="fee" value="${zone.fee ?? 0}" placeholder="Prix">
        <input class="mini-input" data-home-zone-field="delay" value="${escapeHtml(zone.delay || '')}" placeholder="Delai">
        <label class="check">
          <input type="checkbox" data-home-zone-field="isActive" ${zone.isActive ? 'checked' : ''}>
          <span>Actif</span>
        </label>
        <button class="btn-danger" type="button" data-remove-printing-home-zone="${index}">Retirer</button>
      </div>
    `;
  }

  renderModuleDeliveryRules(module, rules = []) {
    const currentPage = Math.max(1, Number(this.deliveryUi?.pages?.[module.id] || 1));
    const totalPages = Math.max(1, Math.ceil(rules.length / DELIVERY_RULES_PAGE_SIZE));
    const safePage = Math.min(currentPage, totalPages);
    if (this.deliveryUi?.pages) this.deliveryUi.pages[module.id] = safePage;
    const start = (safePage - 1) * DELIVERY_RULES_PAGE_SIZE;
    const visibleRules = rules.slice(start, start + DELIVERY_RULES_PAGE_SIZE);
    const isOpen = this.deliveryUi?.openModules?.has(module.id);
    const title = module.usesRange
      ? `${module.title} - zones, intervalle pages, prix et delai`
      : `${module.title} - zones, prix et delai`;
    const hint = module.usesRange
      ? 'Exemple: Haiti -> Ouest -> Delmas -> 1-100 -> 500 G -> 24h. Si aucune regle ne correspond a l adresse et a l intervalle du client, la livraison domicile sera bloquee pour ce module.'
      : 'Exemple: Haiti -> Ouest -> Delmas -> 500 G -> 24h. Aucun intervalle n est demande pour ce module.';
    return `
      <div class="delivery-accordion ${isOpen ? 'is-open' : ''}" data-module-delivery-rules="${module.id}">
        <button class="delivery-accordion__head" type="button" data-toggle-module-delivery="${module.id}" aria-expanded="${isOpen ? 'true' : 'false'}">
          <span>
            <strong>${escapeHtml(module.title)}</strong>
            <small>${rules.length} regle(s) · ${module.usesRange ? 'avec intervalle pages' : 'sans intervalle'}</small>
          </span>
          <i class="fas fa-chevron-${isOpen ? 'up' : 'down'}"></i>
        </button>
        ${isOpen ? `
          <div class="delivery-accordion__body">
            <div class="delivery-module-meta">
              <p class="hint">${escapeHtml(hint)}</p>
              <button class="btn-secondary" type="button" data-add-module-delivery-rule="${module.id}">
                <i class="fas fa-plus"></i>
                Ajouter une regle
              </button>
            </div>
            <div class="delivery-rule-list">
              ${visibleRules.length
                ? visibleRules.map((rule, offset) => this.renderModuleDeliveryRuleRow(module, rule, start + offset)).join('')
                : '<p class="hint" style="margin:0;">Aucune regle pour ce module. Ajoutez une zone pour activer la livraison a domicile.</p>'}
            </div>
            ${this.renderModuleDeliveryPagination(module.id, safePage, totalPages, rules.length)}
          </div>
        ` : ''}
      </div>
    `;
  }

  renderModuleDeliveryPagination(moduleId, currentPage, totalPages, totalRules) {
    if (totalRules <= DELIVERY_RULES_PAGE_SIZE) return '';
    return `
      <div class="delivery-pagination">
        <button class="btn-secondary" type="button" data-module-rule-page="${moduleId}" data-module-rule-page-direction="-1" ${currentPage <= 1 ? 'disabled' : ''}>
          <i class="fas fa-chevron-left"></i>
          Precedent
        </button>
        <span>Page ${currentPage} / ${totalPages}</span>
        <button class="btn-secondary" type="button" data-module-rule-page="${moduleId}" data-module-rule-page-direction="1" ${currentPage >= totalPages ? 'disabled' : ''}>
          Suivant
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>
    `;
  }

  renderModuleDeliveryRuleRow(module, rule, index) {
    const moduleId = module.id;
    const rangeColumn = module.usesRange
      ? `<select class="mini-input" data-module-rule-field="rangeId">
          ${PRINTING_INTERVAL_RANGES.map((range) => `<option value="${escapeHtml(range.id)}" ${range.id === rule.rangeId ? 'selected' : ''}>${escapeHtml(range.label)}</option>`).join('')}
        </select>`
      : '';
    const grid = module.usesRange
      ? '.75fr 1fr 1fr .8fr .75fr 1fr auto auto'
      : '.75fr 1fr 1fr .75fr 1fr auto auto';
    return `
      <div class="option-row delivery-rule-row" data-module-delivery-rule-row="${moduleId}-${index}" data-module-delivery-rule-index="${index}" style="grid-template-columns:${grid};">
        <select class="mini-input" data-module-rule-field="country">
          <option value="Haiti" ${(rule.country || 'Haiti') === 'Haiti' ? 'selected' : ''}>Haiti</option>
        </select>
        <select class="mini-input" data-module-rule-field="department" data-module-rule-department="${moduleId}-${index}">
          ${this.renderDepartmentOptions(rule.department || '')}
        </select>
        <select class="mini-input" data-module-rule-field="commune" data-module-rule-commune="${moduleId}-${index}" ${rule.department ? '' : 'disabled'}>
          ${this.renderCommuneOptions(rule.department || '', rule.commune || '')}
        </select>
        ${rangeColumn}
        <input class="mini-input" type="number" min="0" step="1" data-module-rule-field="fee" value="${rule.fee ?? 0}" placeholder="Prix">
        <input class="mini-input" data-module-rule-field="delay" value="${escapeHtml(rule.delay || '')}" placeholder="Delai">
        <label class="check">
          <input type="checkbox" data-module-rule-field="isActive" ${rule.isActive ? 'checked' : ''}>
          <span>Actif</span>
        </label>
        <button class="btn-danger" type="button" data-remove-module-delivery-rule="${moduleId}" data-remove-module-delivery-rule-index="${index}">Retirer</button>
      </div>
    `;
  }

  renderDepartmentOptions(selected = '') {
    return '<option value="">Choisir un departement...</option>' + Object.keys(HAITI_DEPARTMENTS)
      .map((department) => `<option value="${escapeHtml(department)}" ${department === selected ? 'selected' : ''}>${escapeHtml(department)}</option>`)
      .join('');
  }

  renderCommuneOptions(department = '', selected = '') {
    const communes = HAITI_DEPARTMENTS[department] || [];
    return '<option value="">Choisir une commune...</option>' + communes
      .map((commune) => `<option value="${escapeHtml(commune)}" ${commune === selected ? 'selected' : ''}>${escapeHtml(commune)}</option>`)
      .join('');
  }

  renderModule(module) {
    const state = this.state[module.id] || this.mergeModuleState(module.defaults, {});
    const isManualQuote = module.id === 'grand-format';
    const isOpen = this.moduleUi?.openModules?.has(module.id);
    const dimensionCount = Array.isArray(state.dimensions) ? state.dimensions.length : 0;
    const paperCount = Array.isArray(state.papers) ? state.papers.length : 0;
    const summary = isManualQuote
      ? 'Devis manuel / WhatsApp'
      : `${dimensionCount} format(s) · ${paperCount} papier(s)`;
    return `
      <article class="panel module-config ${isOpen ? 'is-open' : ''}" data-module="${module.id}">
        <button class="module-config__head" type="button" data-toggle-module-config="${module.id}" aria-expanded="${isOpen ? 'true' : 'false'}">
          <div>
            <small>${escapeHtml(module.metric || 'module')}</small>
            <h2>${module.title}</h2>
            <p>${escapeHtml(summary)}</p>
          </div>
          <div class="module-config__status">
            <span class="status-chip ${state.enabled ? '' : 'off'}">
              <i class="fas ${state.enabled ? 'fa-circle-check' : 'fa-circle-pause'}"></i>
              <span>${state.enabled ? 'Actif' : 'Inactif'}</span>
            </span>
            <i class="fas fa-chevron-${isOpen ? 'up' : 'down'}"></i>
          </div>
        </button>

        ${isOpen ? `
          <div class="module-config__body">
            <p>${module.description}</p>
            <div class="stack" style="margin-top:1rem;">
              ${isManualQuote ? `
                <label class="toggle">
                  <input type="checkbox" data-field="enabled" ${state.enabled ? 'checked' : ''}>
                  <span>Module actif</span>
                </label>
              ` : ''}

              ${isManualQuote ? this.renderGrandFormatFields(module.id, state) : this.renderStructuredFields(module.id, state)}

              <div class="actions">
                <button class="btn-primary" type="button" data-save-module="${module.id}">Enregistrer</button>
                ${!isManualQuote ? `
                  <button class="btn-secondary" type="button" data-add-paper="${module.id}">Ajouter un papier</button>
                ` : ''}
                <button class="btn-secondary" type="button" data-reset-module="${module.id}">Reinitialiser</button>
              </div>
            </div>
          </div>
        ` : ''}
      </article>
    `;
  }

  renderStructuredFields(moduleId, state) {
    const papers = Array.isArray(state.papers) ? state.papers : [];
    return `
      <div class="paper-config-list">
        ${papers.length
          ? papers.map((paper, paperIndex) => this.renderPaperConfig(moduleId, paper, paperIndex)).join('')
          : '<p class="hint">Aucun type de papier configure. Ajoutez un papier pour commencer.</p>'}
      </div>

      <label class="field">
        <span>Note admin</span>
        <textarea class="textarea" data-field="notes">${state.notes || ''}</textarea>
      </label>
    `;
  }

  renderPaperConfig(moduleId, paper, paperIndex) {
    const dimensions = Array.isArray(paper.dimensions) ? paper.dimensions : [];
    return `
      <section class="paper-config-card" data-paper-row="${moduleId}-${paperIndex}">
        <div class="paper-config-card__head">
          <label class="field paper-config-card__label">
            <span>Type de papier</span>
            <input class="input" data-paper-module="${moduleId}" data-paper-index="${paperIndex}" data-paper-field="label" value="${paper.label || ''}" placeholder="Ex: Bond">
          </label>
          <label class="check">
            <input type="checkbox" data-paper-module="${moduleId}" data-paper-index="${paperIndex}" data-paper-field="enabled" ${paper.enabled ? 'checked' : ''}>
            <span>Actif</span>
          </label>
          <button class="btn-danger" type="button" data-remove-option="${moduleId}" data-remove-list="papers" data-remove-index="${paperIndex}">Retirer ce papier</button>
        </div>

        <div class="paper-dimension-table">
          <div class="paper-dimension-table__head">
            <span>Dimensions</span>
            <span>Prix</span>
            <span>Statut</span>
            <span>Actions</span>
          </div>
          ${dimensions.length
            ? dimensions.map((dimension, dimensionIndex) => this.renderPaperDimensionRow(moduleId, paperIndex, dimension, dimensionIndex)).join('')
            : '<p class="hint">Aucune dimension pour ce papier.</p>'}
        </div>

        <button class="btn-secondary" type="button" data-add-paper-dimension="${moduleId}" data-paper-index="${paperIndex}">
          Ajouter une dimension pour ce papier
        </button>
      </section>
    `;
  }

  renderPaperDimensionRow(moduleId, paperIndex, dimension, dimensionIndex) {
    return `
      <div class="paper-dimension-row" data-paper-dimension-row="${moduleId}-${paperIndex}-${dimensionIndex}">
        <input class="mini-input" data-paper-dimension-module="${moduleId}" data-paper-index="${paperIndex}" data-dimension-index="${dimensionIndex}" data-paper-dimension-field="label" value="${dimension.label || ''}" placeholder="Ex: 8.5x11">
        <input class="mini-input" type="number" step="0.01" min="0" data-paper-dimension-module="${moduleId}" data-paper-index="${paperIndex}" data-dimension-index="${dimensionIndex}" data-paper-dimension-field="price" value="${dimension.price ?? 0}" placeholder="Prix">
        <label class="check">
          <input type="checkbox" data-paper-dimension-module="${moduleId}" data-paper-index="${paperIndex}" data-dimension-index="${dimensionIndex}" data-paper-dimension-field="enabled" ${dimension.enabled ? 'checked' : ''}>
          <span>Actif</span>
        </label>
        <button class="btn-danger" type="button" data-remove-paper-dimension="${moduleId}" data-paper-index="${paperIndex}" data-dimension-index="${dimensionIndex}">Retirer</button>
      </div>
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

  attachEvents() {
    this.root.querySelectorAll('[data-toggle-module-config]').forEach((button) => {
      button.addEventListener('click', () => {
        this.syncOpenModuleDrafts();
        const moduleId = button.dataset.toggleModuleConfig;
        if (!moduleId) return;
        if (this.moduleUi.openModules.has(moduleId)) {
          this.moduleUi.openModules.delete(moduleId);
        } else {
          this.moduleUi.openModules.add(moduleId);
        }
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-save-module]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.saveModule(button.dataset.saveModule);
      });
    });

    this.root.querySelectorAll('[data-reset-module]').forEach((button) => {
      button.addEventListener('click', () => {
        const module = MODULES.find((entry) => entry.id === button.dataset.resetModule);
        if (!module) return;
        this.state[module.id] = this.mergeModuleState(module.defaults, {});
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-add-paper]').forEach((button) => {
      button.addEventListener('click', () => {
        this.syncOpenModuleDrafts();
        this.addOption(button.dataset.addPaper, 'papers');
      });
    });

    this.root.querySelectorAll('[data-add-paper-dimension]').forEach((button) => {
      button.addEventListener('click', () => {
        this.syncOpenModuleDrafts();
        this.addPaperDimension(
          button.dataset.addPaperDimension,
          Number.parseInt(button.dataset.paperIndex || '0', 10)
        );
      });
    });

    this.root.querySelectorAll('[data-remove-option]').forEach((button) => {
      button.addEventListener('click', () => {
        this.syncOpenModuleDrafts();
        this.removeOption(button.dataset.removeOption, button.dataset.removeList, Number.parseInt(button.dataset.removeIndex || '0', 10));
      });
    });

    this.root.querySelectorAll('[data-remove-paper-dimension]').forEach((button) => {
      button.addEventListener('click', () => {
        this.syncOpenModuleDrafts();
        this.removePaperDimension(
          button.dataset.removePaperDimension,
          Number.parseInt(button.dataset.paperIndex || '0', 10),
          Number.parseInt(button.dataset.dimensionIndex || '0', 10)
        );
      });
    });

    this.root.querySelector('[data-add-printing-pickup]')?.addEventListener('click', () => {
      this.syncOpenModuleDrafts();
      this.syncDeliveryDraftFromDom();
      this.deliverySettings.pickupPoints.push({ id: `pickup_${Date.now()}`, name: '', address: '', phone: '', isActive: true });
      this.render();
      this.attachEvents();
    });

    this.root.querySelectorAll('[data-toggle-module-delivery]').forEach((button) => {
      button.addEventListener('click', () => {
        this.syncOpenModuleDrafts();
        this.syncDeliveryDraftFromDom();
        const moduleId = button.dataset.toggleModuleDelivery;
        if (!moduleId) return;
        if (this.deliveryUi.openModules.has(moduleId)) {
          this.deliveryUi.openModules.delete(moduleId);
        } else {
          this.deliveryUi.openModules.add(moduleId);
        }
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-module-rule-page]').forEach((button) => {
      button.addEventListener('click', () => {
        this.syncOpenModuleDrafts();
        this.syncDeliveryDraftFromDom();
        const moduleId = button.dataset.moduleRulePage;
        const direction = Number.parseInt(button.dataset.moduleRulePageDirection || '0', 10);
        if (!moduleId || !direction) return;
        const rules = this.deliverySettings.moduleRules?.[moduleId] || [];
        const totalPages = Math.max(1, Math.ceil(rules.length / DELIVERY_RULES_PAGE_SIZE));
        const current = Math.max(1, Number(this.deliveryUi.pages[moduleId] || 1));
        this.deliveryUi.pages[moduleId] = Math.min(totalPages, Math.max(1, current + direction));
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-add-module-delivery-rule]').forEach((button) => {
      button.addEventListener('click', () => {
        this.syncOpenModuleDrafts();
        this.syncDeliveryDraftFromDom();
        this.addModuleDeliveryRule(button.dataset.addModuleDeliveryRule);
      });
    });

    this.root.querySelectorAll('[data-remove-printing-pickup]').forEach((button) => {
      button.addEventListener('click', () => {
        this.syncOpenModuleDrafts();
        this.syncDeliveryDraftFromDom();
        this.deliverySettings.pickupPoints.splice(Number.parseInt(button.dataset.removePrintingPickup || '0', 10), 1);
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-remove-module-delivery-rule]').forEach((button) => {
      button.addEventListener('click', () => {
        this.syncOpenModuleDrafts();
        this.syncDeliveryDraftFromDom();
        const moduleId = button.dataset.removeModuleDeliveryRule;
        const index = Number.parseInt(button.dataset.removeModuleDeliveryRuleIndex || '0', 10);
        this.removeModuleDeliveryRule(moduleId, index);
      });
    });

    this.root.querySelectorAll('[data-module-rule-department]').forEach((select) => {
      select.addEventListener('change', () => {
        const rowId = select.dataset.moduleRuleDepartment;
        const communeSelect = this.root.querySelector(`[data-module-rule-commune="${rowId}"]`);
        if (!communeSelect) return;
        communeSelect.innerHTML = this.renderCommuneOptions(select.value, '');
        communeSelect.value = '';
        communeSelect.disabled = !select.value;
      });
    });

    this.root.querySelector('[data-save-printing-delivery]')?.addEventListener('click', async () => {
      try {
        await this.saveDeliverySettings();
      } catch (error) {
        console.error('Erreur sauvegarde livraison impression:', error);
        this.showToast(error?.message || 'Impossible d enregistrer la livraison impression.');
      }
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
    const existingSettings = this.deliverySettings || normalizeDeliverySettings(DEFAULT_DELIVERY_SETTINGS);
    const pickupPoints = Array.from(this.root.querySelectorAll('[data-printing-pickup-row]')).map((row, index) => ({
      id: existingSettings.pickupPoints[index]?.id || `pickup_${index}`,
      name: row.querySelector('[data-pickup-field="name"]')?.value || '',
      address: row.querySelector('[data-pickup-field="address"]')?.value || '',
      phone: row.querySelector('[data-pickup-field="phone"]')?.value || '',
      isActive: Boolean(row.querySelector('[data-pickup-field="isActive"]')?.checked)
    })).filter((point) => point.name || point.address || point.phone);

    const moduleRules = DELIVERY_RULE_MODULES.reduce((acc, module) => {
      const mergedRules = Array.isArray(existingSettings.moduleRules?.[module.id])
        ? clone(existingSettings.moduleRules[module.id])
        : [];
      Array.from(this.root.querySelectorAll(`[data-module-delivery-rule-row^="${module.id}-"]`)).forEach((row) => {
        const index = Number.parseInt(row.dataset.moduleDeliveryRuleIndex || '0', 10);
        const rangeId = module.usesRange
          ? (row.querySelector('[data-module-rule-field="rangeId"]')?.value || PRINTING_INTERVAL_RANGES[0].id)
          : '';
        const range = module.usesRange
          ? (PRINTING_INTERVAL_RANGES.find((entry) => entry.id === rangeId) || PRINTING_INTERVAL_RANGES[0])
          : { id: '', label: '', min: 1, max: 999999 };
        mergedRules[index] = {
          id: existingSettings.moduleRules?.[module.id]?.[index]?.id || `${module.id}_rule_${Date.now()}_${index}`,
          country: row.querySelector('[data-module-rule-field="country"]')?.value || 'Haiti',
          department: row.querySelector('[data-module-rule-field="department"]')?.value || '',
          commune: row.querySelector('[data-module-rule-field="commune"]')?.value || '',
          rangeId: range.id,
          label: range.label,
          min: range.min,
          max: range.max,
          fee: Number.parseFloat(row.querySelector('[data-module-rule-field="fee"]')?.value || '0') || 0,
          delay: row.querySelector('[data-module-rule-field="delay"]')?.value || '',
          isActive: Boolean(row.querySelector('[data-module-rule-field="isActive"]')?.checked)
        };
      });
      acc[module.id] = mergedRules.filter((rule) => rule && (rule.department || rule.commune || Number(rule.fee || 0) > 0));
      return acc;
    }, {});

    return normalizeDeliverySettings({ pickupPoints, homeZones: [], moduleRules });
  }

  syncDeliveryDraftFromDom() {
    if (!this.root?.querySelector('[data-printing-delivery-panel]')) return;
    this.deliverySettings = this.collectDeliverySettings();
  }

  addModuleDeliveryRule(moduleId) {
    const module = DELIVERY_RULE_MODULES.find((entry) => entry.id === moduleId);
    if (!module) return;
    this.deliverySettings.moduleRules = this.deliverySettings.moduleRules || {};
    this.deliverySettings.moduleRules[moduleId] = Array.isArray(this.deliverySettings.moduleRules[moduleId])
      ? this.deliverySettings.moduleRules[moduleId]
      : [];
    const range = module.usesRange ? PRINTING_INTERVAL_RANGES[0] : { id: '', label: '', min: 1, max: 999999 };
    this.deliverySettings.moduleRules[moduleId].push({
      id: `${moduleId}_rule_${Date.now()}`,
      country: 'Haiti',
      department: '',
      commune: '',
      rangeId: range.id,
      label: range.label,
      min: range.min,
      max: range.max,
      fee: 0,
      delay: '',
      isActive: true
    });
    this.deliveryUi.openModules.add(moduleId);
    this.deliveryUi.pages[moduleId] = Math.max(1, Math.ceil(this.deliverySettings.moduleRules[moduleId].length / DELIVERY_RULES_PAGE_SIZE));
    this.render();
    this.attachEvents();
  }

  removeModuleDeliveryRule(moduleId, index) {
    const rules = this.deliverySettings.moduleRules?.[moduleId];
    if (!Array.isArray(rules)) return;
    rules.splice(index, 1);
    const totalPages = Math.max(1, Math.ceil(rules.length / DELIVERY_RULES_PAGE_SIZE));
    this.deliveryUi.pages[moduleId] = Math.min(Math.max(1, Number(this.deliveryUi.pages[moduleId] || 1)), totalPages);
    this.render();
    this.attachEvents();
  }

  async saveDeliverySettings() {
    this.syncDeliveryDraftFromDom();
    const nextSettings = this.collectDeliverySettings();
    const ruleCount = DELIVERY_RULE_MODULES.reduce((total, module) => total + (nextSettings.moduleRules?.[module.id]?.length || 0), 0);
    if (!nextSettings.pickupPoints.length && !ruleCount) {
      throw new Error('Ajoutez au moins un point de retrait ou une regle de livraison avant d enregistrer.');
    }

    const payload = {
      ...nextSettings,
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
    state[listKey].push(listKey === 'papers'
      ? { label: '', enabled: true, dimensions: [] }
      : { label: '', enabled: true, price: 0 });
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

  addPaperDimension(moduleId, paperIndex) {
    const state = this.state[moduleId];
    const paper = state?.papers?.[paperIndex];
    if (!paper) return;
    paper.dimensions = Array.isArray(paper.dimensions) ? paper.dimensions : [];
    paper.dimensions.push({ label: '', enabled: true, price: 0 });
    state.dimensions = collectUniqueDimensionsFromPapers(state.papers || [], state.dimensions || []);
    this.render();
    this.attachEvents();
  }

  removePaperDimension(moduleId, paperIndex, dimensionIndex) {
    const state = this.state[moduleId];
    const paper = state?.papers?.[paperIndex];
    if (!paper || !Array.isArray(paper.dimensions)) return;
    paper.dimensions.splice(dimensionIndex, 1);
    state.dimensions = collectUniqueDimensionsFromPapers(state.papers || [], state.dimensions || []);
    this.render();
    this.attachEvents();
  }

  collectModuleState(moduleId) {
    const panel = this.root.querySelector(`[data-module="${moduleId}"]`);
    const current = this.state[moduleId];
    if (!panel || !current) return current;

    const enabledField = panel.querySelector('[data-field="enabled"]');
    const nextState = {
      ...clone(current),
      enabled: enabledField ? !!enabledField.checked : current.enabled !== false
    };

    panel.querySelectorAll('[data-field]').forEach((field) => {
      const key = field.dataset.field;
      if (!key || key === 'enabled') return;
      nextState[key] = field.value;
    });

    const paperMap = [];
    panel.querySelectorAll('[data-paper-module]').forEach((field) => {
      const index = Number.parseInt(field.dataset.paperIndex || '0', 10);
      const key = field.dataset.paperField;
      paperMap[index] = paperMap[index] || { dimensions: [] };
      paperMap[index][key] = key === 'enabled' ? !!field.checked : field.value;
    });

    panel.querySelectorAll('[data-paper-dimension-module]').forEach((field) => {
      const paperIndex = Number.parseInt(field.dataset.paperIndex || '0', 10);
      const dimensionIndex = Number.parseInt(field.dataset.dimensionIndex || '0', 10);
      const key = field.dataset.paperDimensionField;
      paperMap[paperIndex] = paperMap[paperIndex] || { dimensions: [] };
      paperMap[paperIndex].dimensions = Array.isArray(paperMap[paperIndex].dimensions) ? paperMap[paperIndex].dimensions : [];
      paperMap[paperIndex].dimensions[dimensionIndex] = paperMap[paperIndex].dimensions[dimensionIndex] || {};
      paperMap[paperIndex].dimensions[dimensionIndex][key] = key === 'enabled'
        ? !!field.checked
        : key === 'price'
          ? Number.parseFloat(field.value || '0') || 0
          : field.value;
    });

    if (paperMap.length) {
      nextState.papers = paperMap
        .map((paper) => normalizePaperOption({
          ...paper,
          dimensions: (paper.dimensions || []).filter(Boolean)
        }))
        .filter((paper) => paper.label);
      nextState.dimensions = collectUniqueDimensionsFromPapers(nextState.papers, nextState.dimensions || []);
    }

    return nextState;
  }

  syncOpenModuleDrafts() {
    if (!this.root || !this.moduleUi?.openModules) return;
    this.moduleUi.openModules.forEach((moduleId) => {
      if (!this.root.querySelector(`[data-module="${moduleId}"]`)) return;
      this.state[moduleId] = this.collectModuleState(moduleId);
    });
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
