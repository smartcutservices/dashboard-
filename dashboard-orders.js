import { db } from './firebase-init.js';
import { sendBroadcastNotification } from './notification.js';
import { buildAdminSalesSummary } from './vendor-analytics.js';
import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const CLIENTS_COLLECTION = 'clients';
const FULFILLMENT_STEPS = [
  { key: 'ordered', label: 'Commandé' },
  { key: 'shipped', label: 'Expédié' },
  { key: 'in_delivery', label: 'En cours de livraison' },
  { key: 'delivered', label: 'Livré' }
];

const state = {
  clients: [],
  orders: [],
  activeOrderId: null,
  unsubscribers: [],
  reloadTimeout: null
};

const elements = {
  statTotalOrders: document.getElementById('statTotalOrders'),
  statPendingOrders: document.getElementById('statPendingOrders'),
  statInDelivery: document.getElementById('statInDelivery'),
  statDelivered: document.getElementById('statDelivered'),
  statRevenue: document.getElementById('statRevenue'),
  statConfirmedSales: document.getElementById('statConfirmedSales'),
  statAverageTicket: document.getElementById('statAverageTicket'),
  statActiveClients: document.getElementById('statActiveClients'),
  salesTrendChart: document.getElementById('salesTrendChart'),
  paymentStatusDonut: document.getElementById('paymentStatusDonut'),
  paymentStatusDonutValue: document.getElementById('paymentStatusDonutValue'),
  paymentStatusLegend: document.getElementById('paymentStatusLegend'),
  topProductsList: document.getElementById('topProductsList'),
  searchInput: document.getElementById('searchInput'),
  paymentStatusFilter: document.getElementById('paymentStatusFilter'),
  fulfillmentStatusFilter: document.getElementById('fulfillmentStatusFilter'),
  clientFilter: document.getElementById('clientFilter'),
  refreshOrdersBtn: document.getElementById('refreshOrdersBtn'),
  ordersTableBody: document.getElementById('ordersTableBody'),
  ordersEmptyState: document.getElementById('ordersEmptyState'),
  ordersLoadingState: document.getElementById('ordersLoadingState'),
  orderDetailRoot: document.getElementById('orderDetailRoot')
};

function showToast(message, type = 'success') {
  const palette = {
    success: '#0f9f6e',
    error: '#dc2626',
    info: '#2563eb'
  };

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = [
    'position:fixed',
    'right:20px',
    'bottom:20px',
    'z-index:10000',
    `background:${palette[type] || palette.success}`,
    'color:#fff',
    'padding:0.9rem 1rem',
    'border-radius:14px',
    'box-shadow:0 18px 40px rgba(0,0,0,0.18)',
    'font:600 0.9rem Manrope, sans-serif',
    'transform:translateY(14px)',
    'opacity:0',
    'transition:all .2s ease'
  ].join(';');

  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(14px)';
    setTimeout(() => toast.remove(), 220);
  }, 2200);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatPrice(price) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'HTG',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(price) || 0);
}

function getPaymentStatusText(status) {
  const texts = {
    pending: 'En attente',
    review: 'En examen',
    approved: 'Approuve',
    paid: 'Paye',
    rejected: 'Rejete',
    expired: 'Expire'
  };
  return texts[status] || 'En attente';
}

function getPaymentStatusColor(status) {
  const colors = {
    pending: '#d97706',
    review: '#2563eb',
    approved: '#0f9f6e',
    paid: '#0f9f6e',
    rejected: '#dc2626',
    expired: '#64748b'
  };
  return colors[status] || colors.pending;
}

function getFulfillmentStatus(order) {
  return order?.fulfillmentStatus || 'ordered';
}

function getFulfillmentStatusText(status) {
  const step = FULFILLMENT_STEPS.find((item) => item.key === status);
  return step?.label || 'Commande';
}

function getFulfillmentStatusColor(status) {
  const colors = {
    ordered: '#c6a75e',
    shipped: '#2563eb',
    in_delivery: '#d97706',
    delivered: '#0f9f6e'
  };
  return colors[status] || colors.ordered;
}

function renderBadge(label, color) {
  return `<span class="badge" style="background:${color}18;color:${color};border:1px solid ${color}22;">${escapeHtml(label)}</span>`;
}

function getOrderAmount(order) {
  if (typeof order?.amount === 'number' && Number.isFinite(order.amount)) {
    return order.amount;
  }

  return (Array.isArray(order?.items) ? order.items : []).reduce((sum, item) => {
    const price = Number(item?.price) || 0;
    const qty = Number(item?.quantity) || 1;
    return sum + (price * qty);
  }, 0);
}

function getClientById(clientId) {
  return state.clients.find((client) => client.id === clientId) || null;
}

function populateClientFilter() {
  const currentValue = elements.clientFilter.value || 'all';
  elements.clientFilter.innerHTML = '<option value="all">Tous les clients</option>';

  state.clients
    .slice()
    .sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')))
    .forEach((client) => {
      const option = document.createElement('option');
      option.value = client.id;
      option.textContent = client.name || client.email || client.id;
      elements.clientFilter.appendChild(option);
    });

  elements.clientFilter.value = Array.from(elements.clientFilter.options).some((opt) => opt.value === currentValue)
    ? currentValue
    : 'all';
}

async function loadClients() {
  const snapshot = await getDocs(collection(db, CLIENTS_COLLECTION));
  state.clients = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  populateClientFilter();
}

async function loadOrders() {
  try {
    const snapshot = await getDocs(query(collectionGroup(db, 'orders'), orderBy('createdAt', 'desc')));
    state.orders = snapshot.docs.map((entry) => ({
      id: entry.id,
      clientId: entry.ref.parent.parent?.id || entry.data()?.clientId || '',
      ...entry.data()
    }));
  } catch (error) {
    console.error('Erreur chargement commandes globales:', error);
    state.orders = [];
  }
}

function clearRealtimeListeners() {
  state.unsubscribers.forEach((unsubscribe) => {
    try { unsubscribe(); } catch (_) {}
  });
  state.unsubscribers = [];
}

function scheduleReload() {
  if (state.reloadTimeout) {
    clearTimeout(state.reloadTimeout);
  }

  state.reloadTimeout = setTimeout(async () => {
    await loadOrders();
    render();
  }, 250);
}

function setupRealtimeListeners() {
  clearRealtimeListeners();

  const unsubscribe = onSnapshot(query(collectionGroup(db, 'orders'), orderBy('createdAt', 'desc')), () => {
    scheduleReload();
  });
  state.unsubscribers.push(unsubscribe);
}

function getFilteredOrders() {
  const search = (elements.searchInput.value || '').trim().toLowerCase();
  const paymentStatus = elements.paymentStatusFilter.value;
  const fulfillmentStatus = elements.fulfillmentStatusFilter.value;
  const clientId = elements.clientFilter.value;

  return state.orders.filter((order) => {
    const client = getClientById(order.clientId);
    const searchable = [
      order.uniqueCode,
      order.customerName,
      order.customerEmail,
      client?.name,
      client?.email
    ].join(' ').toLowerCase();

    if (search && !searchable.includes(search)) return false;
    if (paymentStatus !== 'all' && order.status !== paymentStatus) return false;
    if (fulfillmentStatus !== 'all' && getFulfillmentStatus(order) !== fulfillmentStatus) return false;
    if (clientId !== 'all' && order.clientId !== clientId) return false;
    return true;
  });
}

function renderStats() {
  const totalOrders = state.orders.length;
  const pendingOrders = state.orders.filter((order) => order.status === 'pending').length;
  const inDelivery = state.orders.filter((order) => getFulfillmentStatus(order) === 'in_delivery').length;
  const delivered = state.orders.filter((order) => getFulfillmentStatus(order) === 'delivered').length;
  const sales = buildAdminSalesSummary({ orders: state.orders });

  elements.statTotalOrders.textContent = String(totalOrders);
  elements.statPendingOrders.textContent = String(pendingOrders);
  elements.statInDelivery.textContent = String(inDelivery);
  elements.statDelivered.textContent = String(delivered);
  elements.statRevenue.textContent = formatPrice(sales.confirmedRevenue);
  elements.statConfirmedSales.textContent = String(sales.confirmedOrders);
  elements.statAverageTicket.textContent = formatPrice(sales.averageTicket);
  elements.statActiveClients.textContent = String(sales.activeClients);
  renderSalesTrendChart(sales.timeline);
  renderPaymentStatusChart(sales.statusBreakdown);
  renderTopProducts(sales.topProducts);
}

function renderSalesTrendChart(timeline = []) {
  if (!elements.salesTrendChart) return;

  if (!timeline.length) {
    elements.salesTrendChart.innerHTML = '<div class="empty-state" style="grid-column:1 / -1;padding:1rem 0;">Aucune vente confirmee pour tracer une evolution.</div>';
    return;
  }

  const maxAmount = Math.max(...timeline.map((entry) => Number(entry.amount) || 0), 1);
  elements.salesTrendChart.innerHTML = timeline.map((entry) => {
    const height = Math.max(8, Math.round(((Number(entry.amount) || 0) / maxAmount) * 100));
    return `
      <div class="chart-bar-col">
        <div class="chart-bar-value">${formatPrice(entry.amount)}</div>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="height:${height}%;"></div>
        </div>
        <div class="chart-bar-label">${escapeHtml(entry.label)}<br><span style="font-size:0.74rem;">${entry.orders} cmd</span></div>
      </div>
    `;
  }).join('');
}

function renderPaymentStatusChart(breakdown = []) {
  if (!elements.paymentStatusDonut || !elements.paymentStatusLegend || !elements.paymentStatusDonutValue) return;

  const total = breakdown.reduce((sum, entry) => sum + (entry.value || 0), 0);
  elements.paymentStatusDonutValue.textContent = String(total);

  if (!total) {
    elements.paymentStatusDonut.style.background = 'conic-gradient(#e9dcc1 0deg, #e9dcc1 360deg)';
    elements.paymentStatusLegend.innerHTML = '<div class="empty-state" style="padding:0.5rem 0;">Aucune commande disponible.</div>';
    return;
  }

  let angle = 0;
  const segments = breakdown.map((entry) => {
    const ratio = (entry.value || 0) / total;
    const nextAngle = angle + (ratio * 360);
    const segment = `${entry.color} ${angle.toFixed(2)}deg ${nextAngle.toFixed(2)}deg`;
    angle = nextAngle;
    return segment;
  });
  elements.paymentStatusDonut.style.background = `conic-gradient(${segments.join(', ')})`;

  elements.paymentStatusLegend.innerHTML = breakdown.map((entry) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${entry.color};"></span>
      <div>
        <div style="display:flex;justify-content:space-between;gap:0.8rem;">
          <span>${escapeHtml(entry.label)}</span>
          <strong>${entry.value}</strong>
        </div>
        <div class="legend-bar"><span style="width:${Math.max(0, Math.min(100, Math.round((entry.ratio || 0) * 100)))}%;background:${entry.color};"></span></div>
      </div>
      <span>${Math.round((entry.ratio || 0) * 100)}%</span>
    </div>
  `).join('');
}

function renderTopProducts(products = []) {
  if (!elements.topProductsList) return;
  if (!products.length) {
    elements.topProductsList.innerHTML = '<div class="empty-state" style="padding:1rem 0;">Aucune vente produit pour le moment.</div>';
    return;
  }

  elements.topProductsList.innerHTML = products.map((product, index) => `
    <article class="top-product-row">
      <div>
        <strong>${index + 1}. ${escapeHtml(product.name || 'Produit')}</strong>
        <span>${product.quantity || 0} unite(s) vendue(s)</span>
      </div>
      <div style="text-align:right;font-weight:700;">${formatPrice(product.amount)}</div>
    </article>
  `).join('');
}

function renderOrdersTable() {
  const filteredOrders = getFilteredOrders();
  const activeOrderId = state.activeOrderId && filteredOrders.some((order) => order.id === state.activeOrderId)
    ? state.activeOrderId
    : filteredOrders[0]?.id || null;

  state.activeOrderId = activeOrderId;

  if (filteredOrders.length === 0) {
    elements.ordersTableBody.innerHTML = '';
    elements.ordersEmptyState.hidden = false;
    return;
  }

  elements.ordersEmptyState.hidden = true;
  elements.ordersTableBody.innerHTML = filteredOrders.map((order) => {
    const client = getClientById(order.clientId);
    const paymentColor = getPaymentStatusColor(order.status);
    const fulfillmentKey = getFulfillmentStatus(order);
    const fulfillmentColor = getFulfillmentStatusColor(fulfillmentKey);

    return `
      <tr class="${order.id === activeOrderId ? 'active' : ''}" data-order-id="${order.id}">
        <td>${new Date(order.createdAt).toLocaleDateString('fr-FR')}</td>
        <td>
          <strong>${escapeHtml(order.customerName || client?.name || 'Client')}</strong>
          <div class="muted">${escapeHtml(order.customerEmail || client?.email || '-')}</div>
        </td>
        <td>${formatPrice(getOrderAmount(order))}</td>
        <td>${renderBadge(getPaymentStatusText(order.status), paymentColor)}</td>
        <td>${renderBadge(getFulfillmentStatusText(fulfillmentKey), fulfillmentColor)}</td>
        <td><span class="muted">${escapeHtml(order.uniqueCode || '-')}</span></td>
        <td>
          <div class="row-actions">
            <button class="pill-btn quick-status-btn" data-order-id="${order.id}" data-next-status="shipped" type="button">Expédié</button>
            <button class="pill-btn quick-status-btn" data-order-id="${order.id}" data-next-status="in_delivery" type="button">En cours de livraison</button>
            <button class="pill-btn quick-status-btn" data-order-id="${order.id}" data-next-status="delivered" type="button">Livré</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  elements.ordersTableBody.querySelectorAll('tr[data-order-id]').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('.quick-status-btn')) {
        return;
      }
      state.activeOrderId = row.dataset.orderId;
      renderOrderDetail();
      renderOrdersTable();
    });
  });

  elements.ordersTableBody.querySelectorAll('.quick-status-btn').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const order = state.orders.find((entry) => entry.id === button.dataset.orderId);
      if (!order) return;
      await updateFulfillmentStatus(order, button.dataset.nextStatus);
    });
  });
}

function renderStepper(order) {
  const currentStatus = getFulfillmentStatus(order);
  const currentIndex = Math.max(FULFILLMENT_STEPS.findIndex((step) => step.key === currentStatus), 0);
  const stepColor = getFulfillmentStatusColor(currentStatus);

  return `
    <div class="stepper">
      ${FULFILLMENT_STEPS.map((step, index) => {
        const active = index <= currentIndex;
        const current = index === currentIndex;
        return `
          <div class="step ${active ? 'active' : ''} ${current ? 'current' : ''}" style="--step-color:${stepColor}">
            <div class="step-line" style="${index === 0 ? 'opacity:0;' : ''}"></div>
            <div class="step-dot"></div>
            <span class="step-label">${step.label}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderItems(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length === 0) {
    return '<div class="muted">Aucun produit detaille dans cette commande.</div>';
  }

  return `
    <div class="items-list">
      ${items.map((item) => `
        <article class="item-card">
          <img src="${escapeHtml(item?.image || '')}" alt="${escapeHtml(item?.name || 'Produit')}" onerror="this.style.visibility='hidden'">
          <div>
            <div><strong style="color:var(--text);font-size:0.95rem;">${escapeHtml(item?.name || 'Produit')}</strong></div>
            <div class="muted">Qte: ${Number(item?.quantity) || 1} · PU: ${formatPrice(item?.price || 0)}</div>
            <div class="muted">${escapeHtml(item?.sku || item?.productId || '')}</div>
          </div>
        </article>
      `).join('')}
    </div>
  `;
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

function inferFileKind(fileName = '', url = '') {
  const target = `${fileName} ${url}`.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/.test(target)) return 'image';
  if (/\.pdf(\?|$)/.test(target)) return 'pdf';
  return 'file';
}

function buildPrintableAssets(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items
    .map((item, index) => {
      const fileUrl = getSelectedOptionValue(item, ['URL fichier', 'Url fichier', 'Lien fichier']);
      if (!fileUrl) return null;

      const fileName = getSelectedOptionValue(item, ['Fichier', 'Nom du fichier']) || `fichier-impression-${index + 1}`;
      const storagePath = getSelectedOptionValue(item, ['Chemin storage', 'Storage path']);
      const kind = inferFileKind(fileName, fileUrl);

      return {
        id: `${order.id}_${index}`,
        itemName: item?.name || `Fichier ${index + 1}`,
        fileName,
        fileUrl,
        storagePath,
        kind
      };
    })
    .filter(Boolean);
}

function triggerDirectAssetDownload(url, fileName) {
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'telechargement';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return 'direct';
  } catch (error) {
    console.warn('Lien de telechargement direct indisponible, ouverture du fichier.', error);
  }

  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) {
    throw new Error('Impossible de lancer le telechargement. Ouvre le fichier manuellement.');
  }

  return 'open';
}

async function downloadOrderAsset(url, fileName) {
  if (!url) {
    throw new Error('Fichier introuvable pour cette commande.');
  }

  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
      throw new Error('Impossible de telecharger ce fichier.');
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName || 'telechargement';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return 'blob';
  } catch (error) {
    console.warn('Telechargement blob impossible, ouverture directe du fichier.', error);
  }

  return triggerDirectAssetDownload(url, fileName);
}

function renderPrintingFiles(order) {
  const assets = buildPrintableAssets(order);
  if (!assets.length) {
    return '';
  }

  return `
    <div class="detail-section">
      <strong>Fichiers d'impression</strong>
      <div style="display:grid;gap:0.85rem;margin-top:0.8rem;">
        ${assets.map((asset) => `
          <article style="display:grid;grid-template-columns:1fr auto;gap:0.85rem;align-items:center;padding:0.95rem 1rem;border-radius:18px;border:1px solid var(--border);background:#fff;">
            <div style="min-width:0;">
              <div style="display:flex;align-items:center;gap:0.55rem;flex-wrap:wrap;">
                <strong style="margin:0;color:var(--text);font-size:0.95rem;">${escapeHtml(asset.itemName)}</strong>
                ${renderBadge(asset.kind === 'pdf' ? 'PDF' : asset.kind === 'image' ? 'Image' : 'Fichier', '#2563eb')}
              </div>
              <div class="muted" style="margin-top:0.3rem;word-break:break-word;">${escapeHtml(asset.fileName)}</div>
              ${asset.storagePath ? `<div class="muted" style="font-size:0.78rem;margin-top:0.22rem;word-break:break-word;">${escapeHtml(asset.storagePath)}</div>` : ''}
            </div>
            <div style="display:flex;gap:0.55rem;flex-wrap:wrap;justify-content:flex-end;">
              <button class="btn btn-secondary order-file-download" type="button" data-file-url="${escapeHtml(asset.fileUrl)}" data-file-name="${escapeHtml(asset.fileName)}">
                <i class="fas fa-download"></i>
                Telecharger
              </button>
              <a class="btn btn-secondary" href="${escapeHtml(asset.fileUrl)}" target="_blank" rel="noopener noreferrer">
                <i class="fas fa-up-right-from-square"></i>
                Ouvrir
              </a>
            </div>
          </article>
        `).join('')}
      </div>
    </div>
  `;
}

function renderOrderDetail() {
  const order = state.orders.find((entry) => entry.id === state.activeOrderId);
  if (!order) {
    elements.orderDetailRoot.innerHTML = 'Selectionne une commande pour voir les details, le panier et mettre a jour le suivi client.';
    return;
  }

  const client = getClientById(order.clientId);
  const paymentColor = getPaymentStatusColor(order.status);
  const fulfillmentKey = getFulfillmentStatus(order);
  const fulfillmentColor = getFulfillmentStatusColor(fulfillmentKey);

  elements.orderDetailRoot.innerHTML = `
    <div>
      <div class="detail-grid">
        <div>
          <strong>Client</strong>
          <div>${escapeHtml(order.customerName || client?.name || 'Client')}</div>
        </div>
        <div>
          <strong>Email</strong>
          <div>${escapeHtml(order.customerEmail || client?.email || '-')}</div>
        </div>
        <div>
          <strong>Telephone</strong>
          <div>${escapeHtml(order.customerPhone || client?.phone || '-')}</div>
        </div>
        <div>
          <strong>Montant</strong>
          <div>${formatPrice(getOrderAmount(order))}</div>
        </div>
      </div>

      <div class="detail-section">
        <strong>Adresse</strong>
        <div>${escapeHtml(order.customerAddress || client?.address || '-')}</div>
      </div>

      <div class="detail-section">
        <strong>Etat commande</strong>
        <div style="display:flex;gap:0.6rem;flex-wrap:wrap;margin-top:0.55rem;">
          ${renderBadge(getPaymentStatusText(order.status), paymentColor)}
          ${renderBadge(getFulfillmentStatusText(fulfillmentKey), fulfillmentColor)}
        </div>
        ${renderStepper(order)}
      </div>

      <div class="detail-section">
        <strong>Mettre a jour le suivi client</strong>
        <div style="display:grid;grid-template-columns:1fr auto;gap:0.65rem;margin-top:0.75rem;">
          <select class="select" id="detailFulfillmentSelect">
            ${FULFILLMENT_STEPS.map((step) => `
              <option value="${step.key}" ${step.key === fulfillmentKey ? 'selected' : ''}>${step.label}</option>
            `).join('')}
          </select>
          <button class="btn btn-primary" id="detailFulfillmentSave" type="button">
            <i class="fas fa-truck"></i>
            Enregistrer
          </button>
        </div>
        <div class="muted" style="margin-top:0.55rem;">
          Derniere mise a jour: ${order.fulfillmentUpdatedAt ? new Date(order.fulfillmentUpdatedAt).toLocaleString('fr-FR') : 'Non definie'}
        </div>
      </div>

      <div class="detail-section">
        <strong>Note logistique interne</strong>
        <div style="display:grid;gap:0.65rem;margin-top:0.75rem;">
          <textarea class="select" id="detailLogisticsNote" rows="4" style="min-height:120px;resize:vertical;">${escapeHtml(order.logisticsNote || '')}</textarea>
          <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:center;flex-wrap:wrap;">
            <div class="muted">Visible seulement dans le back-office commandes.</div>
            <button class="btn btn-secondary" id="detailLogisticsSave" type="button">
              <i class="fas fa-note-sticky"></i>
              Enregistrer la note
            </button>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <strong>Produits</strong>
        <div style="margin-top:0.8rem;">
          ${renderItems(order)}
        </div>
      </div>

      ${renderPrintingFiles(order)}

      <div class="detail-section">
        <strong>Infos internes</strong>
        <div class="detail-grid" style="margin-top:0.75rem;">
          <div>
            <strong>Code unique</strong>
            <div>${escapeHtml(order.uniqueCode || '-')}</div>
          </div>
          <div>
            <strong>Methode paiement</strong>
            <div>${escapeHtml(order.methodName || '-')}</div>
          </div>
          <div>
            <strong>Soumise le</strong>
            <div>${order.createdAt ? new Date(order.createdAt).toLocaleString('fr-FR') : '-'}</div>
          </div>
          <div>
            <strong>Ville</strong>
            <div>${escapeHtml(order.customerCity || client?.city || '-')}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const saveButton = document.getElementById('detailFulfillmentSave');
  const select = document.getElementById('detailFulfillmentSelect');
  const noteField = document.getElementById('detailLogisticsNote');
  const saveNoteButton = document.getElementById('detailLogisticsSave');
  saveButton?.addEventListener('click', async () => {
    if (!select) return;
    await updateFulfillmentStatus(order, select.value);
  });
  saveNoteButton?.addEventListener('click', async () => {
    await saveLogisticsNote(order, noteField?.value || '');
  });
  elements.orderDetailRoot.querySelectorAll('.order-file-download').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          button.disabled = true;
          const originalHtml = button.innerHTML;
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Telechargement...';
          const result = await downloadOrderAsset(button.dataset.fileUrl || '', button.dataset.fileName || '');
          showToast(result === 'open' ? 'Fichier ouvert dans un nouvel onglet.' : 'Fichier telecharge.');
          button.innerHTML = originalHtml;
        } catch (error) {
          console.error('Erreur telechargement fichier commande:', error);
          showToast(error.message || 'Impossible de telecharger ce fichier.', 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function updateFulfillmentStatus(order, nextStatus) {
  try {
    const orderRef = doc(db, CLIENTS_COLLECTION, order.clientId, 'orders', order.id);
    await updateDoc(orderRef, {
      fulfillmentStatus: nextStatus,
      fulfillmentUpdatedAt: new Date().toISOString()
    });

     const client = getClientById(order.clientId);
     const targetUid = client?.uid || order?.clientUid || null;
     if (targetUid) {
       await sendBroadcastNotification({
         type: 'order_tracking',
         title: 'Suivi de commande mis a jour',
         body: `Votre commande ${order?.uniqueCode || order.id} est maintenant: ${getFulfillmentStatusText(nextStatus)}.`,
         target: 'user',
         targetUid,
         url: './index.html',
         createdBy: 'dashboard_orders'
       });
     }

    showToast(`Suivi client mis a jour: ${getFulfillmentStatusText(nextStatus)}`);
  } catch (error) {
    console.error('Erreur mise a jour suivi commande:', error);
    showToast('Impossible de mettre a jour le suivi de cette commande.', 'error');
  }
}

async function saveLogisticsNote(order, logisticsNote) {
  try {
    const orderRef = doc(db, CLIENTS_COLLECTION, order.clientId, 'orders', order.id);
    await updateDoc(orderRef, {
      logisticsNote,
      logisticsUpdatedAt: new Date().toISOString()
    });
    showToast('Note logistique enregistree.');
  } catch (error) {
    console.error('Erreur sauvegarde note logistique:', error);
    showToast('Impossible d enregistrer la note.', 'error');
  }
}

function render() {
  elements.ordersLoadingState.hidden = state.orders.length > 0;
  renderStats();
  renderOrdersTable();
  renderOrderDetail();
}

function attachEvents() {
  [
    elements.searchInput,
    elements.paymentStatusFilter,
    elements.fulfillmentStatusFilter,
    elements.clientFilter
  ].forEach((entry) => {
    entry?.addEventListener('input', render);
    entry?.addEventListener('change', render);
  });

  elements.refreshOrdersBtn?.addEventListener('click', async () => {
    elements.ordersLoadingState.hidden = false;
    await loadOrders();
    render();
  });
}

async function init() {
  attachEvents();
  await loadClients();
  await loadOrders();
  setupRealtimeListeners();
  render();
}

init().catch((error) => {
  console.error('Erreur initialisation dashboard commandes:', error);
  elements.ordersLoadingState.hidden = true;
  elements.ordersEmptyState.hidden = false;
  elements.ordersEmptyState.textContent = 'Impossible de charger les commandes pour le moment.';
});
