import { auth, db, authReadyPromise } from './firebase-init.js';
import {
  collection,
  doc,
  getDocs,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';

const DELETE_CLIENT_FUNCTION_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/deleteClientAccount';
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

const state = {
  clients: [],
  filteredClients: [],
  selectedId: '',
  adminUid: ''
};

const elements = {
  statClients: document.getElementById('statClients'),
  statAdmins: document.getElementById('statAdmins'),
  statVendors: document.getElementById('statVendors'),
  statSelected: document.getElementById('statSelected'),
  clientSearch: document.getElementById('clientSearch'),
  roleFilter: document.getElementById('roleFilter'),
  refreshClientsBtn: document.getElementById('refreshClientsBtn'),
  clientsList: document.getElementById('clientsList'),
  clientEditor: document.getElementById('clientEditor'),
  clientNotice: document.getElementById('clientNotice')
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getClientName(client = {}) {
  return [client.firstName, client.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ')
    || client.name
    || client.displayName
    || client.username
    || client.email
    || client.id
    || 'Client';
}

function normalizeRole(client = {}) {
  return String(client.role || client.vendorStatus || 'client').toLowerCase();
}

function getDefaultAddress(client = {}) {
  const addresses = Array.isArray(client.addresses) ? client.addresses : [];
  return addresses.find((address) => address?.id === client.defaultDeliveryAddressId)
    || addresses.find((address) => address?.isDelivery)
    || addresses[0]
    || null;
}

function getAddressLine(address = {}, client = {}) {
  return [
    address?.address || client.address || '',
    address?.commune || client.commune || client.city || '',
    address?.department || client.department || '',
    address?.country || client.country || 'Haiti'
  ].filter(Boolean).join(', ');
}

function departmentOptions(selected = '') {
  return '<option value="">Choisir...</option>' + Object.keys(HAITI_DEPARTMENTS)
    .map((department) => `<option value="${escapeHtml(department)}" ${department === selected ? 'selected' : ''}>${escapeHtml(department)}</option>`)
    .join('');
}

function communeOptions(department = '', selected = '') {
  const communes = HAITI_DEPARTMENTS[department] || [];
  return '<option value="">Choisir...</option>' + communes
    .map((commune) => `<option value="${escapeHtml(commune)}" ${commune === selected ? 'selected' : ''}>${escapeHtml(commune)}</option>`)
    .join('');
}

function showNotice(message, type = 'success') {
  elements.clientNotice.textContent = message;
  elements.clientNotice.className = `notice show ${type}`;
  window.setTimeout(() => {
    elements.clientNotice.className = 'notice';
  }, 4200);
}

function updateStats() {
  elements.statClients.textContent = String(state.clients.length);
  elements.statAdmins.textContent = String(state.clients.filter((client) => normalizeRole(client) === 'admin').length);
  elements.statVendors.textContent = String(state.clients.filter((client) => normalizeRole(client) === 'vendor').length);
  elements.statSelected.textContent = state.selectedId ? 'Oui' : '-';
}

function applyFilters() {
  const search = String(elements.clientSearch.value || '').trim().toLowerCase();
  const role = elements.roleFilter.value || 'all';

  state.filteredClients = state.clients.filter((client) => {
    const clientRole = normalizeRole(client);
    if (role !== 'all' && clientRole !== role) return false;
    const haystack = [
      client.id,
      client.uid,
      getClientName(client),
      client.firstName,
      client.lastName,
      client.username,
      client.displayName,
      client.email,
      client.phone,
      getAddressLine(getDefaultAddress(client), client)
    ].join(' ').toLowerCase();
    return !search || haystack.includes(search);
  });

  renderClientList();
}

async function loadClients() {
  elements.clientsList.innerHTML = '<p class="muted">Chargement des clients...</p>';
  const snapshot = await getDocs(collection(db, 'clients'));
  state.clients = snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .sort((a, b) => Date.parse(String(b.updatedAt || b.createdAt || '')) - Date.parse(String(a.updatedAt || a.createdAt || '')));
  if (state.selectedId && !state.clients.some((client) => client.id === state.selectedId)) {
    state.selectedId = '';
  }
  updateStats();
  applyFilters();
  renderEditor();
}

function renderClientList() {
  if (!state.filteredClients.length) {
    elements.clientsList.innerHTML = '<p class="muted">Aucun client trouve.</p>';
    return;
  }

  elements.clientsList.innerHTML = state.filteredClients.map((client) => {
    const role = normalizeRole(client);
    const address = getAddressLine(getDefaultAddress(client), client) || '-';
    return `
      <button class="client-card ${client.id === state.selectedId ? 'active' : ''}" type="button" data-client-id="${escapeHtml(client.id)}">
        <strong>${escapeHtml(getClientName(client))}</strong>
        <span class="muted">${escapeHtml(client.email || '-')}</span>
        <span class="muted">${escapeHtml(client.phone || '-')}</span>
        <span class="muted">${escapeHtml(address)}</span>
        <span class="muted">Role: ${escapeHtml(role)}</span>
      </button>
    `;
  }).join('');

  elements.clientsList.querySelectorAll('[data-client-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedId = button.dataset.clientId;
      updateStats();
      renderClientList();
      renderEditor();
    });
  });
}

function renderAddressEditor(address = {}, index = 0) {
  return `
    <article class="address-card" data-address-index="${index}">
      <strong>Adresse ${index + 1}${address?.id ? ` - ${escapeHtml(address.id)}` : ''}</strong>
      <input type="hidden" data-address-field="id" value="${escapeHtml(address.id || `addr_${Date.now().toString(36)}_${index}`)}">
      <label class="full">Adresse
        <input data-address-field="address" value="${escapeHtml(address.address || '')}" placeholder="Rue, numero, quartier">
      </label>
      <div class="form-grid">
        <label>Departement
          <select data-address-field="department" data-address-department="${index}">
            ${departmentOptions(address.department || '')}
          </select>
        </label>
        <label>Commune
          <select data-address-field="commune" data-address-commune="${index}">
            ${communeOptions(address.department || '', address.commune || '')}
          </select>
        </label>
      </div>
      <label>Adresse de livraison par defaut
        <select data-address-field="isDelivery">
          <option value="false" ${address.isDelivery ? '' : 'selected'}>Non</option>
          <option value="true" ${address.isDelivery ? 'selected' : ''}>Oui</option>
        </select>
      </label>
    </article>
  `;
}

function renderEditor() {
  const client = state.clients.find((item) => item.id === state.selectedId);
  if (!client) {
    elements.clientEditor.innerHTML = '<p>Selectionne un client pour modifier ses informations ou supprimer son compte.</p>';
    return;
  }

  const role = normalizeRole(client);
  const addresses = Array.isArray(client.addresses) && client.addresses.length
    ? client.addresses
    : [{
        id: client.defaultDeliveryAddressId || `addr_${Date.now().toString(36)}`,
        address: client.address || '',
        country: client.country || 'Haiti',
        department: client.department || '',
        commune: client.commune || client.city || '',
        isDelivery: true
      }];

  elements.clientEditor.innerHTML = `
    <form id="clientEditForm" style="display:grid;gap:1rem;">
      <div class="form-grid">
        <label>Nom
          <input id="editLastName" value="${escapeHtml(client.lastName || '')}" placeholder="Nom">
        </label>
        <label>Prenom
          <input id="editFirstName" value="${escapeHtml(client.firstName || '')}" placeholder="Prenom">
        </label>
        <label>Username
          <input id="editUsername" value="${escapeHtml(client.username || client.displayName || '')}" placeholder="Username">
        </label>
        <label>Date de naissance
          <input id="editBirthDate" type="date" value="${escapeHtml(client.birthDate || '')}">
        </label>
        <label>Email
          <input id="editEmail" type="email" value="${escapeHtml(client.email || '')}" placeholder="Email client">
        </label>
        <label>Telephone
          <input id="editPhone" value="${escapeHtml(client.phone || '')}" placeholder="+509...">
        </label>
      </div>

      <div>
        <div class="actions" style="justify-content:space-between;margin-bottom:.8rem;">
          <div>
            <strong>Adresses</strong>
            <p class="muted" style="margin:.25rem 0 0;">Modifie les adresses sauvegardees ou ajoute une nouvelle adresse.</p>
          </div>
          <button id="addAddressBtn" type="button" class="btn-soft"><i class="fas fa-plus"></i> Ajouter une adresse</button>
        </div>
        <div id="addressesEditor" style="display:grid;gap:.8rem;">
          ${addresses.map((address, index) => renderAddressEditor(address, index)).join('')}
        </div>
      </div>

      <div class="actions">
        <button class="btn-primary" type="submit"><i class="fas fa-save"></i> Enregistrer les modifications</button>
        <button class="btn-danger" type="button" id="deleteClientBtn" ${role === 'admin' || client.id === state.adminUid ? 'disabled title="Compte admin protege"' : ''}>
          <i class="fas fa-trash"></i> Supprimer ce client
        </button>
      </div>
      <p class="muted">Attention: la suppression passe par la Cloud Function admin et retire le compte Auth ainsi que les donnees Firestore. Les admins sont proteges.</p>
    </form>
  `;

  elements.clientEditor.querySelector('#clientEditForm')?.addEventListener('submit', saveSelectedClient);
  elements.clientEditor.querySelector('#addAddressBtn')?.addEventListener('click', addAddressBlock);
  elements.clientEditor.querySelector('#deleteClientBtn')?.addEventListener('click', deleteSelectedClient);
  bindAddressDepartmentEvents();
}

function bindAddressDepartmentEvents() {
  elements.clientEditor.querySelectorAll('[data-address-department]').forEach((select) => {
    select.addEventListener('change', () => {
      const index = select.dataset.addressDepartment;
      const commune = elements.clientEditor.querySelector(`[data-address-commune="${index}"]`);
      if (commune) commune.innerHTML = communeOptions(select.value, '');
    });
  });
}

function addAddressBlock() {
  const root = elements.clientEditor.querySelector('#addressesEditor');
  if (!root) return;
  const index = root.querySelectorAll('[data-address-index]').length;
  root.insertAdjacentHTML('beforeend', renderAddressEditor({
    id: `addr_${Date.now().toString(36)}_${index}`,
    country: 'Haiti',
    isDelivery: false
  }, index));
  bindAddressDepartmentEvents();
}

function collectAddresses() {
  const now = new Date().toISOString();
  return Array.from(elements.clientEditor.querySelectorAll('[data-address-index]')).map((card, index) => {
    const getField = (field) => card.querySelector(`[data-address-field="${field}"]`)?.value?.trim() || '';
    const address = {
      id: getField('id') || `addr_${Date.now().toString(36)}_${index}`,
      label: `Adresse ${index + 1}`,
      address: getField('address'),
      country: 'Haiti',
      department: getField('department'),
      commune: getField('commune'),
      isDelivery: getField('isDelivery') === 'true',
      updatedAt: now
    };
    return address.address || address.department || address.commune ? address : null;
  }).filter(Boolean);
}

async function saveSelectedClient(event) {
  event.preventDefault();
  const client = state.clients.find((item) => item.id === state.selectedId);
  if (!client) return;

  const now = new Date().toISOString();
  const firstName = elements.clientEditor.querySelector('#editFirstName')?.value?.trim() || '';
  const lastName = elements.clientEditor.querySelector('#editLastName')?.value?.trim() || '';
  const username = elements.clientEditor.querySelector('#editUsername')?.value?.trim() || '';
  const birthDate = elements.clientEditor.querySelector('#editBirthDate')?.value?.trim() || '';
  const email = elements.clientEditor.querySelector('#editEmail')?.value?.trim() || '';
  const phone = elements.clientEditor.querySelector('#editPhone')?.value?.trim() || '';
  const addresses = collectAddresses();

  if (!firstName || !lastName || !email) {
    showNotice('Nom, prenom et email sont obligatoires.', 'error');
    return;
  }

  if (addresses.some((address) => !address.address || !address.department || !address.commune)) {
    showNotice('Chaque adresse doit avoir adresse, departement et commune.', 'error');
    return;
  }

  const deliveryAddress = addresses.find((address) => address.isDelivery) || addresses[0] || {};
  const payload = {
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    username,
    displayName: username,
    birthDate,
    email,
    phone,
    address: deliveryAddress.address || '',
    country: deliveryAddress.country || 'Haiti',
    department: deliveryAddress.department || '',
    commune: deliveryAddress.commune || '',
    city: deliveryAddress.commune || '',
    addresses,
    defaultDeliveryAddressId: deliveryAddress.id || '',
    updatedAt: now,
    updatedBy: state.adminUid || 'dashboard_admin'
  };

  await setDoc(doc(db, 'clients', client.id), payload, { merge: true });
  showNotice('Client mis a jour.');
  await loadClients();
  state.selectedId = client.id;
  updateStats();
  applyFilters();
  renderEditor();
}

async function deleteSelectedClient() {
  const client = state.clients.find((item) => item.id === state.selectedId);
  if (!client) return;

  const role = normalizeRole(client);
  if (role === 'admin' || client.id === state.adminUid) {
    showNotice('Ce compte admin est protege et ne peut pas etre supprime ici.', 'error');
    return;
  }

  const typed = window.prompt(`Tape SUPPRIMER pour retirer le client ${getClientName(client)}.`);
  if (typed !== 'SUPPRIMER') return;

  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Session admin introuvable.');
    const response = await fetch(DELETE_CLIENT_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ clientId: client.id })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    }
    const vendorDeleted = Boolean(
      payload?.vendorCleanup?.vendorDeleted ||
      payload?.vendorCleanup?.vendorApplicationDeleted ||
      Number(payload?.vendorCleanup?.vendorProductsDeleted || 0) > 0
    );
    showNotice(vendorDeleted
      ? 'Compte client et profil vendeur supprimes.'
      : (payload?.authDeleted === false ? 'Client supprime. Aucun compte Auth correspondant n existait.' : 'Compte client supprime.'));
  } catch (error) {
    console.error('Suppression client impossible:', error);
    showNotice(error?.message || 'Impossible de supprimer ce compte client.', 'error');
    return;
  }

  state.selectedId = '';
  await loadClients();
}

async function boot() {
  await authReadyPromise;
  onAuthStateChanged(auth, async (user) => {
    state.adminUid = user?.uid || '';
    if (!user) {
      elements.clientEditor.innerHTML = '<p>Connecte-toi avec un compte admin pour gerer les clients.</p>';
      return;
    }
    try {
      await loadClients();
    } catch (error) {
      console.error('Erreur chargement clients:', error);
      showNotice(error?.message || 'Impossible de charger les clients.', 'error');
    }
  });
}

elements.clientSearch?.addEventListener('input', applyFilters);
elements.roleFilter?.addEventListener('change', applyFilters);
elements.refreshClientsBtn?.addEventListener('click', loadClients);

boot();
