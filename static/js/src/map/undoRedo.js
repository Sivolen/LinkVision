// undoRedo.js – управление историей позиций всех узлов (устройства, фигуры, группы)
let history = [];
let currentIndex = -1;
let maxHistory = 50;
let isUndoRedo = false;
let saveStateTimeout = null;

export function initUndoRedo(cy, getMapId) {
    function _doSaveState(description = '') {
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

    function saveState(description = '') {
        if (isUndoRedo) return;
        // Debounce для частых вызовов
        clearTimeout(saveStateTimeout);
        saveStateTimeout = setTimeout(() => {
            _doSaveState(description);
        }, 300);
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
        const deviceUpdates = updates.filter(u => !u.id.startsWith('shape_'));
        const shapeUpdates = updates.filter(u => u.id.startsWith('shape_'));

        window.setSkipNextMapUpdate();

        const promises = [];

        // ОДИН массовый запрос для устройств вместо N отдельных
        if (deviceUpdates.length > 0) {
            promises.push(
                fetch('/api/devices/positions', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify(deviceUpdates)
                })
            );
        }

        // Фигуры всё ещё по одной, но их обычно мало
        for (const upd of shapeUpdates) {
            const shapeId = upd.id.replace('shape_', '');
            promises.push(fetch(`/api/shape/${shapeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ x: upd.x, y: upd.y })
            }));
        }

        Promise.all(promises)
            .catch(err => console.error('Sync positions error:', err))
            .finally(() => {
                setTimeout(() => window.clearSkipNextMapUpdate(), 500);
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