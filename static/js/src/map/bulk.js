// Bulk edits target the visible devices listed when the dialog was opened.
import { http } from '../utils/http.js';
import { rememberLocalOperation } from '../utils/state.js';
import { t } from '../i18n/i18n.js';
import { showToast } from '../utils/toast.js';
import { scheduleResync } from './resync.js';

let cy = null;
let flushPendingDragSaves;
let selection = null;
let opening = false;
let saving = false;

export function selectedVisibleDevices(instance) {
    return instance.nodes(':selected').filter(node =>
        !node.data('isGroup') && !node.data('isShape') && node.visible()
    );
}

export function initBulk(instance, flushDragSaves) {
    cy = instance;
    flushPendingDragSaves = flushDragSaves;
    selection = null;
    window.openBulkEditModal = openBulkEditModal;
    window.applyBulkEdit = applyBulkEdit;
    updateBulkEditButton();
}

export function updateBulkEditButton() {
    const group = document.getElementById('bulkEditGroup');
    if (group && cy && !cy.destroyed()) {
        group.style.display = selectedVisibleDevices(cy).length ? 'flex' : 'none';
    }
}

const field = name => document.getElementById(name);
const showError = key => showToast(t('toast.errorTitle'), t(key), 'error');
const isCurrent = target => target.cy === cy && !cy.destroyed()
    && String(target.mapId) === String(window.currentMapId);

function fillOptions(select, options, resetLabelKey) {
    select.replaceChildren(new Option(t('bulk.keepUnchanged'), ''));
    if (resetLabelKey) select.add(new Option(t(resetLabelKey), 'reset'));
    options.forEach(item => select.add(new Option(item.name, item.id)));
}

async function openBulkEditModal() {
    if (opening || saving) return;
    if (window.canEditMap !== true) return showError('common.accessDenied');
    const selected = selectedVisibleDevices(cy);
    if (!selected.length) return showError('bulk.noneSelected');

    const target = { cy, mapId: window.currentMapId, ids: selected.map(node => node.id()) };
    opening = true;
    try {
        const [types, groups, profiles] = await Promise.all([
            http.get('/api/types'),
            http.get(`/api/map/${target.mapId}/groups`),
            http.get('/api/quality-profiles')
        ]);
        if (!isCurrent(target)) return;
        if (window.canEditMap !== true) return showError('common.accessDenied');
        if (target.ids.some(id => !cy.getElementById(id).visible())) return showError('bulk.selectionChanged');

        fillOptions(field('bulk_type'), types);
        fillOptions(field('bulk_group'), groups, 'bulk.noGroup');
        fillOptions(
            field('bulk_quality_profile'),
            profiles.filter(profile => !profile.is_default),
            'modal.device.defaultQualityProfileOpt'
        );
        field('bulk_monitoring').value = '';
        field('bulk_center').checked = false;
        field('bulk_center').disabled = window.dragLocked === true;
        field('selectedCount').textContent = selected.length;
        field('bulk_device_names').textContent = selected.map(node => node.data('name') || node.id()).join(', ');
        selection = target;
        bootstrap.Modal.getOrCreateInstance(field('bulkEditModal')).show();
    } catch (error) {
        console.error('Bulk edit options failed:', error);
        showError('bulk.loadFailed');
    } finally {
        opening = false;
    }
}

async function applyBulkEdit() {
    const target = selection;
    if (saving || !target || !isCurrent(target)) return;
    if (window.canEditMap !== true) return showError('common.accessDenied');

    const type = field('bulk_type').value;
    const group = field('bulk_group').value;
    const monitoring = field('bulk_monitoring').value;
    const qualityProfile = field('bulk_quality_profile').value;
    const move = field('bulk_center').checked;
    const fields = {};
    if (type) fields.type_id = Number(type);
    if (group) fields.group_id = group === 'reset' ? null : Number(group);
    if (qualityProfile) fields.quality_profile_id = qualityProfile === 'reset' ? null : Number(qualityProfile);
    if (monitoring) fields.monitoring_enabled = monitoring === 'true';
    if (!move && !Object.keys(fields).length) return showError('bulk.noChanges');

    const button = field('bulk_apply');
    saving = true;
    button.disabled = true;
    try {
        if (move) await flushPendingDragSaves();
        if (!isCurrent(target)) return;
        if (window.canEditMap !== true || (move && window.dragLocked === true)) return showError('common.accessDenied');
        if (target.ids.some(id => !cy.getElementById(id).visible())) return showError('bulk.selectionChanged');

        let center;
        if (move) {
            const container = cy.container();
            const pan = cy.pan();
            const zoom = cy.zoom();
            center = [(container.clientWidth / 2 - pan.x) / zoom, (container.clientHeight / 2 - pan.y) / zoom];
        }
        const operationId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        rememberLocalOperation(operationId);
        const result = await http.put(`/api/map/${target.mapId}/devices/bulk`, {
            device_ids: target.ids.map(Number), fields, center, operation_id: operationId
        });
        if (!isCurrent(target)) return;
        selection = null;
        bootstrap.Modal.getInstance(field('bulkEditModal'))?.hide();
        scheduleResync(() => window.withViewportRestore(() => window.reloadMapElements(true)));
        showToast(t('toast.successTitle'), t('bulk.saved', { count: result.updated }), 'success');
    } catch (error) {
        console.error('Bulk edit failed:', error);
        showError('bulk.saveFailed');
        // A lost HTTP response can follow a successful commit.
        if (isCurrent(target)) scheduleResync(() => window.withViewportRestore(() => window.reloadMapElements(true)));
    } finally {
        saving = false;
        button.disabled = false;
    }
}
