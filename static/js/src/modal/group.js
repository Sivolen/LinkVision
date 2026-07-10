/**
 * Group Management Module
 * Управление группами устройств
 */

import { showToast } from '../utils/toast.js';
import { t } from '../i18n/i18n.js';
import { escapeHtml } from './utils.js';
import { reloadMapWithViewportRestore } from './mapIntegration.js';
import { http } from '../utils/http.js';
import { beginSelfUpdate, endSelfUpdate } from '../utils/state.js';

// Переменные модуля
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
        Logger.error('Color picker: элементы не найдены');
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
            showToast(t('toast.errorTitle'), t('modal.group.enterName'), 'error');
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
            
            beginSelfUpdate();
            const result = await http.post(url, body);

            showToast(isEdit ? t('modal.group.updated') : t('modal.group.created'), t('modal.group.nameLabel', { name }), 'success');
            resetGroupForm();
            loadGroupsList();
            await reloadMapWithViewportRestore();

        } catch (err) {
            Logger.error('Submit error:', err);
            showToast(t('toast.errorTitle'), err.message || t('modal.group.saveFail'), 'error');
        } finally {
            if (btnText) btnText.classList.remove('d-none');
            if (btnLoader) btnLoader.classList.add('d-none');
            if (submitBtn) submitBtn.disabled = false;
            endSelfUpdate();
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
    if (btnText) btnText.textContent = t('modal.group.addBtn');

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

    if (!tbody) {
        Logger.error('groupListBody not found!');
        return;
    }

    if (!window.currentMapId) {
        Logger.error('currentMapId not set!');
        return;
    }

    Logger.info('Loading groups for map:', window.currentMapId);

    skeleton?.classList.remove('d-none');
    tbody.closest('.table-responsive')?.classList.add('d-none');
    emptyState?.classList.add('d-none');

    try {
        // Добавляем timestamp чтобы обойти кэш браузера
        const timestamp = Date.now();
        const groups = await http.get(`/api/map/${window.currentMapId}/groups?t=${timestamp}`);
        Logger.info('Groups loaded:', groups);

        if (countBadge) countBadge.textContent = groups.length;

        if (!groups || groups.length === 0) {
            skeleton?.classList.add('d-none');
            tbody.closest('.table-responsive')?.classList.add('d-none');
            emptyState?.classList.remove('d-none');
            tbody.innerHTML = '';
            Logger.warn('No groups found');
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

        Logger.info('Groups rendered:', groups.length);

    } catch (err) {
        Logger.error('Load groups error:', err);
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">${t('modal.group.loadError', { msg: err.message })}</td></tr>`;
        showToast(t('toast.errorTitle'), t('modal.group.loadFail'), 'error');
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
    if (btnText) btnText.textContent = t('common.save');
}

/**
 * Удалить группу
 */
export async function deleteGroup(id, name) {
    window.confirmAction(t('modal.group.deleteTitle'), t('modal.group.deleteConfirm', { name }), async () => {
        beginSelfUpdate();
        try {
            await http.del(`/api/group/${id}`);
            showToast(t('modal.group.deleted'), t('modal.group.deletedMsg', { name }), 'success');

            // Удаляем узел группы из графа немедленно
            if (window.cy) {
                const groupNode = window.cy.getElementById(`group_${id}`);
                if (groupNode.length) {
                    groupNode.remove();
                }
            }

            loadGroupsList();
            if (currentGroupId === id) resetGroupForm();
            await reloadMapWithViewportRestore();
        } catch (err) {
            Logger.error('Delete error:', err);
            showToast(t('toast.errorTitle'), err.message || t('modal.group.deleteFail'), 'error');
        } finally {
            endSelfUpdate();
        }
    });
}

/**
 * Открыть менеджер групп
 */
export function openGroupManager() {
    Logger.info('openGroupManager called');

    if (!window.isAdmin) {
        Logger.warn('Not admin');
        showToast(t('common.accessDenied'), t('modal.group.adminOnly'), 'error');
        return;
    }
    if (window.isOperator) {
        Logger.warn('Is operator');
        showToast(t('common.accessDenied'), t('modal.group.operatorNo'), 'error');
        return;
    }

    Logger.info('Admin check passed');

    const modalEl = document.getElementById('groupModal');
    if (!modalEl) {
        Logger.error('Modal #groupModal not found');
        return;
    }

    if (!window.groupModal) {
        Logger.info('Creating modal instance with event listener');
        window.groupModal = new bootstrap.Modal(modalEl);

        // Добавляем listener ПРЯМО ПОСЛЕ создания
        modalEl.addEventListener('shown.bs.modal', function onShown() {
            Logger.info('shown.bs.modal event fired!');
            // Удаляем listener после первого срабатывания
            modalEl.removeEventListener('shown.bs.modal', onShown);

            initColorPicker();
            loadGroupsList();
            setTimeout(() => {
                document.getElementById('group_name')?.focus();
            }, 100);
        });

        Logger.info('Modal instance created with listener');
    } else {
        Logger.info('Using existing modal instance');
    }

    resetGroupForm();
    const fontSizeInput = document.getElementById('group_font_size');
    if (fontSizeInput) fontSizeInput.value = 11;

    Logger.info('Calling modal.show()');
    window.groupModal.show();
}

/**
 * Инициализация модального окна групп
 */
export function initGroupModal() {
    Logger.info('initGroupModal called');

    initFormHandler();
    initTableActions();
    
    // Не создаём modal сразу - создадим при первом открытии
    // Это гарантирует, что DOM элемент существует

    Logger.info('Group modal инициализирован (lazy initialization)');
}

// Экспорт для глобального доступа
window.openGroupManager = openGroupManager;
window.editGroup = editGroup;
window.deleteGroup = deleteGroup;
