import { db } from './firebase-init.js';
import {
  collection,
  getDocs,
  orderBy,
  query
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const CONFIRMED_ORDER_STATUSES = new Set(['approved', 'paid']);
const PRO_VENDOR_COMMISSION_RATE = 10;
const ORDER_STATUS_BUCKETS = [
  { key: 'confirmed', label: 'Confirmees', color: '#0f9f6e' },
  { key: 'pending', label: 'En attente', color: '#d97706' },
  { key: 'review', label: 'En examen', color: '#2563eb' },
  { key: 'rejected', label: 'Rejetees', color: '#dc2626' },
  { key: 'expired', label: 'Expirees', color: '#64748b' }
];

function normalizeRate(rule) {
  const direct = Number(rule?.categoryRate ?? rule?.rate);
  return Number.isFinite(direct) ? Math.max(0, direct) : null;
}

function getOrderMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPaymentState(order = {}) {
  return String(order?.paymentStatus || order?.status || '').trim().toLowerCase();
}

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeCategoryKey(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-');
}

function resolveCommissionRate(item = {}, commissionRules = [], productRules = new Map()) {
  const storedRate = Number(item?.commissionSnapshot?.rate ?? item?.commissionRate);
  if (Number.isFinite(storedRate)) return Math.max(0, storedRate);

  const directRate = normalizeRate(item?.commissionRule);
  if (directRate !== null) return directRate;

  const productData = productRules.get(String(item?.productId || '').trim()) || {};
  const productRate = normalizeRate(productData?.commissionRule);
  if (productRate !== null) return productRate;

  const values = [
    item?.category,
    item?.categoryName,
    item?.categoryId,
    productData?.category,
    productData?.categoryName,
    productData?.categoryId
  ];
  const matchedRule = commissionRules.find((rule) => values.some((value) => (
    normalizeCategoryKey(value) && normalizeCategoryKey(value) === normalizeCategoryKey(rule?.category || rule?.categoryId)
  )));
  return normalizeRate(matchedRule) ?? 0;
}

function getOrderDeliveryDetails(order = {}) {
  const delivery = order?.delivery || {};
  const productDetails = Array.isArray(delivery.productDeliveryDetails)
    ? delivery.productDeliveryDetails
    : [];
  const vendorDetails = Array.isArray(delivery.vendorDeliveryDetails)
    ? delivery.vendorDeliveryDetails
    : [];
  const details = productDetails.length ? productDetails : vendorDetails;
  return details.map((entry) => ({
    ownerType: normalizeText(entry?.ownerType),
    vendorId: String(entry?.vendorId || '').trim(),
    productId: String(entry?.productId || '').trim(),
    productName: String(entry?.productName || '').trim(),
    quantity: Number(entry?.quantity) || 1,
    fee: Number(entry?.fee) || 0,
    unitFee: Number(entry?.unitFee) || 0
  }));
}

function getOrderVendorDeliveryFee(order = {}, details = getOrderDeliveryDetails(order)) {
  const delivery = order?.delivery || {};
  const detailedFee = details
    .filter((entry) => !entry.ownerType || entry.ownerType === 'vendor')
    .reduce((sum, entry) => {
      const fee = Number(entry.fee) || 0;
      return sum + (fee > 0 ? fee : (Number(entry.unitFee) || 0) * (Number(entry.quantity) || 1));
    }, 0);
  if (detailedFee > 0) return detailedFee;

  const storedFee = Number(delivery.vendorDeliveryFee ?? delivery.vendorDeliveryAmount);
  return Number.isFinite(storedFee) && storedFee > 0 ? storedFee : 0;
}

function getLineDeliveryFee(item = {}, order = {}) {
  const quantity = Math.max(1, Number(item?.quantity) || 1);
  const explicitFee = Number(
    item?.deliveryFee ??
    item?.deliveryAmount ??
    item?.shippingFee ??
    item?.delivery?.fee
  );
  if (Number.isFinite(explicitFee) && explicitFee > 0) return explicitFee;

  const details = getOrderDeliveryDetails(order);
  if (!details.length) return 0;

  const productId = String(item?.productId || '').trim();
  const vendorId = String(item?.vendorId || '').trim();
  const itemName = normalizeText(item?.name);
  const matched = details.find((entry) => {
    if (entry.ownerType && entry.ownerType !== 'vendor') return false;
    if (productId && entry.productId && entry.productId === productId) return true;
    return Boolean(vendorId && entry.vendorId && entry.vendorId === vendorId && itemName && normalizeText(entry.productName) === itemName);
  });
  if (!matched) return 0;

  const totalFee = Number(matched.fee) || 0;
  return totalFee > 0 ? totalFee : (Number(matched.unitFee) || 0) * quantity;
}

export function isConfirmedOrder(order = {}) {
  return CONFIRMED_ORDER_STATUSES.has(getPaymentState(order));
}

function getOrderGrossAmount(order = {}) {
  if (Number.isFinite(Number(order?.amount))) {
    return Number(order.amount) || 0;
  }

  return normalizeItems(order).reduce((sum, item) => {
    return sum + ((Number(item.price) || 0) * (Number(item.quantity) || 1));
  }, 0);
}

function normalizeItems(order) {
  const source = Array.isArray(order?.items)
    ? order.items
    : Array.isArray(order?.cart)
      ? order.cart
      : Array.isArray(order?.products)
        ? order.products
        : [];

  return source.map((item) => ({
    productId: item?.productId || item?.id || '',
    name: item?.name || 'Produit',
    price: Number(item?.price ?? item?.unitPrice ?? item?.amount) || 0,
    quantity: Number(item?.quantity ?? item?.qty ?? item?.qte) || 1,
    vendorId: item?.vendorId || '',
    vendorName: item?.vendorName || '',
    commissionRule: item?.commissionRule || null,
    commissionRate: Number.isFinite(Number(item?.commissionRate)) ? Number(item.commissionRate) : null,
    commissionSnapshot: item?.commissionSnapshot && typeof item.commissionSnapshot === 'object'
      ? {
          rate: Number.isFinite(Number(item.commissionSnapshot.rate)) ? Number(item.commissionSnapshot.rate) : null,
          source: String(item.commissionSnapshot.source || '').trim(),
          appliedAt: String(item.commissionSnapshot.appliedAt || '').trim()
        }
      : null,
    category: item?.category || '',
    categoryName: item?.categoryName || '',
    categoryId: item?.categoryId || '',
    deliveryFee: Number(item?.deliveryFee ?? item?.deliveryAmount ?? item?.shippingFee ?? item?.delivery?.fee) || 0,
    deliveryMode: item?.deliveryMode || '',
    selectedOptions: Array.isArray(item?.selectedOptions) ? item.selectedOptions : []
  }));
}

export async function loadAllOrdersWithClients() {
  const clientsSnapshot = await getDocs(collection(db, 'clients'));
  const clients = clientsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const allOrders = [];

  await Promise.all(clients.map(async (client) => {
    try {
      const ordersRef = collection(db, 'clients', client.id, 'orders');
      const snapshot = await getDocs(query(ordersRef, orderBy('createdAt', 'desc')));
      snapshot.docs.forEach((entry) => {
        allOrders.push({
          id: entry.id,
          clientId: client.id,
          refPath: entry.ref.path,
          clientName: client.name || '',
          clientEmail: client.email || '',
          ...entry.data()
        });
      });
    } catch (error) {
      console.error(`Erreur chargement commandes vendeur pour ${client.id}:`, error);
    }
  }));

  return {
    clients,
    orders: allOrders.sort((a, b) => getOrderMs(b.createdAt) - getOrderMs(a.createdAt))
  };
}

export function buildSalesTimeline(orders = [], { days = 7, amountResolver = getOrderGrossAmount, filter = () => true } = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - index - 1));
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      label: date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
      amount: 0,
      orders: 0
    };
  });

  const bucketMap = new Map(buckets.map((entry) => [entry.key, entry]));
  orders.forEach((order) => {
    if (!filter(order)) return;
    const orderDate = new Date(getOrderMs(order.createdAt));
    if (Number.isNaN(orderDate.getTime())) return;
    orderDate.setHours(0, 0, 0, 0);
    const key = orderDate.toISOString().slice(0, 10);
    const bucket = bucketMap.get(key);
    if (!bucket) return;
    bucket.amount += Number(amountResolver(order)) || 0;
    bucket.orders += 1;
  });

  return buckets;
}

export function buildPaymentStatusBreakdown(orders = []) {
  const counts = {
    confirmed: 0,
    pending: 0,
    review: 0,
    rejected: 0,
    expired: 0
  };

  orders.forEach((order) => {
    const status = getPaymentState(order);
    if (CONFIRMED_ORDER_STATUSES.has(status)) {
      counts.confirmed += 1;
      return;
    }
    if (status === 'review') {
      counts.review += 1;
      return;
    }
    if (status === 'rejected') {
      counts.rejected += 1;
      return;
    }
    if (status === 'expired') {
      counts.expired += 1;
      return;
    }
    counts.pending += 1;
  });

  const total = orders.length || 1;
  return ORDER_STATUS_BUCKETS.map((entry) => ({
    ...entry,
    value: counts[entry.key] || 0,
    ratio: (counts[entry.key] || 0) / total
  }));
}

export function buildTopSellingProducts(orders = [], { limit = 5, itemFilter = () => true } = {}) {
  const productMap = new Map();

  orders.forEach((order) => {
    if (!isConfirmedOrder(order)) return;

    normalizeItems(order).forEach((item) => {
      if (!itemFilter(item, order)) return;
      const key = item.productId || item.name || `product-${productMap.size + 1}`;
      const current = productMap.get(key) || {
        productId: item.productId || '',
        name: item.name || 'Produit',
        quantity: 0,
        amount: 0
      };
      const quantity = Number(item.quantity) || 1;
      const gross = (Number(item.price) || 0) * quantity;
      current.quantity += quantity;
      current.amount += gross;
      productMap.set(key, current);
    });
  });

  return Array.from(productMap.values())
    .sort((a, b) => (b.amount - a.amount) || (b.quantity - a.quantity))
    .slice(0, limit);
}

export function buildAdminSalesSummary({ orders = [] } = {}) {
  const confirmedOrders = orders.filter((order) => isConfirmedOrder(order));
  const confirmedRevenue = confirmedOrders.reduce((sum, order) => sum + getOrderGrossAmount(order), 0);
  const pendingOrders = orders.filter((order) => !isConfirmedOrder(order)).length;
  const clientsCount = new Set(
    confirmedOrders
      .map((order) => order.clientId || order.clientUid || '')
      .filter(Boolean)
  ).size;

  return {
    confirmedRevenue,
    confirmedOrders: confirmedOrders.length,
    pendingOrders,
    averageTicket: confirmedOrders.length ? confirmedRevenue / confirmedOrders.length : 0,
    activeClients: clientsCount,
    timeline: buildSalesTimeline(orders, {
      days: 7,
      amountResolver: getOrderGrossAmount,
      filter: (order) => isConfirmedOrder(order)
    }),
    statusBreakdown: buildPaymentStatusBreakdown(orders),
    topProducts: buildTopSellingProducts(orders, { limit: 6 })
  };
}

export function buildVendorSalesSummary({
  vendorId,
  vendorName = '',
  orders = [],
  vendorProductIds = new Set(),
  payouts = [],
  vendorPlanActive = false,
  commissionRules = [],
  vendorProducts = []
}) {
  const orderMap = new Map();
  let grossAmount = 0;
  let deliveryAmount = 0;
  let commissionAmount = 0;
  let vendorNetAmount = 0;
  let itemCount = 0;
  const confirmedVendorOrders = [];
  const productMap = new Map();
  const settledOrderRefs = new Set();
  let settledNetAmount = 0;

  payouts.forEach((payout) => {
    settledNetAmount += Number(payout?.netAmount) || 0;
    const refs = Array.isArray(payout?.coveredOrderRefs) ? payout.coveredOrderRefs : [];
    refs.forEach((refPath) => {
      const normalized = String(refPath || '').trim();
      if (normalized) settledOrderRefs.add(normalized);
    });
  });

  let pendingPayoutAmount = 0;
  const productRules = new Map(
    (Array.isArray(vendorProducts) ? vendorProducts : [])
      .map((product) => [String(product?.id || '').trim(), product || {}])
      .filter(([id]) => id)
  );

  orders.forEach((order) => {
    if (!isConfirmedOrder(order)) return;
    const matchingLines = normalizeItems(order).filter((item) => {
      if (item.vendorId && item.vendorId === vendorId) return true;
      return item.productId && vendorProductIds.has(item.productId);
    });

    if (matchingLines.length === 0) return;

    const deliveryDetails = getOrderDeliveryDetails(order);
    const storedVendorDeliveryFee = getOrderVendorDeliveryFee(order, deliveryDetails);
    const normalizedLines = matchingLines.map((item) => {
      const gross = (Number(item.price) || 0) * (Number(item.quantity) || 1);
      const deliveryFee = getLineDeliveryFee(item, order);
      // A sale keeps the rate that was active when it was paid. Never
      // recalculate historical orders from the vendor's current plan.
      const snapshotRate = Number(item?.commissionSnapshot?.rate ?? item?.commissionRate);
      const rate = resolveCommissionRate(item, commissionRules, productRules);
      const commission = gross * (rate / 100);
      const net = (gross - commission) + deliveryFee;
      grossAmount += gross;
      deliveryAmount += deliveryFee;
      commissionAmount += commission;
      vendorNetAmount += net;
      itemCount += Number(item.quantity) || 1;
      return {
        ...item,
        grossAmount: gross,
        deliveryFee,
        commissionAmount: commission,
        vendorNetAmount: net,
        commissionRate: rate
      };
    });

    // Older orders can store one vendor-level delivery amount instead of one
    // fee per product. Allocate the remaining amount without changing base commission.
    const knownDeliveryFee = normalizedLines.reduce((sum, item) => sum + Math.max(0, item.deliveryFee), 0);
    const unresolvedLines = normalizedLines.filter((item) => item.deliveryFee <= 0);
    const remainingDeliveryFee = Math.max(0, storedVendorDeliveryFee - knownDeliveryFee);
    const unresolvedGross = unresolvedLines.reduce((sum, item) => sum + Math.max(0, item.grossAmount), 0);
    if (remainingDeliveryFee > 0 && unresolvedLines.length) {
      normalizedLines.forEach((item) => {
        if (item.deliveryFee > 0) return;
        const share = unresolvedGross > 0
          ? remainingDeliveryFee * (Math.max(0, item.grossAmount) / unresolvedGross)
          : remainingDeliveryFee / unresolvedLines.length;
        item.deliveryFee = share;
        item.vendorNetAmount += share;
      });
      deliveryAmount += remainingDeliveryFee;
      vendorNetAmount += remainingDeliveryFee;
    }

    normalizedLines.forEach((item) => {
      const key = item.productId || item.name || `product-${productMap.size + 1}`;
      const current = productMap.get(key) || {
        productId: item.productId || '',
        name: item.name || 'Produit',
        quantity: 0,
        amount: 0
      };
      current.quantity += Number(item.quantity) || 1;
      current.amount += item.grossAmount || 0;
      productMap.set(key, current);
    });

    orderMap.set(order.id, {
      id: order.id,
      clientId: order.clientId,
      clientName: order.customerName || order.clientName || 'Client',
      clientEmail: order.customerEmail || order.clientEmail || '',
      uniqueCode: order.uniqueCode || order.id,
      createdAt: order.createdAt || '',
      status: order.status || 'pending',
      fulfillmentStatus: order.fulfillmentStatus || 'ordered',
      grossAmount: normalizedLines.reduce((sum, item) => sum + item.grossAmount, 0),
      deliveryAmount: normalizedLines.reduce((sum, item) => sum + item.deliveryFee, 0),
      commissionAmount: normalizedLines.reduce((sum, item) => sum + item.commissionAmount, 0),
      vendorNetAmount: normalizedLines.reduce((sum, item) => sum + item.vendorNetAmount, 0),
      items: normalizedLines
    });

    confirmedVendorOrders.push({
      ...order,
      amount: normalizedLines.reduce((sum, item) => sum + item.grossAmount, 0)
    });

    const refPath = String(order?.refPath || '').trim();
    if (!refPath || !settledOrderRefs.has(refPath)) {
      pendingPayoutAmount += normalizedLines.reduce((sum, item) => sum + item.vendorNetAmount, 0);
    }
  });

  const recentOrders = Array.from(orderMap.values())
    .sort((a, b) => getOrderMs(b.createdAt) - getOrderMs(a.createdAt))
    .slice(0, 8);

  return {
    vendorId,
    vendorName,
    totalOrders: orderMap.size,
    paidOrders: orderMap.size,
    grossAmount,
    deliveryAmount,
    commissionAmount,
    vendorNetAmount,
    settledNetAmount,
    pendingPayoutAmount,
    averageTicket: orderMap.size ? grossAmount / orderMap.size : 0,
    itemCount,
    recentOrders,
    timeline: buildSalesTimeline(confirmedVendorOrders, {
      days: 7,
      amountResolver: (order) => Number(order.amount) || 0,
      filter: () => true
    }),
    topProducts: Array.from(productMap.values())
      .sort((a, b) => (b.amount - a.amount) || (b.quantity - a.quantity))
      .slice(0, 5)
  };
}
