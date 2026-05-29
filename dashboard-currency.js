import { db } from './firebase-init.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const SETTINGS_REF = ['settings', 'currency'];
const DEFAULT_SETTINGS = {
  htgPerUsd: 132,
  defaultDisplayCurrency: 'HTG'
};

function formatHTG(value) {
  return new Intl.NumberFormat('fr-HT', {
    style: 'currency',
    currency: 'HTG',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function formatUSD(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

class CurrencyDashboard {
  constructor(rootId = 'currency-dashboard-root') {
    this.root = document.getElementById(rootId);
    this.settings = { ...DEFAULT_SETTINGS };
    if (!this.root) return;
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.render();
    this.attachEvents();
  }

  async loadSettings() {
    try {
      const snapshot = await getDoc(doc(db, ...SETTINGS_REF));
      this.settings = snapshot.exists()
        ? { ...DEFAULT_SETTINGS, ...(snapshot.data() || {}) }
        : { ...DEFAULT_SETTINGS };
    } catch (error) {
      console.warn('Parametres devise indisponibles:', error);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  render() {
    const rate = Number(this.settings.htgPerUsd || DEFAULT_SETTINGS.htgPerUsd);
    const sample = 1000;
    this.root.innerHTML = `
      <section class="hero">
        <small>Module devise</small>
        <h1>Devise et taux du jour</h1>
        <p>Definissez le taux HTG/USD utilise par le site. Chaque utilisateur choisit ensuite s'il veut afficher les prix en HTG ou en USD. Les deux devises ne s'affichent pas en meme temps.</p>
      </section>

      <section class="card">
        <small>Parametres publics</small>
        <h2>Taux HTG / USD</h2>
        <div class="grid">
          <label class="field">
            <span>1 USD vaut combien de HTG ?</span>
            <input id="currencyRate" class="input" type="number" min="1" step="0.01" value="${rate}">
          </label>
          <label class="field">
            <span>Devise de paiement</span>
            <input class="input" value="HTG" disabled>
          </label>
        </div>
        <div class="grid">
          <label class="field">
            <span>Devise affichee par defaut pour les nouveaux visiteurs</span>
            <select id="currencyDefaultDisplay" class="input">
              <option value="HTG" ${(this.settings.defaultDisplayCurrency || 'HTG') === 'HTG' ? 'selected' : ''}>HTG</option>
              <option value="USD" ${(this.settings.defaultDisplayCurrency || 'HTG') === 'USD' ? 'selected' : ''}>USD</option>
            </select>
          </label>
          <label class="field">
            <span>Choix utilisateur</span>
            <input class="input" value="Le client choisit HTG ou USD dans le header du site" disabled>
          </label>
        </div>
        <div class="preview">
          <strong>Apercu</strong>
          <span>HTG: ${formatHTG(sample)}</span>
          <span>USD: ${formatUSD(sample / Math.max(1, rate))}</span>
        </div>
        <div class="actions">
          <button type="button" class="primary" data-save-currency><i class="fas fa-save"></i> Enregistrer</button>
          <button type="button" class="secondary" data-refresh-currency><i class="fas fa-rotate"></i> Recharger</button>
        </div>
      </section>
    `;
  }

  attachEvents() {
    this.root.querySelector('[data-save-currency]')?.addEventListener('click', async () => {
      await this.saveSettings();
    });
    this.root.querySelector('[data-refresh-currency]')?.addEventListener('click', async () => {
      await this.loadSettings();
      this.render();
      this.attachEvents();
      this.showToast('Parametres devise recharges.');
    });
  }

  async saveSettings() {
    const payload = {
      htgPerUsd: Math.max(1, Number(this.root.querySelector('#currencyRate')?.value || DEFAULT_SETTINGS.htgPerUsd)),
      defaultDisplayCurrency: String(this.root.querySelector('#currencyDefaultDisplay')?.value || 'HTG').toUpperCase() === 'USD' ? 'USD' : 'HTG',
      paymentCurrency: 'HTG',
      updatedAt: new Date().toISOString(),
      updatedBy: 'dashboard_admin'
    };
    await setDoc(doc(db, ...SETTINGS_REF), payload, { merge: true });
    this.settings = { ...DEFAULT_SETTINGS, ...payload };
    this.render();
    this.attachEvents();
    this.showToast('Taux devise enregistre.');
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }
}

new CurrencyDashboard();
