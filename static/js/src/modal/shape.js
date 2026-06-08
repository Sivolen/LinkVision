/**
 * Shape Management Module
 * Управление фигурами на карте
 */

import { showToast } from './ui.js';
import { getErrorMessage } from './utils.js';
import { reloadMapWithViewportRestore } from './mapIntegration.js';

// Переменные модуля
let shapeModal = null;
let currentShapeId = null;

/**
 * Открыть модальное окно фигуры
 */
export function openShapeModal(shapeNode = null) {
    if (!shapeModal) {
        const el = document.getElementById('shapeModal');
        if (el) shapeModal = new bootstrap.Modal(el);
        else return;
    }

    const idField = document.getElementById('shape_id');
    const typeSelect = document.getElementById('shape_type');
    const widthInput = document.getElementById('shape_width');
    const heightInput = document.getElementById('shape_height');
    const colorInput = document.getElementById('shape_color');
    const opacityInput = document.getElementById('shape_opacity');
    const descriptionInput = document.getElementById('shape_description');
    const deleteBtn = document.getElementById('deleteShapeBtn');
    const fontSizeInput = document.getElementById('shape_font_size');

    if (shapeNode) {
        currentShapeId = shapeNode.id().replace('shape_', '');
        typeSelect.value = shapeNode.data('shape_type');
        widthInput.value = shapeNode.data('width');
        heightInput.value = shapeNode.data('height');
        colorInput.value = shapeNode.data('color');
        opacityInput.value = shapeNode.data('opacity');
        descriptionInput.value = shapeNode.data('description') || '';
        deleteBtn.style.display = 'inline-block';
        deleteBtn.onclick = () => deleteShape(currentShapeId);
        fontSizeInput.value = shapeNode.data('fontSize') || 12;
    } else {
        currentShapeId = null;
        typeSelect.value = 'square';
        widthInput.value = 80;
        heightInput.value = 80;
        colorInput.value = '#3498db';
        opacityInput.value = 1;
        descriptionInput.value = '';
        deleteBtn.style.display = 'none';
        fontSizeInput.value = 12;
    }

    const opacitySpan = document.getElementById('opacity_value');
    if (opacitySpan) {
        const percent = Math.round(opacityInput.value * 100);
        opacitySpan.textContent = `${percent}%`;
    }

    shapeModal.show();
}

/**
 * Сохранить фигуру
 */
export async function saveShape() {
    const id = document.getElementById('shape_id').value;
    const shapeType = document.getElementById('shape_type').value;
    const width = parseFloat(document.getElementById('shape_width').value);
    const height = parseFloat(document.getElementById('shape_height').value);
    const color = document.getElementById('shape_color').value;
    const opacity = parseFloat(document.getElementById('shape_opacity').value);
    const description = document.getElementById('shape_description').value.trim();
    const fontSize = parseInt(document.getElementById('shape_font_size').value, 10) || 12;

    if (!shapeType || !width || !height) {
        showToast('Ошибка', 'Тип, ширина и высота обязательны', 'error');
        return;
    }

    const data = {
        map_id: window.currentMapId,
        shape_type: shapeType,
        x: 100,
        y: 100,
        width: width,
        height: height,
        color: color,
        opacity: opacity,
        description: description,
        font_size: fontSize
    };

    const url = id ? `/api/shape/${id}` : '/api/shape';
    const method = id ? 'PUT' : 'POST';

    const saveBtn = document.getElementById('saveShapeBtn');
    const btnText = saveBtn?.querySelector('.btn-text');
    const btnLoader = saveBtn?.querySelector('.btn-loader');
    if (btnText) btnText.classList.add('d-none');
    if (btnLoader) btnLoader.classList.remove('d-none');
    if (saveBtn) saveBtn.disabled = true;

    try {
        window.setSkipNextMapUpdate();
        
        const res = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify(data)
        });

        if (!res.ok) throw new Error(await getErrorMessage(res));
        
        showToast(id ? 'Фигура обновлена' : 'Фигура создана', '', 'success');
        shapeModal.hide();
        
        await reloadMapWithViewportRestore();
    } catch (err) {
        Logger.error('Ошибка сохранения фигуры:', err);
        showToast('Ошибка', err.message || 'Не удалось сохранить фигуру', 'error');
    } finally {
        if (btnText) btnText.classList.remove('d-none');
        if (btnLoader) btnLoader.classList.add('d-none');
        if (saveBtn) saveBtn.disabled = false;
        setTimeout(() => window.clearSkipNextMapUpdate(), 500);
    }
}

/**
 * Удалить фигуру
 */
export async function deleteShape(shapeId) {
    window.confirmAction('Удаление фигуры', 'Вы уверены?', async () => {
        try {
            const res = await fetch(`/api/shape/${shapeId}`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });

            if (!res.ok) {
                const errorMsg = await getErrorMessage(res);
                throw new Error(errorMsg);
            }

            showToast('Успешно', 'Фигура удалена', 'success');
            shapeModal.hide();
            
            await reloadMapWithViewportRestore();
        } catch (err) {
            Logger.error('Ошибка удаления фигуры:', err);
            showToast('Ошибка', err.message || 'Не удалось удалить фигуру', 'error');
        }
    });
}

/**
 * Инициализация модального окна фигур
 */
export function initShapeModal() {
    // Обновление значения opacity
    const opacityInput = document.getElementById('shape_opacity');
    const opacitySpan = document.getElementById('opacity_value');
    
    opacityInput?.addEventListener('input', function() {
        if (opacitySpan) {
            const percent = Math.round(this.value * 100);
            opacitySpan.textContent = `${percent}%`;
        }
    });

    Logger.info('✅ Shape modal инициализирован');
}

// Экспорт для глобального доступа
window.openShapeModal = openShapeModal;
window.saveShape = saveShape;
window.deleteShape = deleteShape;
