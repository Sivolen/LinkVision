import { t } from '../i18n/i18n.js';
// search.js – поиск по имени/IP и фильтр по статусу
let cy = null;
let currentFilter = 'all';
let searchTimeout = null;
let lastSearchCount = -1; // для предотвращения дублирования announce

export function initSearch(instance) {
    cy = instance;
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    // Создаём aria-live область для анонса результатов поиска (если ещё нет)
    let searchStatus = document.getElementById('searchStatus');
    if (!searchStatus) {
        searchStatus = document.createElement('div');
        searchStatus.id = 'searchStatus';
        searchStatus.className = 'visually-hidden';
        searchStatus.setAttribute('aria-live', 'polite');
        searchStatus.setAttribute('aria-atomic', 'true');
        document.body.appendChild(searchStatus);
    }

    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(applyFilterAndSearch, 300);
    });
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(searchTimeout);
            applyFilterAndSearch();
        }
    });
    window.filterByStatus = (status) => {
        currentFilter = status;
        applyFilterAndSearch();
    };
    window.clearSearch = () => {
        if (searchInput) searchInput.value = '';
        applyFilterAndSearch();
    };
}

function announceSearchResults(count, term) {
    const searchStatus = document.getElementById('searchStatus');
    if (!searchStatus) return;

    // Не обновляем, если результат не изменился
    if (count === lastSearchCount) return;
    lastSearchCount = count;

    if (!term || !term.trim()) {
        searchStatus.textContent = '';
        return;
    }

    if (count === 0) {
        searchStatus.textContent = t('search.notFound', { term });
    } else {
        searchStatus.textContent = t('search.foundCount', { count });
    }
}

function applyFilterAndSearch() {
    if (!cy) return;
    const searchTerm = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';

    // Сброс подсветки
    cy.nodes().removeClass('cy-node-highlight');

    // Применяем фильтр по статусу (скрываем/показываем)
    cy.nodes().forEach(node => {
        if (node.data('isGroup')) {
            node.show();
            return;
        }
        const nodeStatus = node.data('status');
        const statusOk = currentFilter === 'all' || nodeStatus === currentFilter;
        if (statusOk) {
            node.show();
        } else {
            node.hide();
        }
    });

    // Поиск: ТОЛЬКО ПОДСВЕТКА, без скрытия
    if (searchTerm) {
        const visibleNodes = cy.nodes().filter(node => !node.data('isGroup') && node.visible());
        let matchCount = 0;
        visibleNodes.forEach(node => {
            const name = (node.data('name') || '').toLowerCase();
            const ip = (node.data('ip') || '').toLowerCase();
            const type = (node.data('type') || '').toLowerCase();
            if (name.includes(searchTerm) || ip.includes(searchTerm) || type.includes(searchTerm)) {
                node.addClass('cy-node-highlight');
                matchCount++;
            }
        });
        announceSearchResults(matchCount, searchTerm);
    } else {
        lastSearchCount = -1; // сброс при очистке поиска
    }
}