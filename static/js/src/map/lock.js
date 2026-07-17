// lock.js – блокировка перемещения устройств (per-map, v2.0)
import { http } from '../utils/http.js';
import { showToast } from '../utils/toast.js';
import { t } from '../i18n/i18n.js';
import { registerCleanup } from './moduleRegistry.js';

let cy = null;
let currentMapId = null;

// Состояние блокировки хранится для каждой карты отдельно
const mapLockStates = new Map();

// Вешаем слушатель загрузки элементов один раз
let elementsLoadedHooked = false;

// Флаг: ждём эхо СВОЕГО же переключения лока (чтобы не показать тост самому себе).
// Идентифицируем именно эту вкладку, а не пользователя — иначе другая вкладка того
// же аккаунта не увидит тост.
let awaitingOwnLockEcho = false;

/**
 * Инициализация модуля блокировки
 */
export function initLock(instance) {
    cy = instance;
    currentMapId = window.currentMapId || null;

    console.log('initLock called, mapId:', currentMapId);

    // После (пере)загрузки элементов заново применяем passthrough к свежим
    // группам/фигурам: при открытии уже заблокированной карты они добавляются
    // в граф ПОСЛЕ applyDragLockToCanvas, поэтому иначе не получают events:'no'
    // и продолжают перехватывать клик вместо пропускания пана.
    if (!elementsLoadedHooked) {
        elementsLoadedHooked = true;
        window.addEventListener('elements:loaded', () => {
            if (isDragLocked()) applyDragLockToCanvas(true);
        });
    }

    // Инициализируем window.dragLocked для совместимости
    window.dragLocked = false;

    // Сразу устанавливаем кнопку в "разблокировано" (будет обновлено после загрузки)
    updateLockButton();

    // Загружаем состояние блокировки для текущей карты
    if (currentMapId) {
        console.log('Loading lock state for map', currentMapId);
        loadMapLockState(currentMapId);
    } else {
        console.warn('No mapId, skipping lock state load');
    }

    // Глобальная функция для переключения (вызывается из UI)
    window.toggleLock = async () => {
        if (!currentMapId) return;

        const currentState = mapLockStates.get(currentMapId) || false;
        const newState = !currentState;

        try {
            // Помечаем, что следующее событие лока — эхо моего действия (без тоста).
            // Ставим ДО запроса: эхо от сервера может прийти раньше ответа PUT.
            awaitingOwnLockEcho = true;
            setTimeout(() => { awaitingOwnLockEcho = false; }, 4000); // fallback, если эхо не пришло
            const data = await http.put(`/api/map/${currentMapId}/lock`, { locked: newState });
            // Локально применяем сразу (отзывчивость). Остальным клиентам разошлёт
            // сервер через событие map_lock_updated (см. notify_map_lock на бэке),
            // поэтому клиентский emit больше не нужен.
            mapLockStates.set(currentMapId, data.is_locked);
            window.dragLocked = data.is_locked;
            applyDragLockToCanvas(data.is_locked);
            updateLockButton();

            console.log(`Map ${currentMapId} lock: ${data.is_locked ? 'LOCKED' : 'UNLOCKED'}`);
        } catch (err) {
            console.error('Error toggling lock:', err);
            showToast(t('toast.errorTitle'), t('lock.toggleError'), 'error');
        }
    };

    // Подписка на обновления блокировки от других клиентов
    if (window.socket) {
        window.socket.off('map_lock_updated'); // Очищаем старый слушатель перед новым
        window.socket.on('map_lock_updated', (data) => {
            if (Number(data.map_id) !== Number(currentMapId)) return;

            mapLockStates.set(currentMapId, data.is_locked);
            window.dragLocked = data.is_locked;
            applyDragLockToCanvas(data.is_locked);
            updateLockButton();

            // Тост НЕ показываем только той вкладке, которая сама переключила лок
            // (у неё уже всё отражено в toggleLock). Любая другая вкладка — в т.ч.
            // того же пользователя — тост увидит.
            if (awaitingOwnLockEcho) {
                awaitingOwnLockEcho = false; // это эхо моего действия — гасим один раз
            } else {
                const who = data.username || t('common.otherUser');
                if (data.is_locked) {
                    showToast(t('lock.lockedTitle'), t('lock.lockedBy', { who }), 'info');
                } else {
                    showToast(t('lock.unlockedTitle'), t('lock.unlockedBy', { who }), 'success');
                }
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
                lockBtn.title = t('lock.btnNoRightsChange');
            }
        }

        console.log(`Map ${mapId} initial state: ${data.is_locked ? 'LOCKED' : 'UNLOCKED'}`);
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
 * Применить блокировку к полотну. При блокировке:
 *  - autoungrabify — ни один узел нельзя перетаскивать (для существующих и
 *    будущих), но устройства остаются КЛИКАБЕЛЬНЫМИ (можно открыть карточку);
 *  - events:'no' только на группах и фигурах — их фон пропускает указатель
 *    «сквозь» себя, поэтому по нему можно панорамировать карту, как по
 *    рабочему столу, а устройства поверх по-прежнему кликаются.
 */
function passthroughEls() {
    return cy ? cy.nodes().filter(n => n.data('isGroup') || n.data('isShape')) : null;
}

function applyDragLockToCanvas(isLocked) {
    // Класс на body — CSS отключает панель редактирования (.map-locked .edit-tools).
    document.body.classList.toggle('map-locked', !!isLocked);
    if (!cy) return;
    cy.autoungrabify(!!isLocked);
    const bg = passthroughEls();
    if (!bg) return;
    if (isLocked) {
        bg.style('events', 'no');
    } else {
        bg.removeStyle('events');
    }
}

/**
 * Обновить визуальное состояние кнопки блокировки
 */
function updateLockButton() {
    const lockBtn = document.getElementById('lockMode');
    if (!lockBtn) {
        console.warn('Lock button not found!');
        return;
    }

    const isLocked = mapLockStates.get(currentMapId) || false;
    const canEdit = !lockBtn.disabled;

    console.log('updateLockButton:', { isLocked, canEdit, mapId: currentMapId });

    if (isLocked) {
        lockBtn.classList.add('active');
        lockBtn.innerHTML = '<i class="fas fa-lock"></i>';
        lockBtn.title = canEdit ? t('lock.btnUnlock') : t('lock.btnLockedNoRights');
    } else {
        lockBtn.classList.remove('active');
        lockBtn.innerHTML = '<i class="fas fa-lock-open"></i>';
        lockBtn.title = canEdit ? t('lock.btnLock') : t('lock.btnNoRightsLock');
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

// Саморегистрация в общем реестре очистки (см. moduleRegistry.js)
registerCleanup(cleanup);
