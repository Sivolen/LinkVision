import { initCy, updateGroupLabelColor } from './core.js';
import { loadBackground, setElementsLoaded, setBackgroundLoaded, markUserInteracted, resetUserInteracted, fitImageToView, updateMapBackground } from './background.js';
import { loadElements } from './elements.js';
import { initInteractions } from './interactions.js';
import { initNewNodeFeedback } from './newNodeFeedback.js';
import { initModes, setMode, isLinkMode } from './modes.js';
import { initResync, scheduleResync, isMapBusy } from './resync.js';
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
import { beginSelfUpdate, endSelfUpdate, isSelfUpdating, getPendingCount, isLocalOperation } from '../utils/state.js';
import { restoreCollapseState, refreshAllCollapsedStatuses, collapseGroup, expandGroup } from './groupCollapse.js';

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
    updateDevicePositionsInGraph,
    addGroupToGraph,
    updateGroupInGraph,
    removeGroupFromGraph,
    reloadMapElements as _reloadMapElements,
} from './elements.js';

// Импорт для обновления меток и групп
import { updateAllEdgeLabels } from './edgeLabels.js';
import { updateEdgeCurves } from './edgeBundling.js';
import { initZoomEmphasis, refreshZoomEmphasis } from './zoomEmphasis.js';
import { updateAllGroups } from './groupResize.js';

// ─── Утилиты жизненного цикла карты и Socket.IO ────────────────────────────────
// initMap() может вызываться повторно без полной перезагрузки страницы. Все
// обработчики, созданные предыдущим экземпляром карты, нужно снять, иначе одно
// событие Socket.IO начнёт применяться несколько раз.
let mapCleanupHandlers = [];

function clearMapCleanupHandlers() {
    mapCleanupHandlers.forEach(cleanup => {
        try {
            cleanup();
        } catch (error) {
            console.error('Error cleaning up map listener:', error);
        }
    });
    mapCleanupHandlers = [];
}

function registerMapCleanup(cleanup) {
    mapCleanupHandlers.push(cleanup);
}

function onMapEvent(socket, mapId, event, handler) {
    const listener = data => {
        if (Number(data.map_id) !== Number(mapId)) return;
        handler(data);
    };
    socket.on(event, listener);
    registerMapCleanup(() => socket.off(event, listener));
}

let mapId = null;

export function initMap(id) {
    clearMapCleanupHandlers();
    mapId = id;
    window.currentMapId = id;
    window.__mapLoadedOnce = false;
    if (!mapId || isNaN(parseInt(mapId))) {
        initCy(null);
        setElementsLoaded(true);
        setBackgroundLoaded(true);
        return;
    }

    if (window.socket) {
        const joinMapRoom = () => window.socket.emit('join_room', `map_${mapId}`);
        let initialLoadFailed = false;
        const markInitialLoadFailed = () => { initialLoadFailed = true; };
        window.addEventListener('elements:loadfailed', markInitialLoadFailed);
        registerMapCleanup(() => window.removeEventListener('elements:loadfailed', markInitialLoadFailed));

        if (window.socket.connected) joinMapRoom();

        // ВАЖНО: было socket.once('connect', ...) — сработало бы только на
        // самое первое подключение. Socket.IO настроен с reconnection: true
        // (static/js/base.js) и переподключается сам после любого сетевого
        // сбоя (потеря wifi, сон ноутбука, рестарт бэкенда/прокси) — но при
        // .once() повторный 'connect' после реконнекта никогда не обрабатывался,
        // join_room не переотправлялся, и клиент молча переставал получать
        // ЛЮБЫЕ real-time события по этой карте (статусы, позиции, связи) до
        // ручной перезагрузки страницы. Именно это стояло за жалобами
        // "иногда нужно обновить страницу, чтобы всё обновилось".
        const handleSocketConnect = () => {
            joinMapRoom();
            // Событий, которые сервер разослал, пока мы были отключены, мы не
            // получим (Socket.IO их не буферизует после разрыва соединения) —
            // поэтому после (пере)подключения принудительно перечитываем
            // состояние карты с сервера, чтобы гарантированно не остаться со
            // старыми статусами/позициями после сетевого сбоя.
            //
            // withViewportRestore — та же обёртка, что и у 'map_updated' ниже
            // (см. её использование там). Раньше здесь вызывался
            // loadElements(mapId, true) БЕЗ этой обёртки — loadElements внутри
            // делает cy.elements().remove() и перестраивает граф с нуля, и без
            // восстановления pan/zoom это выглядело как настоящая перезагрузка
            // страницы: холст на миг пустел И камера прыгала на дефолтный
            // фит/позицию. Сам разрыв соединения — штука обычная (сон
            // ноутбука, свёрнутая вкладка, кратковременный обрыв сети) и
            // происходит чаще, чем кажется, поэтому визуальный "скачок" на
            // каждый такой реконнект был особенно заметен.
            if (window.__mapLoadedOnce) {
                // Не под руками у пользователя: если он тянет узел, рисует связь
                // или редактирует в модалке — перезагрузка откладывается до паузы
                // (см. resync.js), выделение сохраняется.
                scheduleResync(() => {
                    window.withViewportRestore(() => {
                        loadElements(mapId, true);
                    });
                });
            } else if (initialLoadFailed) {
                // Первая загрузка не удалась даже после повторов — пробуем снова.
                initialLoadFailed = false;
                loadElements(mapId, true);
            }
        };
        window.socket.on('connect', handleSocketConnect);
        registerMapCleanup(() => window.socket.off('connect', handleSocketConnect));
    }

    const cy = initCy(mapId);
    window.cy = cy;
    registerMapCleanup(initResync(cy, { isExtraBusy: isLinkMode }));
    updateGroupLabelColor();

    // Отмена «телепортации»: если пользователь начал скроллить/зумить/тянуть карту
    // до того, как отработал начальный авто-фит (фон+элементы грузятся асинхронно),
    // помечаем взаимодействие — и авто-фит уже не перекрывает вид.
    resetUserInteracted();
    const cyContainer = document.getElementById('cy');
    if (cyContainer) {
        const onFirstInteract = () => {
            markUserInteracted();
            cyContainer.removeEventListener('wheel', onFirstInteract);
            cyContainer.removeEventListener('mousedown', onFirstInteract);
        };
        cyContainer.addEventListener('wheel', onFirstInteract, { passive: true });
        cyContainer.addEventListener('mousedown', onFirstInteract);
        registerMapCleanup(() => {
            cyContainer.removeEventListener('wheel', onFirstInteract);
            cyContainer.removeEventListener('mousedown', onFirstInteract);
        });
    }

    initInteractions(cy);
    initNewNodeFeedback(cy);
    initModes(cy);
    initViewport(cy);
    initLayout(cy);
    initSearch(cy);
    initLock(cy);
    initFullscreen();
    initZoomEmphasis(cy);
    initPulse(cy);
    initBulk(cy);
    initSidebarCounter(cy);
    initMinimap(cy);

    const bgEl = document.getElementById('cy-background');
    if (bgEl && bgEl.dataset.background) loadBackground(bgEl.dataset.background);
    else setBackgroundLoaded(true);

    const { saveState } = initUndoRedo(cy);
    window.saveState = saveState;

    // Состояние свёрнутых групп восстанавливаем ПОСЛЕ того, как элементы реально
    // добавлены в граф: loadElements() ходит на сервер асинхронно, и вызов сразу
    // после него отрабатывал по пустому графу — из-за этого после F5 все группы
    // оказывались развёрнутыми. 'elements:loaded' диспатчится в elements.js.
    const restoreCollapsedGroups = () => {
        if (typeof restoreCollapseState === 'function') restoreCollapseState();
    };
    window.addEventListener('elements:loaded', restoreCollapsedGroups);
    registerMapCleanup(() => window.removeEventListener('elements:loaded', restoreCollapsedGroups));

    // Начальную историю фиксируем после завершения загрузки элементов, а не
    // через фиксированный таймер: медленный ответ сервера иначе оставлял пустой
    // снимок, и первый undo не мог восстановить исходные позиции.
    const saveInitialState = () => {
        if (typeof window.saveState === 'function') window.saveState('initial');
    };
    window.addEventListener('elements:loaded', saveInitialState, { once: true });
    registerMapCleanup(() => window.removeEventListener('elements:loaded', saveInitialState));

    // Флаг «карта хотя бы раз загружена» ставим по факту загрузки, а не сразу
    // после запуска запроса — иначе реконнект во время первой загрузки запускал
    // второй, параллельный reload.
    const markLoadedOnce = () => { window.__mapLoadedOnce = true; };
    window.addEventListener('elements:loaded', markLoadedOnce, { once: true });
    registerMapCleanup(() => window.removeEventListener('elements:loaded', markLoadedOnce));

    loadElements(mapId);

    // Оптимизированный batch для обновлений статусов
    let statusBatch = [];
    let statusBatchTimeout = null;
    const STATUS_BATCH_DELAY = 100; // Увеличено с 50мс для производительности
    registerMapCleanup(() => {
        if (statusBatchTimeout) clearTimeout(statusBatchTimeout);
        statusBatch = [];
        statusBatchTimeout = null;
    });

    // Реалтайм-обработчики регистрируем только если сокет создан. Иначе (когда
    // window.socket ещё не готов) не роняем initMap — карта и мини-карта уже
    // инициализированы выше, дальше только socket.on(...).
    if (!window.socket) {
        console.warn('⚠ window.socket не инициализирован — реалтайм отключён');
        return;
    }

    const listenSocket = (event, handler) => {
        window.socket.on(event, handler);
        registerMapCleanup(() => window.socket.off(event, handler));
    };

    listenSocket('device_status', (data) => {
        const node = cy.getElementById(String(data.id));
        if (!node.length) return;
        const newStatus = data.status;

        const monitoringRaw = node.data('monitoring_enabled');
        const monitoringEnabled = (monitoringRaw === true || monitoringRaw === 'true');

        if (!monitoringEnabled) {
            if (typeof removePulsingNode === 'function') removePulsingNode(cy, node);
            node.data({
                status: 'up',
                quality_status: 'unknown',
                quality_latency_ms: null,
                quality_jitter_ms: null,
                quality_loss_percent: null,
            });
            return;
        }

        // Поддерживаем и одиночное событие полностью: если backend/прокси
        // когда-нибудь отправит device_status с quality-полями, карта не
        // должна оставить старый цвет качества. Основной монитор сейчас
        // использует device_status_batch, но оба пути должны иметь одинаковую
        // семантику.
        if (Object.prototype.hasOwnProperty.call(data, 'quality_status')) {
            node.data({
                quality_status: data.quality_status || 'unknown',
                quality_latency_ms: data.quality_latency_ms ?? null,
                quality_jitter_ms: data.quality_jitter_ms ?? null,
                quality_loss_percent: data.quality_loss_percent ?? null,
            });
        }

        if (node.data('status') === newStatus) {
            cy.style().update();
            refreshZoomEmphasis();
            return;
        }

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
                    updateSidebarCounter(mapId, (newStatus === 'down' || newStatus === 'partial'));
                });
            });
            cy.style().update();
            refreshZoomEmphasis();
            if (typeof refreshAllCollapsedStatuses === 'function') refreshAllCollapsedStatuses();
            statusBatch = [];
            statusBatchTimeout = null;
        }, STATUS_BATCH_DELAY);
    });
    listenSocket('device_status_batch', (statuses) => {
        if (!cy) return;
        cy.batch(() => {
            statuses.forEach(item => {
                const node = cy.getElementById(String(item.id));
                if (!node.length) return;

                // Устройство с выключенным мониторингом никогда не должно
                // считаться алярмом, даже если бэкенд по какой-то причине
                // включит его в пакет статусов (обычный цикл мониторинга
                // такие устройства уже не пингует, но полагаться только на
                // это со стороны фронтенда — хрупко). Та же логика уже есть
                // в одиночном обработчике 'device_status' выше.
                const monitoringRaw = Object.prototype.hasOwnProperty.call(item, 'monitoring_enabled')
                    ? item.monitoring_enabled
                    : node.data('monitoring_enabled');
                const monitoringEnabled = (monitoringRaw === true || monitoringRaw === 'true');
                if (Object.prototype.hasOwnProperty.call(item, 'monitoring_enabled')) {
                    node.data('monitoring_enabled', monitoringEnabled ? 'true' : 'false');
                }
                if (!monitoringEnabled) {
                    if (node.data('status') !== 'up') node.data('status', 'up');
                    node.data('quality_status', 'unknown');
                    node.data('quality_latency_ms', null);
                    node.data('quality_jitter_ms', null);
                    node.data('quality_loss_percent', null);
                    removePulsingNode(cy, node);
                    return;
                }

                // Quality can change while availability stays "up". Always
                // apply the quality fields from the batch independently of the
                // status transition; otherwise a bad -> good recovery is sent by
                // the backend but silently ignored until the next page refresh.
                if (Object.prototype.hasOwnProperty.call(item, 'quality_status')) {
                    node.data({
                        quality_status: item.quality_status || 'unknown',
                        quality_latency_ms: item.quality_latency_ms ?? null,
                        quality_jitter_ms: item.quality_jitter_ms ?? null,
                        quality_loss_percent: item.quality_loss_percent ?? null,
                    });
                }

                if (node.data('status') !== item.status) {
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
        refreshZoomEmphasis();
        if (typeof refreshAllCollapsedStatuses === 'function') refreshAllCollapsedStatuses();
    });

    // ─── Точечные события ─────────────────────────────────────────────────────────

    // Создание устройства
    onMapEvent(window.socket, mapId, 'device_created', (data) => {
        cy.batch(() => {
            _addDeviceToGraph(data.device);
        });
    });

    // Обновление устройства
    onMapEvent(window.socket, mapId, 'device_updated', (data) => {
        _updateDevice(data.device);
    });

    // Удаление устройства
    onMapEvent(window.socket, mapId, 'device_deleted', (data) => {
        _removeDeviceFromGraph(data.device_id);
    });

    // Изменение позиции устройства
    onMapEvent(window.socket, mapId, 'device_position_updated', (data) => {
        updateDevicePositionInGraph(data.device_id, data.x, data.y);
    });

    // Массовое изменение позиций
    onMapEvent(window.socket, mapId, 'bulk_position_updated', (data) => {
        if (isLocalOperation(data.operation_id)) return;
        if (Array.isArray(data.positions)) {
            updateDevicePositionsInGraph(data.positions);
            return;
        }

        // Совместимость с сервером старой версии: у него в событии есть
        // только ID, поэтому перечитываем состояние карты целиком.
        if (typeof window.withViewportRestore === 'function') {
            window.withViewportRestore(() => window.reloadMapElements(true));
        } else {
            window.reloadMapElements(true);
        }
    });

    // Создание связи
    onMapEvent(window.socket, mapId, 'link_created', (data) => {
        cy.batch(() => {
            addLinkToGraph(data.link);
        });
        if (typeof window.updateEdgeCurves === 'function') window.updateEdgeCurves();
    });

    // Обновление связи
    onMapEvent(window.socket, mapId, 'link_updated', (data) => {
        updateLinkInGraph(data.link);
        if (typeof window.updateEdgeCurves === 'function') window.updateEdgeCurves();
    });

    // Удаление связи
    onMapEvent(window.socket, mapId, 'link_deleted', (data) => {
        _removeLinkFromGraph(`link_${data.link_id}`);
        if (typeof window.updateEdgeCurves === 'function') window.updateEdgeCurves();
    });

    // Создание группы
    onMapEvent(window.socket, mapId, 'group_created', (data) => {
        cy.batch(() => {
            addGroupToGraph(data.group);
        });
    });

    // Обновление группы
    onMapEvent(window.socket, mapId, 'group_updated', (data) => {
        updateGroupInGraph(data.group);
    });

    // Удаление группы
    onMapEvent(window.socket, mapId, 'group_deleted', (data) => {
        removeGroupFromGraph(data.group_id);
    });

    // Создание фигуры
    onMapEvent(window.socket, mapId, 'shape_created', (data) => {
        cy.batch(() => {
            _addShapeToGraph(data.shape);
        });
    });

    // Обновление фигуры
    onMapEvent(window.socket, mapId, 'shape_updated', (data) => {
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
    onMapEvent(window.socket, mapId, 'shape_deleted', (data) => {
        _removeShapeFromGraph(data.shape_id);
    });

    // Полная перезагрузка карты (крупные изменения: импорт, массовое редактирование)
    listenSocket('map_updated', (data) => {
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
window.fitImageToView = fitImageToView;
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
window.updateEdgeCurves = updateEdgeCurves;
window.addPulsingNode = addPulsingNode;
window.removePulsingNode = removePulsingNode;
// Счётчик проблемных устройств в сайдбаре нужен и modal-бандлу: при открытии
// карточки устройства нода может синхронизироваться из details (см.
// syncNodeFromDetails в modal/device.js), и вместе со статусом надо поправить
// счётчик, иначе он останется с устаревшим значением до перезагрузки страницы.
window.updateSidebarCounter = updateSidebarCounter;
window.withViewportRestore = withViewportRestore;
window.isMapBusy = isMapBusy; // base.js: не перезагружать страницу посреди действия
window.collapseGroup = collapseGroup;
window.expandGroup = expandGroup;
window.restoreCollapseState = restoreCollapseState;
