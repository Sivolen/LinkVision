// undoRedo.js – управление историей действий на карте
let history = [];
let currentIndex = -1;
let maxHistory = 50;
let isUndoRedo = false;  // флаг, чтобы не записывать в историю при восстановлении

export function initUndoRedo(cy, getMapId) {
    // Сохраняем начальное состояние
    saveState('initial');

    // Функция сохранения текущего состояния
    async function saveState(description = '') {
        if (isUndoRedo) return;
        const mapId = getMapId();
        if (!mapId) return;

        try {
            const res = await fetch(`/api/map/${mapId}/export`);
            if (!res.ok) throw new Error('Failed to export map');
            const snapshot = await res.json();

            // Удаляем "будущие" состояния, если мы не в конце стека
            if (currentIndex < history.length - 1) {
                history = history.slice(0, currentIndex + 1);
            }

            history.push({ snapshot, description });
            if (history.length > maxHistory) history.shift();
            currentIndex = history.length - 1;
            updateButtons();
        } catch (err) {
            console.error('Save state error:', err);
        }
    }

    // Восстановление состояния по индексу
    async function restoreState(index) {
        if (index < 0 || index >= history.length) return;
        const state = history[index];
        if (!state) return;

        isUndoRedo = true;
        try {
            const mapId = getMapId();
            if (!mapId) return;

            // Отправляем импорт сохранённого состояния на сервер
            const res = await fetch('/api/map/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify(state.snapshot)
            });
            if (!res.ok) throw new Error('Failed to restore state');

            // Перезагружаем карту
            if (typeof window.reloadMapElements === 'function') {
                await window.reloadMapElements();
            }
            currentIndex = index;
            updateButtons();
        } catch (err) {
            console.error('Restore error:', err);
        } finally {
            isUndoRedo = false;
        }
    }

    // Отмена (Undo)
    window.undo = function() {
        if (currentIndex > 0) {
            restoreState(currentIndex - 1);
        } else {
            if (typeof showToast === 'function') showToast('Нет действий для отмены', '', 'info');
        }
    };

    // Повтор (Redo)
    window.redo = function() {
        if (currentIndex < history.length - 1) {
            restoreState(currentIndex + 1);
        } else {
            if (typeof showToast === 'function') showToast('Нет действий для повтора', '', 'info');
        }
    };

    // Обновление состояния кнопок (можно добавить визуальные подсказки)
    function updateButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (undoBtn) undoBtn.disabled = (currentIndex <= 0);
        if (redoBtn) redoBtn.disabled = (currentIndex >= history.length - 1);
    }

    // Возвращаем функцию для вызова saveState из других модулей
    return { saveState };
}