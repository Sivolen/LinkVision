// layout.js – авто‑раскладка (grid, circle, cose и т.д.)
import { getCy } from './core.js';
import { t } from '../i18n/i18n.js';
import { boundNodePosition, getBgDimensions } from './background.js';
import { showToast } from '../utils/toast.js';
import { http } from '../utils/http.js';
import { beginSelfUpdate, endSelfUpdate } from '../utils/state.js';
import { registerCleanup } from './moduleRegistry.js';

let layoutRunning = false;
let activeCy = null;
let activeLayout = null;

export function initLayout(cy) {
    cleanup();
    activeCy = cy;
    const mapId = window.currentMapId;

    const applyLayout = (layoutName, direction = null) => {
        if (activeCy !== cy || String(window.currentMapId) !== String(mapId)) return;
        if (layoutRunning) return;
        layoutRunning = true;
        const layoutOptions = {
            name: layoutName,
            animate: true,
            animationDuration: 500,
            fit: true,
            padding: 30
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
        const layout = cy.layout(layoutOptions);
        activeLayout = layout;
        layout.on('layoutstop', () => {
            if (activeLayout === layout) activeLayout = null;
            layoutRunning = false;
            if (activeCy === cy && String(window.currentMapId) === String(mapId)) {
                saveAllPositions(cy, mapId);
            }
        });
        layout.run();
    };

    const confirmLayout = async (layoutName, direction = null) => {
        const names = {
            grid: t('layout.grid'),
            circle: t('layout.circle'),
            concentric: t('layout.concentric'),
            breadthfirst: t('layout.tree'),
            cose: t('layout.force')
        };
        let msg = t('layout.applyPrompt', { name: names[layoutName] || layoutName });
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
        if (confirmed && activeCy === cy && String(window.currentMapId) === String(mapId)) {
            applyLayout(layoutName, direction);
        }
    };
    window.applyLayout = applyLayout;
    window.confirmLayout = confirmLayout;
}

async function saveAllPositions(cy, mapId) {
    if (!cy || getCy() !== cy || String(window.currentMapId) !== String(mapId)) return;
    const devices = cy.nodes().filter(n => !n.data('isGroup') && !n.data('isShape'));
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
        const data = await http.put('/api/devices/positions', updates);
        if (getCy() !== cy || String(window.currentMapId) !== String(mapId)) return;
        showToast(t('toast.successTitle'), t('layout.savedPositions', { count: data.updated }), 'success');
        if (typeof window.saveState === 'function') window.saveState('Авто-раскладка');
    } catch (err) {
        console.error(err);
        showToast(t('toast.errorTitle'), err.message, 'error');
    } finally {
        endSelfUpdate();
        if (toast && toast.hide) toast.hide();
    }
}

export function cleanup() {
    const layout = activeLayout;
    activeLayout = null;
    activeCy = null;
    layoutRunning = false;
    if (layout) layout.stop();
    delete window.applyLayout;
    delete window.confirmLayout;
}

registerCleanup(cleanup);
