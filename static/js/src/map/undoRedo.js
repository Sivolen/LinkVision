// undoRedo.js – управление историей позиций всех узлов (устройства, фигуры, группы)
import { http } from '../utils/http.js';
import { showToast } from '../utils/toast.js';
import { beginSelfUpdate, endSelfUpdate } from '../utils/state.js';
import { isShapeId, parseRawId } from './ids.js';

let history = [];
let currentIndex = -1;
let maxHistory = 50;
let isUndoRedo = false;

export function initUndoRedo(cy, getMapId) {
    function saveState(description = '') {
        if (isUndoRedo) return;

        // Сохраняем только устройства и фигуры (исключая группы)
        const allNodes = cy.nodes().filter(n => !n.data('isGroup'));
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
            cy.resize();
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

    window.undo = () => {
        if (currentIndex > 0) restoreState(currentIndex - 1);
        else if (typeof showToast === 'function') showToast('Нет действий для отмены', '', 'info');
    };

    window.redo = () => {
        if (currentIndex < history.length - 1) restoreState(currentIndex + 1);
        else if (typeof showToast === 'function') showToast('Нет действий для повтора', '', 'info');
    };

    // Не сохраняем начальное состояние здесь – оно будет сохранено после загрузки карты
    return { saveState };
}