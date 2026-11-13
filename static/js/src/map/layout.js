// layout.js – авто‑раскладка (grid, circle, cose и т.д.)
import { getCy } from './core.js';
import { t } from '../i18n/i18n.js';
import { boundNodePosition, getBgDimensions } from './background.js';
import { showToast } from '../utils/toast.js';
import { http } from '../utils/http.js';
import { beginSelfUpdate, endSelfUpdate } from '../utils/state.js';
import { registerCleanup } from './moduleRegistry.js';
import { flushPendingDragSaves } from './interactions.js';
import { isDragLocked } from './lock.js';
import { selectedVisibleDevices } from './bulk.js';

let layoutRunning = false;
let activeCy = null;
let activeLayout = null;
let cancelLayout = null;
let detachLockListener = null;

export function initLayout(cy) {
    cleanup();
    activeCy = cy;
    const mapId = window.currentMapId;

    const applyLayout = (layoutName, direction = null, selectedDevices = null) => {
        if (activeCy !== cy || String(window.currentMapId) !== String(mapId)) return;
        if (window.canEditMap !== true || isDragLocked()) {
            showToast(t('toast.errorTitle'), t('common.accessDenied'), 'error');
            return;
        }
        if (layoutRunning) return;
        layoutRunning = true;
        const partial = Boolean(selectedDevices && selectedDevices.length);
        const selectedIds = partial ? new Set(selectedDevices.map(node => node.id())) : null;
        const layoutElements = partial
            ? selectedDevices.union(cy.edges().filter(edge =>
                selectedIds.has(edge.data('source')) && selectedIds.has(edge.data('target'))
            ))
            : cy.elements();
        const initialBounds = partial ? selectedDevices.boundingBox({ includeLabels: false }) : null;
        const layoutOptions = {
            name: layoutName,
            animate: true,
            animationDuration: 500,
            fit: !partial,
            padding: 30,
            ...(partial ? {
                boundingBox: {
                    x1: initialBounds.x1 - 40,
                    y1: initialBounds.y1 - 40,
                    x2: initialBounds.x2 + 40,
                    y2: initialBounds.y2 + 40
                }
            } : {})
        };
        if (layoutName === 'cose') {
            // ... существующие параметры ...
        } else if (layoutName === 'breadthfirst') {
            layoutOptions.directed = true;
            layoutOptions.spacingFactor = 1.5;
            // Добавляем направление, если оно передано
            if (direction) {
                // Важно: в Cy 3.33+ параметр называется 'direction', а не 'orient'
                layoutOptions.direction = direction;   // 'top-bottom', 'bottom-top', 'left-right', 'right-left'
            }
            // Можно также указать корневой узел, если нужно (layoutOptions.roots = [...])
        }
        const originalPositions = layoutElements.nodes().filter(node => !node.data('isGroup')).map(node => ({ node, position: { ...node.position() } }));
        let cancelled = false;
        cancelLayout = () => {
            cancelled = true;
            layout.stop();
        };
        const layout = layoutElements.layout(layoutOptions);
        activeLayout = layout;
        layout.on('layoutstop', () => {
            if (activeLayout === layout) activeLayout = null;
            cancelLayout = null;
            layoutRunning = false;
            if (cancelled || isDragLocked()) {
                if (activeCy === cy) cy.batch(() => originalPositions.forEach(({ node, position }) => { if (!node.removed()) node.position(position); }));
                return;
            }
            if (activeCy === cy && String(window.currentMapId) === String(mapId)) {
                if (partial) separateFromStationary(cy, selectedDevices);
                saveAllPositions(cy, mapId, partial ? selectedDevices : null, originalPositions);
            }
        });
        layout.run();
    };

    const confirmLayout = async (layoutName, direction = null) => {
        if (window.canEditMap !== true || isDragLocked()) {
            showToast(t('toast.errorTitle'), t('common.accessDenied'), 'error');
            return;
        }
        const names = {
            grid: t('layout.grid'),
            circle: t('layout.circle'),
            concentric: t('layout.concentric'),
            breadthfirst: t('layout.tree'),
            cose: t('layout.force')
        };
        let msg = t('layout.applyPrompt', { name: names[layoutName] || layoutName });
        const currentSelection = selectedVisibleDevices(cy);
        if (cy.$(':selected').length && currentSelection.length < 2) {
            showToast(t('toast.infoTitle'), t('layout.selectAtLeastTwo'), 'info');
            return;
        }
        if (currentSelection.length >= 2) {
            msg += ` ${t('layout.selectedDevicesPrompt', { count: currentSelection.length })}`;
        }
        if (direction) {
            const dirNames = {
                'top-bottom': t('layout.dirTopBottom'),
                'bottom-top': t('layout.dirBottomTop'),
                'left-right': t('layout.dirLeftRight'),
                'right-left': t('layout.dirRightLeft')
            };
            msg += ` (${dirNames[direction]})`;
        }
        const confirmed = await window.confirmAction({
            title: t('layout.confirmTitle'),
            message: msg + '?',
            confirmText: t('layout.apply'),
            variant: 'primary'
        });
        if (!confirmed) return;
        await flushPendingDragSaves();
        if (activeCy !== cy || String(window.currentMapId) !== String(mapId)) return;
        const confirmedSelection = selectedVisibleDevices(cy);
        if (currentSelection.length !== confirmedSelection.length
            || currentSelection.some(node => node.removed() || !confirmedSelection.has(node))) {
            showToast(t('toast.infoTitle'), t('bulk.selectionChanged'), 'info');
            return;
        }
        applyLayout(layoutName, direction, currentSelection.length ? currentSelection : null);
    };
    const onLockChange = event => { if (event.detail?.locked && cancelLayout) cancelLayout(); };
    window.addEventListener('linkvision:drag-lock-changed', onLockChange);
    detachLockListener = () => window.removeEventListener('linkvision:drag-lock-changed', onLockChange);
    window.applyLayout = applyLayout;
    window.confirmLayout = confirmLayout;
}

async function saveAllPositions(cy, mapId, selectedDevices = null, originalPositions = []) {
    if (!cy || getCy() !== cy || String(window.currentMapId) !== String(mapId)) return;
    const devices = selectedDevices || cy.nodes().filter(n => !n.data('isGroup') && !n.data('isShape'));
    const updates = devices.map(device => {
        let pos = device.position();
        const { width, height } = getBgDimensions();
        if (width && height) {
            const bounded = boundNodePosition(pos);
            if (bounded.x !== pos.x || bounded.y !== pos.y) device.position(bounded);
            pos = device.position();
        }
        return { id: device.id(), x: Math.round(pos.x), y: Math.round(pos.y) };
    });
    if (!updates.length) return;
    const toast = showToast(t('layout.saving'), t('layout.savingPositions'), 'info', { autoHide: false });
    beginSelfUpdate();
    try {
        const data = await http.put('/api/devices/positions', { positions: updates, operation: 'layout' });
        if (getCy() !== cy || String(window.currentMapId) !== String(mapId)) return;
        showToast(t('toast.successTitle'), t('layout.savedPositions', { count: data.updated }), 'success');
        if (typeof window.saveState === 'function') window.saveState('Авто-раскладка');
    } catch (err) {
        console.error(err);
        if (getCy() === cy && String(window.currentMapId) === String(mapId)) {
            cy.batch(() => originalPositions.forEach(({ node, position }) => { if (!node.removed()) node.position(position); }));
        }
        showToast(t('toast.errorTitle'), err.message, 'error');
    } finally {
        endSelfUpdate();
        if (toast && toast.hide) toast.hide();
    }
}

// If the new layout overlaps stationary nodes, move the selected set together
// to the nearest free slot, preserving the layout and its edge geometry.
function separateFromStationary(cy, selectedDevices) {
    const selectedIds = new Set(selectedDevices.map(node => node.id()));
    const stationary = cy.nodes().filter(node =>
        !selectedIds.has(node.id()) && !node.data('isGroup')
    ).map(node => node.boundingBox({ includeLabels: true }));
    const selectedBoxes = selectedDevices.map(node => node.boundingBox({ includeLabels: true }));
    const overlaps = (dx, dy) => selectedDevices.some((_node, index) => {
        const box = selectedBoxes[index];
        return stationary.some(obstacle => {
            return box.x1 + dx < obstacle.x2 + 12 && box.x2 + dx > obstacle.x1 - 12 &&
                box.y1 + dy < obstacle.y2 + 12 && box.y2 + dy > obstacle.y1 - 12;
        });
    });
    if (!overlaps(0, 0)) return;

    let offset = null;
    for (let radius = 1; radius <= 20 && !offset; radius++) {
        const candidates = [
            [radius, 0], [-radius, 0], [0, radius], [0, -radius],
            [radius, radius], [radius, -radius], [-radius, radius], [-radius, -radius]
        ];
        offset = candidates.map(([x, y]) => ({ x: x * 40, y: y * 40 }))
            .find(candidate => !overlaps(candidate.x, candidate.y));
    }
    if (!offset) return;
    cy.batch(() => selectedDevices.forEach(node => node.position({
        x: node.position('x') + offset.x,
        y: node.position('y') + offset.y
    })));
}

export function cleanup() {
    const layout = activeLayout;
    activeLayout = null;
    activeCy = null;
    detachLockListener?.();
    detachLockListener = null;
    cancelLayout = null;
    layoutRunning = false;
    if (layout) layout.stop();
    delete window.applyLayout;
    delete window.confirmLayout;
}

registerCleanup(cleanup);
