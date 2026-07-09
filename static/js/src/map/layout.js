// layout.js – авто‑раскладка (grid, circle, cose и т.д.)
import { getCy } from './core.js';
import { t } from '../i18n/i18n.js';
import { boundNodePosition, getBgDimensions } from './background.js';
import { showToast } from '../utils/toast.js';
import { http } from '../utils/http.js';
import { beginSelfUpdate, endSelfUpdate } from '../utils/state.js';

let layoutRunning = false;

export function initLayout(cy) {
    window.applyLayout = (layoutName, direction = null) => {
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
        layout.on('layoutstop', () => {
            saveAllPositions();
            layoutRunning = false;
        });
        layout.run();
    };
    window.confirmLayout = async (layoutName, direction = null) => {
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
        if (confirmed) {
            window.applyLayout(layoutName, direction);
        }
    };
}

async function saveAllPositions() {
    const cy = getCy();
    if (!cy) return;
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