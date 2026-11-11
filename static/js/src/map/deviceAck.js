import { http } from '../utils/http.js';
import { showToast } from '../utils/toast.js';
import { t } from '../i18n/i18n.js';
import { addPulsingNode, removePulsingNode } from './pulse.js';
import { refreshZoomEmphasis } from './zoomEmphasis.js';
import { refreshAllCollapsedStatuses } from './groupCollapse.js';
import { applyMapVisibility, getStatusFilter } from './visibility.js';
import { updateSidebarCounter } from './sidebar.js';

const pending = new WeakSet();

export function canAcknowledge(node) {
    const monitoring = node.data('monitoring_enabled');
    return (monitoring === true || monitoring === 'true')
        && ['down', 'partial'].includes(node.data('status'));
}

export function applyAcknowledgment(cy, node, acknowledged) {
    if (!node.length || node.removed() || node.cy() !== cy) return;
    const value = acknowledged === true && canAcknowledge(node);
    if (Boolean(node.data('acknowledged')) === value) return;
    cy.batch(() => {
        node.data('acknowledged', value);
        removePulsingNode(cy, node);
    });
    refreshZoomEmphasis();
    updateSidebarCounter(window.currentMapId, !value);
    if (!value && canAcknowledge(node)) addPulsingNode(cy, node, node.data('status'));
    refreshAllCollapsedStatuses();
    if (getStatusFilter() !== 'all') applyMapVisibility();
}

export async function toggleAcknowledgment(cy, node) {
    if (window.canEditMap !== true || !canAcknowledge(node) || pending.has(node)) return;
    pending.add(node);
    try {
        const result = await http.put(`/api/device/${node.id()}/acknowledgment`, {
            acknowledged: !node.data('acknowledged'),
        });
        applyAcknowledgment(cy, node, result.acknowledged);
    } catch {
        showToast(t('toast.errorTitle'), t('contextMenu.acknowledgmentFailed'), 'danger');
    } finally {
        pending.delete(node);
    }
}
