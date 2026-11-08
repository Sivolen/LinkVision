import { http } from '../utils/http.js';
import { t } from '../i18n/i18n.js';
import { showToast } from '../utils/toast.js';
import { setLayerVisibility } from './visibility.js';
import { registerCleanup } from './moduleRegistry.js';

let mapId = null, layers = [], visibleIds = new Set(), root = null, outsideHandler = null;
let toggleButton = null;
let requestVersion = 0;
let visibilitySave = Promise.resolve();
const togglePanel = () => { const open = root?.hidden; render(); setPanelOpen(open); };
const updatePermissions = () => render();
const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

function apply() {
    const deviceLayers = new Map(), linkLayers = new Map();
    layers.forEach(layer => {
        layer.device_ids.forEach(id => deviceLayers.set(id, [...(deviceLayers.get(id) || []), layer.id]));
        layer.link_ids.forEach(id => linkLayers.set(id, [...(linkLayers.get(id) || []), layer.id]));
    });
    setLayerVisibility({ deviceLayers, linkLayers, visibleLayerIds: [...visibleIds] });
}

// The toolbar scrolls horizontally on narrow screens and therefore clips an
// absolutely positioned child. Bootstrap dropdowns already work around this
// in map_view.html; the custom layer popover needs the same treatment.
function setPanelOpen(open) {
    if (!root) return;
    root.hidden = !open;
    const toolbar = root.closest('.toolbar');
    if (!toolbar) return;
    if (open) {
        toolbar.style.overflowX = 'visible';
        toolbar.style.overflowY = 'visible';
    } else {
        toolbar.style.removeProperty('overflow-x');
        toolbar.style.removeProperty('overflow-y');
    }
}

function render() {
    if (!root) return;
    const canEdit = window.canEditMap === true && window.dragLocked !== true;
    root.innerHTML = `<div class="map-layers-head"><strong>${escape(t('layers.title'))}</strong><button type="button" class="btn-close" data-layer-close aria-label="${escape(t('common.close'))}"></button></div>
      <div class="map-layers-actions"><button type="button" class="btn btn-sm btn-outline-primary" data-layer-all>${escape(t('layers.showAll'))}</button>${canEdit ? `<button type="button" class="btn btn-sm btn-primary" data-layer-create>${escape(t('layers.create'))}</button>` : ''}</div>
      <div class="map-layers-list">${layers.length ? layers.map(layer => `<div class="map-layer-row"><label><input type="checkbox" data-layer-visible="${layer.id}" ${visibleIds.has(layer.id) ? 'checked' : ''}><span class="map-layer-name">${escape(layer.name)}</span><span class="map-layer-count" title="${escape(t('layers.elementCount', { devices: layer.device_count, links: layer.link_count }))}"><i class="fas fa-server" aria-hidden="true"></i>${layer.device_count}<i class="fas fa-link" aria-hidden="true"></i>${layer.link_count}</span></label>${canEdit ? `<div class="map-layer-controls"><button type="button" class="btn btn-sm btn-link" data-layer-assign="${layer.id}" title="${escape(t('layers.assignSelection'))}"><i class="fas fa-check"></i></button><button type="button" class="btn btn-sm btn-link" data-layer-edit="${layer.id}" title="${escape(t('common.edit'))}">⋯</button><button type="button" class="btn btn-sm btn-link text-danger" data-layer-delete="${layer.id}" title="${escape(t('common.delete'))}"><i class="fas fa-trash"></i></button></div>` : ''}</div>`).join('') : `<p class="map-layers-empty">${escape(t('layers.empty'))}</p>`}</div>`;
    root.querySelector('[data-layer-close]')?.addEventListener('click', () => setPanelOpen(false));
    root.querySelector('[data-layer-all]')?.addEventListener('click', () => updateVisible(layers.map(layer => layer.id)));
    root.querySelector('[data-layer-create]')?.addEventListener('click', createLayer);
    root.querySelectorAll('[data-layer-visible]').forEach(input => input.addEventListener('change', () => updateVisible([...root.querySelectorAll('[data-layer-visible]:checked')].map(x => Number(x.dataset.layerVisible)))));
    root.querySelectorAll('[data-layer-edit]').forEach(button => button.addEventListener('click', () => editLayer(Number(button.dataset.layerEdit))));
    root.querySelectorAll('[data-layer-assign]').forEach(button => button.addEventListener('click', () => assignSelection(Number(button.dataset.layerAssign))));
    root.querySelectorAll('[data-layer-delete]').forEach(button => button.addEventListener('click', () => deleteLayer(Number(button.dataset.layerDelete))));
}

async function updateVisible(ids) {
    ++requestVersion;
    visibleIds = new Set(ids);
    apply();
    render();
    const targetMap = mapId;
    // Preserve click order even when a slow request finishes after a newer
    // click. Otherwise F5 could restore an older preference.
    visibilitySave = visibilitySave.catch(() => {}).then(() => http.put(`/api/map/${targetMap}/layer-visibility`, { visible_layer_ids: ids }));
    try { await visibilitySave; }
    catch { if (mapId === targetMap) showToast(t('toast.errorTitle'), t('layers.saveFailed'), 'error'); }
}
async function createLayer() { const name = window.prompt(t('layers.namePrompt')); if (!name?.trim()) return; try { await http.post(`/api/map/${mapId}/layers`, { name: name.trim() }); await refreshLayers(); } catch (error) { showToast(t('toast.errorTitle'), t('layers.createFailed'), 'error'); } }
async function editLayer(id) { const layer = layers.find(item => item.id === id); if (!layer) return; const name = window.prompt(t('layers.renamePrompt'), layer.name); if (name === null || !name.trim()) return; const description = window.prompt(t('layers.descriptionPrompt'), layer.description || ''); if (description === null) return; try { await http.put(`/api/map/${mapId}/layers/${id}`, { name: name.trim(), description }); await refreshLayers(); } catch (error) { showToast(t('toast.errorTitle'), t('layers.saveFailed'), 'error'); } }
async function deleteLayer(id) { const layer = layers.find(item => item.id === id); if (!layer || !window.confirm(t('layers.deleteQuestion', { name: layer.name }))) return; try { await http.del(`/api/map/${mapId}/layers/${id}`); await refreshLayers(); } catch { showToast(t('toast.errorTitle'), t('layers.saveFailed'), 'error'); } }
async function assignSelection(layerId) { const selected = window.cy?.$(':selected'); const deviceIds = [], linkIds = []; selected?.forEach(item => { if (item.isNode() && !item.data('isGroup') && !item.data('isShape')) deviceIds.push(Number(item.id())); else if (item.isEdge()) linkIds.push(Number(String(item.id()).replace(/^link_/, ''))); }); if (!deviceIds.length && !linkIds.length) { showToast(t('toast.infoTitle'), t('layers.selectElements'), 'info'); return; } try { await http.put(`/api/map/${mapId}/layers/assignments`, { layer_ids: [layerId], device_ids: deviceIds, link_ids: linkIds, mode: 'add' }); await refreshLayers(); } catch { showToast(t('toast.errorTitle'), t('layers.saveFailed'), 'error'); } }

export async function refreshLayers() {
    if (!mapId) return;
    const version = ++requestVersion;
    const requestedMap = mapId;
    const [list, visibility] = await Promise.all([http.get(`/api/map/${mapId}/layers`), http.get(`/api/map/${mapId}/layer-visibility`)]);
    if (version !== requestVersion || requestedMap !== mapId) return;
    layers = list.layers || []; visibleIds = new Set(visibility.visible_layer_ids || []); apply(); render();
}
export function initLayers(id) {
    cleanup(); mapId = id; root = document.getElementById('mapLayersPanel'); const button = document.getElementById('layersToggle');
    if (!root || !button) return;
    // Render the shell synchronously. Previously the panel stayed completely
    // empty until the two API requests finished, which made "New layer" look
    // as if it appeared only after a later click.
    render();
    toggleButton = button;
    button.addEventListener('click', togglePanel);
    window.addEventListener('linkvision:edit-permission-changed', updatePermissions);
    window.addEventListener('linkvision:drag-lock-changed', updatePermissions);
    outsideHandler = event => { if (!root.hidden && !root.contains(event.target) && event.target !== button && !button.contains(event.target)) setPanelOpen(false); };
    document.addEventListener('click', outsideHandler); refreshLayers().catch(() => showToast(t('toast.errorTitle'), t('layers.loadFailed'), 'error'));
}
export function cleanup() {
    ++requestVersion;
    setPanelOpen(false);
    toggleButton?.removeEventListener('click', togglePanel);
    window.removeEventListener('linkvision:edit-permission-changed', updatePermissions);
    window.removeEventListener('linkvision:drag-lock-changed', updatePermissions);
    if (outsideHandler) document.removeEventListener('click', outsideHandler);
    toggleButton = null; mapId = null; layers = []; visibleIds = new Set(); root = null; outsideHandler = null;
}
registerCleanup(cleanup);
