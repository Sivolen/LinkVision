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
            fetch(`/api/device/${node.id()}/position`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) })
            })
            .then(() => {
                if (typeof window.saveState === 'function') window.saveState('Перемещение устройства');
            }).catch(err => console.error(err));
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
            const promises = deviceUpdates.map(upd =>
                fetch(`/api/device/${upd.id}/position`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                    body: JSON.stringify({ x: upd.x, y: upd.y })
                })
            );
            Promise.all(promises).catch(console.error)
            .then(() => {
            if (typeof window.saveState === 'function') window.saveState('Перемещение группы устройств');
        })
        .catch(console.error);
        }, 500);
        selectedNodes.forEach(n => delete n._private.scratch._dragStartPos);
    });

    // Клики по узлам
    cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        if (isLinkMode()) {
            evt.stopPropagation();
            const source = getSourceNode();
            if (!source) startLinkMode(node);
            else if (source.id() !== node.id()) {
                // глобальная функция открытия модалки связи
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
        // копирование IP с задержкой
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

    // Клики по рёбрам
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
// ===== Универсальный парсер цвета в RGB =====
function parseColorToRgb(color) {
    if (!color) return null;
    // Если уже в формате rgb(r,g,b)
    const rgbMatch = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
    if (rgbMatch) {
        return {
            r: parseInt(rgbMatch[1]),
            g: parseInt(rgbMatch[2]),
            b: parseInt(rgbMatch[3])
        };
    }
    // Если HEX
    const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
    if (hexMatch) {
        return {
            r: parseInt(hexMatch[1], 16),
            g: parseInt(hexMatch[2], 16),
            b: parseInt(hexMatch[3], 16)
        };
    }
    return null;
}

// ===== Вспомогательная функция ограничения =====
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// ===== Плавная анимация стилей ребра (с ограничением RGB) =====
function animateEdgeStyle(edge, targetColor, targetWidth, duration = 200) {
    const startColor = edge.style('line-color') || '#6c757d';
    const startWidth = parseFloat(edge.style('width')) || 2;
    const startRgb = parseColorToRgb(startColor);
    const targetRgb = parseColorToRgb(targetColor);
    if (!startRgb || !targetRgb) return;
    const startTime = performance.now();

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const r = clamp(Math.round(startRgb.r + (targetRgb.r - startRgb.r) * progress), 0, 255);
        const g = clamp(Math.round(startRgb.g + (targetRgb.g - startRgb.g) * progress), 0, 255);
        const b = clamp(Math.round(startRgb.b + (targetRgb.b - startRgb.b) * progress), 0, 255);
        const width = startWidth + (targetWidth - startWidth) * progress;
        edge.style({
            'line-color': `rgb(${r}, ${g}, ${b})`,
            'width': width
        });
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ===== Плавная анимация стилей узла (с ограничением RGB) =====
function animateNodeStyle(node, targetColor, targetWidth, duration = 200) {
    const startColor = node.style('border-color') || '#28a745';
    const startWidth = parseFloat(node.style('border-width')) || 3;
    const startRgb = parseColorToRgb(startColor);
    const targetRgb = parseColorToRgb(targetColor);
    if (!startRgb || !targetRgb) return;
    const startTime = performance.now();

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const r = clamp(Math.round(startRgb.r + (targetRgb.r - startRgb.r) * progress), 0, 255);
        const g = clamp(Math.round(startRgb.g + (targetRgb.g - startRgb.g) * progress), 0, 255);
        const b = clamp(Math.round(startRgb.b + (targetRgb.b - startRgb.b) * progress), 0, 255);
        const width = startWidth + (targetWidth - startWidth) * progress;
        node.style({
            'border-color': `rgb(${r}, ${g}, ${b})`,
            'border-width': width
        });
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}
    // Подсветка связей при наведении на устройство
// Вместо animateEdgeStyle / animateNodeStyle используем прямые стили:
cy.on('mouseover', 'node', function(evt) {
    if (window.isOperator) return;
    const node = evt.target;
    if (node.data('isGroup') || node.data('isShape')) return;

    const edges = node.connectedEdges();
    const neighbors = edges.connectedNodes();

    edges.forEach(edge => {
        if (!edge._private.originalStyle) {
            edge._private.originalStyle = {
                'line-color': edge.style('line-color'),
                'width': edge.style('width')
            };
        }
        edge.style({ 'line-color': '#f59e0b', 'width': 3 });
    });

    neighbors.union(node).forEach(n => {
        if (!n._private.originalBorderStyle) {
            n._private.originalBorderStyle = {
                'border-color': n.style('border-color'),
                'border-width': n.style('border-width')
            };
        }
        n.style({ 'border-color': '#f59e0b', 'border-width': 3 });
    });
});

cy.on('mouseout', 'node', function(evt) {
    if (window.isOperator) return;
    const node = evt.target;
    if (node.data('isGroup') || node.data('isShape')) return;

    const edges = node.connectedEdges();
    const neighbors = edges.connectedNodes();

    edges.forEach(edge => {
        if (edge._private.originalStyle) {
            const orig = edge._private.originalStyle;
            edge.style({ 'line-color': orig['line-color'], 'width': orig['width'] });
        }
    });

    neighbors.union(node).forEach(n => {
        if (n._private.originalBorderStyle) {
            const orig = n._private.originalBorderStyle;
            n.style({ 'border-color': orig['border-color'], 'border-width': orig['border-width'] });
        }
    });
});
        // ==================== КОНТЕКСТНОЕ МЕНЮ ====================
    let contextMenu = null;

    // Создание и показ меню с абсолютными координатами
    function showContextMenu(items, mouseX, mouseY) {
        if (contextMenu) contextMenu.remove();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.cssText = `
            position: fixed;
            top: ${mouseY}px;
            left: ${mouseX}px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            min-width: 180px;
            overflow: hidden;
        `;

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'context-menu-item';
            btn.style.cssText = `
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
                padding: 10px 16px;
                background: transparent;
                border: none;
                color: var(--text-primary);
                font-size: 0.9rem;
                text-align: left;
                cursor: pointer;
                transition: background 0.15s;
            `;
            btn.innerHTML = `<i class="fas ${item.icon}" style="width: 20px;"></i> ${item.label}`;
            btn.onclick = (e) => {
                e.stopPropagation();
                item.action();
                if (contextMenu) contextMenu.remove();
            };
            btn.onmouseenter = () => btn.style.backgroundColor = 'var(--accent-color)';
            btn.onmouseleave = () => btn.style.backgroundColor = 'transparent';
            menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        contextMenu = menu;

        // Закрыть при клике вне
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                if (contextMenu) contextMenu.remove();
                document.removeEventListener('click', closeHandler);
                document.removeEventListener('contextmenu', closeHandler);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeHandler);
            document.addEventListener('contextmenu', closeHandler);
        }, 10);
    }

    // Получение абсолютных координат мыши из события Cytoscape
    function getAbsoluteMousePosition(cyEvent) {
        const originalEvent = cyEvent.originalEvent;
        if (originalEvent && typeof originalEvent.clientX === 'number') {
            return { x: originalEvent.clientX, y: originalEvent.clientY };
        }
        // fallback: используем renderedPosition + смещение canvas
        const rendered = cyEvent.renderedPosition;
        const canvasRect = document.getElementById('cy').getBoundingClientRect();
        return { x: canvasRect.left + rendered.x, y: canvasRect.top + rendered.y };
    }

    // Обработчик правого клика на пустой области
    cy.on('cxttap', function(event) {
        if (event.target === cy) {
            const { x, y } = getAbsoluteMousePosition(event);
            showContextMenu([
                { icon: 'fa-plus-circle', label: 'Создать устройство', action: () => window.openDeviceModal() },
                { icon: 'fa-shapes', label: 'Создать фигуру', action: () => window.openShapeModal() }
            ], x, y);
        }
    });

    // Обработчик правого клика на узлах
    cy.on('cxttap', 'node', function(evt) {
        const node = evt.target;
        const { x, y } = getAbsoluteMousePosition(evt);

        if (node.data('isGroup')) {
            showContextMenu([
                { icon: 'fa-edit', label: 'Редактировать группу', action: () => {
                    const id = node.data('group_id');
                    const name = node.data('name');
                    const color = node.data('color');
                    const fontSize = node.data('fontSize');
                    if (typeof window.editGroup === 'function') {
                        window.editGroup(id, name, color, fontSize);
                        if (typeof window.openGroupManager === 'function') window.openGroupManager();
                    }
                }},
                { icon: 'fa-trash', label: 'Удалить группу', action: () => {
                    if (typeof window.deleteGroup === 'function') {
                        window.deleteGroup(node.data('group_id'), node.data('name'));
                    }
                }}
            ], x, y);
            return;
        }

        if (node.data('isShape')) {
            showContextMenu([
                { icon: 'fa-edit', label: 'Редактировать фигуру', action: () => window.openShapeModal(node) },
                { icon: 'fa-trash', label: 'Удалить фигуру', action: () => {
                    const id = node.id().replace('shape_', '');
                    if (typeof window.deleteShape === 'function') window.deleteShape(id);
                }}
            ], x, y);
            return;
        }

        // Устройство
        const deviceId = node.id();
        const deviceIp = node.data('ip');

        const items = [
            { icon: 'fa-edit', label: 'Редактировать', action: () => window.openDeviceModal(node) },
            { icon: 'fa-trash', label: 'Удалить', action: () => {
                if (typeof window.deleteDevice === 'function') window.deleteDevice(deviceId);
            }}
        ];
        if (deviceIp && deviceIp.trim()) {
            items.push({ icon: 'fa-copy', label: 'Копировать IP', action: () => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(deviceIp).then(() => {
                        if (typeof showToast === 'function') showToast('Скопировано', `IP ${deviceIp}`, 'info');
                    }).catch(() => fallbackCopy(deviceIp));
                } else {
                    fallbackCopy(deviceIp);
                }
            }});
        }
        items.push({ icon: 'fa-history', label: 'История изменений', action: () => {
            if (typeof window.openDeviceModal === 'function') {
                window.openDeviceModal(node);
                setTimeout(() => {
                    const historyTab = document.querySelector('a[href="#device-history"]');
                    if (historyTab) {
                        const tab = new bootstrap.Tab(historyTab);
                        tab.show();
                    }
                }, 300);
            }
        }});
        showContextMenu(items, x, y);
    });

    // Обработчик правого клика на рёбрах
    cy.on('cxttap', 'edge', function(evt) {
        const edge = evt.target;
        const { x, y } = getAbsoluteMousePosition(evt);
        const linkId = edge.id();
        showContextMenu([
            { icon: 'fa-edit', label: 'Редактировать связь', action: () => {
                if (typeof window.openLinkModalForEdit === 'function') window.openLinkModalForEdit(edge);
            }},
            { icon: 'fa-trash', label: 'Удалить связь', action: () => {
                if (typeof window.deleteLink === 'function') window.deleteLink(linkId);
            }}
        ], x, y);
    });
}