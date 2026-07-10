/**
 * Shape Management Module
 * Управление фигурами на карте
 */

import { showToast } from '../utils/toast.js';
import { t } from '../i18n/i18n.js';
import { reloadMapWithViewportRestore } from './mapIntegration.js';
import { http } from '../utils/http.js';
import { beginSelfUpdate, endSelfUpdate } from '../utils/state.js';
import { parseRawId } from '../map/ids.js';

// Переменные модуля
let shapeModal = null;
let currentShapeId = null;
let shapeEditX = null;
let shapeEditY = null;

/**
 * Открыть модальное окна фигуры
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
        currentShapeId = parseRawId(shapeNode.id());
        idField.value = currentShapeId; // Устанавливаем ID в скрытое поле!

        // Сохраняем текущую позицию фигуры из графа
        updateShapePositionFromNode(shapeNode);

        typeSelect.value = shapeNode.data('shape_type');
        widthInput.value = shapeNode.data('width');
        heightInput.value = shapeNode.data('height');
        colorInput.value = shapeNode.data('color');
        opacityInput.value = shapeNode.data('opacity');
        descriptionInput.value = shapeNode.data('description') || '';
        deleteBtn.style.display = 'inline-block';
        deleteBtn.onclick = () => deleteShape(currentShapeId);
        fontSizeInput.value = shapeNode.data('fontSize') || 12;

        // Обновляем превью цвета
        const colorPreview = document.getElementById('shapeColorPreview');
        const colorCode = document.getElementById('shapeColorCode');
        if (colorPreview && colorCode) {
            colorPreview.style.backgroundColor = shapeNode.data('color');
            colorCode.textContent = (shapeNode.data('color') || '#3498db').toUpperCase();
        }

        // Добавляем слушатель для обновления позиции при перетаскивании
        if (window.cy) {
            const shapeNodeEl = window.cy.getElementById(`shape_${currentShapeId}`);
            if (shapeNodeEl.length) {
                shapeNodeEl.on('dragfree', function() {
                    updateShapePositionFromNode(shapeNodeEl);
                });
            }
        }
    } else {
        currentShapeId = null;
        idField.value = '';
        shapeEditX = null;
        shapeEditY = null;
        typeSelect.value = 'square';
        widthInput.value = 80;
        heightInput.value = 80;
        colorInput.value = '#3498db';
        opacityInput.value = 1;
        descriptionInput.value = '';
        deleteBtn.style.display = 'none';
        fontSizeInput.value = 12;

        // Сброс превью цвета для новой фигуры
        const colorPreview = document.getElementById('shapeColorPreview');
        const colorCode = document.getElementById('shapeColorCode');
        if (colorPreview && colorCode) {
            colorPreview.style.backgroundColor = '#3498db';
            colorCode.textContent = '#3498DB';
        }
    }

    const opacitySpan = document.getElementById('opacity_value');
    if (opacitySpan) {
        const percent = Math.round(opacityInput.value * 100);
        opacitySpan.textContent = `${percent}%`;
    }

    shapeModal.show();
}

/**
 * Обновить координаты фигуры из узла графа
 */
function updateShapePositionFromNode(shapeNode) {
    const pos = shapeNode.position();
    shapeEditX = pos.x;
    shapeEditY = pos.y;
}

/**
 * Сохранить фигуру
 */
export async function saveShape() {
    Logger.info('saveShape called');

    const id = document.getElementById('shape_id').value;
    const shapeType = document.getElementById('shape_type').value;
    const width = parseFloat(document.getElementById('shape_width').value);
    const height = parseFloat(document.getElementById('shape_height').value);
    const color = document.getElementById('shape_color').value;
    const opacity = parseFloat(document.getElementById('shape_opacity').value);
    const description = document.getElementById('shape_description').value.trim();
    const fontSize = parseInt(document.getElementById('shape_font_size').value, 10) || 12;

    Logger.info('Form data:', { id, shapeType, width, height, color, opacity, description, fontSize });

    if (!shapeType || !width || !height) {
        showToast(t('toast.errorTitle'), t('modal.shape.required'), 'error');
        return;
    }

    const data = {
        map_id: window.currentMapId,
        shape_type: shapeType,
        x: id && shapeEditX !== null ? shapeEditX : 100,
        y: id && shapeEditY !== null ? shapeEditY : 100,
        width: width,
        height: height,
        color: color,
        opacity: opacity,
        description: description,
        font_size: fontSize
    };

    Logger.info('Sending data:', data);

    const url = id ? `/api/shape/${id}` : '/api/shape';
    const method = id ? 'PUT' : 'POST';

    Logger.info('Request:', { method, url });

    const saveBtn = document.getElementById('saveShapeBtn');
    const btnText = saveBtn?.querySelector('.btn-text');
    const btnLoader = saveBtn?.querySelector('.btn-loader');
    if (btnText) btnText.classList.add('d-none');
    if (btnLoader) btnLoader.classList.remove('d-none');
    if (saveBtn) saveBtn.disabled = true;

    beginSelfUpdate();

    try {
        const result = await (method === 'POST' ? http.post : http.put)(url, data);
        Logger.info('Shape saved successfully');
        Logger.info('Shape ID:', id);

        if (!id) {
            // Для новой фигуры добавляем её в граф сразу
            const newShape = {
                id: result.id,
                shape_type: data.shape_type,
                x: data.x,
                y: data.y,
                width: data.width,
                height: data.height,
                color: data.color,
                opacity: data.opacity,
                description: data.description,
                font_size: data.font_size
            };
            if (typeof window.addShapeToGraph === 'function') {
                await window.addShapeToGraph(newShape);
            }
            Logger.info('Showing toast: Фигура создана');
            showToast(t('toast.successTitle'), t('modal.shape.created'), 'success');
        } else {
            // Для обновления - удаляем старую фигуру и добавляем новую
            Logger.info('Showing toast: Фигура обновлена');
            if (typeof window.removeShapeFromGraph === 'function') {
                window.removeShapeFromGraph(id);
            }

            const updatedShape = {
                id: result.id,
                shape_type: data.shape_type,
                x: data.x,
                y: data.y,
                width: data.width,
                height: data.height,
                color: data.color,
                opacity: data.opacity,
                description: data.description,
                font_size: data.font_size
            };
            if (typeof window.addShapeToGraph === 'function') {
                await window.addShapeToGraph(updatedShape);
            }
            showToast(t('toast.successTitle'), t('modal.shape.updated'), 'success');
        }

        shapeModal.hide();
    } catch (err) {
        Logger.error('Ошибка сохранения фигуры:', err);
        showToast(t('toast.errorTitle'), err.message || t('modal.shape.saveFail'), 'error');
    } finally {
        if (btnText) btnText.classList.remove('d-none');
        if (btnLoader) btnLoader.classList.add('d-none');
        if (saveBtn) saveBtn.disabled = false;
        endSelfUpdate();
    }
}

/**
 * Удалить фигуру
 */
export async function deleteShape(shapeId) {
    window.confirmAction(t('modal.shape.deleteTitle'), t('common.areYouSure'), async () => {
        beginSelfUpdate();

        try {
            await http.del(`/api/shape/${shapeId}`);

            // Удаляем фигуру из графа сразу
            if (typeof window.removeShapeFromGraph === 'function') {
                window.removeShapeFromGraph(shapeId);
            }

            showToast(t('toast.successTitle'), t('modal.shape.deleted'), 'success');

            shapeModal.hide();
            
            await reloadMapWithViewportRestore();
        } catch (err) {
            Logger.error('Ошибка удаления фигуры:', err);
            showToast(t('toast.errorTitle'), err.message || t('modal.shape.deleteFail'), 'error');
        } finally {
            endSelfUpdate();
        }
    });
}

/**
 * Инициализация модального окна фигур
 */
export function initShapeModal() {
    // Обновление значения прозрачности
    const opacityInput = document.getElementById('shape_opacity');
    const opacitySpan = document.getElementById('opacity_value');
    
    if (opacityInput && opacitySpan) {
        // Установить начальное значение
        const initialPercent = Math.round(parseFloat(opacityInput.value) * 100);
        opacitySpan.textContent = `${initialPercent}%`;

        opacityInput.addEventListener('input', function() {
            const percent = Math.round(parseFloat(this.value) * 100);
            opacitySpan.textContent = `${percent}%`;
        });
    }

    // Инициализация цветоселектора
    initShapeColorPicker();

    Logger.info('Shape modal инициализирован');
}

/**
 * Инициализация цветоселектора для фигур
 */
function initShapeColorPicker() {
    const btn = document.getElementById('shapeColorPickerBtn');
    const panel = document.getElementById('shapeColorPanel');
    const colorInput = document.getElementById('shape_color'); // input type="color" внутри panel
    const preview = document.getElementById('shapeColorPreview');
    const code = document.getElementById('shapeColorCode');

    if (!btn || !panel || !colorInput || !preview || !code) {
        Logger.error('Shape color picker: элементы не найдены');
        return;
    }

    function setColor(color) {
        preview.style.backgroundColor = color;
        code.textContent = color.toUpperCase();
        colorInput.value = color;

        // Обновляем активный класс для свотчей
        document.querySelectorAll('.color-swatch').forEach(sw => {
            sw.classList.toggle('active', sw.dataset.color?.toLowerCase() === color.toLowerCase());
        });
    }

    // Открытие/закрытие панели
    btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : 'block';
        btn.classList.toggle('active', !isVisible);
        panel.style.zIndex = '99999';
    });

    // Выбор цвета из сетки
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', function(e) {
            e.stopPropagation();
            const color = this.dataset.color;
            if (color) {
                setColor(color);
                panel.style.display = 'none';
                btn.classList.remove('active');
            }
        });
    });

    // Выбор произвольного цвета через input type="color"
    colorInput.addEventListener('input', function(e) {
        setColor(e.target.value);
    });

    // Закрытие при клике вне панели
    const closeHandler = function(e) {
        if (!e.target.closest('#shapeColorPickerBtn') && !e.target.closest('#shapeColorPanel')) {
            panel.style.display = 'none';
            btn.classList.remove('active');
        }
    };
    document.addEventListener('click', closeHandler);

    // Блокировка закрытия при клике внутри панели
    panel.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    // Установить начальный цвет
    const defaultColor = colorInput.value || '#3498db';
    setColor(defaultColor);

    // Экспорт для глобального доступа
    window.setShapeColor = setColor;
}

// Экспорт для глобального доступа
window.openShapeModal = openShapeModal;
window.saveShape = saveShape;
window.deleteShape = deleteShape;
