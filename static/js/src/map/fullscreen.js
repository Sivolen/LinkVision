// fullscreen.js – полноэкранный режим
import { fitImageToView } from './background.js';
import { registerCleanup } from './moduleRegistry.js';

let exitButton = null;

function handleFullscreenChange() {
    if (!document.fullscreenElement) exitFullscreen();
}

export function initFullscreen() {
    cleanup();
    // Не навешиваем слушатель на fullscreenBtn, так как используется onclick в HTML
    exitButton = document.getElementById('exitFullscreenBtn');
    if (exitButton) exitButton.addEventListener('click', exitFullscreen);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
}

export function cleanup() {
    if (exitButton) {
        exitButton.removeEventListener('click', exitFullscreen);
        exitButton = null;
    }
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
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
    
    // Центрируем карту при входе в полноэкранный режим
    setTimeout(() => fitImageToView(), 100);
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

registerCleanup(cleanup);
