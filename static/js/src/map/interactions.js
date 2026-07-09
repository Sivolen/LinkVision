// interactions.js – перетаскивание узлов, клики, групповое перемещение
import { getCy } from './core.js';
import { t } from '../i18n/i18n.js';
import { boundNodePosition, getBgDimensions } from './background.js';
import { startLinkMode, resetLinkMode, isLinkMode, getSourceNode } from './modes.js';
import { updateEdgeLabelsForNode } from './edgeLabels.js';
import { updateGroupsForNode, updateAllGroups } from './groupResize.js';
import { isDragLocked } from './lock.js';
import { showToast } from '../utils/toast.js';
import { http } from '../utils/http.js';
import { beginSelfUpdate, endSelfUpdate } from '../utils/state.js';
import { isShapeId, parseRawId } from './ids.js';

let dragTimeouts = {};
let groupBatchTimeout = null;
let hoverTimeout = null;
let pendingHighlight = null;
let highlightedNodes = new Set();
let highlightedEdges = new Set();

// Отложенные (debounced) сохранения позиций после drag, которые ещё не
// долетели до сервера/истории undo. Ключ -> функция, которая немедленно
// выполняет сохранение (используется flushPendingDragSaves()).
const pendingDragSaves = {};

/**
 * Принудительно и немедленно выполняет все отложенные сохранения позиций
 * (устройства, фигуры, групповые перемещения), которые сейчас ждут в
 * debounce-таймере. Нужно вызывать перед undo/redo — иначе можно словить
 * гонку: пользователь тащит устройство, сразу жмёт "Отменить", а через
 * 500 мс всё равно прилетает отложенное saveState() поверх уже
 * восстановленного состояния, и история выглядит "случайной".
 */
export function flushPendingDragSaves() {
    const entries = Object.entries(pendingDragSaves);
    if (!entries.length) return Promise.resolve();

    const jobs = entries.map(([key, commit]) => {
        clearTimeout(dragTimeouts[key]);
        delete dragTimeouts[key];
        try {
            return commit();
        } catch (e) {
            console.error('Commit error in flushPendingDragSaves:', e);
            return Promise.resolve();
        }
    });
    clearTimeout(groupBatchTimeout);
    return Promise.allSettled(jobs).then(() => undefined);
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    if (typeof showToast === 'function') showToast(t('contextMenu.copied'), t('contextMenu.copiedFallback', { ip: text }), 'info');
}

// Оптимизация highlight через requestAnimationFrame
function scheduleHighlight(node) {
    if (pendingHighlight) return; // Уже запланировано

    pendingHighlight = true;
    requestAnimationFrame(() => {
        applyHighlight(node);
        pendingHighlight = false;
    });
}

function applyHighlight(node) {
    if (window.isOperator) return;
    if (!node || node.data('isGroup') || node.data('isShape')) return;

    const edges = node.connectedEdges();
    const neighbors = edges.connectedNodes();

    // Подсвечиваем edges
    edges.forEach(edge => {
        if (!highlightedEdges.has(edge)) {
            if (!edge._private.originalStyle) {
                edge._private.originalStyle = {
                    'line-color': edge.style('line-color'),
                    'width': edge.style('width')
                };
            }
            edge.style({ 'line-color': '#f59e0b', 'width': 3 });
            highlightedEdges.add(edge);
        }
    });

    // Подсвечиваем neighbors
    neighbors.union(node).forEach(n => {
        if (!highlightedNodes.has(n)) {
            if (!n._private.originalBorderStyle) {
                n._private.originalBorderStyle = {
                    'border-color': n.style('border-color'),
                    'border-width': n.style('border-width')
                };
            }
            n.style({ 'border-color': '#f59e0b', 'border-width': 3 });
            highlightedNodes.add(n);
        }
    });
}

function clearHighlight() {
    // Очищаем edges
    highlightedEdges.forEach(edge => {
        if (edge._private.originalStyle) {
            edge.style(edge._private.originalStyle);
            delete edge._private.originalStyle;
        }
    });
    highlightedEdges.clear();

    // Очищаем nodes
    highlightedNodes.forEach(n => {
        if (n._private.originalBorderStyle) {
            n.style(n._private.originalBorderStyle);
            delete n._private.originalBorderStyle;
        }
    });
    highlightedNodes.clear();
}

export function initInteractions(cy) {
    // Флаг: пользователь тащит compound-узел (группу), а не отдельное устройство.
    // При перетаскивании группы Cytoscape генерирует dragfree на каждом ребёнке
    // тоже — без этого флага каждый ребёнок создал бы отдельную запись в истории
    // undo, и отмена "ничего не делала" бы (N одинаковых записей подряд).
    let draggingGroup = false;
    cy.on('grab', 'node[isGroup]', () => { draggingGroup = true; });

    // Перетаскивание одиночного узла
    cy.on('dragfree', 'node', function(evt) {
        const node = evt.target;
        if (node.data('isGroup') || node.data('isShape')) return;
        if (window.isOperator || isDragLocked()) return;
        // Если тащили группу — дети уже обработаны в node[isGroup], пропускаем
        if (draggingGroup) return;

        let pos = node.position();
        const { width, height } = getBgDimensions();
        if (width && height) {
            const bounded = boundNodePosition(pos);
            if (bounded.x !== pos.x || bounded.y !== pos.y) node.position(bounded);
            pos = node.position();
        }
        updateEdgeLabelsForNode(node);

        const key = `device:${node.id()}`;
        const commitDeviceMove = () => {
            delete pendingDragSaves[key];
            beginSelfUpdate();
            return http.put(`/api/device/${node.id()}/position`, { x: Math.round(pos.x), y: Math.round(pos.y) })
            .then(() => {
                if (typeof window.saveState === 'function') window.saveState('Перемещение устройства');
            })
            .catch(err => console.error(err))
            .finally(() => {
                endSelfUpdate();
                delete dragTimeouts[key];
            });
        };

        clearTimeout(dragTimeouts[key]);
        dragTimeouts[key] = setTimeout(commitDeviceMove, 500);
        pendingDragSaves[key] = commitDeviceMove;
    });
    // Групповое перетаскивание (несколько выделенных узлов сразу)
    cy.on('dragfree', 'node:selected', function(evt) {
        if (window.isOperator || isDragLocked()) return;
        const draggedNode = evt.target;
        // Пропускаем группы – они не будут сохраняться в историю
        if (draggedNode.data('isGroup')) return;
        const selectedNodes = cy.nodes(':selected').filter(n => !n.data('isGroup'));
        if (selectedNodes.length <= 1) return;

        // Cytoscape уже переместил ВСЕ выделенные узлы за время drag
        // (стандартное поведение multi-select drag) — просто читаем финальные
        // позиции. Раньше здесь пересчитывалась и повторно применялась
        // дельта относительно node._private.scratch._dragStartPos, но эта
        // scratch-переменная нигде не устанавливалась — ветка либо была
        // мертва (если проверялся oldPos), либо задваивала смещение узлов.
        const deviceUpdates = [], shapeUpdates = [];
        selectedNodes.forEach(node => {
            let { x, y } = node.position();
            if (getBgDimensions().width) {
                const bounded = boundNodePosition({ x, y });
                if (bounded.x !== x || bounded.y !== y) {
                    node.position(bounded);
                    x = bounded.x; y = bounded.y;
                }
            }
            if (node.data('isShape')) {
                shapeUpdates.push({ id: parseRawId(node.id()), x: Math.round(x), y: Math.round(y) });
            } else {
                deviceUpdates.push({ id: node.id(), x: Math.round(x), y: Math.round(y) });
            }
        });

        selectedNodes.forEach(node => updateGroupsForNode(node));
        selectedNodes.forEach(node => updateEdgeLabelsForNode(node));
        updateAllGroups();

        const key = 'multiSelect';
        const commitGroupMove = () => {
            delete pendingDragSaves[key];
            beginSelfUpdate();
            const promises = [
                ...deviceUpdates.map(upd => http.put(`/api/device/${upd.id}/position`, { x: upd.x, y: upd.y })),
                ...shapeUpdates.map(upd => http.put(`/api/shape/${upd.id}`, { x: upd.x, y: upd.y })),
            ];
            return Promise.all(promises)
                .then(() => {
                    if (typeof window.saveState === 'function') window.saveState('Перемещение группы устройств');
                })
                .catch(console.error)
                .finally(() => endSelfUpdate());
        };

        clearTimeout(groupBatchTimeout);
        groupBatchTimeout = setTimeout(commitGroupMove, 500);
        pendingDragSaves[key] = commitGroupMove;
    });
    // Перетаскивание одиночной фигуры
    cy.on('dragfree', 'node[isShape]', function(evt) {
        if (window.isOperator || isDragLocked()) return;
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
        const shapeId = parseRawId(node.id());
        const key = `shape:${shapeId}`;

        const commitShapeMove = () => {
            delete pendingDragSaves[key];
            beginSelfUpdate();
            return http.put(`/api/shape/${shapeId}`, { x: Math.round(pos.x), y: Math.round(pos.y) })
            .then(() => {
                // ВАЖНО: saveState теперь вызывается только после успешного
                // сохранения на сервере — раньше он срабатывал сразу при
                // dragfree, до debounce и до реального PUT, из-за чего
                // история могла зафиксировать позицию, которая ещё не
                // была (или не будет, при ошибке сети) сохранена на бэкенде.
                if (typeof window.saveState === 'function') window.saveState('Перемещение фигуры');
            })
            .catch(err => console.error('Error saving shape position:', err))
            .finally(() => {
                endSelfUpdate();
                delete dragTimeouts[key];
            });
        };

        clearTimeout(dragTimeouts[key]);
        dragTimeouts[key] = setTimeout(commitShapeMove, 500);
        pendingDragSaves[key] = commitShapeMove;
    });
    // Перетаскивание группы
    cy.on('dragfree', 'node[isGroup]', function(evt) {
        if (window.isOperator || isDragLocked()) return;
        const groupNode = evt.target;
        // Фильтруем: только устройства, не вложенные группы
        const children = groupNode.children().filter(child => !child.data('isGroup'));
        if (!children.length) return;

        // Ограничение позиции группы границами фона (если есть)
        let pos = groupNode.position();
        const { width, height } = getBgDimensions();
        if (width && height) {
            const bounded = boundNodePosition(pos);
            if (bounded.x !== pos.x || bounded.y !== pos.y) groupNode.position(bounded);
            pos = groupNode.position();
        }

        // Собираем новые позиции всех дочерних устройств
        const updates = children.map(child => ({
            id: child.id(),
            x: Math.round(child.position().x),
            y: Math.round(child.position().y)
        }));

        const key = `group:${groupNode.id()}`;
        const commitGroupNodeMove = () => {
            delete pendingDragSaves[key];
            beginSelfUpdate();

            // Отправляем один массовый запрос вместо многих
            return http.put('/api/devices/positions', updates)
            .then(response => {
                if (typeof window.saveState === 'function') window.saveState('Перемещение группы');
            })
            .catch(err => console.error('Error moving group:', err))
            .finally(() => {
                endSelfUpdate();
                delete dragTimeouts[key];
            });
        };

        clearTimeout(dragTimeouts[key]);
        dragTimeouts[key] = setTimeout(commitGroupNodeMove, 500);
        pendingDragSaves[key] = commitGroupNodeMove;

        // Сбрасываем флаг в следующем тике — после всех dragfree на детях
        setTimeout(() => { draggingGroup = false; }, 0);
    });
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
                        if (typeof showToast === 'function') showToast(t('contextMenu.copied'), `IP ${ip}`, 'info');
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

    // Подсветка связей при наведении (без throttle!)
    const handleMouseOver = function(evt) {
        if (window._isBulkSelecting) return;   // ← подавляем во время рамки
        const node = evt.target;
        if (node.data('isGroup') || node.data('isShape')) return;
        scheduleHighlight(node);
    };

    const handleMouseOut = function(evt) {
        // Если кнопка мыши зажата (началось перетаскивание) — не очищать подсветку
        if (evt.originalEvent.buttons) return;

        const node = evt.target;
        if (node.data('isGroup') || node.data('isShape')) return;
        clearHighlight();
    };

    // Fallback: полная очистка при движении мыши по canvas
    cy.on('mousemove', function(evt) {
        if (window.isOperator) return;
        if (evt.originalEvent.buttons) return; // Не очищать при drag
        const node = evt.target;
        if (!node || node === cy) {
            clearHighlight();
        }
    });

    cy.on('mouseover', 'node', handleMouseOver);
    cy.on('mouseout', 'node', handleMouseOut);

    // Гасим hover-подсветку во время боксового выделения
    cy.on('boxstart', () => { window._isBulkSelecting = true; clearHighlight(); });
    cy.on('boxend',   () => { window._isBulkSelecting = false; });
        // ==================== КОНТЕКСТНОЕ МЕНЮ ====================
    let contextMenu = null;

    // Создание и показ меню с абсолютными координатами
    function showContextMenu(items, mouseX, mouseY) {
        if (contextMenu) contextMenu.remove();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', t('contextMenu.menuAria'));
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

        const buttons = [];
        items.forEach((item, i) => {
            const btn = document.createElement('button');
            btn.className = 'context-menu-item';
            btn.setAttribute('role', 'menuitem');
            btn.setAttribute('tabindex', i === 0 ? '0' : '-1');
            btn.setAttribute('aria-label', item.label);
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
            btn.innerHTML = `<i class="fas ${item.icon}" style="width: 20px;" aria-hidden="true"></i> ${item.label}`;
            btn.onclick = (e) => {
                e.stopPropagation();
                item.action();
                if (contextMenu) contextMenu.remove();
            };
            btn.onmouseenter = () => btn.style.backgroundColor = 'var(--accent-color)';
            btn.onmouseleave = () => btn.style.backgroundColor = 'transparent';
            menu.appendChild(btn);
            buttons.push(btn);
        });

        document.body.appendChild(menu);
        contextMenu = menu;

        // Фокус на первый элемент
        buttons[0]?.focus();

        // Клавиатурная навигация
        menu.addEventListener('keydown', (e) => {
            const idx = buttons.indexOf(document.activeElement);
            if (idx === -1) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const next = (idx + 1) % buttons.length;
                buttons[next].focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prev = (idx - 1 + buttons.length) % buttons.length;
                buttons[prev].focus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeMenu();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                closeMenu();
            }
        });

        // Закрыть при клике вне
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                if (contextMenu) contextMenu.remove();
                document.removeEventListener('click', closeHandler);
                document.removeEventListener('contextmenu', closeHandler);
            }
        };
        const closeMenu = () => {
            if (contextMenu) contextMenu.remove();
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
        event.originalEvent?.preventDefault();
        if (event.target === cy) {
            const { x, y } = getAbsoluteMousePosition(event);
            showContextMenu([
                { icon: 'fa-plus-circle', label: t('contextMenu.createDevice'), action: () => window.openDeviceModal() },
                { icon: 'fa-shapes', label: t('contextMenu.createShape'), action: () => window.openShapeModal() }
            ], x, y);
        }
    });

    // Обработчик правого клика на узлах
    cy.on('cxttap', 'node', function(evt) {
        const node = evt.target;
        const { x, y } = getAbsoluteMousePosition(evt);

        if (node.data('isGroup')) {
            showContextMenu([
                { icon: 'fa-edit', label: t('contextMenu.editGroup'), action: () => {
                    const id = node.data('group_id');
                    const name = node.data('name');
                    const color = node.data('color');
                    const fontSize = node.data('fontSize');
                    if (typeof window.editGroup === 'function') {
                        window.editGroup(id, name, color, fontSize);
                        if (typeof window.openGroupManager === 'function') window.openGroupManager();
                    }
                }},
                { icon: 'fa-trash', label: t('contextMenu.deleteGroup'), action: () => {
                    if (typeof window.deleteGroup === 'function') {
                        window.deleteGroup(node.data('group_id'), node.data('name'));
                    }
                }}
            ], x, y);
            return;
        }

        if (node.data('isShape')) {
            showContextMenu([
                { icon: 'fa-edit', label: t('contextMenu.editShape'), action: () => window.openShapeModal(node) },
                { icon: 'fa-trash', label: t('contextMenu.deleteShape'), action: () => {
                    const id = parseRawId(node.id());
                    if (typeof window.deleteShape === 'function') window.deleteShape(id);
                }}
            ], x, y);
            return;
        }

        // Устройство
        const deviceId = node.id();
        const deviceIp = node.data('ip');

        const items = [
            { icon: 'fa-edit', label: t('contextMenu.edit'), action: () => window.openDeviceModal(node) },
            { icon: 'fa-trash', label: t('common.delete'), action: () => {
                if (typeof window.deleteDevice === 'function') window.deleteDevice(deviceId);
            }}
        ];
        if (deviceIp && deviceIp.trim()) {
            items.push({ icon: 'fa-copy', label: t('contextMenu.copyIp'), action: () => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(deviceIp).then(() => {
                        if (typeof showToast === 'function') showToast(t('contextMenu.copied'), `IP ${deviceIp}`, 'info');
                    }).catch(() => fallbackCopy(deviceIp));
                } else {
                    fallbackCopy(deviceIp);
                }
            }});
        }
        items.push({ icon: 'fa-history', label: t('contextMenu.history'), action: () => {
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
            { icon: 'fa-edit', label: t('contextMenu.editLink'), action: () => {
                if (typeof window.openLinkModalForEdit === 'function') window.openLinkModalForEdit(edge);
            }},
            { icon: 'fa-trash', label: t('contextMenu.deleteLink'), action: () => {
                if (typeof window.deleteLink === 'function') window.deleteLink(linkId);
            }}
        ], x, y);
    });
}
