// search.js – поиск по имени/IP и фильтр по статусу
let cy = null;
let currentFilter = 'all';
let searchTimeout = null;

export function initSearch(instance) {
    cy = instance;
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
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
        visibleNodes.forEach(node => {
            const name = (node.data('name') || '').toLowerCase();
            const ip = (node.data('ip') || '').toLowerCase();
            const type = (node.data('type') || '').toLowerCase();
            if (name.includes(searchTerm) || ip.includes(searchTerm) || type.includes(searchTerm)) {
                node.addClass('cy-node-highlight');
            }
        });
    }
}