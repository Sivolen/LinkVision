import { getCy } from './core.js';
import { boundNodePosition, setElementsLoaded, getBgImageSize } from './background.js';
import { addPulsingNode } from './pulse.js';
import { updateAllEdgeLabels } from './edgeLabels.js';
import { updateAllGroups } from './groupResize.js';

const wrapText = window.wrapText || ((text) => text);

// Кэш для оптимизации повторных загрузок
let elementsCache = {
    groups: null,
    shapes: null,
    nodes: null,
    edges: null,
    timestamp: 0
};

const CACHE_DURATION = 5000; // 5 секунд кэш

export function loadElements(mapId, force = false) {
    const cy = getCy();
    if (!cy) return;

    // Проверка кэша (если не force)
    const now = Date.now();
    if (!force && elementsCache.timestamp && (now - elementsCache.timestamp) < CACHE_DURATION) {
        console.log('📦 Using cache for elements');
        return; // Используем кэш
    }

    console.log(`🔄 Loading elements for map ${mapId}, force=${force}`);

    cy.elements().remove();

    fetchWithRetry(`/api/map/${mapId}/elements`)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => {
            const { width: bgW, height: bgH } = getBgImageSize();
            const startTime = performance.now();

            // Подготовка всех элементов для batch-операции
            const allElements = [];
            const groupMap = {};

            // ГРУППЫ - только с устройствами
            if (data.groups && data.groups.length) {
                data.groups.forEach(g => {
                    if (g.device_count === 0) return;
                    const groupId = `group_${g.id}`;
                    allElements.push({
                        group: 'nodes',
                        data: {
                            id: groupId,
                            name: g.name,
                            color: g.color,
                            isGroup: true,
                            group_id: g.id,
                            fontSize: g.font_size || 11
                        }
                    });
                    groupMap[g.id] = groupId;
                });
            }

            // ФИГУРЫ
            if (data.shapes && data.shapes.length) {
                console.log(`🔷 Loading ${data.shapes.length} shapes from API`);
                data.shapes.forEach(shape => {
                    console.log(`  Shape ${shape.id}: x=${shape.x}, y=${shape.y}`);
                    allElements.push({
                        group: 'nodes',
                        data: {
                            id: `shape_${shape.id}`,
                            isShape: true,
                            shape_type: shape.shape_type,
                            width: shape.width,
                            height: shape.height,
                            color: shape.color,
                            opacity: shape.opacity,
                            description: shape.description,
                            label: wrapText(shape.description || '', 30),
                            fontSize: shape.font_size || 12
                        },
                        position: { x: shape.x, y: shape.y }
                    });
                });
            } else {
                console.log('🔷 No shapes in API response');
            }

            // УСТРОЙСТВА - оптимизированная обработка
            if (data.nodes && data.nodes.length) {
                data.nodes.forEach(n => {
                    if (!n.data || !n.data.id) return;
                    n.data.id = String(n.data.id);
                    if (n.data.group_id && groupMap[n.data.group_id]) {
                        n.data.parent = groupMap[n.data.group_id];
                    } else {
                        delete n.data.parent;
                    }
                    if (bgW && bgH && n.data.x !== undefined && n.data.y !== undefined) {
                        const bounded = boundNodePosition({ x: n.data.x, y: n.data.y });
                        n.data.x = bounded.x;
                        n.data.y = bounded.y;
                    }
                    allElements.push(n);
                });
            }

            // РЁБРА - оптимизированная обработка
            if (data.edges && data.edges.length) {
                data.edges.forEach(e => {
                    if (!e.data || !e.data.source || !e.data.target) return;
                    e.data.source = String(e.data.source);
                    e.data.target = String(e.data.target);
                    e.data.id = `link_${String(e.data.id)}`;
                    if (e.data.font_size === undefined) e.data.font_size = 8;
                    const parts = (e.data.label || 'eth0↔eth0').split('↔');
                    e.data.srcIface = parts[0].trim();
                    e.data.tgtIface = parts[1].trim();
                    allElements.push(e);
                });
            }

            // Единая batch-операция для всех элементов
            cy.batch(() => {
                cy.add(allElements);
            });

            // Проверка загруженных фигур
            if (cy) {
                const shapeNodes = cy.nodes('[isShape]');
                console.log(`✅ Loaded ${shapeNodes.length} shapes into graph`);
                shapeNodes.forEach(n => {
                    const pos = n.position();
                    console.log(`  Shape ${n.id()}: x=${pos.x}, y=${pos.y}`);
                });
            }

            // Обновление меток и групп
            updateAllEdgeLabels();
            updateAllGroups();

            setElementsLoaded(true);
            cy.resize();
            window.dispatchEvent(new CustomEvent('elements:loaded'));

            // Оптимизированное применение стилей
            const downNodes = [];
            const partialNodes = [];
            const monitoringOffNodes = [];

            cy.nodes().forEach(node => {
                const monitoringRaw = node.data('monitoring_enabled');
                const isMonitoringOff = (monitoringRaw === 'false' || monitoringRaw === false);
                if (isMonitoringOff) {
                    monitoringOffNodes.push(node);
                } else {
                    const status = node.data('status');
                    if (status === 'down') downNodes.push(node);
                    else if (status === 'partial') partialNodes.push(node);
                }
            });

            // Пакетное применение стилей — один проход рендера
            cy.batch(() => {
                monitoringOffNodes.forEach(node => applyGrayStyle(node));
                downNodes.forEach(node => addPulsingNode(cy, node, 'down'));
                partialNodes.forEach(node => addPulsingNode(cy, node, 'partial'));
            });

            // Обновление кэша
            elementsCache = {
                groups: data.groups,
                shapes: data.shapes,
                nodes: data.nodes,
                edges: data.edges,
                timestamp: Date.now()
            };

            const loadTime = performance.now() - startTime;
            console.log(`⚡ Elements loaded in ${loadTime.toFixed(0)}ms (${allElements.length} elements)`);

            if (typeof window.loadSidebarMaps === 'function') {
                setTimeout(() => window.loadSidebarMaps(), 300);
            }
        })
        .catch(err => console.error('Load elements error:', err));
}

export async function addDeviceToGraph(device) {
    const cy = getCy();
    if (!cy) return;
    if (cy.getElementById(String(device.id)).length) return;

    let groupParent = undefined;
    if (device.group_id) {
        let groupNode = cy.getElementById(`group_${device.group_id}`);
        if (!groupNode.length) {
            try {
                const res = await fetch(`/api/map/${window.currentMapId}/groups`);
                if (res.ok) {
                    const groups = await res.json();
                    const groupData = groups.find(g => g.id === device.group_id);
                    if (groupData) {
                        groupNode = cy.add({
                            group: 'nodes',
                            data: {
                                id: `group_${groupData.id}`,
                                name: groupData.name,
                                color: groupData.color,
                                isGroup: true,
                                group_id: groupData.id,
                                fontSize: groupData.font_size || 11
                            }
                        });
                    }
                }
            } catch (err) { console.error(err); }
        }
        if (groupNode && groupNode.length) groupParent = `group_${device.group_id}`;
    }

    const ipLabel = (device.ips && device.ips.length) ? device.ips.join(', ') : '';

    // Добавляем узел внутри batch
    cy.batch(() => {
        cy.add({
            group: 'nodes',
            data: {
                id: String(device.id),
                name: device.name,
                ip: ipLabel,
                ips: device.ips || [],
                type_id: device.type_id,
                group_id: device.group_id,
                parent: groupParent,
                monitoring_enabled: device.monitoring_enabled ? 'true' : 'false',
                status: device.status || 'up',
                iconUrl: device.iconUrl || '',
                width: device.width || null,
                height: device.height || null,
                fontSize: device.font_size || null
            },
            position: { x: device.x || 100, y: device.y || 100 }
        });
    });
    cy.style().update();
}

export function removeDeviceFromGraph(deviceId) {
    const cy = getCy();
    if (!cy) return;
    const node = cy.getElementById(String(deviceId));
    if (node.length) {
        // Останавливаем пульсацию, если она была
        if (typeof window.removePulsingNode === 'function') {
            window.removePulsingNode(cy, node);
        }
        node.remove();
    }
}

export function updateDevice(device) {
    const cy = getCy();
    if (!cy) return;
    const node = cy.getElementById(String(device.id));
    if (node.length) {
        node.data({
            name: device.name,
            ips: device.ips || [],
            type_id: device.type_id,
            group_id: device.group_id,
            monitoring_enabled: device.monitoring_enabled ? 'true' : 'false'
        });
        let groupParent = undefined;
        if (device.group_id) {
            const groupNode = cy.getElementById(`group_${device.group_id}`);
            if (groupNode.length) groupParent = `group_${device.group_id}`;
        }
        node.data('parent', groupParent);
        cy.style().update();
    }
}

export function addShapeToGraph(shape) {
    const cy = getCy();
    if (!cy) return;
    if (cy.getElementById(`shape_${shape.id}`).length) return;

    cy.batch(() => {
        cy.add({
            group: 'nodes',
            data: {
                id: `shape_${shape.id}`,
                isShape: true,
                shape_type: shape.shape_type,
                width: shape.width,
                height: shape.height,
                color: shape.color,
                opacity: shape.opacity,
                description: shape.description,
                label: wrapText(shape.description || '', 30),
                fontSize: shape.font_size || 12
            },
            position: { x: shape.x || 100, y: shape.y || 100 }
        });
    });
}

export function removeShapeFromGraph(shapeId) {
    const cy = getCy();
    if (!cy) return;
    const node = cy.getElementById(`shape_${shapeId}`);
    if (node.length) {
        node.remove();
    }
}

export function removeLinkFromGraph(linkId) {
    const cy = getCy();
    if (cy) cy.getElementById(String(linkId)).remove();
}

export function reloadMapElements(force = false) {
    const mapId = window.currentMapId;
    if (mapId) loadElements(mapId, force);
}

// Принудительное применение серого стиля для выключенного мониторинга
export function applyGrayStyle(node) {
    if (!node || !node.length) return;
    node.style({
        'border-color': '#6c757d',
        'border-style': 'dotted',
        'border-width': '3px',
        'opacity': '0.7',
        'overlay-opacity': '0',
        'overlay-color': 'transparent'
    });
    if (typeof window.removePulsingNode === 'function') {
        window.removePulsingNode(window.cy, node);
    }
}

// Экспорт для глобального доступа
window.applyGrayStyle = applyGrayStyle;
window.addShapeToGraph = addShapeToGraph;
window.removeShapeFromGraph = removeShapeFromGraph;
