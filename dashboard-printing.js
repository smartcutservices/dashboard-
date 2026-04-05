import { db } from './firebase-init.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import {
  deepClone,
  collectUniqueDimensionsFromPapers,
  normalizePrintingConfig
} from './printing-config-utils.js';

const DOCUMENT_DIMENSIONS = [
  { label: '8.5x11', enabled: true, price: 15 },
  { label: '8.5x14', enabled: true, price: 17 },
  { label: '11x17', enabled: true, price: 28 },
  { label: '13x19', enabled: true, price: 47 }
];

const PHOTO_DIMENSIONS = [
  { label: '4x5', enabled: true, price: 15 },
  { label: '5x7', enabled: true, price: 17 },
  { label: '8x10', enabled: true, price: 28 },
  { label: '8.5x11', enabled: true, price: 47 },
  { label: '11x17', enabled: true, price: 110 },
  { label: '13x19', enabled: true, price: 89 }
];

const CAD_DIMENSIONS = [
  { label: '8.5x11', enabled: true, price: 15 },
  { label: '8.5x14', enabled: true, price: 17 },
  { label: '11x17', enabled: true, price: 28 },
  { label: '13x19', enabled: true, price: 47 },
  { label: '24x36', enabled: true, price: 110 },
  { label: '24x24', enabled: true, price: 89 }
];

function buildPaper(label, dimensions) {
  return {
    label,
    enabled: true,
    dimensions: deepClone(dimensions)
  };
}

const MODULES = [
  {
    id: 'documents',
    title: 'POD Documents',
    description: 'Chaque type de papier gere ses propres dimensions et ses propres prix par page PDF.',
    metric: 'PDF / pages',
    defaults: {
      enabled: true,
      papers: [
        buildPaper('Bond', DOCUMENT_DIMENSIONS),
        buildPaper('Glossy', DOCUMENT_DIMENSIONS),
        buildPaper('Bristol Glossy', DOCUMENT_DIMENSIONS),
        buildPaper('Autocollant', DOCUMENT_DIMENSIONS)
      ],
      notes: ''
    }
  },
  {
    id: 'photo',
    title: 'Impression Photo',
    description: 'Configuration papier -> dimension -> prix pour les commandes photo en PDF.',
    metric: 'PDF / tirages',
    defaults: {
      enabled: true,
      papers: [
        buildPaper('Glossy', PHOTO_DIMENSIONS),
        buildPaper('Matte', PHOTO_DIMENSIONS),
        buildPaper('Premium Glossy', PHOTO_DIMENSIONS)
      ],
      notes: ''
    }
  },
  {
    id: 'cad',
    title: 'Plans CAD',
    description: 'Formats techniques et prix par page PDF, directement rattaches a chaque papier.',
    metric: 'plans PDF',
    defaults: {
      enabled: true,
      papers: [
        buildPaper('Bond', CAD_DIMENSIONS)
      ],
      notes: ''
    }
  },
  {
    id: 'grand-format',
    title: 'Stickers & Grand Format',
    description: 'Flux devis WhatsApp pour stickers, banners et travaux grand format.',
    metric: 'devis',
    defaults: {
      enabled: true,
      whatsappNumber: '',
      whatsappMessage: 'Bonjour, je souhaite demander un devis Smart Cut Services pour un sticker ou un format grand format.',
      notes: 'Calcul manuel via WhatsApp.'
    }
  }
];

class PrintingDashboard {
  constructor(rootId = 'printing-dashboard-root') {
    this.root = document.getElementById(rootId);
    this.state = {};
    if (!this.root) return;
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.render();
    this.attachEvents();
  }

  async loadSettings() {
    const entries = await Promise.all(MODULES.map(async (module) => {
      const snapshot = await getDoc(doc(db, 'printingSettings', module.id));
      const merged = snapshot.exists()
        ? this.mergeModuleState(module.defaults, snapshot.data())
        : deepClone(module.defaults);
      return [module.id, merged];
    }));
    this.state = Object.fromEntries(entries);
  }

  mergeModuleState(defaults, data) {
    if (defaults.papers) {
      return normalizePrintingConfig(defaults, data);
    }
    return {
      ...deepClone(defaults),
      ...(data || {})
    };
  }

  getStats() {
    const activeModules = MODULES.filter((module) => this.state[module.id]?.enabled).length;
    const papers = MODULES.reduce((total, module) => total + (this.state[module.id]?.papers?.length || 0), 0);
    const totalDimensions = MODULES.reduce((total, module) => {
      return total + (this.state[module.id]?.papers || []).reduce((sum, paper) => sum + (paper?.dimensions?.length || 0), 0);
    }, 0);
    return { activeModules, papers, totalDimensions };
  }

  render() {
    const stats = this.getStats();
    this.root.innerHTML = `
      <section class="hero">
        <small>Pole impression</small>
        <h1>Configuration impression & production</h1>
        <p>Chaque papier porte maintenant sa propre liste de dimensions et de prix. Le site calcule ensuite automatiquement le total d apres le nombre de pages PDF.</p>
      </section>

      <section class="stats">
        <article class="stat-card"><strong>${MODULES.length}</strong><span>Sous-modules relies</span></article>
        <article class="stat-card"><strong>${stats.activeModules}</strong><span>Modules actifs</span></article>
        <article class="stat-card"><strong>${stats.papers}</strong><span>Types de papier</span></article>
        <article class="stat-card"><strong>${stats.totalDimensions}</strong><span>Dimensions configurees</span></article>
      </section>

      <section class="config-grid">
        ${MODULES.map((module) => this.renderModule(module)).join('')}
      </section>
    `;
  }

  renderModule(module) {
    const state = this.state[module.id] || deepClone(module.defaults);
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

          ${isManualQuote ? this.renderGrandFormatFields(state) : this.renderStructuredFields(module.id, state)}

          <div class="actions">
            <button class="btn-primary" type="button" data-save-module="${module.id}">Enregistrer</button>
            ${!isManualQuote ? `<button class="btn-secondary" type="button" data-add-paper="${module.id}">Ajouter un papier</button>` : ''}
            <button class="btn-secondary" type="button" data-reset-module="${module.id}">Reinitialiser</button>
          </div>
        </div>
      </article>
    `;
  }

  renderStructuredFields(moduleId, state) {
    return `
      <div class="option-list">
        <div class="option-title">Types de papier et dimensions</div>
        ${(state.papers || []).map((paper, index) => this.renderPaperCard(moduleId, paper, index)).join('')}
      </div>
      <label class="field">
        <span>Note admin</span>
        <textarea class="textarea" data-field="notes">${state.notes || ''}</textarea>
      </label>
      <p class="hint">Le site utilisera le prix de la dimension choisie dans le papier choisi, puis le multipliera automatiquement par le nombre de pages du PDF.</p>
    `;
  }

  renderPaperCard(moduleId, paper, paperIndex) {
    return `
      <div class="paper-card">
        <div class="paper-card-head">
          <div class="paper-card-fields">
            <input class="mini-input" data-paper-module="${moduleId}" data-paper-index="${paperIndex}" data-paper-field="label" value="${paper.label || ''}" placeholder="Type de papier">
            <label class="check">
              <input type="checkbox" data-paper-module="${moduleId}" data-paper-index="${paperIndex}" data-paper-field="enabled" ${paper.enabled ? 'checked' : ''}>
              <span>Disponible</span>
            </label>
          </div>
          <div class="paper-card-actions">
            <button class="btn-secondary btn-small" type="button" data-add-dimension="${moduleId}" data-paper-index="${paperIndex}">Ajouter une dimension</button>
            <button class="btn-danger btn-small" type="button" data-remove-paper="${moduleId}" data-paper-index="${paperIndex}">Retirer</button>
          </div>
        </div>
        <div class="dimension-list">
          ${(paper.dimensions || []).map((dimension, dimensionIndex) => this.renderDimensionRow(moduleId, paperIndex, dimension, dimensionIndex)).join('')}
        </div>
      </div>
    `;
  }

  renderDimensionRow(moduleId, paperIndex, dimension, dimensionIndex) {
    return `
      <div class="option-row">
        <input class="mini-input" data-dimension-module="${moduleId}" data-paper-index="${paperIndex}" data-dimension-index="${dimensionIndex}" data-dimension-field="label" value="${dimension.label || ''}" placeholder="Dimension">
        <input class="mini-input" type="number" step="0.01" min="0" data-dimension-module="${moduleId}" data-paper-index="${paperIndex}" data-dimension-index="${dimensionIndex}" data-dimension-field="price" value="${dimension.price ?? 0}" placeholder="Prix">
        <label class="check">
          <input type="checkbox" data-dimension-module="${moduleId}" data-paper-index="${paperIndex}" data-dimension-index="${dimensionIndex}" data-dimension-field="enabled" ${dimension.enabled ? 'checked' : ''}>
          <span>Disponible</span>
        </label>
        <button class="btn-danger" type="button" data-remove-dimension="${moduleId}" data-paper-index="${paperIndex}" data-dimension-index="${dimensionIndex}">Retirer</button>
      </div>
    `;
  }

  renderGrandFormatFields(state) {
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
      <p class="hint">Le client choisit le type de projet, la largeur et la hauteur, puis il est dirige vers WhatsApp pour demander un devis.</p>
    `;
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
        this.state[module.id] = deepClone(module.defaults);
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-add-paper]').forEach((button) => {
      button.addEventListener('click', () => {
        this.addPaper(button.dataset.addPaper);
      });
    });

    this.root.querySelectorAll('[data-remove-paper]').forEach((button) => {
      button.addEventListener('click', () => {
        this.removePaper(button.dataset.removePaper, Number.parseInt(button.dataset.paperIndex || '0', 10));
      });
    });

    this.root.querySelectorAll('[data-add-dimension]').forEach((button) => {
      button.addEventListener('click', () => {
        this.addDimension(button.dataset.addDimension, Number.parseInt(button.dataset.paperIndex || '0', 10));
      });
    });

    this.root.querySelectorAll('[data-remove-dimension]').forEach((button) => {
      button.addEventListener('click', () => {
        this.removeDimension(
          button.dataset.removeDimension,
          Number.parseInt(button.dataset.paperIndex || '0', 10),
          Number.parseInt(button.dataset.dimensionIndex || '0', 10)
        );
      });
    });
  }

  addPaper(moduleId) {
    const state = this.state[moduleId];
    if (!state?.papers) return;
    const fallbackDimensions = collectUniqueDimensionsFromPapers(state.papers, []);
    state.papers.push({
      label: '',
      enabled: true,
      dimensions: deepClone(fallbackDimensions.length ? fallbackDimensions : [{ label: '', enabled: true, price: 0 }])
    });
    this.render();
    this.attachEvents();
  }

  removePaper(moduleId, paperIndex) {
    const state = this.state[moduleId];
    if (!state?.papers) return;
    state.papers.splice(paperIndex, 1);
    this.render();
    this.attachEvents();
  }

  addDimension(moduleId, paperIndex) {
    const state = this.state[moduleId];
    const paper = state?.papers?.[paperIndex];
    if (!paper) return;
    paper.dimensions = Array.isArray(paper.dimensions) ? paper.dimensions : [];
    paper.dimensions.push({ label: '', enabled: true, price: 0 });
    this.render();
    this.attachEvents();
  }

  removeDimension(moduleId, paperIndex, dimensionIndex) {
    const state = this.state[moduleId];
    const paper = state?.papers?.[paperIndex];
    if (!paper?.dimensions) return;
    paper.dimensions.splice(dimensionIndex, 1);
    this.render();
    this.attachEvents();
  }

  collectModuleState(moduleId) {
    const panel = this.root.querySelector(`[data-module="${moduleId}"]`);
    const current = this.state[moduleId];
    if (!panel || !current) return current;

    const nextState = {
      ...deepClone(current),
      enabled: !!panel.querySelector('[data-field="enabled"]')?.checked
    };

    panel.querySelectorAll('[data-field]').forEach((field) => {
      const key = field.dataset.field;
      if (!key || key === 'enabled') return;
      nextState[key] = field.value;
    });

    if (Array.isArray(current.papers)) {
      const papers = [];
      panel.querySelectorAll('[data-paper-module]').forEach((field) => {
        const paperIndex = Number.parseInt(field.dataset.paperIndex || '0', 10);
        const paperField = field.dataset.paperField;
        papers[paperIndex] = papers[paperIndex] || { dimensions: [] };
        papers[paperIndex][paperField] = paperField === 'enabled' ? !!field.checked : field.value;
      });

      panel.querySelectorAll('[data-dimension-module]').forEach((field) => {
        const paperIndex = Number.parseInt(field.dataset.paperIndex || '0', 10);
        const dimensionIndex = Number.parseInt(field.dataset.dimensionIndex || '0', 10);
        const dimensionField = field.dataset.dimensionField;
        papers[paperIndex] = papers[paperIndex] || { dimensions: [] };
        papers[paperIndex].dimensions = papers[paperIndex].dimensions || [];
        papers[paperIndex].dimensions[dimensionIndex] = papers[paperIndex].dimensions[dimensionIndex] || {};
        papers[paperIndex].dimensions[dimensionIndex][dimensionField] = dimensionField === 'enabled'
          ? !!field.checked
          : dimensionField === 'price'
            ? Number.parseFloat(field.value || '0') || 0
            : field.value;
      });

      nextState.papers = papers
        .filter(Boolean)
        .map((paper) => ({
          label: String(paper.label || '').trim(),
          enabled: paper.enabled !== false,
          dimensions: (paper.dimensions || [])
            .filter(Boolean)
            .map((dimension) => ({
              label: String(dimension.label || '').trim(),
              enabled: dimension.enabled !== false,
              price: Number(dimension.price) || 0
            }))
            .filter((dimension) => dimension.label)
        }))
        .filter((paper) => paper.label);
      nextState.dimensions = collectUniqueDimensionsFromPapers(nextState.papers, []);
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
