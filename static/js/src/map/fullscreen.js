// fullscreen.js – полноэкранный режим
export function initFullscreen() {
    // Не навешиваем слушатель на fullscreenBtn, так как используется onclick в HTML
    const exitBtn = document.getElementById('exitFullscreenBtn');
    if (exitBtn) exitBtn.addEventListener('click', exitFullscreen);
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) exitFullscreen();
    });
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        enterFullscreen();
    } else {
        exitFullscreen();
    }
}

function enterFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(err => {
            console.warn(`Fullscreen error: ${err.message}`);
        });
    }
    document.getElementById('sidebar')?.classList.add('fullscreen-hidden');
    document.querySelector('.toolbar')?.classList.add('fullscreen-hidden');
    document.querySelector('.mobile-menu-toggle')?.classList.add('fullscreen-hidden');
    const exitBtn = document.getElementById('exitFullscreenBtn');
    if (exitBtn) exitBtn.style.display = 'flex';
    const fullBtn = document.getElementById('fullscreenBtn');
    if (fullBtn) fullBtn.innerHTML = '<i class="fas fa-compress"></i>';
    document.querySelector('.map-container')?.classList.add('fullscreen-map');
}

function exitFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(err => {
            console.warn(`Exit fullscreen error: ${err.message}`);
        });
    }
    document.getElementById('sidebar')?.classList.remove('fullscreen-hidden');
    document.querySelector('.toolbar')?.classList.remove('fullscreen-hidden');
    document.querySelector('.mobile-menu-toggle')?.classList.remove('fullscreen-hidden');
    const exitBtn = document.getElementById('exitFullscreenBtn');
    if (exitBtn) exitBtn.style.display = 'none';
    const fullBtn = document.getElementById('fullscreenBtn');
    if (fullBtn) fullBtn.innerHTML = '<i class="fas fa-expand"></i>';
    document.querySelector('.map-container')?.classList.remove('fullscreen-map');
}

// Глобальные функции для вызова из HTML
window.toggleFullscreen = toggleFullscreen;
window.exitFullscreen = exitFullscreen;