import { initCy, updateGroupLabelColor } from './core.js';
import { loadBackground, setElementsLoaded, setBackgroundLoaded } from './background.js';
import { updateMapBackground } from './background.js';
import { loadElements } from './elements.js';
import { initInteractions } from './interactions.js';
import { initModes, setMode } from './modes.js';
import { initViewport, saveViewportToServer, withViewportRestore } from './viewport.js';
import { initLayout } from './layout.js';
import { initSearch } from './search.js';
import { initLock } from './lock.js';
import { initFullscreen } from './fullscreen.js';
import { initPulse, addPulsingNode, removePulsingNode } from './pulse.js';
import { initBulk } from './bulk.js';
import { initSidebarCounter, updateSidebarCounter } from './sidebar.js';
import { initUndoRedo } from './undoRedo.js';

let mapId = null;
let skipNextMapUpdate = false;

export function initMap(id) {
    mapId = id;
    window.currentMapId = id;
    if (!mapId || isNaN(parseInt(mapId))) {
        initCy(null);
        setElementsLoaded(true);
        setBackgroundLoaded(true);
        return;
    }

    if (window.socket) {
        if (window.socket.connected) window.socket.emit('join_room', `map_${mapId}`);
        else window.socket.once('connect', () => window.socket.emit('join_room', `map_${mapId}`));
    }

    const cy = initCy(mapId);
    window.cy = cy;
    updateGroupLabelColor();

    initInteractions(cy);
    initModes(cy);
    initViewport(cy);
    initLayout(cy);
    initSearch(cy);
    initLock(cy);
    initFullscreen();
    initPulse(cy);
    initBulk(cy);
    initSidebarCounter(cy);

    const bgEl = document.getElementById('cy-background');
    if (bgEl && bgEl.dataset.background) loadBackground(bgEl.dataset.background);
    else setBackgroundLoaded(true);

    const { saveState } = initUndoRedo(cy, () => mapId);
    window.saveState = saveState;

    loadElements(mapId);
    if (typeof window.saveState === 'function') {
        setTimeout(() => window.saveState('initial'), 500);
    }

    // Оптимизированный batch для обновлений статусов
    let statusBatch = [];
    let statusBatchTimeout = null;
    const STATUS_BATCH_DELAY = 100; // Увеличено с 50мс для производительности

    window.socket.on('device_status', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        const node = cy.getElementById(String(data.id));
        if (!node.length) return;
        const newStatus = data.status;

        const monitoringRaw = node.data('monitoring_enabled');
        const monitoringEnabled = (monitoringRaw === true || monitoringRaw === 'true');

        if (!monitoringEnabled) {
            if (typeof removePulsingNode === 'function') removePulsingNode(cy, node);
            if (typeof window.applyGrayStyle === 'function') window.applyGrayStyle(node);
            node.data('status', 'up');
            return;
        }

        if (node.data('status') === newStatus) return;

        statusBatch.push({ node, newStatus, mapId: data.map_id });
        if (statusBatchTimeout) clearTimeout(statusBatchTimeout);
        statusBatchTimeout = setTimeout(() => {
            cy.batch(() => {
                statusBatch.forEach(({ node, newStatus, mapId }) => {
                    node.data('status', newStatus);
                    removePulsingNode(cy, node);
                    if (newStatus === 'down') {
                        addPulsingNode(cy, node, 'down');
                    } else if (newStatus === 'partial') {
                        addPulsingNode(cy, node, 'partial');
                    }
                    updateSidebarCounter(mapId, (newStatus === 'down' || newStatus === 'partial'));
                });
            });
            cy.style().update();
            statusBatch = [];
            statusBatchTimeout = null;
        }, STATUS_BATCH_DELAY);
    });
    window.socket.on('device_status_batch', (statuses) => {
        if (!cy) return;
        cy.batch(() => {
            statuses.forEach(item => {
                const node = cy.getElementById(String(item.id));
                if (node.length && node.data('status') !== item.status) {
                    const oldStatus = node.data('status');
                    node.data('status', item.status);
                    // Остановить старую пульсацию, если была
                    if (typeof removePulsingNode === 'function') {
                        removePulsingNode(cy, node);
                    }
                    // Запустить новую пульсацию для down/partial
                    if (item.status === 'down') {
                        if (typeof addPulsingNode === 'function') {
                            addPulsingNode(cy, node, 'down');
                        }
                    } else if (item.status === 'partial') {
                        if (typeof addPulsingNode === 'function') {
                            addPulsingNode(cy, node, 'partial');
                        }
                    }
                    // Обновить счётчик проблемных устройств в сайдбаре
                    if (typeof updateSidebarCounter === 'function') {
                        // Если статус изменился с up на down/partial – увеличиваем счётчик
                        const becameDown = (item.status === 'down' || item.status === 'partial') && (oldStatus === 'up');
                        const becameUp = item.status === 'up' && (oldStatus === 'down' || oldStatus === 'partial');
                        if (becameDown) updateSidebarCounter(mapId, true);
                        if (becameUp) updateSidebarCounter(mapId, false);
                    }
                }
            });
        });
        // Принудительно обновляем стили (для применения селекторов статусов)
        cy.style().update();
    });
window.socket.on('map_updated', (data) => {
    if (skipNextMapUpdate) {
        console.log('⏭️ Skipping map reload (self change)');
        return;   // не сбрасываем флаг здесь
    }
    if (Number(data.map_id) === mapId) {
        console.log('🔄 Reloading map from other client');
        window.withViewportRestore(() => {
            window.reloadMapElements();
        });
    }
});
}

window.setSkipNextMapUpdate = () => {
    skipNextMapUpdate = true;
    console.log('⏳ skipNextMapUpdate = true');
};
window.clearSkipNextMapUpdate = () => {
    skipNextMapUpdate = false;
    console.log('✅ skipNextMapUpdate = false');
};
window.zoomIn = () => {
    const cy = window.cy;
    if (cy) cy.zoom({ level: cy.zoom() * 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
};
window.zoomOut = () => {
    const cy = window.cy;
    if (cy) cy.zoom({ level: cy.zoom() * 0.8, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
};
window.resetZoom = () => {
    const cy = window.cy;
    if (cy) cy.fit(null, 50);
};
window.fitImageToView = () => {
    const cy = window.cy;
    if (cy && window.bgImageWidth && window.bgImageHeight) {
        const container = document.getElementById('cy').getBoundingClientRect();
        const zoom = Math.min(container.width / window.bgImageWidth, container.height / window.bgImageHeight) * 0.95;
        const panX = (container.width / zoom - window.bgImageWidth) / 2;
        const panY = (container.height / zoom - window.bgImageHeight) / 2;
        cy.viewport({ pan: { x: panX, y: panY }, zoom });
    } else {
        cy.fit(null, 50);
    }
};
window.initMap = initMap;
window.setMode = setMode;
window.saveViewportToServer = saveViewportToServer;
window.reloadMapElements = (force = false) => import('./elements.js').then(m => m.reloadMapElements(force));
window.addDeviceToGraph = (d) => import('./elements.js').then(m => m.addDeviceToGraph(d));
window.removeDeviceFromGraph = (id) => import('./elements.js').then(m => m.removeDeviceFromGraph(id));
window.updateDevice = (d) => import('./elements.js').then(m => m.updateDevice(d));
window.addShapeToGraph = (s) => import('./elements.js').then(m => m.addShapeToGraph(s));
window.removeShapeFromGraph = (id) => import('./elements.js').then(m => m.removeShapeFromGraph(id));
window.updateMapBackground = updateMapBackground;
window.updateAllEdgeLabels = () => import('./edgeLabels.js').then(m => m.updateAllEdgeLabels());
window.addPulsingNode = addPulsingNode;
window.removePulsingNode = removePulsingNode;
window.withViewportRestore = withViewportRestore;