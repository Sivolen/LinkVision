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
    if (currentCount <= 0) {
        if (badge) badge.remove();
    } else {
        if (badge) badge.textContent = currentCount;
        else {
            badge = document.createElement('span');
            badge.className = 'badge bg-danger ms-2';
            badge.textContent = currentCount;
            const actionsDiv = rightDiv.querySelector('.map-item-actions');
            if (actionsDiv) actionsDiv.insertAdjacentElement('afterend', badge);
            else rightDiv.appendChild(badge);
        }
    }
}