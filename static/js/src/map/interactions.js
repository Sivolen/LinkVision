// interactions.js – перетаскивание узлов, клики, групповое перемещение
import { getCy } from './core.js';
import { t } from '../i18n/i18n.js';
import { boundNodePosition, getBgDimensions } from './background.js';
import { startLinkMode, resetLinkMode, isLinkMode, getSourceNode } from './modes.js';
import { updateEdgeLabelsForNode, updateEdgeLabelsForNodes } from './edgeLabels.js';
import { updateEdgeCurves } from './edgeBundling.js';
import { updateGroupsForNode, updateGroupsForNodes } from './groupResize.js';
import { isDragLocked } from './lock.js';
import { showToast } from '../utils/toast.js';
import { http } from '../utils/http.js';
import { beginSelfUpdate, endSelfUpdate, rememberLocalOperation } from '../utils/state.js';
import { isShapeId, parseRawId } from './ids.js';
import { registerCleanup } from './moduleRegistry.js';

let dragTimeouts = {};
let groupBatchTimeout = null;
// Состояние hover-подсветки: ровно один активный узел и один rAF-цикл.
let hoverLeaveTarget = null;
let hoverState = null; // { nodeId, startedAt, raf, edges: [{edge, reverse, base}], nodes }
let activeContextMenu = null;
let closeContextMenuHandler = null;
let closeContextMenuTimer = null;

function closeActiveContextMenu() {
    if (closeContextMenuTimer) {
        clearTimeout(closeContextMenuTimer);
        closeContextMenuTimer = null;
    }
    if (closeContextMenuHandler) {
        document.removeEventListener('click', closeContextMenuHandler);
        document.removeEventListener('contextmenu', closeContextMenuHandler);
        closeContextMenuHandler = null;
    }
    if (activeContextMenu) {
        activeContextMenu.remove();
        activeContextMenu = null;
    }
}

registerCleanup(closeActiveContextMenu);

function saveStateForMap(mapId, description) {
    if (String(window.currentMapId) !== String(mapId)) return;
    if (typeof window.saveState === 'function') window.saveState(description);
}

// Отложенные (debounced) сохранения позиций после drag, которые ещё не
// долетели до сервера/истории undo. Ключ -> функция, которая немедленно
// выполняет сохранение (используется flushPendingDragSaves()).
const pendingDragSaves = {};

// Copy buffer is intentionally kept in this module's memory only. It survives
// map reinitialization and is replaced only after another device is copied.
let copiedDeviceConfig = null;
let deviceCopyRequestId = 0;

async function copyDeviceConfiguration(node) {
    const requestId = ++deviceCopyRequestId;
    try {
        // The rendered Cytoscape node omits some editable fields (notably type
        // and the complete IP list), so reuse the existing authorized details
        // endpoint and explicitly whitelist fields supported by device create.
        const details = await http.get(`/api/device/${encodeURIComponent(node.id())}/details`);
        // If the user copied another device while this request was in flight,
        // only the most recent copy action is allowed to replace the buffer.
        if (requestId !== deviceCopyRequestId) return;
        const monitoringValue = details.monitoring_enabled ?? node.data('monitoring_enabled');
        const monitoringEnabled = monitoringValue === true || monitoringValue === 'true';

        copiedDeviceConfig = {
            sourceMapId: window.currentMapId,
            fields: {
                name: details.name ?? node.data('name') ?? '',
                type_id: details.type_id ?? node.data('type_id') ?? null,
                ips: Array.isArray(details.ips)
                    ? details.ips.filter(ip => typeof ip === 'string').slice()
                    : (Array.isArray(node.data('ips')) ? node.data('ips').slice() : []),
                group_id: details.group_id ?? node.data('group_id') ?? null,
                font_size: node.data('fontSize') ?? details.font_size ?? null,
                monitoring_enabled: monitoringEnabled,
                quality_profile_id: details.quality_profile_id ?? null
            }
        };

        showToast(
            t('toast.successTitle'),
            t('contextMenu.deviceCopied', { name: copiedDeviceConfig.fields.name }),
            'success'
        );
    } catch (err) {
        if (requestId !== deviceCopyRequestId) return;
        console.error('Failed to copy device configuration:', err);
        showToast(t('toast.errorTitle'), t('contextMenu.deviceCopyFailed'), 'error');
    }
}

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

// ==================== HOVER-ПОДСВЕТКА С ЗАПОЛНЕНИЕМ РЁБЕР ====================
// Принципы (чтобы не залипало при быстром движении мыши):
//  1. Никаких отложенных применений: stopHover() и startHover() синхронные.
//  2. Исходные стили не копируются: финальное состояние — CSS-классы
//     (hl-edge / hl-node), промежуточное — bypass, который снимается removeStyle.
//  3. Очистка идемпотентна, обёрнута в try/finally и не может оставить
//     полу-очищенное состояние.
//  4. mouseout очищает только если уходим с того узла, который активен.
const HL_FILL_MS = 350;
const HL_GOLD = '#f59e0b';
const HL_LIGHT = '#fde68a';
const HL_ANIM_KEYS = ['line-fill', 'line-gradient-stop-colors',
    'line-gradient-stop-positions', 'transition-property', 'line-color', 'width'];

// Итоговое состояние «горит»: явный сплошной золотой стиль на ребре.
// Держится до stopHover(), который снимает все HL_ANIM_KEYS.
function setSolidGold(edge) {
    edge.removeStyle('line-gradient-stop-colors line-gradient-stop-positions');
    edge.style({
        'transition-property': 'none',
        'line-fill': 'solid',
        'line-color': HL_GOLD,
        'width': 3
    });
    edge.addClass('hl-edge');
}

function isPlainDevice(node) {
    return node && node.length && !node.data('isGroup') && !node.data('isShape');
}

function stopHover() {
    const st = hoverState;
    hoverState = null;               // сначала сбрасываем, чтобы повторный вызов был no-op
    if (!st) return;
    if (st.raf !== null) cancelAnimationFrame(st.raf);
    const cy = getCy();
    const clean = () => {
        st.edges.forEach(({ edge }) => {
            try {
                if (edge.removed()) return;
                edge.removeStyle(HL_ANIM_KEYS.join(' '));
                edge.removeClass('hl-edge');
            } catch (e) { console.warn('hover edge cleanup', e); }
        });
        st.nodes.forEach(n => {
            try { if (!n.removed()) n.removeClass('hl-node'); }
            catch (e) { console.warn('hover node cleanup', e); }
        });
    };
    try { cy && !cy.destroyed() ? cy.batch(clean) : clean(); }
    catch (e) { console.warn('hover cleanup', e); }
}

function paintFill(st, now) {
    const t = Math.max(0, Math.min(1, (now - st.startedAt) / HL_FILL_MS));
    const p = t * 100;
    st.edges.forEach(({ edge, reverse, base }) => {
        if (edge.removed()) return;
        if (t >= 1) {
            setSolidGold(edge);
            return;
        }
        // Фронт заполнения идёт от наведённого устройства к соседу.
        const colors = reverse ? [base, base, HL_LIGHT, HL_GOLD]
                               : [HL_GOLD, HL_LIGHT, base, base];
        const pos = reverse ? [0, 100 - p, 100 - p, 100] : [0, p, p, 100];
        edge.style({
            'transition-property': 'none',
            'line-fill': 'linear-gradient',
            'line-gradient-stop-colors': colors.join(' '),
            'line-gradient-stop-positions': pos.map(x => x.toFixed(2) + '%').join(' ')
        });
    });
    return t >= 1;
}

function startHover(node) {
    if (window.isOperator || window._isBulkSelecting) return;
    if (!isPlainDevice(node)) return;
    const id = node.id();
    if (hoverState && hoverState.nodeId === id) return;
    stopHover();                                 // синхронно гасим предыдущий

    const cy = getCy();
    if (!cy) return;
    const edges = node.connectedEdges();
    const st = { nodeId: id, startedAt: performance.now(), raf: null, edges: [], nodes: [] };
    hoverState = st;

    cy.batch(() => {
        edges.forEach(edge => {
            // base читаем до любых изменений: stopHover() уже снял прошлый bypass
            st.edges.push({
                edge,
                reverse: edge.target().id() === id && edge.source().id() !== id,
                base: String(edge.style('line-color')).replace(/\s+/g, '')
            });
        });
        edges.connectedNodes().union(node).forEach(n => {
            if (!isPlainDevice(n)) return;
            n.addClass('hl-node');
            st.nodes.push(n);
        });
        try { paintFill(st, st.startedAt); }
        catch (e) {
            console.warn('hover paint', e);
            st.edges.forEach(({ edge }) => {
                setSolidGold(edge);
            });
        }
    });

    const tick = () => {
        const now = performance.now();   // не rAF-метка: она может быть раньше startedAt
        if (hoverState !== st) return;           // нас уже заменили/остановили
        let done = true;
        try { done = paintFill(st, now); }
        catch (e) {
            console.warn('hover paint', e);
            // Градиент не применился — всё равно показываем итоговое золото
            st.edges.forEach(({ edge }) => {
                if (edge.removed()) return;
                setSolidGold(edge);
            });
        }
        st.raf = done ? null : requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
}

function cleanupInteractions() {
    closeActiveContextMenu();
    stopHover();
    if (hoverLeaveTarget) {
        hoverLeaveTarget.removeEventListener('mouseleave', stopHover);
        hoverLeaveTarget = null;
    }

    // Завершаем уже совершённые перемещения до уничтожения старого Cytoscape
    // экземпляра. saveStateForMap не даст позднему ответу добавить их в историю
    // новой карты.
    flushPendingDragSaves().catch(error => {
        console.error('Failed to flush drag saves during map cleanup:', error);
    });
    Object.values(dragTimeouts).forEach(clearTimeout);
    dragTimeouts = {};
    clearTimeout(groupBatchTimeout);
    groupBatchTimeout = null;
}

registerCleanup(cleanupInteractions);

export function initInteractions(cy) {
    cleanupInteractions();
    // Флаг: пользователь тащит compound-узел (группу), а не отдельное устройство.
    // При перетаскивании группы Cytoscape генерирует dragfree на каждом ребёнке
    // тоже — без этого флага каждый ребёнок создал бы отдельную запись в истории
    // undo, и отмена "ничего не делала" бы (N одинаковых записей подряд).
    let draggingGroup = false;
    let draggedGroupId = null;
    cy.on('grab', 'node[isGroup]', evt => {
        draggingGroup = true;
        draggedGroupId = evt.target.id();
    });

    // Перетаскивание одиночного узла
    cy.on('dragfree', 'node', function(evt) {
        const node = evt.target;
        if (node.data('isGroup') || node.data('isShape')) return;
        if (window.canEditMap === false || isDragLocked()) return;
        // Если тащили группу — дети уже обработаны в node[isGroup], пропускаем
        if (draggingGroup) return;
        // Обработчик множественного выделения сохранит все позиции одной
        // пачкой. Без этого одиночный обработчик ставил свой debounce для
        // каждого выбранного устройства, а затем срабатывала и общая пачка.
        if (node.selected() && cy.nodes(':selected').filter(n => !n.data('isGroup')).length > 1) return;

        let pos = node.position();
        const { width, height } = getBgDimensions();
        if (width && height) {
            const bounded = boundNodePosition(pos);
            if (bounded.x !== pos.x || bounded.y !== pos.y) node.position(bounded);
            pos = node.position();
        }
        updateEdgeLabelsForNode(node);
        updateEdgeCurves();

        const operationMapId = window.currentMapId;
        const key = `device:${node.id()}`;
        const commitDeviceMove = () => {
            delete pendingDragSaves[key];
            beginSelfUpdate();
            return http.put(`/api/device/${node.id()}/position`, { x: Math.round(pos.x), y: Math.round(pos.y) })
            .then(() => {
                saveStateForMap(operationMapId, 'Перемещение устройства');
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
        if (window.canEditMap === false || isDragLocked()) return;
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

        const movedDevices = selectedNodes.filter(node => !node.data('isShape'));
        updateGroupsForNodes(movedDevices);
        updateEdgeLabelsForNodes(movedDevices);
        updateEdgeCurves();

        const operationMapId = window.currentMapId;
        const key = 'multiSelect';
        const commitGroupMove = () => {
            delete pendingDragSaves[key];
            beginSelfUpdate();
            const promises = [];
            if (deviceUpdates.length) {
                const operationId = window.crypto?.randomUUID?.()
                    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                rememberLocalOperation(operationId);
                promises.push(http.put('/api/devices/positions', {
                    positions: deviceUpdates,
                    operation_id: operationId,
                }));
            }
            shapeUpdates.forEach(upd => {
                promises.push(http.put(`/api/shape/${upd.id}`, { x: upd.x, y: upd.y }));
            });
            return Promise.all(promises)
                .then(() => {
                    saveStateForMap(operationMapId, 'Перемещение группы устройств');
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
        if (window.canEditMap === false || isDragLocked()) return;
        const node = evt.target;
        if (node.selected() && cy.nodes(':selected').filter(n => !n.data('isGroup')).length > 1) return;
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
        const operationMapId = window.currentMapId;
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
                saveStateForMap(operationMapId, 'Перемещение фигуры');
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
        if (window.canEditMap === false || isDragLocked()) return;
        const groupNode = evt.target;
        // A parent drag also triggers dragfree for nested compound groups.
        // Persist the moved subtree only once, from the group the user grabbed.
        if (draggedGroupId && groupNode.id() !== draggedGroupId) return;
        // Берём все устройства на любой глубине вложенности. Compound-группа
        // перемещает всё поддерево, значит позиции всех листьев нужно сохранить.
        const devices = groupNode.descendants().filter(
            child => !child.data('isGroup') && !child.data('isShape')
        );
        if (!devices.length) return;

        // Ограничение позиции группы границами фона (если есть)
        let pos = groupNode.position();
        const { width, height } = getBgDimensions();
        if (width && height) {
            const bounded = boundNodePosition(pos);
            if (bounded.x !== pos.x || bounded.y !== pos.y) groupNode.position(bounded);
            pos = groupNode.position();
        }

        // Собираем новые позиции всех дочерних устройств
        const updates = devices.map(child => ({
            id: child.id(),
            x: Math.round(child.position().x),
            y: Math.round(child.position().y)
        }));

        // Одно пакетное обновление меток, чтобы общее ребро не пересчитывалось
        // повторно для обоих перемещённых концов.
        updateEdgeLabelsForNodes(devices);
        updateEdgeCurves();

        const key = `group:${groupNode.id()}`;
        const operationMapId = window.currentMapId;
        const commitGroupNodeMove = () => {
            delete pendingDragSaves[key];
            beginSelfUpdate();
            const operationId = window.crypto?.randomUUID?.()
                || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            rememberLocalOperation(operationId);

            // Отправляем один массовый запрос вместо многих
            return http.put('/api/devices/positions', {
                positions: updates,
                operation_id: operationId,
            })
            .then(response => {
                saveStateForMap(operationMapId, 'Перемещение группы');
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
        setTimeout(() => {
            draggingGroup = false;
            draggedGroupId = null;
        }, 0);
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
        if (node.data('isGroup')) {
            // Сворачивание/разворачивание группы по двойному клику.
            // У свёрнутой группы children() пуст (потомки скрыты), поэтому
            // проверку «есть ли что сворачивать» делаем только для развёрнутой,
            // иначе пузырёк нельзя было бы развернуть обратно.
            if (!node.data('collapsed') && node.children().length === 0) return;
            if (typeof window.toggleGroupCollapse === 'function') {
                window.toggleGroupCollapse(node);
            }
            return;
        }
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

    // Подсветка связей при наведении
    cy.on('mouseover', 'node', evt => startHover(evt.target));

    // Подсветка держится, пока курсор остаётся на устройстве или на его
    // собственных рёбрах. mouseout узла НЕ гасит её: Cytoscape шлёт его и тогда,
    // когда курсор заходит на ребро/подпись поверх того же узла.
    cy.on('mousemove', evt => {
        if (!hoverState) return;
        if (evt.originalEvent && evt.originalEvent.buttons) return; // drag
        const target = evt.target;
        if (target === cy) { stopHover(); return; }
        if (target.isNode()) {
            if (target.id() === hoverState.nodeId) return;
            if (isPlainDevice(target)) startHover(target);   // переход на другое устройство
            else stopHover();                                // группа/фигура
            return;
        }
        // ребро: остаёмся, только если оно принадлежит активному устройству
        if (!hoverState.edges.some(e => e.edge === target)) stopHover();
    });

    // Курсор вернулся на фон — гарантированно очищаем
    cy.on('mouseover', evt => { if (evt.target === cy) stopHover(); });

    // Курсор покинул canvas
    if (hoverLeaveTarget) hoverLeaveTarget.removeEventListener('mouseleave', stopHover);
    hoverLeaveTarget = cy.container();
    hoverLeaveTarget.addEventListener('mouseleave', stopHover);

    // Гасим hover-подсветку во время боксового выделения
    cy.on('boxstart', () => { window._isBulkSelecting = true; stopHover(); });
    cy.on('boxend',   () => { window._isBulkSelecting = false; });
        // ==================== КОНТЕКСТНОЕ МЕНЮ ====================
    // Создание и показ меню с абсолютными координатами
    function showContextMenu(items, mouseX, mouseY) {
        closeActiveContextMenu();

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
                closeActiveContextMenu();
            };
            btn.onmouseenter = () => btn.style.backgroundColor = 'var(--accent-color)';
            btn.onmouseleave = () => btn.style.backgroundColor = 'transparent';
            menu.appendChild(btn);
            buttons.push(btn);
        });

        document.body.appendChild(menu);
        activeContextMenu = menu;

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
                closeActiveContextMenu();
            }
        };
        const closeMenu = () => {
            closeActiveContextMenu();
        };
        closeContextMenuHandler = closeHandler;
        closeContextMenuTimer = setTimeout(() => {
            closeContextMenuTimer = null;
            if (activeContextMenu !== menu || closeContextMenuHandler !== closeHandler) return;
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
            // Cytoscape supplies the model coordinate for this input event.
            // Copy it now so later camera changes cannot move the creation target.
            const graphPosition = event.position
                && Number.isFinite(event.position.x)
                && Number.isFinite(event.position.y)
                ? { x: event.position.x, y: event.position.y }
                : (() => {
                    const rendered = event.renderedPosition;
                    const pan = cy.pan();
                    const zoom = cy.zoom();
                    return rendered && zoom
                        ? { x: (rendered.x - pan.x) / zoom, y: (rendered.y - pan.y) / zoom }
                        : null;
                })();
            const items = [];
            if (copiedDeviceConfig) {
                items.push({
                    icon: 'fa-paste',
                    label: t('contextMenu.pasteDevice'),
                    action: () => {
                        // Clone the allow-listed form values so editing this
                        // insertion never mutates the reusable copy buffer.
                        const initialData = {
                            ...copiedDeviceConfig.fields,
                            ips: copiedDeviceConfig.fields.ips.slice(),
                            // A group is a map-local relationship. Do not send
                            // a source-map group ID when pasting onto another map.
                            group_id: String(copiedDeviceConfig.sourceMapId) === String(window.currentMapId)
                                ? copiedDeviceConfig.fields.group_id
                                : null
                        };
                        if (typeof window.openDeviceModal === 'function') {
                            window.openDeviceModal(null, { position: graphPosition, initialData });
                        }
                    }
                });
            }
            items.push(
                { icon: 'fa-plus-circle', label: t('contextMenu.createDevice'), action: () => window.openDeviceModal(null, { position: graphPosition }) },
                { icon: 'fa-shapes', label: t('contextMenu.createShape'), action: () => window.openShapeModal() }
            );
            showContextMenu(items, x, y);
        }
    });

    // Обработчик правого клика на узлах
    cy.on('cxttap', 'node', function(evt) {
        const node = evt.target;
        const { x, y } = getAbsoluteMousePosition(evt);

        if (node.data('isGroup')) {
            const isCollapsed = node.data('collapsed');
            const items = [
                { icon: 'fa-edit', label: t('contextMenu.editGroup'), action: () => {
                    // Раньше здесь звался editGroup(), а затем openGroupManager(),
                    // который в конце делает resetGroupForm() и затирал только что
                    // заполненную форму — модалка открывалась пустой, и режим
                    // редактирования приходилось включать кнопкой вручную.
                    // Теперь контекст редактирования передаётся В модалку и
                    // применяется уже после её открытия и загрузки списка групп.
                    if (typeof window.openGroupManager === 'function') {
                        window.openGroupManager({
                            editGroup: {
                                id: node.data('group_id'),
                                name: node.data('name'),
                                color: node.data('color'),
                                fontSize: node.data('fontSize'),
                            },
                        });
                    }
                }},
                { icon: isCollapsed ? 'fa-expand' : 'fa-compress', label: isCollapsed ? t('contextMenu.expandGroup') : t('contextMenu.collapseGroup'), action: () => {
                    if (isCollapsed) {
                        if (typeof window.expandGroup === 'function') window.expandGroup(node);
                    } else {
                        if (typeof window.collapseGroup === 'function') window.collapseGroup(node);
                    }
                }},
                { icon: 'fa-folder-plus', label: t('contextMenu.createSubgroup'), action: () => {
                    const id = node.data('group_id');
                    if (typeof window.openGroupManager === 'function') {
                        window.openGroupManager({ parentGroupId: id });
                    }
                }},
                { icon: 'fa-trash', label: t('contextMenu.deleteGroup'), action: () => {
                    if (typeof window.deleteGroup === 'function') {
                        window.deleteGroup(node.data('group_id'), node.data('name'));
                    }
                }}
            ];
            showContextMenu(items, x, y);
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
            { icon: 'fa-copy', label: t('contextMenu.copyDevice'), action: () => copyDeviceConfiguration(node) },
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
