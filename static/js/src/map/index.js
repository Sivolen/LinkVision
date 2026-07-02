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
import { initMinimap } from './minimap.js';
import { initUndoRedo } from './undoRedo.js';
import { beginSelfUpdate, endSelfUpdate, isSelfUpdating, getPendingCount } from '../utils/state.js';

// Импорт функций для инкрементальных обновлений
import {
    addDeviceToGraph as _addDeviceToGraph,
    removeDeviceFromGraph as _removeDeviceFromGraph,
    updateDevice as _updateDevice,
    addLinkToGraph,
    updateLinkInGraph,
    removeLinkFromGraph as _removeLinkFromGraph,
    addShapeToGraph as _addShapeToGraph,
    removeShapeFromGraph as _removeShapeFromGraph,
    updateDevicePositionInGraph,
    addGroupToGraph,
    updateGroupInGraph,
    removeGroupFromGraph,
    reloadMapElements as _reloadMapElements,
} from './elements.js';

// Импорт для обновления меток и групп
import { updateAllEdgeLabels } from './edgeLabels.js';
import { updateAllGroups } from './groupResize.js';

let mapId = null;

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
    initMinimap(cy);

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

    // ─── Точечные события ─────────────────────────────────────────────────────────

    // Создание устройства
    window.socket.on('device_created', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        cy.batch(() => {
            _addDeviceToGraph(data.device);
        });
    });

    // Обновление устройства
    window.socket.on('device_updated', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        _updateDevice(data.device);
    });

    // Удаление устройства
    window.socket.on('device_deleted', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        _removeDeviceFromGraph(data.device_id);
    });

    // Изменение позиции устройства
    window.socket.on('device_position_updated', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        updateDevicePositionInGraph(data.device_id, data.x, data.y);
    });

    // Массовое изменение позиций
    window.socket.on('bulk_position_updated', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        // Позиции уже обновлены на клиенте через dragfree — просто обновим метки
        if (typeof window.updateAllEdgeLabels === 'function') window.updateAllEdgeLabels();
        if (typeof window.updateAllGroups === 'function') window.updateAllGroups();
    });

    // Создание связи
    window.socket.on('link_created', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        cy.batch(() => {
            addLinkToGraph(data.link);
        });
    });

    // Обновление связи
    window.socket.on('link_updated', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        updateLinkInGraph(data.link);
    });

    // Удаление связи
    window.socket.on('link_deleted', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        _removeLinkFromGraph(`link_${data.link_id}`);
    });

    // Создание группы
    window.socket.on('group_created', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        cy.batch(() => {
            addGroupToGraph(data.group);
        });
    });

    // Обновление группы
    window.socket.on('group_updated', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        updateGroupInGraph(data.group);
    });

    // Удаление группы
    window.socket.on('group_deleted', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        removeGroupFromGraph(data.group_id);
    });

    // Создание фигуры
    window.socket.on('shape_created', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        cy.batch(() => {
            _addShapeToGraph(data.shape);
        });
    });

    // Обновление фигуры
    window.socket.on('shape_updated', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        const shape = data.shape;
        const node = cy.getElementById(`shape_${shape.id}`);
        if (node.length) {
            node.position({ x: shape.x, y: shape.y });
            node.data({
                shape_type: shape.shape_type,
                width: shape.width,
                height: shape.height,
                color: shape.color,
                opacity: shape.opacity,
                description: shape.description,
            });
            cy.style().update();
        }
    });

    // Удаление фигуры
    window.socket.on('shape_deleted', (data) => {
        if (Number(data.map_id) !== Number(mapId)) return;
        _removeShapeFromGraph(data.shape_id);
    });

    // Полная перезагрузка карты (крупные изменения: импорт, массовое редактирование)
    window.socket.on('map_updated', (data) => {
        if (isSelfUpdating()) {
            console.log('⏭️ Skipping map reload (self change, pending:', getPendingCount(), ')');
            return;
        }
        if (Number(data.map_id) === mapId) {
            console.log('🔄 Reloading map from other client:', data);
            window.withViewportRestore(() => {
                console.log('🔄 Calling reloadMapElements(force=true)');
                window.reloadMapElements(true); // force=true чтобы обойти кэш
            });
        }
    });
}

window.setSkipNextMapUpdate = () => {
    beginSelfUpdate();
};
window.clearSkipNextMapUpdate = () => {
    endSelfUpdate();
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
window.reloadMapElements = _reloadMapElements;
window.addDeviceToGraph = _addDeviceToGraph;
window.removeDeviceFromGraph = _removeDeviceFromGraph;
window.updateDevice = _updateDevice;
window.addShapeToGraph = _addShapeToGraph;
window.removeShapeFromGraph = _removeShapeFromGraph;
window.updateMapBackground = updateMapBackground;
window.updateAllEdgeLabels = updateAllEdgeLabels;
window.addPulsingNode = addPulsingNode;
window.removePulsingNode = removePulsingNode;
window.withViewportRestore = withViewportRestore;