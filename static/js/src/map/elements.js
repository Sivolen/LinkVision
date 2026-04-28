import { getCy } from './core.js';
import { boundNodePosition, setElementsLoaded, getBgImageSize } from './background.js';
import { addPulsingNode } from './pulse.js';

const wrapText = window.wrapText || ((text) => text);

export function loadElements(mapId) {
    const cy = getCy();
    if (!cy) return;
    cy.elements().remove();

    fetchWithRetry(`/api/map/${mapId}/elements`)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => {
            const { width: bgW, height: bgH } = getBgImageSize();

            cy.batch(() => {
                // ГРУППЫ
                const groupNodes = [];
                const groupMap = {};
                (data.groups || []).forEach(g => {
                    if (g.device_count === 0) return;
                    groupNodes.push({
                        group: 'nodes',
                        data: {
                            id: `group_${g.id}`,
                            name: g.name,
                            color: g.color,
                            isGroup: true,
                            group_id: g.id,
                            fontSize: g.font_size || 11
                        }
                    });
                    groupMap[g.id] = `group_${g.id}`;
                });
                cy.add(groupNodes);

                // ФИГУРЫ
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
                    const parts = (e.data.label || 'eth0↔eth0').split('↔');
                    e.data.srcIface = parts[0].trim();
                    e.data.tgtIface = parts[1].trim();
                });
                cy.add(validEdges);
            });

            import('./edgeLabels.js').then(m => m.updateAllEdgeLabels());
            import('./groupResize.js').then(m => m.updateAllGroups());
            setElementsLoaded(true);

            // Применяем стили при загрузке
            cy.nodes().forEach(node => {
                const monitoringRaw = node.data('monitoring_enabled');
                const isMonitoringOff = (monitoringRaw === 'false' || monitoringRaw === false);
                if (isMonitoringOff) {
                    applyGrayStyle(node);
                } else {
                    const status = node.data('status');
                    if (status === 'down') {
                        addPulsingNode(cy, node, 'down');
                    } else if (status === 'partial') {
                        addPulsingNode(cy, node, 'partial');
                    }
                }
            });
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

    // Формируем строку IP для отображения в подписи
    const ipLabel = (device.ips && device.ips.length) ? device.ips.join(', ') : '';

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

export function removeLinkFromGraph(linkId) {
    const cy = getCy();
    if (cy) cy.getElementById(String(linkId)).remove();
}

export function reloadMapElements() {
    const mapId = window.currentMapId;
    if (mapId) loadElements(mapId);
}

// Принудительное применение серого стиля для выключенного мониторинга
export function applyGrayStyle(node) {
    if (!node || !node.length) return;
    node.style('border-color', '#6c757d');
    node.style('border-style', 'dotted');
    node.style('border-width', '3px');
    node.style('opacity', '0.7');
    node.style('overlay-opacity', '0');
    node.style('overlay-color', 'transparent');
    if (typeof window.removePulsingNode === 'function') {
        window.removePulsingNode(window.cy, node);
    }
}
window.applyGrayStyle = applyGrayStyle;