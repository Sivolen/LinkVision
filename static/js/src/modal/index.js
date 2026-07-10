/**
 * Modal Manager - основная точка входа
 * Управление модальными окнами приложения
 */

// Импорт модулей
import { initDeviceModal, openDeviceModal, saveDevice, deleteDevice } from './device.js';
import { t } from '../i18n/i18n.js';
import { initGroupModal, openGroupManager, editGroup, deleteGroup } from './group.js';
import { initShapeModal, openShapeModal, saveShape, deleteShape } from './shape.js';
import { initHistoryModal, loadHistory, loadHistoryPage } from './history.js';
import { initIpManagement, addIpRow, getIpsFromForm, setIpsInForm } from './ipManager.js';
import { showToast, initToast } from '../utils/toast.js';
import { initUtils, escapeHtml, getErrorMessage, formatDateTime, getStatusBadgeClass } from './utils.js';
import { initMapIntegration, withViewportRestore, reloadMapWithViewportRestore } from './mapIntegration.js';
import { initLinkModal, openLinkModal, openLinkModalForEdit, confirmCreateLink, deleteLink } from './link.js';
import { openPermissionsModal, addPermission, addRolePermission } from './permissions.js';
import { http } from '../utils/http.js';

// Экспорт для глобального доступа
window.openDeviceModal = openDeviceModal;
window.saveDevice = saveDevice;
window.deleteDevice = deleteDevice;
window.openGroupManager = openGroupManager;
window.editGroup = editGroup;
window.deleteGroup = deleteGroup;
window.openShapeModal = openShapeModal;
window.saveShape = saveShape;
window.deleteShape = deleteShape;
window.loadHistoryPage = loadHistoryPage;

// Глобальные переменные (используем window для доступа из других модулей)
let deviceModal = null;
window.groupModal = null;
let shapeModal = null;
let currentHistoryPage = 1;
let totalHistoryPages = 1;
let currentDeviceId = null;
let historyPerPage = 10;
let currentGroupId = null;
let currentShapeId = null;
let _formHandlerAttached = false;
let savedViewport = null;

// ==================== ЭКСПОРТ КАРТЫ ====================
export function exportMap() {
    const mapId = document.getElementById('edit_map_id').value;
    if (!mapId) {
        showToast(t('toast.errorTitle'), t('modal.export.noMap'), 'error');
        return;
    }
    http.get(`/api/map/${mapId}/export`)
    .then(async data => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const fileName = `map_${mapId}_export.json`;
        let saved = false;

        // Пробуем современный File System Access API (требует HTTPS)
        if (window.showSaveFilePicker && location.protocol === 'https:') {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: fileName,
                    types: [{
                        description: 'JSON File',
                        accept: { 'application/json': ['.json'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                saved = true;
                showToast(t('toast.successTitle'), t('modal.export.exported'), 'success');
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Error saving file:', err);
                    showToast(t('toast.errorTitle'), t('modal.export.saveFileFail'), 'error');
                }
            }
        }

        // Fallback для HTTP или браузеров без showSaveFilePicker
        if (!saved) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            // Задержка чтобы тост появился после закрытия диалога сохранения
            setTimeout(() => {
                showToast(t('toast.successTitle'), t('modal.export.exported'), 'success');
            }, 2000);
        }
    })
    .catch(err => {
        console.error('Error exporting map:', err);
        showToast(t('toast.errorTitle'), err.message || t('modal.export.exportFail'), 'error');
    });
}

// Экспорт для глобального доступа
window.exportMap = exportMap;

/**
 * Инициализация всех модальных окон
 */
export function initModals() {
    try {
        Logger.info('initModals called');

        // Инициализация утилит
        initUtils();
        
        // Инициализация интеграции с картой
        initMapIntegration();

        // Инициализация IP менеджмента
        initIpManagement();
        
        // Инициализация модальных окон
        Logger.info('Initializing device modal...');
        initDeviceModal();

        Logger.info('Initializing group modal...');
        initGroupModal();

        Logger.info('Initializing shape modal...');
        initShapeModal();

        Logger.info('Initializing history modal...');
        initHistoryModal();

        Logger.info('Initializing link modal...');
        initLinkModal();

        // Инициализация UI компонентов
        initToast();
        
        Logger.info('Modal manager инициализирован');
    } catch (error) {
        Logger.error('Ошибка инициализации modal manager:', error);
    }
}

// Обработчики для кнопок пагинации истории
document.addEventListener('DOMContentLoaded', function() {
    const historyTab = document.querySelector('a[href="#device-history"]');
    if (historyTab) {
        historyTab.addEventListener('shown.bs.tab', function() {
            const deviceId = document.getElementById('dev_id')?.value;
            if (deviceId && typeof loadHistory === 'function') {
                loadHistory(deviceId, 1);
            }
        });
    }

    const prevBtn = document.getElementById('history-prev');
    const nextBtn = document.getElementById('history-next');
    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.loadHistoryPage(currentHistoryPage - 1);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.loadHistoryPage(currentHistoryPage + 1);
        });
    }

    // Кнопка добавления IP
    document.getElementById('add-ip-btn')?.addEventListener('click', () => {
        addIpRow('');
    });

    // Инициализация всех модальных окон при загрузке страницы
    Logger.info('DOMContentLoaded - initializing modals');
    initModals();
});

// Экспорты для глобального доступа
window.openLinkModal = openLinkModal;
window.openLinkModalForEdit = openLinkModalForEdit;
window.confirmCreateLink = confirmCreateLink;
window.deleteLink = deleteLink;
window.openPermissionsModal = openPermissionsModal;

