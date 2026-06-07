// interactions.js – перетаскивание узлов, клики, групповое перемещение
import { getCy } from './core.js';
import { boundNodePosition, getBgDimensions } from './background.js';
import { startLinkMode, resetLinkMode, isLinkMode, getSourceNode } from './modes.js';
import { updateEdgeLabelsForNode } from './edgeLabels.js';
import { updateGroupsForNode, updateAllGroups } from './groupResize.js';

let dragTimeouts = {};
let groupBatchTimeout = null;

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    if (typeof showToast === 'function') showToast('Скопировано', `IP ${text} (резервный способ)`, 'info');
}

export function initInteractions(cy) {
    // Перетаскивание одиночного узла
    cy.on('dragfree', 'node', function(evt) {
        const node = evt.target;
        if (node.data('isGroup') || node.data('isShape')) return;
        if (window.isOperator || window.dragLocked) return;

        let pos = node.position();
        const { width, height } = getBgDimensions();
        if (width && height) {
            const bounded = boundNodePosition(pos);
            if (bounded.x !== pos.x || bounded.y !== pos.y) node.position(bounded);
            pos = node.position();
        }
        updateEdgeLabelsForNode(node);
        clearTimeout(dragTimeouts[node.id()]);
        dragTimeouts[node.id()] = setTimeout(() => {
            window.setSkipNextMapUpdate();
            fetch(`/api/device/${node.id()}/position`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) })
            })
            .then(() => {
                if (typeof window.saveState === 'function') window.saveState('Перемещение устройства');
            })
            .catch(err => console.error(err))
            .finally(() => {
                setTimeout(() => window.clearSkipNextMapUpdate(), 500);
            });
            delete dragTimeouts[node.id()];
        }, 500);
    });
    // Групповое перетаскивание
    cy.on('dragfree', 'node:selected', function(evt) {
        if (window.isOperator || window.dragLocked) return;
        const draggedNode = evt.target;
        if (draggedNode.data('isGroup')) return;
        const selectedNodes = cy.nodes(':selected').filter(n => !n.data('isGroup'));
        if (selectedNodes.length <= 1) return;
        const oldPos = draggedNode._private.scratch._dragStartPos;
        if (!oldPos) return;
        const deltaX = draggedNode.position().x - oldPos.x;
        const deltaY = draggedNode.position().y - oldPos.y;
        const deviceUpdates = [], shapeUpdates = [];
        selectedNodes.forEach(node => {
            let x = node.position().x + deltaX;
            let y = node.position().y + deltaY;
            if (getBgDimensions().width) {
                const bounded = boundNodePosition({ x, y });
                x = bounded.x; y = bounded.y;
            }
            node.position({ x, y });
            if (node.data('isShape')) {
                shapeUpdates.push({ id: node.id().replace('shape_', ''), x: Math.round(x), y: Math.round(y) });
            } else {
                deviceUpdates.push({ id: node.id(), x: Math.round(x), y: Math.round(y) });
            }
        });
        selectedNodes.forEach(node => updateGroupsForNode(node));
        selectedNodes.forEach(node => updateEdgeLabelsForNode(node));
        clearTimeout(groupBatchTimeout);
        updateAllGroups();
        groupBatchTimeout = setTimeout(() => {
            window.setSkipNextMapUpdate();
            const promises = deviceUpdates.map(upd =>
                fetch(`/api/device/${upd.id}/position`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                    body: JSON.stringify({ x: upd.x, y: upd.y })
                })
            );
            Promise.all(promises)
                .then(() => {
                    if (typeof window.saveState === 'function') window.saveState('Перемещение группы устройств');
                })
                .catch(console.error)
                .finally(() => {
                    setTimeout(() => window.clearSkipNextMapUpdate(), 10000);
                });
        }, 500);
        selectedNodes.forEach(n => delete n._private.scratch._dragStartPos);
    });
    // Перетаскивание одиночной фигуры
    cy.on('dragfree', 'node[isShape]', function(evt) {
        if (window.isOperator || window.dragLocked) return;
        const node = evt.target;
        let pos = node.position();
        const { width, height } = getBgDimensions();
        if (width && height) {
            const bounded = boundNodePosition(pos);
            if (bounded.x !== pos.x || bounded.y !== pos.y) {
                node.position(bounded);
                pos = bounded;
            }
        }
        const shapeId = node.id().replace('shape_', '');
        clearTimeout(dragTimeouts[shapeId]);
        dragTimeouts[shapeId] = setTimeout(() => {
            window.setSkipNextMapUpdate();
            fetch(`/api/shape/${shapeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ x: pos.x, y: pos.y })
            })
            .catch(err => console.error('Error saving shape position:', err))
            .finally(() => {
                setTimeout(() => window.clearSkipNextMapUpdate(), 500);
            });
            delete dragTimeouts[shapeId];
        }, 500);
        if (typeof window.saveState === 'function') window.saveState('Перемещение фигуры');
    });
    // Перетаскивание группы
    cy.on('dragfree', 'node[isGroup]', function(evt) {
        if (window.isOperator || window.dragLocked) return;
        const groupNode = evt.target;
        const children = groupNode.children().filter(child => !child.data('isGroup'));
        if (!children.length) return;

        let pos = groupNode.position();
        const { width, height } = getBgDimensions();
        if (width && height) {
            const bounded = boundNodePosition(pos);
            if (bounded.x !== pos.x || bounded.y !== pos.y) groupNode.position(bounded);
            pos = groupNode.position();
        }

        const updates = children.map(child => ({
            id: child.id(),
            x: Math.round(child.position().x),
            y: Math.round(child.position().y)
        }));

        // Ставим флаг ПЕРЕД отправкой, чтобы пропустить свой map_updated
        window.setSkipNextMapUpdate();

        clearTimeout(dragTimeouts[groupNode.id()]);
        dragTimeouts[groupNode.id()] = setTimeout(() => {
            fetch('/api/devices/positions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify(updates)
            })
            .then(response => {
                if (!response.ok) throw new Error('Failed to update positions');
                return response.json();
            })
            .then(() => {
                if (typeof window.saveState === 'function') window.saveState('Перемещение группы');
            })
            .catch(err => console.error('Error moving group:', err))
            .finally(() => {
                setTimeout(() => window.clearSkipNextMapUpdate(), 10000);
            });
            delete dragTimeouts[groupNode.id()];
        }, 500);
    });

    // Клики по узлам
    cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        if (isLinkMode()) {
            evt.stopPropagation();
            const source = getSourceNode();
            if (!source) startLinkMode(node);
            else if (source.id() !== node.id()) {
                if (typeof window.openLinkModal === 'function') {
                    window.openLinkModal(source.id(), node.id());
                } else {
                    console.error('openLinkModal not defined');
                }
            }
            return;
        }
        if (node.data('isShape')) {
            if (window.currentMode !== 'select') cy.nodes().selected(false);
            node.selected(true);
            return;
        }
        if (window.copyTimer) clearTimeout(window.copyTimer);
        window.copyTimer = setTimeout(() => {
            const ip = node.data('ip');
            if (ip && ip.trim()) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(ip).then(() => {
                        if (typeof showToast === 'function') showToast('Скопировано', `IP ${ip}`, 'info');
                    }).catch(() => {
                        fallbackCopy(ip);
                    });
                } else {
                    fallbackCopy(ip);
                }
            }
        }, 200);
        if (window.currentMode !== 'select') cy.nodes().selected(false);
        node.selected(true);
    });

    cy.on('dbltap', 'node', function(evt) {
        if (window.copyTimer) clearTimeout(window.copyTimer);
        const node = evt.target;
        if (node.data('isGroup')) return;
        if (node.data('isShape')) {
            if (typeof window.openShapeModal === 'function') window.openShapeModal(node);
        } else {
            if (typeof window.openDeviceModal === 'function') window.openDeviceModal(node);
        }
    });

    cy.on('tap', 'edge', function(evt) {
        if (window.currentMode !== 'select') cy.edges().selected(false);
        evt.target.selected(true);
    });

    cy.on('dbltap', 'edge', (evt) => {
        if (typeof window.openLinkModalForEdit === 'function') {
            window.openLinkModalForEdit(evt.target);
        }
    });

    cy.on('tap', (event) => {
        if (event.target === cy && isLinkMode()) resetLinkMode();
    });
}
