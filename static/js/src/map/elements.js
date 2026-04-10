// elements.js – загрузка, добавление, удаление элементов графа
import { getCy } from './core.js';
import { boundNodePosition, setElementsLoaded, getBgImageSize } from './background.js';
import { addPulsingNode } from './pulse.js';

// wrapText – глобальная функция из common.js
const wrapText = window.wrapText || ((text) => text);

export function loadElements(mapId) {
    const cy = getCy();
    if (!cy) return;

    // 🔥 ОЧИЩАЕМ ВСЕ СУЩЕСТВУЮЩИЕ ЭЛЕМЕНТЫ ПЕРЕД ЗАГРУЗКОЙ НОВЫХ
    cy.elements().remove();

    fetchWithRetry(`/api/map/${mapId}/elements`)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => {
            const { width: bgW, height: bgH } = getBgImageSize();

            // ГРУППЫ
            const groupNodes = [];
            const groupMap = {};
            (data.groups || []).forEach(g => {
                if (g.device_count === 0) return;
                const groupNode = {
                    group: 'nodes',
                    data: {
                        id: `group_${g.id}`,
                        name: g.name,
                        color: g.color,
                        isGroup: true,
                        group_id: g.id,
                        fontSize: g.font_size || 11
                    }
                };
                groupNodes.push(groupNode);
                groupMap[g.id] = `group_${g.id}`;
            });
            cy.add(groupNodes);

            // ФИГУРЫ (с проверкой на существование, хотя граф уже очищен)
            (data.shapes || []).forEach(shape => {
                const shapeId = `shape_${shape.id}`;
                if (!cy.getElementById(shapeId).length) {
                    cy.add({
                        group: 'nodes',
                        data: {
                            id: shapeId,
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
                }
            });

            // УСТРОЙСТВА
            const validNodes = data.nodes.filter(n => n.data && n.data.id);
            validNodes.forEach(n => {
                n.data.id = String(n.data.id);
                if (n.data.group_id && groupMap[n.data.group_id]) {
                    n.data.parent = groupMap[n.data.group_id];
                }
                if (bgW && bgH && n.data.x !== undefined && n.data.y !== undefined) {
                    const bounded = boundNodePosition({ x: n.data.x, y: n.data.y });
                    n.data.x = bounded.x;
                    n.data.y = bounded.y;
                }
            });
            cy.add(validNodes);

            // РЁБРА
            const validEdges = data.edges.filter(e => e.data && e.data.source && e.data.target);
            validEdges.forEach(e => {
                e.data.source = String(e.data.source);
                e.data.target = String(e.data.target);
                e.data.id = `link_${String(e.data.id)}`;
                if (e.data.font_size === undefined) e.data.font_size = 8;
                // Сохраняем оригинальные интерфейсы для последующего обновления
                const parts = (e.data.label || 'eth0↔eth0').split('↔');
                e.data.srcIface = parts[0].trim();
                e.data.tgtIface = parts[1].trim();
            });
            cy.add(validEdges);
            import('./edgeLabels.js').then(module => module.updateAllEdgeLabels());
            setElementsLoaded(true);

            // ПУЛЬСАЦИЯ ДЛЯ НЕДОСТУПНЫХ УСТРОЙСТВ
            cy.nodes().forEach(node => {
                if (node.data('status') === 'false') addPulsingNode(cy, node);
            });
        })
        .catch(err => console.error('Load elements error:', err));
        cy.ready(() => {
            import('./groupResize.js').then(module => module.updateAllGroups());
        });
}

export async function addDeviceToGraph(device) {
    const cy = getCy();
    if (!cy) return;

    // Проверяем, не существует ли уже устройство
    if (cy.getElementById(String(device.id)).length) return;

    let groupParent = undefined;
    if (device.group_id) {
        let groupNode = cy.getElementById(`group_${device.group_id}`);
        if (groupNode.length) groupParent = `group_${device.group_id}`;
        // Если группы нет в графе – загружаем её данные с сервера
        if (!groupNode.length) {
            try {
                const res = await fetch(`/api/map/${window.currentMapId}/groups`);
                if (res.ok) {
                    const groups = await res.json();
                    const groupData = groups.find(g => g.id === device.group_id);
                    if (groupData) {
                        // Добавляем узел группы
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
            } catch (err) {
                console.error('Failed to load group:', err);
            }
        }
        if (groupNode && groupNode.length) {
            groupParent = `group_${device.group_id}`;
        }
    }

    cy.add({
        group: 'nodes',
        data: {
            id: String(device.id),
            name: device.name,
            ip: device.ip,
            type_id: device.type_id,
            group_id: device.group_id,
            parent: groupParent,
            monitoring_enabled: device.monitoring_enabled,
            status: device.status || 'true',
            iconUrl: device.iconUrl || '',
            width: device.width || null,
            height: device.height || null,
            fontSize: device.font_size || null
        },
        position: { x: device.x || 100, y: device.y || 100 }
    });
    cy.style().update();
}

export function removeDeviceFromGraph(deviceId) {
    const cy = getCy();
    if (cy) cy.getElementById(String(deviceId)).remove();
}

export function updateDevice(device) {
    const cy = getCy();
    if (!cy) return;
    const node = cy.getElementById(String(device.id));
    if (node.length) {
        node.data({
            name: device.name,
            ip: device.ip_address || device.ip,
            type_id: device.type_id,
            group_id: device.group_id,
            monitoring_enabled: device.monitoring_enabled
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

export function removeLinkFromGraph(linkId) {
    const cy = getCy();
    if (cy) cy.getElementById(String(linkId)).remove();
}

export function reloadMapElements() {
    const mapId = window.currentMapId;
    if (mapId) loadElements(mapId);
}