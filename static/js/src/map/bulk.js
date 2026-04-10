// bulk.js – массовое редактирование выбранных устройств
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
        alert('Оператор не может редактировать устройства');
        return;
    }
    const selected = cy.nodes(':selected').filter(n => !n.data('isGroup'));
    if (selected.length === 0) {
        alert('Нет выбранных устройств');
        return;
    }
    document.getElementById('selectedCount').textContent = selected.length;
    await Promise.all([loadTypesForBulk(), loadGroupsForBulk()]);
    const modal = new bootstrap.Modal(document.getElementById('bulkEditModal'));
    modal.show();
}

async function loadTypesForBulk() {
    const res = await fetchWithRetry('/api/types');
    const types = await res.json();
    const select = document.getElementById('bulk_type');
    select.innerHTML = '<option value="">-- Не изменять --</option>';
    types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.text = t.name;
        select.appendChild(opt);
    });
}

async function loadGroupsForBulk() {
    const res = await fetchWithRetry(`/api/map/${window.currentMapId}/groups`);
    const groups = await res.json();
    const select = document.getElementById('bulk_group');
    select.innerHTML = '<option value="">-- Не изменять --</option>';
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
        promises.push(fetch(`/api/device/${node.id()}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify(update)
        }));
    });
    if (!promises.length) { alert('Нет изменений'); return; }
    await Promise.all(promises);
    if (typeof window.saveState === 'function') window.saveState('Массовое редактирование');
    bootstrap.Modal.getInstance(document.getElementById('bulkEditModal')).hide();
    reloadMapElements();
}