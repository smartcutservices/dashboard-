import './admin-access.js';
import { auth } from './firebase-init.js';

const API = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/autoPartsApi';
const root = document.getElementById('autoPartsAdminApp');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const token = async () => auth.currentUser?.getIdToken();
async function call(action, data = {}, method = 'GET') {
  const idToken = await token();
  const url = new URL(API); url.searchParams.set('action', action);
  const response = await fetch(url, { method, headers: { Accept:'application/json', Authorization:`Bearer ${idToken}`, ...(method !== 'GET' ? {'Content-Type':'application/json'} : {}) }, body: method !== 'GET' ? JSON.stringify({ action, ...data }) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || payload.error || 'Opération impossible');
  return payload;
}
function render(categories) {
  root.innerHTML = `<div style="display:grid;gap:1rem">${categories.map(category => `<article data-category="${esc(category.id)}" style="border:1px solid #ddd;border-radius:14px;padding:1rem"><div style="display:flex;justify-content:space-between;gap:1rem;align-items:center"><div><strong>${esc(category.label || category.name)}</strong><small style="display:block;color:#667085">${category.subcategories?.length || 0} sous-catégories</small></div><button data-edit="${esc(category.id)}">Modifier</button></div><div class="subcategories" style="margin-top:.75rem;display:grid;gap:.4rem">${(category.subcategories || []).map(sub => `<div><strong>${esc(sub.label)}</strong><small style="display:block;color:#667085">${(sub.dynamicFields || []).map(field => esc(field.label)).join(' · ') || 'Champs génériques'}</small></div>`).join('')}</div></article>`).join('')}</div><button id="newCategory" style="margin-top:1rem">Ajouter une catégorie</button><p id="adminNotice" role="status"></p>`;
  root.querySelector('#newCategory').onclick = () => editVisual({ id:'', label:'', subcategories:[] });
  root.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => editVisual(categories.find(category => category.id === button.dataset.edit)));
}

function editVisual(category) {
  const value = category || { id:'', label:'', order:0, isActive:true, subcategories:[] };
  const rows = (value.subcategories || []).map((item, index) => `<div class="sub-row" data-index="${index}" style="border:1px solid #d9e0e7;border-radius:10px;padding:.75rem;display:grid;gap:.5rem"><div style="display:flex;gap:.5rem;align-items:center"><input data-sub-label value="${esc(item.label || item.name)}" placeholder="Nom de la sous-catégorie" required><button type="button" data-remove-sub>Supprimer</button></div><label>Champs dynamiques (JSON)<textarea data-sub-fields rows="4">${esc(JSON.stringify(item.dynamicFields || [], null, 2))}</textarea></div>`).join('');
  root.innerHTML = `<form id="categoryForm" style="display:grid;gap:.8rem;border:1px solid #ddd;border-radius:14px;padding:1rem"><label>ID<input name="id" value="${esc(value.id)}" required></label><label>Nom<input name="label" value="${esc(value.label || value.name)}" required></label><label>Ordre<input name="order" type="number" value="${Number(value.order || 0)}"></label><label><input name="isActive" type="checkbox" ${value.isActive !== false ? 'checked' : ''}> Active</label><section><h2 style="font-size:1.1rem">Sous-catégories</h2><div id="subRows" style="display:grid;gap:.6rem">${rows}</div><button type="button" id="addSub">Ajouter une sous-catégorie</button></section><div><button type="submit">Enregistrer</button><button type="button" id="cancelCategory">Annuler</button></div><p id="adminNotice" role="status"></p></form>`;
  const subRows = root.querySelector('#subRows');
  root.querySelector('#addSub').onclick = () => { const index = subRows.children.length; const node = document.createElement('div'); node.className = 'sub-row'; node.dataset.index = index; node.style.cssText = 'border:1px solid #d9e0e7;border-radius:10px;padding:.75rem;display:grid;gap:.5rem'; node.innerHTML = '<div style="display:flex;gap:.5rem;align-items:center"><input data-sub-label placeholder="Nom de la sous-catégorie" required><button type="button" data-remove-sub>Supprimer</button></div><label>Champs dynamiques (JSON)<textarea data-sub-fields rows="4">[]</textarea></label>'; subRows.appendChild(node); bindSubRows(); };
  const bindSubRows = () => root.querySelectorAll('[data-remove-sub]').forEach(button => button.onclick = () => button.closest('.sub-row')?.remove());
  bindSubRows();
  root.querySelector('#cancelCategory').onclick = load;
  root.querySelector('#categoryForm').onsubmit = async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const notice = root.querySelector('#adminNotice'); try { const subcategories = [...root.querySelectorAll('.sub-row')].map((row, index) => ({ id: String(row.querySelector('[data-sub-label]').value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''), label: row.querySelector('[data-sub-label]').value.trim(), order:index, dynamicFields: JSON.parse(row.querySelector('[data-sub-fields]').value || '[]') })); await call('saveTaxonomyCategory', { id:form.get('id'), label:form.get('label'), order:Number(form.get('order') || 0), isActive:form.get('isActive') === 'on', subcategories }, 'POST'); notice.textContent = 'Catégorie enregistrée.'; await load(); } catch (error) { notice.textContent = error.message; } };
}
function edit(category) {
  const value = category || { id:'', label:'', order:0, isActive:true, subcategories:[] };
  root.innerHTML = `<form id="categoryForm" style="display:grid;gap:.8rem;border:1px solid #ddd;border-radius:14px;padding:1rem"><label>ID<input name="id" value="${esc(value.id)}" required></label><label>Nom<label><input name="label" value="${esc(value.label || value.name)}" required></label></label><label>Ordre<input name="order" type="number" value="${Number(value.order || 0)}"></label><label><input name="isActive" type="checkbox" ${value.isActive !== false ? 'checked' : ''}> Active</label><label>Sous-catégories et champs dynamiques (JSON)<textarea name="subcategories" rows="18">${esc(JSON.stringify(value.subcategories || [], null, 2))}</textarea></label><div><button type="submit">Enregistrer</button><button type="button" id="cancelCategory">Annuler</button></div><p id="adminNotice" role="status"></p></form>`;
  root.querySelector('#cancelCategory').onclick = load;
  root.querySelector('#categoryForm').onsubmit = async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const notice = root.querySelector('#adminNotice'); try { const subcategories = JSON.parse(form.get('subcategories') || '[]'); await call('saveTaxonomyCategory', { id:form.get('id'), label:form.get('label'), order:Number(form.get('order') || 0), isActive:form.get('isActive') === 'on', subcategories }, 'POST'); notice.textContent = 'Catégorie enregistrée.'; await load(); } catch (error) { notice.textContent = error.message; } };
}
async function load() { try { const payload = await call('taxonomy'); render(payload.categories || []); } catch (error) { root.innerHTML = `<p style="color:#a52d25">${esc(error.message)}</p>`; } }
document.addEventListener('adminAccessGranted', load, { once:true });
if (document.body.dataset.adminAccess === 'granted') load();
