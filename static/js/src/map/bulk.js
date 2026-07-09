// bulk.js – массовое редактирование выбранных устройств
import { http } from '../utils/http.js';
import { beginSelfUpdate, endSelfUpdate } from '../utils/state.js';
import { t } from '../i18n/i18n.js';

let cy = null;

export function initBulk(instance) {
    cy = instance;
    window.openBulkEditModal = openBulkEditModal;
    window.applyBulkEdit = applyBulkEdit;
}

export function updateBulkEditButton() {
    const group = document.getElementById('bulkEditGroup');
    if (group && cy) {
        const selectedCount = cy.nodes(':selected').filter(n => !n.data('isGroup')).length;
        group.style.display = selectedCount > 0 ? 'flex' : 'none';
    }
}

async function openBulkEditModal() {
    if (window.isOperator) {
        alert(t('bulk.operatorForbidden'));
        return;
    }
    const selected = cy.nodes(':selected').filter(n => !n.data('isGroup'));
    if (selected.length === 0) {
        alert(t('bulk.noneSelected'));
        return;
    }
    document.getElementById('selectedCount').textContent = selected.length;
    await Promise.all([loadTypesForBulk(), loadGroupsForBulk()]);
    const modal = new bootstrap.Modal(document.getElementById('bulkEditModal'));
    modal.show();
}

async function loadTypesForBulk() {
    const types = await http.get('/api/types');
    const select = document.getElementById('bulk_type');
    select.innerHTML = '<option value="">' + t('bulk.keepUnchanged') + '</option>';
    types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.text = t.name;
        select.appendChild(opt);
    });
}

async function loadGroupsForBulk() {
    const groups = await http.get(`/api/map/${window.currentMapId}/groups`);
    const select = document.getElementById('bulk_group');
    select.innerHTML = '<option value="">' + t('bulk.keepUnchanged') + '</option>';
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.text = g.name;
        select.appendChild(opt);
    });
}

async function applyBulkEdit() {
    const selected = cy.nodes(':selected').filter(n => !n.data('isGroup'));
    if (selected.length === 0) return;
    const typeId = document.getElementById('bulk_type').value;
    const groupId = document.getElementById('bulk_group').value;
    const center = document.getElementById('bulk_center').checked;
    const monitoring = document.getElementById('bulk_monitoring').value;
    let centerX, centerY;
    if (center) {
        const container = document.getElementById('cy');
        const pan = cy.pan();
        const zoom = cy.zoom();
        centerX = (-pan.x + container.clientWidth / 2) / zoom;
        centerY = (-pan.y + container.clientHeight / 2) / zoom;
    }
    const promises = [];
    selected.forEach(node => {
        const update = {};
        if (typeId) update.type_id = parseInt(typeId);
        if (groupId !== '') update.group_id = parseInt(groupId);
        if (center) { update.pos_x = Math.round(centerX); update.pos_y = Math.round(centerY); }
        if (monitoring !== '') update.monitoring_enabled = monitoring === 'true';
        if (Object.keys(update).length === 0) return;
        promises.push(http.put(`/api/device/${node.id()}`, update));
    });
    if (!promises.length) { alert(t('bulk.noChanges')); return; }

    beginSelfUpdate();
    try {
        await Promise.all(promises);
    } finally {
        endSelfUpdate();
    }

    // Восстановление viewport после перезагрузки карты (для других вкладок)
    if (typeof window.withViewportRestore === 'function') {
        window.withViewportRestore(() => {
            reloadMapElements();
        });
    } else {
        // fallback
        let savedViewport = null;
        if (window.cy) savedViewport = { pan: window.cy.pan(), zoom: window.cy.zoom() };
        if (typeof window.setSkipAutoFit === 'function') window.setSkipAutoFit(true);
        reloadMapElements();
        if (savedViewport && window.cy) {
            setTimeout(() => window.cy.viewport(savedViewport), 200);
            setTimeout(() => window.cy.viewport(savedViewport), 500);
        }
        setTimeout(() => { if (typeof window.setSkipAutoFit === 'function') window.setSkipAutoFit(false); }, 600);
    }

    // Null-check: модалка может быть не инициализирована
    const bulkModalEl = document.getElementById('bulkEditModal');
    (bootstrap.Modal.getInstance(bulkModalEl) ?? new bootstrap.Modal(bulkModalEl)).hide();
}