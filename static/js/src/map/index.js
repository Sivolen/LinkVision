import { initCy, updateGroupLabelColor } from './core.js';
import { loadBackground, setElementsLoaded, setBackgroundLoaded } from './background.js';
import { updateMapBackground } from './background.js';
import { loadElements } from './elements.js';
import { initInteractions } from './interactions.js';
import { initModes, setMode } from './modes.js';
import { initViewport, saveViewportToServer } from './viewport.js';
import { initLayout } from './layout.js';
import { initSearch } from './search.js';
import { initLock } from './lock.js';
import { initFullscreen } from './fullscreen.js';
import { initPulse, addPulsingNode, removePulsingNode } from './pulse.js';
import { initBulk } from './bulk.js';
import { initSidebarCounter, updateSidebarCounter } from './sidebar.js';
import { initUndoRedo } from './undoRedo.js';

let mapId = null;

export function initMap(id) {
    mapId = id;
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

    let statusBatch = [];
    let statusBatchTimeout = null;

    window.socket.on('device_status', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        const node = cy.getElementById(String(data.id));
        if (!node.length) return;
        const newStatus = data.status; // 'up', 'down', 'partial'

        const monitoringRaw = node.data('monitoring_enabled');
        const monitoringEnabled = (monitoringRaw === true || monitoringRaw === 'true');

        if (!monitoringEnabled) {
            if (typeof removePulsingNode === 'function') removePulsingNode(cy, node);
            if (typeof window.applyGrayStyle === 'function') window.applyGrayStyle(node);
            node.data('status', 'up');
            return;
        }

        if (node.data('status') === newStatus) return;

        statusBatch.push({ node, newStatus });
        if (statusBatchTimeout) clearTimeout(statusBatchTimeout);
        statusBatchTimeout = setTimeout(() => {
            cy.batch(() => {
                statusBatch.forEach(({ node, newStatus }) => {
                    node.data('status', newStatus);
                    removePulsingNode(cy, node);
                    if (newStatus === 'down') {
                        addPulsingNode(cy, node, 'down');
                    } else if (newStatus === 'partial') {
                        addPulsingNode(cy, node, 'partial');
                    }
                    updateSidebarCounter(data.map_id, (newStatus === 'down' || newStatus === 'partial'));
                });
            });
            cy.style().update();
            if (typeof window.loadSidebarMaps === 'function') {
                setTimeout(() => window.loadSidebarMaps(), 100);
            }
            statusBatch = [];
            statusBatchTimeout = null;
        }, 50);
    });
}

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
window.reloadMapElements = () => import('./elements.js').then(m => m.reloadMapElements());
window.addDeviceToGraph = (d) => import('./elements.js').then(m => m.addDeviceToGraph(d));
window.removeDeviceFromGraph = (id) => import('./elements.js').then(m => m.removeDeviceFromGraph(id));
window.updateDevice = (d) => import('./elements.js').then(m => m.updateDevice(d));
window.updateMapBackground = updateMapBackground;
window.updateAllEdgeLabels = () => import('./edgeLabels.js').then(m => m.updateAllEdgeLabels());
window.addPulsingNode = addPulsingNode;
window.removePulsingNode = removePulsingNode;