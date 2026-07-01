// lock.js – блокировка перемещения устройств (per-map, v2.0)
import { http } from '../utils/http.js';
import { showToast } from '../utils/toast.js';

let cy = null;
let currentMapId = null;

// Состояние блокировки хранится для каждой карты отдельно
const mapLockStates = new Map();

/**
 * Инициализация модуля блокировки
 */
export function initLock(instance) {
    cy = instance;
    currentMapId = window.currentMapId || null;

    console.log('🔒 initLock called, mapId:', currentMapId);

    // Инициализируем window.dragLocked для совместимости
    window.dragLocked = false;

    // Сразу устанавливаем кнопку в "разблокировано" (будет обновлено после загрузки)
    updateLockButton();

    // Загружаем состояние блокировки для текущей карты
    if (currentMapId) {
        console.log('🔒 Loading lock state for map', currentMapId);
        loadMapLockState(currentMapId);
    } else {
        console.warn('🔒 No mapId, skipping lock state load');
    }

    // Глобальная функция для переключения (вызывается из UI)
    window.toggleLock = async () => {
        if (!currentMapId) return;

        const currentState = mapLockStates.get(currentMapId) || false;
        const newState = !currentState;

        try {
            const data = await http.put(`/api/map/${currentMapId}/lock`, { locked: newState });
            mapLockStates.set(currentMapId, data.is_locked);
            window.dragLocked = data.is_locked;
            applyDragLockToCanvas(data.is_locked);
            updateLockButton();

            // Уведомляем другие клиенты через WebSocket
            if (window.socket) {
                window.socket.emit('map_lock_updated', {
                    map_id: currentMapId,
                    is_locked: data.is_locked,
                    user_id: window.currentUserId,
                    username: window.currentUsername,
                });
            }

            console.log(`🔒 Map ${currentMapId} lock: ${data.is_locked ? 'LOCKED' : 'UNLOCKED'}`);
        } catch (err) {
            console.error('Error toggling lock:', err);
            showToast('Ошибка', 'Не удалось изменить блокировку', 'error');
        }
    };

    // Подписка на обновления блокировки от других клиентов
    if (window.socket) {
        window.socket.off('map_lock_updated'); // Очищаем старый слушатель перед новым
        window.socket.on('map_lock_updated', (data) => {
            if (Number(data.map_id) === Number(currentMapId)) {
                mapLockStates.set(currentMapId, data.is_locked);
                window.dragLocked = data.is_locked;
                applyDragLockToCanvas(data.is_locked);
                updateLockButton();

                const action = data.is_locked ? 'заблокировал' : 'разблокировал';
                console.log(`🔔 Карта ${action} пользователем ${data.username || 'Unknown'}`);
            }
        });
    }
}

/**
 * Очистка слушателей и состояния при смене карты
 */
export function cleanup() {
    if (window.socket) {
        window.socket.off('map_lock_updated');
    }
    mapLockStates.clear();
    window.dragLocked = false;
}

/**
 * Загрузить состояние блокировки карты с сервера
 */
async function loadMapLockState(mapId) {
    try {
        const data = await http.get(`/api/map/${mapId}/lock`);
        mapLockStates.set(mapId, data.is_locked);
        window.dragLocked = data.is_locked;
        applyDragLockToCanvas(data.is_locked);

        // Обновляем кнопку ПОСЛЕ загрузки состояния
        updateLockButton();

        // Обновляем UI с учётом прав
        const canEdit = data.can_edit;
        const lockBtn = document.getElementById('lockMode');
        if (lockBtn) {
            lockBtn.disabled = !canEdit;
            if (!canEdit) {
                lockBtn.title = 'Нет прав для изменения блокировки';
            }
        }

        console.log(`🔒 Map ${mapId} initial state: ${data.is_locked ? 'LOCKED' : 'UNLOCKED'}`);
    } catch (err) {
        console.error('Error loading map lock state:', err);
    }
}

/**
 * Проверить, заблокирована ли текущая карта
 */
export function isDragLocked() {
    return mapLockStates.get(currentMapId) || false;
}

/**
 * Применить блокировку к полотну: физически запрещаем/разрешаем захват узлов
 * мышью. autoungrabify действует и на существующие, и на будущие узлы, при этом
 * выделение, клики и панорама остаются доступны.
 */
function applyDragLockToCanvas(isLocked) {
    if (cy) cy.autoungrabify(!!isLocked);
}

/**
 * Обновить визуальное состояние кнопки блокировки
 */
function updateLockButton() {
    const lockBtn = document.getElementById('lockMode');
    if (!lockBtn) {
        console.warn('🔒 Lock button not found!');
        return;
    }

    const isLocked = mapLockStates.get(currentMapId) || false;
    const canEdit = !lockBtn.disabled;

    console.log('🔒 updateLockButton:', { isLocked, canEdit, mapId: currentMapId });

    if (isLocked) {
        lockBtn.classList.add('active');
        lockBtn.innerHTML = '<i class="fas fa-lock"></i>';
        lockBtn.title = canEdit ? 'Разблокировать перемещение' : 'Карта заблокирована';
    } else {
        lockBtn.classList.remove('active');
        lockBtn.innerHTML = '<i class="fas fa-lock-open"></i>';
        lockBtn.title = canEdit ? 'Заблокировать перемещение' : 'Нет прав для блокировки';
    }
}

/**
 * Обновить состояние кнопки при изменении прав
 */
export function updateLockPermissions(canEdit) {
    const lockBtn = document.getElementById('lockMode');
    if (lockBtn) {
        lockBtn.disabled = !canEdit;
        updateLockButton();
    }
}