/**
 * History Modal Module
 * Модуль истории изменений устройства
 */

import { formatDateTime, getStatusBadgeClass } from './utils.js';
import { t } from '../i18n/i18n.js';
import { showToast } from '../utils/toast.js';

// Переменные модуля
let currentDeviceId = null;
let currentHistoryPage = 1;
let totalHistoryPages = 1;
let historyPerPage = 10;

/**
 * Загрузить историю устройства
 */
export function loadHistory(deviceId, page = 1) {
    if (!deviceId) return;
    
    currentDeviceId = deviceId;
    currentHistoryPage = page;

    const tbody = document.getElementById('device-history-body');
    const paginationDiv = document.getElementById('history-pagination');
    const prevBtn = document.getElementById('history-prev');
    const nextBtn = document.getElementById('history-next');
    const pageInfo = document.getElementById('history-page-info');

    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">' + t('common.loading') + '</td></tr>';
    if (paginationDiv) paginationDiv.style.display = 'none';

    fetch(`/api/device/${deviceId}/history?page=${page}&per_page=${historyPerPage}`)
        .then(response => {
            if (!response.ok) throw new Error(t('modal.history.loadError'));
            return response.json();
        })
        .then(data => {
            let items = [];
            let currentPage = 1;
            let totalPages = 1;

            if (Array.isArray(data)) {
                const allItems = data;
                totalPages = Math.ceil(allItems.length / historyPerPage);
                currentPage = page;
                const start = (currentPage - 1) * historyPerPage;
                const end = start + historyPerPage;
                items = allItems.slice(start, end);
            } else if (data && Array.isArray(data.items)) {
                items = data.items;
                currentPage = data.page || 1;
                totalPages = data.pages || 1;
            }

            renderHistoryTable(items, tbody);

            if (paginationDiv) {
                if (totalPages > 1) {
                    paginationDiv.style.display = 'flex';
                    pageInfo.textContent = t('modal.history.pageInfo', { page: currentPage, total: totalPages });
                    if (prevBtn) prevBtn.disabled = currentPage <= 1;
                    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
                } else {
                    paginationDiv.style.display = 'none';
                }
            }

            currentHistoryPage = currentPage;
            totalHistoryPages = totalPages;
        })
        .catch(error => {
            Logger.error('Ошибка загрузки истории:', error);
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">' + t('common.loadError') + '</td></tr>';
            if (paginationDiv) paginationDiv.style.display = 'none';
            showToast(t('toast.errorTitle'), t('modal.history.loadFail'), 'error');
        });
}

/**
 * Отрисовать таблицу истории
 */
function renderHistoryTable(items, tbody) {
    if (!tbody) return;
    
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">' + t('modal.history.noRecords') + '</td></tr>';
        return;
    }

    let html = '';
    items.forEach(item => {
        const oldStatus = item.old_status === 'true' ? 'up' : (item.old_status === 'false' ? 'down' : item.old_status);
        const newStatus = item.new_status === 'true' ? 'up' : (item.new_status === 'false' ? 'down' : item.new_status);
        const oldBadge = getStatusBadgeClass(oldStatus);
        const newBadge = getStatusBadgeClass(newStatus);
        
        html += `<tr>
            <td>${formatDateTime(item.timestamp)}</td>
            <td><span class="badge ${oldBadge}">${oldStatus || '—'}</span></td>
            <td><span class="badge ${newBadge}">${newStatus || '—'}</span></td>
        </tr>`;
    });
    
    tbody.innerHTML = html;
}

/**
 * Переключить страницу истории
 */
export function loadHistoryPage(newPage) {
    if (newPage < 1 || newPage > totalHistoryPages) return;
    loadHistory(currentDeviceId, newPage);
}

/**
 * Инициализация модуля истории
 */
export function initHistoryModal() {
    Logger.info('History modal инициализирован');
}

// Экспорт для глобального доступа
window.loadHistoryPage = loadHistoryPage;
