const STORAGE_KEY = "smartcut.proforma.v1";

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

const defaults = {
  company: {
    logo: "../logo.png",
    name: "Smart Cut Services",
    slogan: "Solutions professionnelles, rapides et propres",
    address: "Delmas\nOuest, Haiti 6120",
    taxId: "",
    email: "print@smartcutservices.com",
    phone: "+509 34 91 3988",
    website: "https://www.smartcutservices.com",
    terms: "Merci pour votre confiance. Cette proforma est valide selon la date indiquee."
  },
  taxes: [
    { id: "none", name: "Aucun", rate: 0, mode: "excluded" },
    { id: "tca-2", name: "TCA 2%", rate: 2, mode: "excluded" },
    { id: "tva-10", name: "TVA 10%", rate: 10, mode: "excluded" }
  ],
  products: [
    {
      id: crypto.randomUUID(),
      name: "Impression document",
      description: "Impression haute qualite",
      sku: "PRINT-DOC",
      usd: 0.25,
      htg: 33,
      unit: "page",
      taxId: "none",
      discount: 0
    },
    {
      id: crypto.randomUUID(),
      name: "Conception graphique",
      description: "Creation visuelle professionnelle",
      sku: "DESIGN",
      usd: 25,
      htg: 3300,
      unit: "service",
      taxId: "tca-2",
      discount: 0
    }
  ],
  clients: [],
  proformas: [],
  invoices: [],
  settings: {
    sequence: 1,
    invoiceSequence: 1,
    exchangeRate: 132,
    dark: false
  }
};

const state = loadState();
let currentProformaId = null;
let currentInvoiceId = null;
let currentDocumentType = "proforma";

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return mergeState(defaults, saved || {});
  } catch {
    return structuredClone(defaults);
  }
}

function mergeState(base, saved) {
  return {
    company: { ...base.company, ...(saved.company || {}) },
    taxes: saved.taxes?.length ? saved.taxes : base.taxes,
    products: saved.products?.length ? saved.products : base.products,
    clients: saved.clients || [],
    proformas: saved.proformas || [],
    invoices: saved.invoices || [],
    settings: { ...base.settings, ...(saved.settings || {}) }
  };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function money(value, currency = getCurrency()) {
  if (currency === "HTG") {
    return `${numberFr(value)} G`;
  }
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function numberFr(value) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatDate(dateISO) {
  if (!dateISO) return "";
  const [year, month, day] = dateISO.split("-");
  return `${day}/${month}/${year}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateISO, days) {
  const date = new Date(`${dateISO}T00:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function getCurrency() {
  return qs("#currency").value || "USD";
}

function selectedTax(id) {
  return state.taxes.find((tax) => tax.id === id) || state.taxes[0];
}

function nextProformaNumber() {
  return `PF-${new Date().getFullYear()}-${String(state.settings.sequence).padStart(5, "0")}`;
}

function nextInvoiceNumber() {
  return `FAC-${new Date().getFullYear()}-${String(state.settings.invoiceSequence || 1).padStart(5, "0")}`;
}

function documentLabel() {
  return currentDocumentType === "invoice" ? "FACTURE" : "PROFORMA";
}

function sanitizeFilePart(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDocumentFileNumber(number, label = documentLabel()) {
  const raw = String(number || "");
  const match = raw.match(/(\d+)\s*$/);
  if (!match) return sanitizeFilePart(raw) || `${label} 0001`;
  return `${label} ${match[1].slice(-4).padStart(4, "0")}`;
}

function buildPdfTitle() {
  const clientName = sanitizeFilePart(qs("#clientName").value || "CLIENT");
  const clientCompany = sanitizeFilePart(qs("#clientCompany").value);
  const fallbackNumber = currentDocumentType === "invoice" ? nextInvoiceNumber() : nextProformaNumber();
  const documentNumber = formatDocumentFileNumber(qs("#proformaNumber").value || fallbackNumber);
  return [clientName, clientCompany, documentNumber].filter(Boolean).join(" - ");
}

function printProforma() {
  const previousTitle = document.title;
  const restoreTitle = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restoreTitle);
  };

  document.title = buildPdfTitle();
  window.addEventListener("afterprint", restoreTitle, { once: true });
  window.print();
  window.setTimeout(() => {
    if (document.title !== previousTitle) restoreTitle();
  }, 30000);
}

function openPreparedEmail(item) {
  const subject = encodeURIComponent(`${buildPdfTitle()} - ${state.company.name}`);
  const documentName = currentDocumentType === "invoice" ? "facture" : "proforma";
  const body = encodeURIComponent(
    `Bonjour,\n\nVeuillez trouver en piece jointe la ${documentName} ${item.number} d'un montant de ${money(item.total, item.currency)}.\n\nCordialement,\n${state.company.name}`
  );
  window.location.href = `mailto:${item.clientEmail || ""}?subject=${subject}&body=${body}`;
}

function printThenEmailProforma(item) {
  const previousTitle = document.title;
  let emailOpened = false;
  const openEmailOnce = () => {
    if (emailOpened) return;
    emailOpened = true;
    document.title = previousTitle;
    window.removeEventListener("afterprint", openEmailOnce);
    openPreparedEmail(item);
  };

  document.title = buildPdfTitle();
  window.addEventListener("afterprint", openEmailOnce, { once: true });
  window.print();
  window.setTimeout(openEmailOnce, 30000);
}

function init() {
  document.body.classList.toggle("dark", Boolean(state.settings.dark));
  bindNavigation();
  bindBuilder();
  bindCompany();
  bindClients();
  bindCatalog();
  bindTaxes();
  bindRecords();
  bindUtilities();
  fillCompanyForm();
  refreshAll();
  newProforma();
  window.addEventListener("resize", fitPreview);
}

function bindNavigation() {
  qsa(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa(".nav-btn").forEach((item) => item.classList.remove("active"));
      qsa(".tab-panel").forEach((panel) => panel.classList.remove("active"));
      btn.classList.add("active");
      qs(`#${btn.dataset.tab}`).classList.add("active");
      qs("#pageTitle").textContent = btn.textContent.trim();
      if (btn.dataset.tab === "reports") renderReports();
      if (btn.dataset.tab === "invoices") renderInvoices();
    });
  });
}

function bindBuilder() {
  [
    "#clientName", "#clientCompany", "#clientEmail", "#clientAddress", "#clientPicker", "#proformaDate", "#validityDays",
    "#currency", "#exchangeRate", "#showDualCurrency", "#shipping", "#globalDiscount",
    "#paymentTerms", "#incoterms", "#hsCode", "#notes"
  ].forEach((selector) => {
    qs(selector).addEventListener("input", () => {
      state.settings.exchangeRate = Number(qs("#exchangeRate").value || state.settings.exchangeRate);
      persist();
      recalcLines();
      renderPreview();
    });
  });

  qs("#addProductBtn").addEventListener("click", () => {
    const product = state.products.find((item) => item.id === qs("#productPicker").value);
    if (product) addLineFromProduct(product);
  });
  qs("#addCustomLineBtn").addEventListener("click", () => addLine());
  qs("#saveProformaBtn").addEventListener("click", saveCurrentDocument);
  qs("#newProformaBtn").addEventListener("click", newProforma);
  qs("#printBtn").addEventListener("click", printProforma);
}

function bindCompany() {
  qs("#saveCompanyBtn").addEventListener("click", () => {
    state.company = {
      ...state.company,
      name: qs("#companyName").value,
      slogan: qs("#companySlogan").value,
      address: qs("#companyAddress").value,
      taxId: qs("#companyTaxId").value,
      email: qs("#companyEmail").value,
      phone: qs("#companyPhone").value,
      website: qs("#companyWebsite").value,
      terms: qs("#companyTerms").value
    };
    qs("#notes").value ||= state.company.terms;
    persist();
    renderPreview();
    toast("Template konpayi an sove.");
  });

  qs("#companyLogo").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state.company.logo = await fileToDataUrl(file);
    persist();
    renderPreview();
  });
}

function bindCatalog() {
  qs("#saveProductBtn").addEventListener("click", saveProduct);
  qs("#clearProductBtn").addEventListener("click", clearProductForm);
  qs("#addProductFormBtn").addEventListener("click", clearProductForm);
  qs("#productSearch").addEventListener("input", renderProducts);
  qs("#csvInput").addEventListener("change", importCsv);
}

function bindClients() {
  qs("#saveClientBtn").addEventListener("click", saveClient);
  qs("#clearClientBtn").addEventListener("click", clearClientForm);
  qs("#clientSearch").addEventListener("input", renderClients);
  qs("#clientPicker").addEventListener("change", () => applyClientToProforma(qs("#clientPicker").value));
}

function bindTaxes() {
  qs("#addTaxBtn").addEventListener("click", () => {
    state.taxes.push({
      id: crypto.randomUUID(),
      name: "Nouvo taks",
      rate: 0,
      mode: "excluded"
    });
    persist();
    refreshAll();
  });
}

function bindRecords() {
  qs("#recordSearch").addEventListener("input", renderRecords);
  qs("#invoiceSearch").addEventListener("input", renderInvoices);
}

function bindUtilities() {
  qs("#themeToggle").addEventListener("click", () => {
    state.settings.dark = !state.settings.dark;
    document.body.classList.toggle("dark", state.settings.dark);
    persist();
  });

  qs("#backupBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `smartcut-proforma-backup-${todayISO()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  qs("#restoreInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const restored = JSON.parse(await file.text());
    Object.assign(state, mergeState(defaults, restored));
    persist();
    fillCompanyForm();
    refreshAll();
    newProforma();
    toast("Backup restore.");
  });
}

function fillCompanyForm() {
  qs("#companyName").value = state.company.name;
  qs("#companySlogan").value = state.company.slogan;
  qs("#companyAddress").value = state.company.address;
  qs("#companyTaxId").value = state.company.taxId;
  qs("#companyEmail").value = state.company.email;
  qs("#companyPhone").value = state.company.phone;
  qs("#companyWebsite").value = state.company.website;
  qs("#companyTerms").value = state.company.terms;
}

function refreshAll() {
  renderClientPicker();
  renderClients();
  renderProductPicker();
  renderTaxSelects();
  renderProducts();
  renderTaxes();
  renderRecords();
  renderInvoices();
  renderReports();
}

function newProforma() {
  currentProformaId = null;
  currentInvoiceId = null;
  currentDocumentType = "proforma";
  qs("#statusPill").textContent = "Draft";
  qs("#clientPicker").value = "";
  qs("#clientName").value = "";
  qs("#clientCompany").value = "";
  qs("#clientEmail").value = "";
  qs("#clientAddress").value = "";
  qs("#proformaDate").value = todayISO();
  qs("#validityDays").value = "30";
  qs("#currency").value = "USD";
  qs("#exchangeRate").value = state.settings.exchangeRate;
  qs("#showDualCurrency").checked = true;
  qs("#shipping").value = 0;
  qs("#globalDiscount").value = 0;
  qs("#paymentTerms").value = "";
  qs("#incoterms").value = "";
  qs("#hsCode").value = "";
  qs("#notes").value = state.company.terms;
  qs("#proformaNumber").value = nextProformaNumber();
  qs("#lineItems").innerHTML = "";
  addLine();
  renderPreview();
}

function addLine(data = {}) {
  const row = qs("#lineItemTemplate").content.firstElementChild.cloneNode(true);
  const taxSelect = qs(".line-tax", row);
  state.taxes.forEach((tax) => taxSelect.add(new Option(`${tax.name} (${tax.rate}%)`, tax.id)));
  qs(".line-name", row).value = data.name || "";
  qs(".line-description", row).value = data.description || "";
  qs(".line-reference", row).value = data.reference || "";
  qs(".line-qty", row).value = data.qty ?? 1;
  qs(".line-price", row).value = data.price ?? 0;
  qs(".line-tax", row).value = data.taxId || "none";
  qs(".remove-line", row).addEventListener("click", () => {
    const confirmed = window.confirm("Voulez-vous vraiment supprimer cette ligne de la proforma ?");
    if (!confirmed) return;
    row.remove();
    recalcLines();
    renderPreview();
  });
  qsa("input, textarea, select", row).forEach((field) => {
    field.addEventListener("input", () => {
      recalcLines();
      renderPreview();
    });
  });
  qs("#lineItems").appendChild(row);
  recalcLines();
  renderPreview();
}

function addLineFromProduct(product) {
  const currency = getCurrency();
  const price = currency === "HTG" ? product.htg : product.usd;
  addLine({
    name: product.name,
    description: product.description,
    reference: product.sku,
    qty: 1,
    price,
    taxId: product.taxId
  });
}

function getLines() {
  return qsa("#lineItems tr").map((row) => ({
    name: qs(".line-name", row).value,
    description: qs(".line-description", row).value,
    reference: qs(".line-reference", row)?.value || "",
    qty: Number(qs(".line-qty", row).value || 0),
    price: Number(qs(".line-price", row).value || 0),
    taxId: qs(".line-tax", row).value
  })).filter((line) => line.name || line.description || line.price);
}

function calculateTotals() {
  const lines = getLines();
  let subtotal = 0;
  let taxTotal = 0;
  const calculatedLines = lines.map((line) => {
    const tax = selectedTax(line.taxId);
    const gross = line.qty * line.price;
    let base = gross;
    let taxAmount = 0;
    if (tax.rate > 0 && tax.mode === "included") {
      base = gross / (1 + tax.rate / 100);
      taxAmount = gross - base;
    } else if (tax.rate > 0) {
      taxAmount = gross * (tax.rate / 100);
    }
    subtotal += base;
    taxTotal += taxAmount;
    return { ...line, base, taxAmount, total: base + taxAmount };
  });
  const shipping = Number(qs("#shipping").value || 0);
  const discountPercent = Math.min(100, Math.max(0, Number(qs("#globalDiscount").value || 0)));
  const totalBeforeDiscount = subtotal + taxTotal + shipping;
  const discount = totalBeforeDiscount * (discountPercent / 100);
  const finalTotal = Math.max(0, totalBeforeDiscount - discount);
  return { lines: calculatedLines, subtotal, taxTotal, shipping, discount, discountPercent, finalTotal };
}

function recalcLines() {
  qsa("#lineItems tr").forEach((row) => {
    const qty = Number(qs(".line-qty", row).value || 0);
    const price = Number(qs(".line-price", row).value || 0);
    const tax = selectedTax(qs(".line-tax", row).value);
    const base = qty * price;
    const taxAmount = tax.mode === "included" ? 0 : base * (tax.rate / 100);
    qs(".line-total", row).textContent = money(base + taxAmount);
  });
}

function renderPreview() {
  const totals = calculateTotals();
  const currency = getCurrency();
  const previewTitle = currentDocumentType === "invoice" ? "FACTURE" : "DEVIS";
  const previewLabel = currentDocumentType === "invoice" ? "Facture" : "Devis";
  const date = qs("#proformaDate").value || todayISO();
  const validity = addDays(date, qs("#validityDays").value);
  const exchange = Number(qs("#exchangeRate").value || 1);
  const dual = qs("#showDualCurrency").checked;
  const htgValue = currency === "HTG" ? totals.finalTotal : totals.finalTotal * exchange;
  const usdValue = currency === "USD" ? totals.finalTotal : totals.finalTotal / exchange;
  const clientName = qs("#clientName").value || "Nom client";
  const clientCompany = qs("#clientCompany").value.trim();
  const clientAddress = qs("#clientAddress").value || "Adresse client";
  const logo = state.company.logo || "../logo.png";
  const clientCompanyLine = clientCompany ? `<p>${escapeHtml(clientCompany)}</p>` : "";

  qs("#invoicePreview").innerHTML = `
    <div class="devis-page">
      <header class="devis-head">
        <div class="devis-company">
          <h2>${previewTitle}</h2>
          <strong>${escapeHtml(state.company.name)}</strong>
          ${escapeLines(state.company.address)}
        </div>
        <div class="devis-contact">
          <p>${escapeHtml(state.company.email || "")}</p>
          <p>${escapeHtml(state.company.phone || "")}</p>
          <p>${escapeHtml(state.company.website || "")}</p>
        </div>
        <img class="devis-logo" src="${escapeAttr(logo)}" alt="Logo">
      </header>

      <section class="devis-band address-band">
        <div>
          <strong>Adresse de facturation</strong>
          <p>${escapeHtml(clientName)}</p>
          ${clientCompanyLine}
          ${escapeLines(clientAddress)}
        </div>
        <div>
          <strong>Adresse de livraison</strong>
          <p>${escapeHtml(clientName)}</p>
          ${clientCompanyLine}
          ${escapeLines(clientAddress)}
        </div>
      </section>

      <section class="devis-band fiscal-band">
        <div>
          <strong>Infos sur l'organisme fiscal (${previewLabel})</strong>
          <p>No de ${previewLabel}: ${escapeHtml(qs("#proformaNumber").value.replace(/^PF-/, "").replace(/^FAC-/, ""))}</p>
          <p>Date ${previewLabel}: ${escapeHtml(formatDate(date))}</p>
          <p>Validite: ${escapeHtml(formatDate(validity))}</p>
          <p>Devise: ${escapeHtml(currency)}</p>
        </div>
      </section>

      <table class="devis-items">
        <thead>
          <tr>
            <th>no</th>
            <th>Date</th>
            <th>Produit ou service</th>
            <th>REFERENCE</th>
            <th>Description</th>
            <th class="amount">Qte</th>
            <th class="amount">Taux</th>
            <th class="amount">Montant</th>
            <th class="amount">Taxe</th>
          </tr>
        </thead>
        <tbody>
          ${totals.lines.map((line, index) => {
            const tax = selectedTax(line.taxId);
            return `
              <tr>
                <td>${index + 1}.</td>
                <td>${escapeHtml(formatDate(date))}</td>
                <td><strong>${escapeHtml(line.name || "Produit")}</strong></td>
                <td>${escapeHtml(line.reference || "-")}</td>
                <td>${escapeHtml(line.description || "")}</td>
                <td class="amount">${numberFr(line.qty)}</td>
                <td class="amount">${money(line.price, currency)}</td>
                <td class="amount">${money(line.base, currency)}</td>
                <td class="amount">${tax.rate ? `${numberFr(tax.rate)}% S` : "-"}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>

      <section class="devis-bottom">
        <div class="devis-extra">
          <p><strong>Conditions de paiement:</strong> ${escapeHtml(qs("#paymentTerms").value || "-")}</p>
          <p><strong>Incoterms:</strong> ${escapeHtml(qs("#incoterms").value || "-")}</p>
          <p><strong>HS Code:</strong> ${escapeHtml(qs("#hsCode").value || "-")}</p>
          ${dual ? `<p><strong>USD / HTG:</strong> ${money(usdValue, "USD")} | ${money(htgValue, "HTG")}</p>` : ""}
        </div>
        <div class="devis-totals">
          <div><span>Sous-total</span><strong>${money(totals.subtotal, currency)}</strong></div>
          <div><span>TOT taxe</span><strong>${money(totals.taxTotal, currency)}</strong></div>
          ${totals.shipping ? `<div><span>Shipping</span><strong>${money(totals.shipping, currency)}</strong></div>` : ""}
          ${totals.discount ? `<div><span>Remise (${numberFr(totals.discountPercent)}%)</span><strong>- ${money(totals.discount, currency)}</strong></div>` : ""}
          <div class="final"><span>Total</span><strong>${money(totals.finalTotal, currency)}</strong></div>
        </div>
      </section>

      <div class="devis-signatures">
        <strong>Date</strong>
        <strong>Responsable</strong>
      </div>

      <div class="invoice-notes">${escapeHtml(qs("#notes").value || "")}</div>
    </div>
  `;
  fitPreview();
}

function fitPreview() {
  const preview = qs("#invoicePreview");
  const page = qs(".devis-page");
  if (!preview || !page) return;
  if (window.matchMedia("print").matches) {
    page.style.transform = "none";
    page.style.marginBottom = "0";
    preview.style.minHeight = "1056px";
    return;
  }
  const pageWidth = 816;
  const pageHeight = 1056;
  const available = Math.max(320, preview.clientWidth);
  const scale = Math.min(1, available / pageWidth);
  page.style.transform = `scale(${scale})`;
  page.style.marginBottom = `-${pageHeight * (1 - scale)}px`;
  preview.style.minHeight = `${pageHeight * scale}px`;
}

function buildDocumentPayload(id, type = "proforma") {
  const totals = calculateTotals();
  return {
    id,
    type,
    clientId: qs("#clientPicker").value || "",
    number: qs("#proformaNumber").value,
    clientName: qs("#clientName").value,
    clientCompany: qs("#clientCompany").value,
    clientEmail: qs("#clientEmail").value,
    clientAddress: qs("#clientAddress").value,
    date: qs("#proformaDate").value,
    validityDays: qs("#validityDays").value,
    currency: getCurrency(),
    exchangeRate: Number(qs("#exchangeRate").value || 1),
    showDualCurrency: qs("#showDualCurrency").checked,
    shipping: Number(qs("#shipping").value || 0),
    globalDiscount: Number(qs("#globalDiscount").value || 0),
    paymentTerms: qs("#paymentTerms").value,
    incoterms: qs("#incoterms").value,
    hsCode: qs("#hsCode").value,
    notes: qs("#notes").value,
    lines: getLines(),
    total: totals.finalTotal,
    updatedAt: new Date().toISOString()
  };
}

function saveCurrentDocument() {
  if (currentDocumentType === "invoice") {
    saveInvoice();
    return;
  }
  saveProforma();
}

function saveProforma() {
  const proforma = buildDocumentPayload(currentProformaId || crypto.randomUUID(), "proforma");

  const existingIndex = state.proformas.findIndex((item) => item.id === proforma.id);
  if (existingIndex >= 0) {
    state.proformas[existingIndex] = proforma;
  } else {
    state.proformas.unshift(proforma);
    state.settings.sequence += 1;
  }
  currentProformaId = proforma.id;
  currentInvoiceId = null;
  currentDocumentType = "proforma";
  qs("#statusPill").textContent = "Sove";
  persist();
  renderRecords();
  renderReports();
  toast("Proforma a sove.");
}

function saveInvoice() {
  const invoice = buildDocumentPayload(currentInvoiceId || crypto.randomUUID(), "invoice");
  const existingIndex = state.invoices.findIndex((item) => item.id === invoice.id);
  if (existingIndex >= 0) {
    state.invoices[existingIndex] = invoice;
  } else {
    state.invoices.unshift(invoice);
    state.settings.invoiceSequence = (state.settings.invoiceSequence || 1) + 1;
  }
  currentInvoiceId = invoice.id;
  currentProformaId = null;
  currentDocumentType = "invoice";
  qs("#statusPill").textContent = "Facture";
  persist();
  renderInvoices();
  renderReports();
  toast("Facture a sove.");
}

function loadProforma(id, duplicate = false) {
  const proforma = state.proformas.find((item) => item.id === id);
  if (!proforma) return;
  currentProformaId = duplicate ? null : proforma.id;
  currentInvoiceId = null;
  currentDocumentType = "proforma";
  qs("#statusPill").textContent = duplicate ? "Copie" : "Sove";
  qs("#clientPicker").value = proforma.clientId || "";
  qs("#clientName").value = proforma.clientName;
  qs("#clientCompany").value = proforma.clientCompany || "";
  qs("#clientEmail").value = proforma.clientEmail;
  qs("#clientAddress").value = proforma.clientAddress;
  qs("#proformaDate").value = duplicate ? todayISO() : proforma.date;
  qs("#validityDays").value = proforma.validityDays;
  qs("#currency").value = proforma.currency;
  qs("#exchangeRate").value = proforma.exchangeRate;
  qs("#showDualCurrency").checked = proforma.showDualCurrency;
  qs("#shipping").value = proforma.shipping;
  qs("#globalDiscount").value = proforma.globalDiscount;
  qs("#paymentTerms").value = proforma.paymentTerms;
  qs("#incoterms").value = proforma.incoterms;
  qs("#hsCode").value = proforma.hsCode;
  qs("#notes").value = proforma.notes;
  qs("#proformaNumber").value = duplicate ? nextProformaNumber() : proforma.number;
  qs("#lineItems").innerHTML = "";
  proforma.lines.forEach((line) => addLine(line));
  activateTab("builder");
  renderPreview();
}

function loadInvoice(id) {
  const invoice = state.invoices.find((item) => item.id === id);
  if (!invoice) return;
  currentInvoiceId = invoice.id;
  currentProformaId = null;
  currentDocumentType = "invoice";
  qs("#statusPill").textContent = "Facture";
  qs("#clientPicker").value = invoice.clientId || "";
  qs("#clientName").value = invoice.clientName;
  qs("#clientCompany").value = invoice.clientCompany || "";
  qs("#clientEmail").value = invoice.clientEmail;
  qs("#clientAddress").value = invoice.clientAddress;
  qs("#proformaDate").value = invoice.date;
  qs("#validityDays").value = invoice.validityDays;
  qs("#currency").value = invoice.currency;
  qs("#exchangeRate").value = invoice.exchangeRate;
  qs("#showDualCurrency").checked = invoice.showDualCurrency;
  qs("#shipping").value = invoice.shipping;
  qs("#globalDiscount").value = invoice.globalDiscount;
  qs("#paymentTerms").value = invoice.paymentTerms;
  qs("#incoterms").value = invoice.incoterms;
  qs("#hsCode").value = invoice.hsCode;
  qs("#notes").value = invoice.notes;
  qs("#proformaNumber").value = invoice.number;
  qs("#lineItems").innerHTML = "";
  invoice.lines.forEach((line) => addLine(line));
  activateTab("builder");
  renderPreview();
}

function activateTab(tab) {
  qs(`.nav-btn[data-tab="${tab}"]`).click();
}

function renderClientPicker() {
  const picker = qs("#clientPicker");
  const current = picker.value;
  picker.innerHTML = `<option value="">Chwazi yon kliyan...</option>`;
  state.clients.forEach((client) => {
    const label = client.company ? `${client.name} - ${client.company}` : client.name;
    picker.add(new Option(label || "Kliyan san non", client.id));
  });
  picker.value = current;
}

function applyClientToProforma(id) {
  const client = state.clients.find((item) => item.id === id);
  if (!client) return;
  qs("#clientName").value = client.name || "";
  qs("#clientCompany").value = client.company || "";
  qs("#clientEmail").value = client.email || "";
  qs("#clientAddress").value = client.address || "";
  renderPreview();
}

function saveClient() {
  const id = qs("#savedClientId").value || crypto.randomUUID();
  const client = {
    id,
    name: qs("#savedClientName").value.trim(),
    company: qs("#savedClientCompany").value.trim(),
    email: qs("#savedClientEmail").value.trim(),
    phone: qs("#savedClientPhone").value.trim(),
    address: qs("#savedClientAddress").value.trim(),
    updatedAt: new Date().toISOString()
  };
  if (!client.name && !client.company && !client.email) {
    toast("Ranpli omwen non, antrepriz oswa email kliyan an.");
    return;
  }

  const index = state.clients.findIndex((item) => item.id === id);
  if (index >= 0) state.clients[index] = client;
  else state.clients.unshift(client);
  persist();
  clearClientForm();
  renderClients();
  renderClientPicker();
  toast("Kliyan an sove.");
}

function clearClientForm() {
  ["#savedClientId", "#savedClientName", "#savedClientCompany", "#savedClientEmail", "#savedClientPhone", "#savedClientAddress"].forEach((selector) => {
    qs(selector).value = "";
  });
}

function editClient(id) {
  const client = state.clients.find((item) => item.id === id);
  if (!client) return;
  qs("#savedClientId").value = client.id;
  qs("#savedClientName").value = client.name || "";
  qs("#savedClientCompany").value = client.company || "";
  qs("#savedClientEmail").value = client.email || "";
  qs("#savedClientPhone").value = client.phone || "";
  qs("#savedClientAddress").value = client.address || "";
}

function deleteClient(id) {
  const client = state.clients.find((item) => item.id === id);
  if (!client) return;
  const confirmed = window.confirm(`Voulez-vous vraiment supprimer ce client ?\n\n${client.name || client.company || "Client"}`);
  if (!confirmed) return;

  state.clients = state.clients.filter((item) => item.id !== id);
  if (qs("#clientPicker").value === id) qs("#clientPicker").value = "";
  persist();
  clearClientForm();
  renderClients();
  renderClientPicker();
  toast("Kliyan an supprime.");
}

function renderClients() {
  const search = qs("#clientSearch")?.value?.toLowerCase() || "";
  const clients = state.clients.filter((client) => JSON.stringify(client).toLowerCase().includes(search));
  qs("#clientList").innerHTML = clients.length ? clients.map((client) => `
    <article class="item-card">
      <div>
        <strong>${escapeHtml(client.name || "Kliyan san non")}</strong>
        <p>${escapeHtml(client.company || "-")} · ${escapeHtml(client.email || "-")}</p>
        <p>${escapeHtml(client.phone || "")}${client.phone && client.address ? " · " : ""}${escapeHtml(client.address || "")}</p>
      </div>
      <div class="mini-actions">
        <button type="button" data-use-client="${client.id}">Itilize</button>
        <button type="button" data-edit-client="${client.id}">Edit</button>
        <button type="button" class="danger-action" data-delete-client="${client.id}">Supprimer</button>
      </div>
    </article>
  `).join("") : `<p>Aucun kliyan sove pou kounye a.</p>`;

  qsa("[data-use-client]").forEach((btn) => btn.addEventListener("click", () => {
    qs("#clientPicker").value = btn.dataset.useClient;
    applyClientToProforma(btn.dataset.useClient);
    activateTab("builder");
  }));
  qsa("[data-edit-client]").forEach((btn) => btn.addEventListener("click", () => editClient(btn.dataset.editClient)));
  qsa("[data-delete-client]").forEach((btn) => btn.addEventListener("click", () => deleteClient(btn.dataset.deleteClient)));
}

function renderProductPicker() {
  const picker = qs("#productPicker");
  picker.innerHTML = `<option value="">Ajoute pwodwi rapid</option>`;
  state.products.forEach((product) => picker.add(new Option(`${product.name} - ${product.sku || "Sans SKU"}`, product.id)));
}

function renderTaxSelects() {
  const productTax = qs("#productTax");
  productTax.innerHTML = "";
  state.taxes.forEach((tax) => productTax.add(new Option(`${tax.name} (${tax.rate}%)`, tax.id)));
  qsa(".line-tax").forEach((select) => {
    const current = select.value;
    select.innerHTML = "";
    state.taxes.forEach((tax) => select.add(new Option(`${tax.name} (${tax.rate}%)`, tax.id)));
    select.value = current || "none";
  });
}

function saveProduct() {
  const id = qs("#productId").value || crypto.randomUUID();
  const product = {
    id,
    name: qs("#productName").value || "Produit sans nom",
    sku: qs("#productSku").value,
    description: qs("#productDescription").value,
    usd: Number(qs("#productUsd").value || 0),
    htg: Number(qs("#productHtg").value || 0),
    unit: qs("#productUnit").value,
    taxId: qs("#productTax").value,
    discount: Number(qs("#productDiscount").value || 0)
  };
  const index = state.products.findIndex((item) => item.id === id);
  if (index >= 0) state.products[index] = product;
  else state.products.unshift(product);
  persist();
  clearProductForm();
  renderProducts();
  renderProductPicker();
  toast("Pwodwi a sove.");
}

function clearProductForm() {
  ["#productId", "#productName", "#productSku", "#productDescription", "#productUsd", "#productHtg", "#productUnit"].forEach((selector) => {
    qs(selector).value = "";
  });
  qs("#productDiscount").value = 0;
  qs("#productTax").value = "none";
}

function editProduct(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  qs("#productId").value = product.id;
  qs("#productName").value = product.name;
  qs("#productSku").value = product.sku;
  qs("#productDescription").value = product.description;
  qs("#productUsd").value = product.usd;
  qs("#productHtg").value = product.htg;
  qs("#productUnit").value = product.unit;
  qs("#productTax").value = product.taxId;
  qs("#productDiscount").value = product.discount;
}

function deleteProduct(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  const confirmed = window.confirm(`Voulez-vous vraiment supprimer ce produit ?\n\n${product.name || "Produit"}`);
  if (!confirmed) return;

  state.products = state.products.filter((item) => item.id !== id);
  persist();
  renderProducts();
  renderProductPicker();
  toast("Produit supprime.");
}

function renderProducts() {
  const search = qs("#productSearch").value?.toLowerCase() || "";
  const products = state.products.filter((product) => JSON.stringify(product).toLowerCase().includes(search));
  qs("#productList").innerHTML = products.map((product) => `
    <article class="item-card">
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <p>${escapeHtml(product.sku || "-")} · ${money(product.usd, "USD")} · ${money(product.htg, "HTG")}</p>
      </div>
      <div class="mini-actions">
        <button type="button" data-edit-product="${product.id}">Edit</button>
        <button type="button" data-delete-product="${product.id}">Efase</button>
      </div>
    </article>
  `).join("");

  qsa("[data-edit-product]").forEach((btn) => btn.addEventListener("click", () => editProduct(btn.dataset.editProduct)));
  qsa("[data-delete-product]").forEach((btn) => btn.addEventListener("click", () => deleteProduct(btn.dataset.deleteProduct)));
}

function renderTaxes() {
  qs("#taxList").innerHTML = state.taxes.map((tax) => `
    <article class="tax-card">
      <div class="form-grid compact">
        <input value="${escapeAttr(tax.name)}" data-tax-name="${tax.id}">
        <input type="number" min="0" step="0.01" value="${tax.rate}" data-tax-rate="${tax.id}">
        <select data-tax-mode="${tax.id}">
          <option value="excluded" ${tax.mode === "excluded" ? "selected" : ""}>Excluded</option>
          <option value="included" ${tax.mode === "included" ? "selected" : ""}>Included</option>
        </select>
      </div>
      <div class="mini-actions">
        <button type="button" data-delete-tax="${tax.id}" ${tax.id === "none" ? "disabled" : ""}>Efase</button>
      </div>
    </article>
  `).join("");

  qsa("[data-tax-name], [data-tax-rate], [data-tax-mode]").forEach((field) => {
    field.addEventListener("input", updateTaxesFromDom);
  });
  qsa("[data-delete-tax]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tax = state.taxes.find((item) => item.id === btn.dataset.deleteTax);
      if (!tax) return;
      const confirmed = window.confirm(`Voulez-vous vraiment supprimer cette taxe ?\n\n${tax.name || "Taxe"}`);
      if (!confirmed) return;

      state.taxes = state.taxes.filter((tax) => tax.id !== btn.dataset.deleteTax);
      persist();
      refreshAll();
      renderPreview();
      toast("Taxe supprimee.");
    });
  });
}

function updateTaxesFromDom() {
  state.taxes = state.taxes.map((tax) => ({
    ...tax,
    name: qs(`[data-tax-name="${tax.id}"]`)?.value ?? tax.name,
    rate: Number(qs(`[data-tax-rate="${tax.id}"]`)?.value ?? tax.rate),
    mode: qs(`[data-tax-mode="${tax.id}"]`)?.value ?? tax.mode
  }));
  persist();
  renderTaxSelects();
  recalcLines();
  renderPreview();
}

function renderRecords() {
  const search = qs("#recordSearch")?.value?.toLowerCase() || "";
  const records = state.proformas.filter((item) => JSON.stringify(item).toLowerCase().includes(search));
  qs("#recordsList").innerHTML = records.length ? records.map((item) => `
    ${(() => {
      const invoice = state.invoices.find((record) => record.originalProformaId === item.id);
      const convertButton = invoice
        ? `<button type="button" disabled>Facture creee</button>`
        : `<button type="button" data-convert-record="${item.id}">Convertir en Facture</button>`;
      return `
    <article class="record-card">
      <div>
        <strong>${escapeHtml(item.number)} · ${escapeHtml(item.clientName || "Client")}</strong>
        <p>${escapeHtml(item.date)} · ${escapeHtml(item.currency)} · ${money(item.total, item.currency)}</p>
      </div>
      <div class="mini-actions">
        ${convertButton}
        <button type="button" data-open-record="${item.id}">Ouvri</button>
        <button type="button" data-duplicate-record="${item.id}">Duplike</button>
        <button type="button" data-email-record="${item.id}">Email</button>
        <button type="button" class="danger-action" data-delete-record="${item.id}">Supprimer</button>
      </div>
    </article>
      `;
    })()}
  `).join("") : `<p>Aucun proforma sove pou kounye a.</p>`;

  qsa("[data-open-record]").forEach((btn) => btn.addEventListener("click", () => loadProforma(btn.dataset.openRecord)));
  qsa("[data-duplicate-record]").forEach((btn) => btn.addEventListener("click", () => loadProforma(btn.dataset.duplicateRecord, true)));
  qsa("[data-email-record]").forEach((btn) => btn.addEventListener("click", () => emailProforma(btn.dataset.emailRecord)));
  qsa("[data-convert-record]").forEach((btn) => btn.addEventListener("click", () => convertProformaToInvoice(btn.dataset.convertRecord)));
  qsa("[data-delete-record]").forEach((btn) => btn.addEventListener("click", () => deleteProforma(btn.dataset.deleteRecord)));
}

function convertProformaToInvoice(id) {
  const proforma = state.proformas.find((record) => record.id === id);
  if (!proforma) return;
  const existingInvoice = state.invoices.find((record) => record.originalProformaId === id);
  if (existingInvoice) {
    loadInvoice(existingInvoice.id);
    return;
  }

  const confirmed = window.confirm(
    `Voulez-vous convertir cette proforma en facture ?\n\n${proforma.number || "Proforma"} - ${proforma.clientName || "Client"}`
  );
  if (!confirmed) return;

  const invoice = {
    ...structuredClone(proforma),
    id: crypto.randomUUID(),
    type: "invoice",
    number: nextInvoiceNumber(),
    originalProformaId: proforma.id,
    originalProformaNumber: proforma.number,
    convertedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.invoices.unshift(invoice);
  state.settings.invoiceSequence = (state.settings.invoiceSequence || 1) + 1;
  persist();
  renderRecords();
  renderInvoices();
  renderReports();
  loadInvoice(invoice.id);
  toast("Proforma convertie en facture.");
}

function deleteProforma(id) {
  const item = state.proformas.find((record) => record.id === id);
  if (!item) return;

  const label = `${item.number || "Proforma"} - ${item.clientName || "Client"}`;
  const confirmed = window.confirm(`Voulez-vous vraiment supprimer definitivement cette proforma ?\n\n${label}`);
  if (!confirmed) return;

  state.proformas = state.proformas.filter((record) => record.id !== id);
  if (currentProformaId === id) {
    currentProformaId = null;
    newProforma();
  }
  persist();
  renderRecords();
  renderReports();
  toast("Proforma supprimee definitivement.");
}

function renderInvoices() {
  const search = qs("#invoiceSearch")?.value?.toLowerCase() || "";
  const invoices = state.invoices.filter((item) => JSON.stringify(item).toLowerCase().includes(search));
  qs("#invoicesList").innerHTML = invoices.length ? invoices.map((item) => `
    <article class="record-card">
      <div>
        <strong>${escapeHtml(item.number)} · ${escapeHtml(item.clientName || "Client")}</strong>
        <p>${escapeHtml(item.date)} · ${escapeHtml(item.currency)} · ${money(item.total, item.currency)}</p>
        ${item.originalProformaNumber ? `<p>Depuis: ${escapeHtml(item.originalProformaNumber)}</p>` : ""}
      </div>
      <div class="mini-actions">
        <button type="button" data-open-invoice="${item.id}">Ouvri</button>
        <button type="button" data-email-invoice="${item.id}">Email</button>
        <button type="button" class="danger-action" data-delete-invoice="${item.id}">Supprimer</button>
      </div>
    </article>
  `).join("") : `<p>Aucune facture pou kounye a.</p>`;

  qsa("[data-open-invoice]").forEach((btn) => btn.addEventListener("click", () => loadInvoice(btn.dataset.openInvoice)));
  qsa("[data-email-invoice]").forEach((btn) => btn.addEventListener("click", () => emailInvoice(btn.dataset.emailInvoice)));
  qsa("[data-delete-invoice]").forEach((btn) => btn.addEventListener("click", () => deleteInvoice(btn.dataset.deleteInvoice)));
}

function deleteInvoice(id) {
  const item = state.invoices.find((record) => record.id === id);
  if (!item) return;

  const label = `${item.number || "Facture"} - ${item.clientName || "Client"}`;
  const confirmed = window.confirm(`Voulez-vous vraiment supprimer definitivement cette facture ?\n\n${label}`);
  if (!confirmed) return;

  state.invoices = state.invoices.filter((record) => record.id !== id);
  if (currentInvoiceId === id) {
    currentInvoiceId = null;
    newProforma();
  }
  persist();
  renderRecords();
  renderInvoices();
  renderReports();
  toast("Facture supprimee definitivement.");
}

function emailProforma(id) {
  const item = state.proformas.find((record) => record.id === id);
  if (!item) return;

  const confirmed = window.confirm(
    "Le navigateur ne peut pas attacher un PDF automatiquement dans un email.\n\n" +
    "Le systeme va d'abord ouvrir la fenetre PDF pour enregistrer la proforma avec le bon nom. Ensuite, votre email va s'ouvrir et vous pourrez attacher ce PDF.\n\n" +
    "Continuer ?"
  );
  if (!confirmed) return;

  loadProforma(id);
  window.setTimeout(() => printThenEmailProforma(item), 250);
}

function emailInvoice(id) {
  const item = state.invoices.find((record) => record.id === id);
  if (!item) return;

  const confirmed = window.confirm(
    "Le navigateur ne peut pas attacher un PDF automatiquement dans un email.\n\n" +
    "Le systeme va d'abord ouvrir la fenetre PDF pour enregistrer la facture avec le bon nom. Ensuite, votre email va s'ouvrir et vous pourrez attacher ce PDF.\n\n" +
    "Continuer ?"
  );
  if (!confirmed) return;

  loadInvoice(id);
  window.setTimeout(() => printThenEmailProforma(item), 250);
}

function renderReports() {
  const count = state.proformas.length;
  const totalsByCurrency = sumTotalsByCurrency(state.proformas);
  const topClient = topBy(state.proformas, "clientName");
  const topCurrency = topCurrencyByActivity(state.proformas);
  qs("#reportsGrid").innerHTML = `
    <article class="report-card"><span>Proforma total</span><strong>${count}</strong></article>
    <article class="report-card"><span>Montan total an goud</span><strong>${money(totalsByCurrency.HTG, "HTG")}</strong></article>
    <article class="report-card"><span>Montan total an $US</span><strong>${money(totalsByCurrency.USD, "USD")}</strong></article>
    <article class="report-card"><span>Top kliyan</span><strong>${escapeHtml(topClient || "-")}</strong></article>
    <article class="report-card"><span>Lajan plis itilize</span><strong>${escapeHtml(formatCurrencyLabel(topCurrency))}</strong></article>
  `;
}

function sumTotalsByCurrency(items) {
  return items.reduce((totals, item) => {
    const currency = item.currency === "HTG" ? "HTG" : "USD";
    totals[currency] += Number(item.total || 0);
    return totals;
  }, { HTG: 0, USD: 0 });
}

function topCurrencyByActivity(items) {
  const map = new Map();
  items.forEach((item) => {
    const currency = item.currency === "HTG" ? "HTG" : "USD";
    const total = Number(item.total || 0);
    if (!total) return;
    const current = map.get(currency) || { count: 0, total: 0 };
    map.set(currency, { count: current.count + 1, total: current.total + total });
  });
  return [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].total - a[1].total)[0]?.[0] || "";
}

function formatCurrencyLabel(currency) {
  if (currency === "HTG") return "Gourdes (HTG)";
  if (currency === "USD") return "Dollar US (USD)";
  return "-";
}

function topBy(items, key) {
  const map = new Map();
  items.forEach((item) => {
    const value = item[key];
    if (value) map.set(value, (map.get(value) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

async function importCsv(event) {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const rows = text.split(/\r?\n/).map((line) => line.split(",").map((cell) => cell.trim())).filter((row) => row.length > 1);
  const [header, ...data] = rows;
  const keys = header.map((key) => key.toLowerCase());
  data.forEach((row) => {
    const get = (name) => row[keys.indexOf(name)] || "";
    state.products.push({
      id: crypto.randomUUID(),
      name: get("name") || get("nom") || "Produit importe",
      description: get("description"),
      sku: get("sku") || get("code"),
      usd: Number(get("usd") || get("price_usd") || 0),
      htg: Number(get("htg") || get("price_htg") || 0),
      unit: get("unit") || get("inite"),
      taxId: get("taxid") || "none",
      discount: Number(get("discount") || get("rabe") || 0)
    });
  });
  persist();
  renderProducts();
  renderProductPicker();
  toast("Import CSV fini.");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function toast(message) {
  qs("#statusPill").textContent = message;
  setTimeout(() => {
    qs("#statusPill").textContent = currentProformaId ? "Sove" : "Draft";
  }, 1800);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function escapeLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

init();
