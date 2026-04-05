// index.js – инициализация всех модулей карты
import { initCy, updateGroupLabelColor } from './core.js';
import { loadBackground, setElementsLoaded, setBackgroundLoaded } from './background.js';
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

let mapId = null;

export function initMap(id) {
    mapId = id;
    if (!mapId || isNaN(parseInt(mapId))) {
        // пустая карта
        initCy(null);
        setElementsLoaded(true);
        setBackgroundLoaded(true);
        return;
    }

    // Socket join
    if (window.socket) {
        if (window.socket.connected) window.socket.emit('join_room', `map_${mapId}`);
        else window.socket.once('connect', () => window.socket.emit('join_room', `map_${mapId}`));
    }

    const cy = initCy(mapId);
    window.cy = cy;
    updateGroupLabelColor();

    // Подключаем все обработчики
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

    // Фон
    const bgEl = document.getElementById('cy-background');
    if (bgEl && bgEl.dataset.background) loadBackground(bgEl.dataset.background);
    else setBackgroundLoaded(true);

    // Загружаем элементы
    loadElements(mapId);

    // Обработчик статуса устройства
    window.socket.on('device_status', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        const node = cy.getElementById(String(data.id));
        if (!node.length) return;
        const statusValue = data.status === 'true' ? 'true' : 'false';
        if (node.data('status') === statusValue) return;
        node.data('status', statusValue);
        if (statusValue === 'false') addPulsingNode(cy, node);
        else removePulsingNode(cy, node);
        cy.style().update();
        updateSidebarCounter(data.map_id, statusValue === 'false');
    });
}
// Глобальные функции для панели инструментов
window.zoomIn = () => {
    const cy = window.cy;
    if (cy) {
        cy.zoom({
            level: cy.zoom() * 1.2,
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
        });
    }
};

window.zoomOut = () => {
    const cy = window.cy;
    if (cy) {
        cy.zoom({
            level: cy.zoom() * 0.8,
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
        });
    }
};

window.resetZoom = () => {
    const cy = window.cy;
    if (cy) {
        cy.fit(null, 50);
    }
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
// Глобальный доступ для внешних вызовов (из modal.js, toolbar)
window.initMap = initMap;
window.setMode = setMode;
window.saveViewportToServer = saveViewportToServer;
window.reloadMapElements = () => import('./elements.js').then(m => m.reloadMapElements());
window.addDeviceToGraph = (d) => import('./elements.js').then(m => m.addDeviceToGraph(d));
window.removeDeviceFromGraph = (id) => import('./elements.js').then(m => m.removeDeviceFromGraph(id));
window.updateDevice = (d) => import('./elements.js').then(m => m.updateDevice(d));