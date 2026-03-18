// modal.js - функции для модальных окон (устройства, история, связи)

// Текущие данные для пагинации
let currentHistoryPage = 1;
let totalHistoryPages = 1;
let currentDeviceId = null;
let historyPerPage = 10; // можно изменить

/**
 * Загрузка истории изменений устройства
 * @param {number} deviceId - ID устройства
 * @param {number} page - номер страницы (начиная с 1)
 */
function loadHistory(deviceId, page = 1) {
    if (!deviceId) {
        console.warn('loadHistory: deviceId не указан');
        return;
    }

    currentDeviceId = deviceId;
    currentHistoryPage = page;

    const tbody = document.getElementById('device-history-body');
    const paginationDiv = document.getElementById('history-pagination');
    const prevBtn = document.getElementById('history-prev');
    const nextBtn = document.getElementById('history-next');
    const pageInfo = document.getElementById('history-page-info');

    if (!tbody) {
        console.error('Элемент device-history-body не найден');
        return;
    }

    // Показываем загрузку
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Загрузка...</td></tr>';
    if (paginationDiv) paginationDiv.style.display = 'none';

    // Формируем URL с параметрами пагинации
    const url = `/api/device/${deviceId}/history?page=${page}&per_page=${historyPerPage}`;
    console.log('Запрос истории:', url);

    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error('Ошибка загрузки истории');
            return response.json();
        })
        .then(data => {
            console.log('Ответ сервера:', data);

            let items = [];
            let currentPage = 1;
            let totalPages = 1;
            let totalItems = 0;

            if (Array.isArray(data)) {
                // Старый формат (без пагинации) – все записи
                console.warn('Сервер вернул массив (пагинация не работает на сервере). Используем клиентскую пагинацию.');
                items = data;
                totalItems = items.length;
                totalPages = Math.ceil(totalItems / historyPerPage);
                currentPage = page;

                // Обрезаем массив для текущей страницы
                const start = (currentPage - 1) * historyPerPage;
                const end = start + historyPerPage;
                items = items.slice(start, end);

                // Показываем пагинацию, если страниц больше 1
                if (paginationDiv) {
                    if (totalPages > 1) {
                        paginationDiv.style.display = 'flex';
                        pageInfo.textContent = `Страница ${currentPage} из ${totalPages}`;
                        prevBtn.disabled = currentPage <= 1;
                        nextBtn.disabled = currentPage >= totalPages;
                    } else {
                        paginationDiv.style.display = 'none';
                    }
                }
            } else if (data && Array.isArray(data.items)) {
                // Новый формат с пагинацией (ожидаемый)
                items = data.items;
                currentPage = data.page || 1;
                totalPages = data.pages || 1;
                totalItems = data.total || items.length;

                if (paginationDiv) {
                    if (totalPages > 1) {
                        paginationDiv.style.display = 'flex';
                        pageInfo.textContent = `Страница ${currentPage} из ${totalPages}`;
                        prevBtn.disabled = currentPage <= 1;
                        nextBtn.disabled = currentPage >= totalPages;
                    } else {
                        paginationDiv.style.display = 'none';
                    }
                }
            } else {
                console.error('Неожиданный формат данных:', data);
                items = [];
            }

            // Отрисовка таблицы
            renderHistoryTable(items, tbody);

            // Обновляем глобальные переменные пагинации
            currentHistoryPage = currentPage;
            totalHistoryPages = totalPages;
        })
        .catch(error => {
            console.error('Ошибка загрузки истории:', error);
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">Ошибка загрузки</td></tr>';
            if (paginationDiv) paginationDiv.style.display = 'none';
        });
}

/**
 * Отрисовка таблицы истории
 * @param {Array} items - массив записей истории
 * @param {HTMLElement} tbody - элемент tbody
 */
function renderHistoryTable(items, tbody) {
    if (!tbody) return;

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Нет записей истории</td></tr>';
        return;
    }

    let html = '';
    items.forEach(item => {
        // Преобразуем статусы из 'true'/'false' в понятные значения
        const oldStatus = item.old_status === 'true' ? 'up' : (item.old_status === 'false' ? 'down' : item.old_status);
        const newStatus = item.new_status === 'true' ? 'up' : (item.new_status === 'false' ? 'down' : item.new_status);

        const oldBadgeClass = getStatusBadgeClass(oldStatus);
        const newBadgeClass = getStatusBadgeClass(newStatus);

        html += `
            <tr>
                <td>${formatDateTime(item.timestamp)}</td>
                <td><span class="badge ${oldBadgeClass}">${oldStatus || '—'}</span></td>
                <td><span class="badge ${newBadgeClass}">${newStatus || '—'}</span></td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

/**
 * Переключение страницы истории
 * @param {number} newPage - номер страницы
 */
function loadHistoryPage(newPage) {
    if (newPage < 1 || newPage > totalHistoryPages) return;
    loadHistory(currentDeviceId, newPage);
}

/**
 * Форматирование даты и времени
 * @param {string} timestamp - ISO строка или что-то подобное
 * @returns {string}
 */
function formatDateTime(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp; // если не удалось распарсить
    return date.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

/**
 * Определение класса бейджа по статусу
 * @param {string} status
 * @returns {string}
 */
function getStatusBadgeClass(status) {
    const s = String(status).toLowerCase();
    if (s === 'up' || s === 'true' || s === 'online') return 'bg-success';
    if (s === 'down' || s === 'false' || s === 'offline') return 'bg-danger';
    if (s === 'warning') return 'bg-warning';
    return 'bg-secondary';
}

// Инициализация обработчиков событий после загрузки DOM
document.addEventListener('DOMContentLoaded', function() {
    // Обработчик переключения на вкладку "История"
    const historyTab = document.querySelector('a[href="#device-history"]');
    if (historyTab) {
        historyTab.addEventListener('shown.bs.tab', function() {
            const deviceId = document.getElementById('dev_id').value;
            if (deviceId) {
                loadHistory(deviceId, 1);
            } else {
                console.warn('deviceId не найден при переключении на вкладку истории');
            }
        });
    }

    // Обработчики кнопок пагинации
    const prevBtn = document.getElementById('history-prev');
    const nextBtn = document.getElementById('history-next');

    if (prevBtn) {
        prevBtn.addEventListener('click', function(e) {
            e.preventDefault();
            loadHistoryPage(currentHistoryPage - 1);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', function(e) {
            e.preventDefault();
            loadHistoryPage(currentHistoryPage + 1);
        });
    }
});