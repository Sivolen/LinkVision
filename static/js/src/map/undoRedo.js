// undoRedo.js – управление историей действий на карте с сохранением viewport
let history = [];
let currentIndex = -1;
let maxHistory = 50;
let isUndoRedo = false;

export function initUndoRedo(cy, getMapId) {
    // Сохраняем начальное состояние
    saveState('initial');

    async function saveState(description = '') {
        if (isUndoRedo) return;
        const mapId = getMapId();
        if (!mapId) return;

        try {
            // Получаем снапшот карты (устройства, связи, группы, фигуры)
            const res = await fetch(`/api/map/${mapId}/export`);
            if (!res.ok) throw new Error('Failed to export map');
            const snapshot = await res.json();

            // Сохраняем текущий viewport
            const viewport = {
                pan: cy.pan(),
                zoom: cy.zoom()
            };

            // Удаляем "будущие" состояния
            if (currentIndex < history.length - 1) {
                history = history.slice(0, currentIndex + 1);
            }

            history.push({ snapshot, description, viewport });
            if (history.length > maxHistory) history.shift();
            currentIndex = history.length - 1;
            updateButtons();
        } catch (err) {
            console.error('Save state error:', err);
        }
    }

    async function restoreState(index) {
        if (index < 0 || index >= history.length) return;
        const state = history[index];
        if (!state) return;

        isUndoRedo = true;
        try {
            const mapId = getMapId();
            if (!mapId) return;

            // Восстанавливаем данные карты на сервере
            const res = await fetch('/api/map/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify(state.snapshot)
            });
            if (!res.ok) throw new Error('Failed to restore state');

            // Перезагружаем элементы карты
            if (typeof window.reloadMapElements === 'function') {
                await window.reloadMapElements();
            }

            // Восстанавливаем viewport (если он сохранён)
            if (state.viewport) {
                cy.viewport({
                    pan: state.viewport.pan,
                    zoom: state.viewport.zoom
                });
                // Принудительно обновляем фон и границы
                if (typeof window.updateBackgroundTransform === 'function') {
                    window.updateBackgroundTransform();
                }
                if (typeof window.enforcePanBounds === 'function') {
                    window.enforcePanBounds();
                }
            }

            currentIndex = index;
            updateButtons();
        } catch (err) {
            console.error('Restore error:', err);
        } finally {
            isUndoRedo = false;
        }
    }

    window.undo = function() {
        if (currentIndex > 0) {
            restoreState(currentIndex - 1);
        } else {
            if (typeof showToast === 'function') showToast('Нет действий для отмены', '', 'info');
        }
    };

    window.redo = function() {
        if (currentIndex < history.length - 1) {
            restoreState(currentIndex + 1);
        } else {
            if (typeof showToast === 'function') showToast('Нет действий для повтора', '', 'info');
        }
    };

    function updateButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (undoBtn) undoBtn.disabled = (currentIndex <= 0);
        if (redoBtn) redoBtn.disabled = (currentIndex >= history.length - 1);
    }

    // Возвращаем функцию для вызова saveState из других модулей
    return { saveState };
}