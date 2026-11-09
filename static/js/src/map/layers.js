import { http } from '../utils/http.js';
import { t } from '../i18n/i18n.js';
import { showToast } from '../utils/toast.js';
import { setLayerVisibility } from './visibility.js';
import { registerCleanup } from './moduleRegistry.js';

let mapId = null, layers = [], visibleIds = new Set(), root = null, outsideHandler = null;
let toggleButton = null;
let requestVersion = 0;
let visibilitySave = null;
let layerDialog = null;
let orderSaving = false;
const canEditLayers = () => window.canEditMap === true && window.dragLocked !== true;
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
    const canEdit = canEditLayers();
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
    root.querySelectorAll('[data-layer-all], [data-layer-visible]').forEach(input => {
        input.disabled = Boolean(visibilitySave) || !layers.length;
    });
    if (!canEdit || !layers.length) return;
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'btn btn-sm btn-outline-primary';
    manage.textContent = t('layers.membership');
    manage.addEventListener('click', () => openLayerMembership(window.cy?.$(':selected')));
    root.querySelector('.map-layers-actions').append(manage);
    root.querySelectorAll('.map-layer-controls').forEach((controls, index) => {
        for (const [step, label, arrow] of [[-1, 'moveUp', '↑'], [1, 'moveDown', '↓']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-sm btn-link';
            button.textContent = arrow;
            button.title = t(`layers.${label}`);
            button.setAttribute('aria-label', button.title);
            button.disabled = orderSaving || !layers[index + step];
            button.addEventListener('click', () => moveLayer(index, step));
            controls.prepend(button);
        }
    });
}

async function updateVisible(ids) {
    if (visibilitySave) return;
    ++requestVersion;
    const targetMap = mapId;
    const panel = root;
    const save = http.put(`/api/map/${targetMap}/layer-visibility`, { visible_layer_ids: ids }, AbortSignal.timeout(15000));
    visibilitySave = save;
    render();
    try {
        const result = await save;
        if (visibilitySave !== save || root !== panel) return;
        visibleIds = new Set(result.visible_layer_ids);
        apply();
    } catch {
        if (visibilitySave === save) {
            showToast(t('toast.errorTitle'), t('layers.saveFailed'), 'error');
            // A timeout may occur after the server commits the preference.
            refreshLayers().catch(() => {});
        }
    } finally {
        if (visibilitySave === save) {
            visibilitySave = null;
            render();
        }
    }
}
const createLayer = () => editLayer();

function openLayerDialog(title, fields, save) {
    if (!canEditLayers() || layerDialog) return;
    const dialog = document.createElement('dialog');
    layerDialog = dialog;
    const targetMap = mapId;
    dialog.className = 'map-layer-dialog';
    dialog.setAttribute('aria-label', title);
    dialog.innerHTML = `<form><h3></h3><div data-layer-fields></div><p role="alert" class="text-danger" hidden></p>
        <div class="map-layers-actions"><button type="button" class="btn btn-outline-secondary" data-cancel>${escape(t('common.cancel'))}</button>
        <button type="submit" class="btn btn-primary">${escape(t('common.save'))}</button></div></form>`;
    dialog.querySelector('h3').textContent = title;
    dialog.querySelector('[data-layer-fields]').append(fields);
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
        if (layerDialog === dialog) layerDialog = null;
        dialog.remove();
    }, { once: true });
    const form = dialog.querySelector('form');
    const submit = form.querySelector('[type=submit]');
    const error = form.querySelector('[role=alert]');
    dialog.addEventListener('cancel', event => { if (submit.disabled) event.preventDefault(); });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (submit.disabled || targetMap !== mapId) return;
        if (!canEditLayers()) {
            error.textContent = t('common.accessDenied');
            error.hidden = false;
            return;
        }
        submit.disabled = true;
        form.querySelector('[data-cancel]').disabled = true;
        error.hidden = true;
        try {
            await save(targetMap);
            dialog.close();
            if (targetMap === mapId) {
                refreshLayers().catch(() => showToast(t('toast.errorTitle'), t('layers.loadFailed'), 'error'));
            }
        } catch (err) {
            const detail = err.message || '';
            const message = detail.includes('Invalid layer name or description') ? 'invalidName'
                : detail.includes('Layer name already exists') ? 'duplicateName' : 'saveFailed';
            error.textContent = t(`layers.${message}`);
            error.hidden = false;
        } finally {
            submit.disabled = false;
            form.querySelector('[data-cancel]').disabled = false;
        }
    });
    document.body.append(dialog);
    dialog.showModal();
}

function editLayer(id) {
    const layer = layers.find(item => item.id === id);
    if (id != null && !layer) return;
    const fields = document.createElement('div');
    const inputs = [];
    for (const [key, label, maxLength] of [['name', 'namePrompt', 64], ['description', 'descriptionPrompt', 255]]) {
        const wrapper = document.createElement('label');
        wrapper.className = 'map-layer-field';
        wrapper.textContent = t(`layers.${label}`);
        const input = document.createElement('input');
        input.className = 'form-control';
        input.maxLength = maxLength;
        input.value = layer?.[key] || '';
        input.required = key === 'name';
        wrapper.append(input);
        fields.append(wrapper);
        inputs.push(input);
    }
    const [name, description] = inputs;
    name.addEventListener('input', () => name.setCustomValidity(name.value.trim() ? '' : t('layers.invalidName')));
    openLayerDialog(t(layer ? 'common.edit' : 'layers.create'), fields, targetMap => {
        const payload = { name: name.value.trim(), description: description.value.trim() };
        return layer ? http.put(`/api/map/${targetMap}/layers/${id}`, payload)
            : http.post(`/api/map/${targetMap}/layers`, payload);
    });
}

function layerObjectIds(elements) {
    const deviceIds = [], linkIds = [];
    elements?.forEach(item => {
        if (item.isNode() && !item.data('isGroup') && !item.data('isShape')) deviceIds.push(Number(item.id()));
        if (item.isEdge() && /^link_\d+$/.test(item.id())) linkIds.push(Number(item.id().slice(5)));
    });
    return { deviceIds, linkIds };
}

export function openLayerMembership(elements) {
    if (!canEditLayers()) return;
    const { deviceIds, linkIds } = layerObjectIds(elements);
    const total = deviceIds.length + linkIds.length;
    if (!total || !layers.length) {
        showToast(t('toast.infoTitle'), t(total ? 'layers.empty' : 'layers.selectElements'), 'info');
        return;
    }
    const fields = document.createElement('div');
    const changes = new Map();
    for (const layer of layers) {
        const devices = new Set(layer.device_ids);
        const links = new Set(layer.link_ids);
        const count = deviceIds.filter(id => devices.has(id)).length + linkIds.filter(id => links.has(id)).length;
        const row = document.createElement('label');
        row.className = 'map-layer-field';
        const input = document.createElement('select');
        input.className = 'form-select';
        for (const [value, label] of [['', count === total ? 'assigned' : count ? 'mixed' : 'unassigned'], ['add', 'addMembership'], ['remove', 'removeMembership']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = t(`layers.${label}`);
            input.append(option);
        }
        input.addEventListener('change', () => changes.set(layer.id, input.value));
        row.append(document.createTextNode(layer.name), input);
        fields.append(row);
    }
    openLayerDialog(t('layers.membership'), fields, targetMap => {
        const layer_ids = [], remove_layer_ids = [];
        for (const [id, action] of changes) {
            if (action === 'add') layer_ids.push(id);
            if (action === 'remove') remove_layer_ids.push(id);
        }
        if (!layer_ids.length && !remove_layer_ids.length) return;
        return http.put(`/api/map/${targetMap}/layers/assignments`, {
            mode: 'patch', layer_ids, remove_layer_ids, device_ids: deviceIds, link_ids: linkIds,
        });
    });
}

async function moveLayer(index, step) {
    if (orderSaving || !canEditLayers() || !layers[index + step]) return;
    const targetMap = mapId;
    const ids = layers.map(layer => layer.id);
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    orderSaving = true;
    render();
    try {
        await http.put(`/api/map/${targetMap}/layers/order`, { layer_ids: ids });
        if (targetMap === mapId) await refreshLayers();
    } catch {
        if (targetMap === mapId) showToast(t('toast.errorTitle'), t('layers.saveFailed'), 'error');
    } finally {
        if (targetMap === mapId) {
            orderSaving = false;
            render();
        }
    }
}
async function deleteLayer(id) { const layer = layers.find(item => item.id === id); if (!layer || !window.confirm(t('layers.deleteQuestion', { name: layer.name }))) return; try { await http.del(`/api/map/${mapId}/layers/${id}`); await refreshLayers(); } catch { showToast(t('toast.errorTitle'), t('layers.saveFailed'), 'error'); } }
async function assignSelection(layerId) {
    if (!canEditLayers()) return;
    const { deviceIds, linkIds } = layerObjectIds(window.cy?.$(':selected'));
    if (!deviceIds.length && !linkIds.length) {
        showToast(t('toast.infoTitle'), t('layers.selectElements'), 'info');
        return;
    }
    const targetMap = mapId;
    try {
        await http.put(`/api/map/${targetMap}/layers/assignments`, {
            layer_ids: [layerId], device_ids: deviceIds, link_ids: linkIds, mode: 'add',
        });
        if (targetMap === mapId) await refreshLayers();
    } catch {
        if (targetMap === mapId) showToast(t('toast.errorTitle'), t('layers.saveFailed'), 'error');
    }
}

export async function refreshLayers() {
    if (!mapId) return;
    const version = ++requestVersion;
    const requestedMap = mapId;
    if (visibilitySave) await visibilitySave.catch(() => {});
    if (version !== requestVersion || requestedMap !== mapId) return;
    const [list, visibility] = await Promise.all([http.get(`/api/map/${mapId}/layers`), http.get(`/api/map/${mapId}/layer-visibility`)]);
    if (version !== requestVersion || requestedMap !== mapId) return;
    const nextLayers = list.layers || [];
    const nextVisible = new Set(visibility.visible_layer_ids || []);
    const oldById = new Map(layers.map(layer => [layer.id, layer]));
    const topologyChanged = nextLayers.length !== layers.length || nextLayers.some(layer => {
        const old = oldById.get(layer.id);
        return !old || ['device_ids', 'link_ids'].some(key =>
            layer[key].length !== old[key].length || layer[key].some((id, index) => id !== old[key][index]));
    });
    const visibilityChanged = visibleIds.size !== nextVisible.size || [...nextVisible].some(id => !visibleIds.has(id));
    layers = nextLayers;
    visibleIds = nextVisible;
    if (topologyChanged || visibilityChanged) apply();
    render();
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
    outsideHandler = event => {
        const path = event.composedPath();
        if (!root.hidden && !path.includes(root) && !path.includes(button)) setPanelOpen(false);
    };
    document.addEventListener('click', outsideHandler); refreshLayers().catch(() => showToast(t('toast.errorTitle'), t('layers.loadFailed'), 'error'));
}
export function cleanup() {
    ++requestVersion;
    layerDialog?.close();
    layerDialog = null;
    visibilitySave = null;
    orderSaving = false;
    setPanelOpen(false);
    toggleButton?.removeEventListener('click', togglePanel);
    window.removeEventListener('linkvision:edit-permission-changed', updatePermissions);
    window.removeEventListener('linkvision:drag-lock-changed', updatePermissions);
    if (outsideHandler) document.removeEventListener('click', outsideHandler);
    toggleButton = null; mapId = null; layers = []; visibleIds = new Set(); root = null; outsideHandler = null;
}
registerCleanup(cleanup);
