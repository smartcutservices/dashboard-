import { auth } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';

const FUNCTION_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/getWebsiteAnalytics';

class DashboardAnalyticsPage {
  constructor() {
    this.rangeDays = 7;
    this.analytics = null;
    this.bindRangeButtons();
    this.init();
  }

  bindRangeButtons() {
    document.querySelectorAll('[data-range]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextRange = Number(button.dataset.range || 7) || 7;
        if (nextRange === this.rangeDays) return;
        this.rangeDays = nextRange;
        this.updateRangeButtons();
        this.load();
      });
    });
  }

  updateRangeButtons() {
    document.querySelectorAll('[data-range]').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.range || 0) === this.rangeDays);
    });
  }

  setLastUpdateLabel(text) {
    const node = document.getElementById('analytics-last-update');
    if (node) node.textContent = text;
  }

  formatNumber(value) {
    return new Intl.NumberFormat('fr-FR').format(Number(value || 0));
  }

  truncateText(value, maxLength = 90) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
  }

  formatDateTime(value) {
    const parsed = new Date(value || '');
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  async init() {
    onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      await this.load();
    });
  }

  async load() {
    const user = auth.currentUser;
    if (!user) return;

    this.setLastUpdateLabel('Chargement des analytics...');

    try {
      const token = await user.getIdToken();
      const response = await fetch(`${FUNCTION_URL}?days=${this.rangeDays}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || 'Impossible de charger les analytics.');
      }

      this.analytics = payload.analytics || null;
      this.render();
      this.setLastUpdateLabel(`Dernière mise à jour · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      console.error('Erreur chargement analytics website:', error);
      this.renderError(error?.message || 'Impossible de charger les analytics.');
      this.setLastUpdateLabel('Impossible de charger les analytics.');
    }
  }

  renderError(message) {
    const wrappers = [
      'analytics-timeline',
      'analytics-devices',
      'analytics-sources',
      'top-pages-wrap',
      'analytics-browsers',
      'analytics-os',
      'analytics-languages',
      'recent-sessions-wrap'
    ];

    wrappers.forEach((id) => {
      const node = document.getElementById(id);
      if (!node) return;
      node.innerHTML = `<div class="empty-state">${this.escapeHtml(message)}</div>`;
    });
  }

  escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  renderStat(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = this.formatNumber(value);
  }

  renderMetricList(id, items = []) {
    const node = document.getElementById(id);
    if (!node) return;

    if (!items.length) {
      node.innerHTML = '<div class="empty-state">Aucune donnée pour le moment.</div>';
      return;
    }

    const max = Math.max(...items.map((item) => Number(item.value || 0)), 1);
    node.innerHTML = items.map((item) => {
      const ratio = Math.max(4, Math.round((Number(item.value || 0) / max) * 100));
      const fullLabel = item.label || item.path || 'Inconnu';
      return `
        <div class="metric-item">
          <div class="metric-row">
            <span class="metric-label" title="${this.escapeHtml(fullLabel)}">${this.escapeHtml(this.truncateText(fullLabel, 56))}</span>
            <strong class="metric-value">${this.formatNumber(item.value)}</strong>
          </div>
          <div class="metric-bar"><div style="width:${ratio}%;"></div></div>
        </div>
      `;
    }).join('');
  }

  renderTimeline(items = []) {
    const node = document.getElementById('analytics-timeline');
    if (!node) return;

    if (!items.length) {
      node.innerHTML = '<div class="empty-state">Aucune visite enregistrée pour le moment.</div>';
      return;
    }

    const max = Math.max(...items.map((item) => Number(item.pageViews || 0)), 1);
    node.innerHTML = items.map((item) => {
      const height = Math.max(8, Math.round((Number(item.pageViews || 0) / max) * 100));
      return `
        <div class="bar-col">
          <div class="bar-value">${this.formatNumber(item.pageViews || 0)}</div>
          <div class="bar-track">
            <div class="bar-fill" style="height:${height}%;"></div>
          </div>
          <div class="bar-label">${this.escapeHtml(item.label || '')}</div>
        </div>
      `;
    }).join('');
  }

  renderTopPages(items = []) {
    const node = document.getElementById('top-pages-wrap');
    if (!node) return;

    if (!items.length) {
      node.innerHTML = '<div class="empty-state">Aucune page vue enregistrée pour le moment.</div>';
      return;
    }

    node.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Page</th>
            <th>Chemin</th>
            <th>Vues</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td><span class="table-main" title="${this.escapeHtml(item.title || item.path || '-')}">${this.escapeHtml(this.truncateText(item.title || item.path || '-', 96))}</span></td>
              <td><span class="table-sub" title="${this.escapeHtml(item.path || '-')}">${this.escapeHtml(item.path || '-')}</span></td>
              <td>${this.formatNumber(item.value)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  renderRecentSessions(items = []) {
    const node = document.getElementById('recent-sessions-wrap');
    if (!node) return;

    if (!items.length) {
      node.innerHTML = '<div class="empty-state">Aucune session récente pour le moment.</div>';
      return;
    }

    node.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Entrée</th>
            <th>Source</th>
            <th>Appareil</th>
            <th>Technique</th>
            <th>Langue / Fuseau</th>
            <th>Dernière activité</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>
                <span class="table-main" title="${this.escapeHtml(item.landingTitle || item.landingPath || '-')}">${this.escapeHtml(this.truncateText(item.landingTitle || item.landingPath || '-', 92))}</span>
                <span class="table-sub" title="${this.escapeHtml(item.landingPath || '-')}">${this.escapeHtml(item.landingPath || '-')}</span>
              </td>
              <td>${this.escapeHtml(item.source || 'direct')}</td>
              <td>
                <span class="table-main">${this.escapeHtml(item.deviceType || '-')}</span>
                <span class="table-sub">${this.formatNumber(item.pageViews || 0)} pages</span>
              </td>
              <td>
                <span class="table-main" title="${this.escapeHtml(item.browser || '-')}">${this.escapeHtml(this.truncateText(item.browser || '-', 48))}</span>
                <span class="table-sub" title="${this.escapeHtml(item.os || '-')}">${this.escapeHtml(item.os || '-')}</span>
              </td>
              <td>
                <span class="table-main" title="${this.escapeHtml(item.language || '-')}">${this.escapeHtml(item.language || '-')}</span>
                <span class="table-sub" title="${this.escapeHtml(item.timeZone || '-')}">${this.escapeHtml(item.timeZone || '-')}</span>
              </td>
              <td>${this.escapeHtml(this.formatDateTime(item.lastSeenAt))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  render() {
    const analytics = this.analytics || {};
    const summary = analytics.summary || {};

    this.renderStat('stat-visitors', summary.uniqueVisitors || 0);
    this.renderStat('stat-pageviews', summary.pageViews || 0);
    this.renderStat('stat-average', summary.averagePagesPerSession || 0);
    this.renderStat('stat-cartadds', summary.cartAdds || 0);
    this.renderStat('stat-checkouts', summary.checkoutStarts || 0);

    const timelineBadge = document.getElementById('timeline-badge');
    if (timelineBadge) {
      timelineBadge.textContent = `${this.formatNumber(summary.activeToday || 0)} actifs aujourd’hui`;
    }

    this.renderTimeline(Array.isArray(analytics.timeline) ? analytics.timeline : []);
    this.renderMetricList('analytics-devices', analytics.devices || []);
    this.renderMetricList('analytics-sources', analytics.sources || []);
    this.renderTopPages(analytics.topPages || []);
    this.renderMetricList('analytics-browsers', analytics.browsers || []);
    this.renderMetricList('analytics-os', analytics.operatingSystems || []);
    this.renderMetricList('analytics-languages', analytics.languages || []);
    this.renderRecentSessions(analytics.recentSessions || []);
  }
}

new DashboardAnalyticsPage();
