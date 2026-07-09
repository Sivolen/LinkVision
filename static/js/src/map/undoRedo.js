// undoRedo.js – управление историей позиций всех узлов (устройства, фигуры, группы)
import { http } from '../utils/http.js';
import { showToast } from '../utils/toast.js';
import { beginSelfUpdate, endSelfUpdate } from '../utils/state.js';
import { isShapeId, parseRawId } from './ids.js';
import { flushPendingDragSaves } from './interactions.js';
import { updateAllGroups } from './groupResize.js';
import { updateAllEdgeLabels } from './edgeLabels.js';

let history = [];
let currentIndex = -1;
let maxHistory = 50;
let isUndoRedo = false;

export function initUndoRedo(cy, getMapId) {
    function saveState(description = '') {
        if (isUndoRedo) return;

        // Сохраняем все узлы — устройства, фигуры И группы.
        // Группы критичны: при перетаскивании группы Cytoscape меняет позицию
        // только родительского узла, дети сохраняют модельные координаты.
        // Без сохранения позиции группы undo/redo не может откатить перемещение.
        const allNodes = cy.nodes();
        const positions = {};
        allNodes.forEach(node => {
            const pos = node.position();
            positions[node.id()] = { x: pos.x, y: pos.y };
        });
        const viewport = { pan: cy.pan(), zoom: cy.zoom() };

        if (currentIndex < history.length - 1) {
            history = history.slice(0, currentIndex + 1);
        }

        history.push({ positions, viewport, description });
        if (history.length > maxHistory) history.shift();
        currentIndex = history.length - 1;

        updateButtons();
    }

    function restoreState(index) {
        if (index < 0 || index >= history.length) return;
        const state = history[index];
        if (!state) return;

        isUndoRedo = true;
        try {
            cy.batch(() => {
                for (const [id, pos] of Object.entries(state.positions)) {
                    const node = cy.getElementById(id);
                    if (node.length) {
                        node.position(pos);
                    }
                }
            });
            cy.style().update();

            // Критично для compound-узлов (групп): после восстановления позиций
            // детей нужно заставить Cytoscape пересчитать размеры/позицию родителя.
            // Без этого группа визуально остаётся на новом месте.
            updateAllGroups();
            updateAllEdgeLabels();

            syncPositionsToServer(cy);

            currentIndex = index;
            updateButtons();
        } catch (err) {
            console.error('Restore error:', err);
        } finally {
            isUndoRedo = false;
        }
    }
    // Синхронизация позиций устройств и фигур с сервером
    function syncPositionsToServer(cy) {
        const nodes = cy.nodes().filter(n => !n.data('isGroup'));
        const updates = nodes.map(node => {
            const pos = node.position();
            return { id: node.id(), x: Math.round(pos.x), y: Math.round(pos.y) };
        }).filter(u => u.id && !isNaN(u.x) && !isNaN(u.y));
        if (updates.length === 0) return;

        // Разделяем на устройства и фигуры
        const deviceUpdates = updates.filter(u => !isShapeId(u.id));
        const shapeUpdates = updates.filter(u => isShapeId(u.id));

        beginSelfUpdate();
        const promises = [];

        // Все устройства — одним bulk-запросом
        if (deviceUpdates.length) {
            promises.push(
                http.put('/api/devices/positions', deviceUpdates.map((u) => ({ id: u.id, x: u.x, y: u.y })))
            );
        }

        // Фигуры (нет bulk-эндпоинта) — по одной
        for (const upd of shapeUpdates) {
            const shapeId = parseRawId(upd.id);
            promises.push(
                http.put(`/api/shape/${shapeId}`, { x: upd.x, y: upd.y })
            );
        }

        Promise.allSettled(promises).finally(() => {
            endSelfUpdate();
        });
    }
    function updateButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (undoBtn) undoBtn.disabled = (currentIndex <= 0);
        if (redoBtn) redoBtn.disabled = (currentIndex >= history.length - 1);
    }

    window.undo = async () => {
        // Если только что был drag (устройства/фигуры/группы) — его сохранение
        // ещё может ждать в 500мс debounce. Если пользователь жмёт "Отменить"
        // раньше, чем оно долетит до saveState(), это отложенное сохранение
        // прилетит ПОЗЖЕ восстановления и перезапишет историю поверх того,
        // что пользователь только что отменил — с эффектом "работает через раз".
        // Поэтому сначала принудительно завершаем все такие сохранения.
        try {
            await flushPendingDragSaves();
        } catch (e) {
            console.error('flushPendingDragSaves error:', e);
        }

        if (currentIndex > 0) restoreState(currentIndex - 1);
        else if (typeof showToast === 'function') showToast('Нет действий для отмены', '', 'info');
    };

    window.redo = async () => {
        try {
            await flushPendingDragSaves();
        } catch (e) {
            console.error('flushPendingDragSaves error:', e);
        }

        if (currentIndex < history.length - 1) restoreState(currentIndex + 1);
        else if (typeof showToast === 'function') showToast('Нет действий для повтора', '', 'info');
    };

    // Не сохраняем начальное состояние здесь – оно будет сохранено после загрузки карты
    return { saveState };
}