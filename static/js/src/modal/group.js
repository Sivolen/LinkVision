/**
 * Group Management Module
 * Управление группами устройств
 */

import { showToast } from './ui.js';
import { escapeHtml, getErrorMessage } from './utils.js';
import { reloadMapWithViewportRestore } from './mapIntegration.js';

// Переменные модуля
let groupModal = null;
let currentGroupId = null;
let _formHandlerAttached = false;

/**
 * Инициализировать цветовой пикер
 */
function initColorPicker() {
    const btn = document.getElementById('colorPickerBtn');
    const panel = document.getElementById('colorPanel');
    const input = document.getElementById('group_color');
    const preview = document.getElementById('colorPreview');
    const code = document.getElementById('colorCode');

    if (!btn || !panel || !input || !preview || !code) {
        Logger.error('❌ Color picker: элементы не найдены');
        return;
    }

    const newBtn = btn.cloneNode(true);
    if (btn.parentNode) {
        btn.parentNode.replaceChild(newBtn, btn);
    }

    const newPanel = document.getElementById('colorPanel');
    const newInput = document.getElementById('group_color');
    const newPreview = document.getElementById('colorPreview');
    const newCode = document.getElementById('colorCode');

    function setColor(color) {
        newPreview.style.backgroundColor = color;
        newCode.textContent = color.toUpperCase();
        newInput.value = color;
        document.querySelectorAll('.color-swatch').forEach(sw => {
            sw.classList.toggle('active', sw.dataset.color?.toLowerCase() === color.toLowerCase());
        });
    }

    const newBtnEl = document.getElementById('colorPickerBtn');
    newBtnEl?.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const isVisible = newPanel.style.display !== 'none';
        newPanel.style.display = isVisible ? 'none' : 'block';
        newBtnEl.classList.toggle('active', !isVisible);
        newPanel.style.zIndex = '99999';
        newPanel.style.position = 'absolute';
    });

    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', function(e) {
            e.stopPropagation();
            const color = swatch.dataset.color;
            if (color) {
                setColor(color);
                newPanel.style.display = 'none';
                newBtnEl?.classList.remove('active');
            }
        });
    });

    newInput.addEventListener('input', function(e) {
        setColor(e.target.value);
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('#colorPickerBtn') && !e.target.closest('#colorPanel')) {
            newPanel.style.display = 'none';
            newBtnEl?.classList.remove('active');
        }
    });

    newPanel.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    const defaultColor = newInput.value || '#3498db';
    setColor(defaultColor);

    window.setColor = setColor;
}

/**
 * Инициализировать обработчик формы
 */
function initFormHandler() {
    if (_formHandlerAttached) return;
    _formHandlerAttached = true;

    const form = document.getElementById('groupForm');
    if (!form) return;

    const newForm = form.cloneNode(true);
    if (form.parentNode) {
        form.parentNode.replaceChild(newForm, form);
    }

    newForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!newForm.checkValidity()) {
            e.stopPropagation();
            newForm.classList.add('was-validated');
            return;
        }

        const id = document.getElementById('group_id')?.value;
        const name = document.getElementById('group_name')?.value.trim();
        const color = document.getElementById('group_color')?.value;
        const fontSize = parseInt(document.getElementById('group_font_size').value, 10) || 11;

        if (!name) {
            showToast('Ошибка', 'Введите название группы', 'error');
            return;
        }

        const submitBtn = document.getElementById('submitBtn');
        const btnText = submitBtn?.querySelector('.btn-text');
        const btnLoader = submitBtn?.querySelector('.btn-loader');

        if (btnText) btnText.classList.add('d-none');
        if (btnLoader) btnLoader.classList.remove('d-none');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const isEdit = !!id;
            const url = isEdit ? `/api/group/${id}` : '/api/group';
            const method = isEdit ? 'PUT' : 'POST';
            const body = isEdit
                ? { name, color, font_size: fontSize }
                : { map_id: window.currentMapId, name, color, font_size: fontSize };
            
            window.setSkipNextMapUpdate();
            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const errorMsg = await getErrorMessage(res);
                throw new Error(errorMsg);
            }

            showToast(isEdit ? 'Группа обновлена' : 'Группа создана', `Группа "${name}"`, 'success');
            resetGroupForm();
            loadGroupsList();
            await reloadMapWithViewportRestore();

        } catch (err) {
            Logger.error('Submit error:', err);
            showToast('Ошибка', err.message || 'Не удалось сохранить', 'error');
        } finally {
            if (btnText) btnText.classList.remove('d-none');
            if (btnLoader) btnLoader.classList.add('d-none');
            if (submitBtn) submitBtn.disabled = false;
            setTimeout(() => window.clearSkipNextMapUpdate(), 500);
        }
    });

    document.getElementById('resetFormBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        resetGroupForm();
    });
}

/**
 * Сбросить форму группы
 */
function resetGroupForm() {
    currentGroupId = null;
    const form = document.getElementById('groupForm');
    form?.classList.remove('was-validated');
    form?.reset();

    const defaultColor = '#3498db';
    if (window.setColor) {
        window.setColor(defaultColor);
    }

    const fontSizeInput = document.getElementById('group_font_size');
    if (fontSizeInput) fontSizeInput.value = 11;

    const btnText = document.querySelector('#submitBtn .btn-text');
    if (btnText) btnText.textContent = 'Добавить группу';

    const idField = document.getElementById('group_id');
    if (idField) idField.value = '';
}

/**
 * Загрузить список групп
 */
async function loadGroupsList() {
    const tbody = document.getElementById('groupListBody');
    const emptyState = document.getElementById('emptyState');
    const skeleton = document.getElementById('skeletonLoader');
    const countBadge = document.getElementById('groupsCount');

    if (!tbody) return;

    skeleton?.classList.remove('d-none');
    tbody.closest('.table-responsive')?.classList.add('d-none');
    emptyState?.classList.add('d-none');

    try {
        const res = await fetch(`/api/map/${window.currentMapId}/groups`);
        if (!res.ok) throw new Error('Ошибка: ' + res.status);

        const groups = await res.json();

        if (countBadge) countBadge.textContent = groups.length;

        if (groups.length === 0) {
            skeleton?.classList.add('d-none');
            tbody.closest('.table-responsive')?.classList.add('d-none');
            emptyState?.classList.remove('d-none');
            tbody.innerHTML = '';
            return;
        }

        tbody.innerHTML = groups.map((group, idx) => `
            <tr style="animation: rowFadeIn 0.25s ease ${idx * 50}ms forwards; opacity: 0">
                <td><span class="fw-medium">${escapeHtml(group.name)}</span></td>
                <td><span class="color-preview" style="background:${group.color}" title="${group.color}"></span></td>
                <td class="text-center"><span class="badge bg-light text-dark">${group.device_count || 0}</span></td>
                <td class="text-end">
                    <div class="table-actions">
                        <button type="button" class="btn-action" data-action="edit" data-id="${group.id}" data-name="${escapeHtml(group.name)}" data-color="${group.color}" data-fontsize="${group.font_size || 11}">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button type="button" class="btn-action btn-danger" data-action="delete" data-id="${group.id}" data-name="${escapeHtml(group.name)}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        Logger.error('Load groups error:', err);
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">Ошибка загрузки</td></tr>`;
        showToast('Ошибка', 'Не удалось загрузить группы', 'error');
    } finally {
        skeleton?.classList.add('d-none');
        tbody.closest('.table-responsive')?.classList.remove('d-none');
    }
}

/**
 * Инициализировать действия таблицы
 */
function initTableActions() {
    const tbody = document.getElementById('groupListBody');
    const searchInput = document.getElementById('groupsSearch');

    tbody?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-action');
        if (!btn) return;

        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);

        if (action === 'edit') {
            const name = btn.dataset.name;
            const color = btn.dataset.color;
            const fontSize = btn.dataset.fontsize || 11;
            editGroup(id, name, color, fontSize);
        } else if (action === 'delete') {
            deleteGroup(id, btn.dataset.name);
        }
    });

    searchInput?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        const rows = tbody?.querySelectorAll('tr') || [];
        rows.forEach(row => {
            const name = row.querySelector('td:first-child')?.textContent.toLowerCase() || '';
            row.style.display = name.includes(term) ? '' : 'none';
        });
    });
}

/**
 * Редактировать группу
 */
export function editGroup(id, name, color, fontSize) {
    currentGroupId = id;
    const idField = document.getElementById('group_id');
    const nameField = document.getElementById('group_name');
    const fontSizeInput = document.getElementById('group_font_size');

    if (idField) idField.value = id;
    if (nameField) {
        nameField.value = name;
        nameField.focus();
        nameField.select();
    }
    if (window.setColor) window.setColor(color);
    if (fontSizeInput) fontSizeInput.value = fontSize || 11;

    const btnText = document.querySelector('#submitBtn .btn-text');
    if (btnText) btnText.textContent = 'Сохранить';
}

/**
 * Удалить группу
 */
export async function deleteGroup(id, name) {
    window.confirmAction('Удаление группы', `Удалить группу "${name}"?`, async () => {
        window.setSkipNextMapUpdate();
        try {
            const res = await fetch(`/api/group/${id}`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            if (!res.ok) {
                const errorMsg = await getErrorMessage(res);
                throw new Error(errorMsg);
            }
            showToast('Группа удалена', `Группа "${name}" удалена`, 'success');
            loadGroupsList();
            if (currentGroupId === id) resetGroupForm();
            await reloadMapWithViewportRestore();
        } catch (err) {
            Logger.error('Delete error:', err);
            showToast('Ошибка', err.message || 'Не удалось удалить группу', 'error');
        } finally {
            setTimeout(() => window.clearSkipNextMapUpdate(), 500);
        }
    });
}

/**
 * Открыть менеджер групп
 */
export function openGroupManager() {
    if (!window.isAdmin) {
        showToast('Доступ запрещён', 'Только администратор может управлять группами', 'error');
        return;
    }
    if (window.isOperator) {
        showToast('Доступ запрещён', 'Оператор не может управлять группами', 'error');
        return;
    }

    if (!groupModal) {
        const el = document.getElementById('groupModal');
        if (el) {
            groupModal = new bootstrap.Modal(el);
        } else {
            Logger.error('Modal #groupModal not found');
            return;
        }
    }

    resetGroupForm();
    const fontSizeInput = document.getElementById('group_font_size');
    if (fontSizeInput) fontSizeInput.value = 11;
    groupModal.show();
}

/**
 * Инициализация модального окна групп
 */
export function initGroupModal() {
    initFormHandler();
    initTableActions();
    
    const modalEl = document.getElementById('groupModal');
    modalEl?.addEventListener('shown.bs.modal', () => {
        initColorPicker();
        loadGroupsList();
        setTimeout(() => {
            document.getElementById('group_name')?.focus();
        }, 100);
    });

    Logger.info('✅ Group modal инициализирован');
}

// Экспорт для глобального доступа
window.openGroupManager = openGroupManager;
window.editGroup = editGroup;
window.deleteGroup = deleteGroup;
