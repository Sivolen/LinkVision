// sidebar.js – обновление счётчика проблемных устройств в сайдбаре
let cy = null;

export function initSidebarCounter(instance) { cy = instance; }

export function updateSidebarCounter(mapId, becameDown) {
    const mapLink = document.querySelector(`.map-item[href="/map/${mapId}"]`);
    if (!mapLink) return;
    const rightDiv = mapLink.querySelector('.map-item-right');
    if (!rightDiv) return;
    let badge = rightDiv.querySelector('.badge');
    let currentCount = badge ? parseInt(badge.textContent) : 0;
    if (becameDown) currentCount++; else currentCount--;
    _renderBadge(rightDiv, currentCount);
}

/**
 * Абсолютная установка счётчика (в отличие от updateSidebarCounter, который
 * только +1/-1 к тому, что уже нарисовано в DOM). +1/-1 накапливает
 * рассинхрон при любом пропущенном событии (обрыв сокета, вкладка в фоне
 * браузер троттлит таймеры, гонки при загрузке страницы) — единственный
 * способ гарантированно починить дрейф без перезагрузки страницы это
 * периодически пересчитать счётчик от факта. Вызывается после полной
 * загрузки/пересинхронизации карты (см. loadElements() в elements.js).
 */
export function setSidebarCounter(mapId, count) {
    const mapLink = document.querySelector(`.map-item[href="/map/${mapId}"]`);
    if (!mapLink) return;
    const rightDiv = mapLink.querySelector('.map-item-right');
    if (!rightDiv) return;
    _renderBadge(rightDiv, count);
}

function _renderBadge(rightDiv, count) {
    let badge = rightDiv.querySelector('.badge');
    if (count <= 0) {
        if (badge) badge.remove();
        return;
    }
    if (badge) {
        badge.textContent = count;
    } else {
        badge = document.createElement('span');
        badge.className = 'badge bg-danger ms-2';
        badge.textContent = count;
        const actionsDiv = rightDiv.querySelector('.map-item-actions');
        if (actionsDiv) actionsDiv.insertAdjacentElement('afterend', badge);
        else rightDiv.appendChild(badge);
    }
}
