/**
 * Modal Manager - основная точка входа
 * Управление модальными окнами приложения
 */

// Импорт модулей
import { initDeviceModal, openDeviceModal, saveDevice, deleteDevice } from './device.js';
import { initGroupModal, openGroupManager, editGroup, deleteGroup } from './group.js';
import { initShapeModal, openShapeModal, saveShape, deleteShape } from './shape.js';
import { initHistoryModal, loadHistory, loadHistoryPage } from './history.js';
import { initIpManagement, addIpRow, getIpsFromForm, setIpsInForm } from './ipManager.js';
import { initToast, showToast } from './ui.js';
import { initUtils, escapeHtml, getErrorMessage, formatDateTime, getStatusBadgeClass } from './utils.js';
import { initMapIntegration, withViewportRestore, reloadMapWithViewportRestore } from './mapIntegration.js';
import { initLinkModal, openLinkModal, openLinkModalForEdit, confirmCreateLink, deleteLink } from './link.js';

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

// Глобальные переменные
let deviceModal = null;
let groupModal = null;
let shapeModal = null;
let currentHistoryPage = 1;
let totalHistoryPages = 1;
let currentDeviceId = null;
let historyPerPage = 10;
let currentGroupId = null;
let currentShapeId = null;
let _formHandlerAttached = false;
let savedViewport = null;

/**
 * Инициализация всех модальных окон
 */
export function initModals() {
    try {
        // Инициализация утилит
        initUtils();
        
        // Инициализация интеграции с картой
        initMapIntegration();

        // Инициализация IP менеджмента
        initIpManagement();
        
        // Инициализация модальных окон
        initDeviceModal();
        initGroupModal();
        initShapeModal();
        initHistoryModal();
        initLinkModal();

        // Инициализация UI компонентов
        initToast();
        
        Logger.info('✅ Modal manager инициализирован');
    } catch (error) {
        Logger.error('❌ Ошибка инициализации modal manager:', error);
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
});

// Экспорты для глобального доступа
window.openLinkModal = openLinkModal;
window.openLinkModalForEdit = openLinkModalForEdit;
window.confirmCreateLink = confirmCreateLink;
window.deleteLink = deleteLink;

