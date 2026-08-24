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
let pendingParentGroupId = null;
// Группа, которую нужно открыть сразу в режиме редактирования (из контекстного
// меню карты). Применяется в обработчике shown.bs.modal — см. openGroupManager().
let pendingEditGroup = null;

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
        const parentIdRaw = document.getElementById('group_parent_id')?.value;
        const parentId = parentIdRaw ? parseInt(parentIdRaw, 10) : null;

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

        console.log('📝 Form submit: id=', id, 'parentId=', parentId);

        try {
            const isEdit = !!id;
            const url = isEdit ? `/api/group/${id}` : '/api/group';
            const method = isEdit ? 'PUT' : 'POST';
            const body = isEdit
                ? { name, color, font_size: fontSize, parent_group_id: parentId }
                : { map_id: window.currentMapId, name, color, font_size: fontSize, parent_group_id: parentId };
            
            beginSelfUpdate();
            const result = await http[method.toLowerCase()](url, body);

            showToast(isEdit ? t('modal.group.updated') : t('modal.group.created'), t('modal.group.nameLabel', { name }), 'success');
            resetGroupForm();
            loadGroupsList();

            // ★★★ НЕ ПЕРЕЗАГРУЖАЕМ ВСЮ КАРТУ ★★★
            // Обновляем группу напрямую в графе
            if (window.cy) {
                const groupId = isEdit ? `group_${id}` : `group_${result.id}`;
                const groupNode = window.cy.getElementById(groupId);
                if (groupNode.length) {
                    // Обновляем данные
                    groupNode.data({ name, color, fontSize });
                    
                    // Если менялся родитель — перемещаем
                    if (parentId) {
                        const parentNode = window.cy.getElementById(`group_${parentId}`);
                        if (parentNode.length) {
                            groupNode.move({ parent: parentNode.id() });
                        }
                    } else {
                        // ВАЖНО: именно null отвязывает узел от родителя.
                        // move({parent: undefined}) в Cytoscape — no-op, поэтому
                        // при снятии родителя группа оставалась вложенной и на
                        // карте это было видно только после перезагрузки (сервер
                        // уже отдавал parent_group_id=null, а граф — нет).
                        groupNode.move({ parent: null });
                    }
                    
                    // Принудительно обновляем размеры
                    if (typeof window.forceUpdateAllGroups === 'function') {
                        setTimeout(() => window.forceUpdateAllGroups(), 50);
                    }
                } else {
                    // Группа ещё не на карте — добавляем
                    if (typeof window.addGroupToGraph === 'function') {
                        window.addGroupToGraph({
                            id: isEdit ? id : result.id,
                            name, color, font_size: fontSize,
                            parent_group_id: parentId
                        });
                    }
                }
            }

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

        // Раскладываем плоский список в дерево и печатаем его в порядке обхода:
        // так сразу видно, какая группа кому дочерняя (раньше список был плоским
        // и родителя было не определить).
        const byId = new Map(groups.map(g => [g.id, g]));
        const ordered = [];
        const childrenOf = new Map();
        groups.forEach(g => {
            const parentId = byId.has(g.parent_group_id) ? g.parent_group_id : null;
            if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
            childrenOf.get(parentId).push(g);
        });
        (function walk(parentId, depth) {
            (childrenOf.get(parentId) || []).forEach(g => {
                ordered.push({ group: g, depth });
                walk(g.id, depth + 1);
            });
        })(null, 0);

        tbody.innerHTML = ordered.map(({ group, depth }, idx) => {
            const parent = byId.get(group.parent_group_id);
            const indent = depth ? `padding-left:${depth * 18}px;` : '';
            const branch = depth ? '<span class="text-muted me-1">└</span>' : '';
            // Родителя показываем подписью ПОД названием, а не отдельной
            // колонкой: пятая колонка расширяла таблицу шире модалки, и колонка
            // «Действия» с кнопкой редактирования уезжала в горизонтальный
            // overflow — визуально кнопка «пропадала».
            const parentHint = parent
                ? `<div class="text-muted small" style="${indent}"><i class="fas fa-level-up-alt fa-rotate-90 me-1"></i>${escapeHtml(parent.name)}</div>`
                : '';
            return `
            <tr style="animation: rowFadeIn 0.25s ease ${idx * 50}ms forwards; opacity: 0">
                <td><span class="fw-medium" style="${indent}">${branch}${escapeHtml(group.name)}</span>${parentHint}</td>
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
            </tr>`;
        }).join('');

        // await — чтобы вызывающий код (открытие модалки в режиме
        // редактирования) не применял выбор родителя до заполнения <select>.
        await populateParentDropdown();

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
 * Заполнить дропдаун родительской группы
 */
async function populateParentDropdown(excludeGroupId = null, selectedId = pendingParentGroupId) {
    const select = document.getElementById('group_parent_id');
    if (!select) return;

    // Получаем актуальный список групп
    return http.get(`/api/map/${window.currentMapId}/groups`)
        .then(groups => {
            select.innerHTML = `<option value="">${t('modal.group.noParent', { defaultValue: '-- Без родителя --' })}</option>`;
            
            // Исключаем саму группу и всех её потомков
            const excludeIds = new Set(excludeGroupId ? [excludeGroupId] : []);
            if (excludeGroupId) {
                // Рекурсивно собираем всех потомков
                function collectChildren(parentId) {
                    groups.filter(g => g.parent_group_id === parentId).forEach(child => {
                        excludeIds.add(child.id);
                        collectChildren(child.id);
                    });
                }
                collectChildren(excludeGroupId);
            }
            
            groups.filter(g => !excludeIds.has(g.id)).forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.id;
                opt.textContent = g.name;
                if (g.id == selectedId) opt.selected = true;
                select.appendChild(opt);
            });
            
            // Сбрасываем pending
            pendingParentGroupId = null;
        })
        .catch(err => Logger.error('Failed to populate parent dropdown:', err));
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
    const parentSelect = document.getElementById('group_parent_id');

    if (idField) idField.value = id;
    if (nameField) {
        nameField.value = name;
        nameField.focus();
        nameField.select();
    }
    if (window.setColor) window.setColor(color);
    if (fontSizeInput) fontSizeInput.value = fontSize || 11;

    // Текущий родитель + защита от циклов: перезаполняем дропдаун, исключая саму
    // группу и всех её потомков (иначе можно выбрать собственного потомка
    // родителем и получить 400 от сервера).
    if (parentSelect) {
        let parentId = null;
        if (window.cy) {
            const groupNode = window.cy.getElementById(`group_${id}`);
            const parent = groupNode.length ? groupNode.parent() : null;
            if (parent && parent.length) {
                parentId = parseInt(parent.id().replace('group_', ''), 10);
            }
        }
        populateParentDropdown(id, parentId);
    }

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
export function openGroupManager(options = {}) {
    Logger.info('openGroupManager called');

    if (window.canEditMap !== true) {
        Logger.warn('Map is not editable');
        showToast(t('common.accessDenied'), t('common.accessDenied'), 'error');
        return;
    }

    Logger.info('Map edit permission passed');

    const modalEl = document.getElementById('groupModal');
    if (!modalEl) {
        Logger.error('Modal #groupModal not found');
        return;
    }

    if (!window.groupModal) {
        window.groupModal = new bootstrap.Modal(modalEl);

        // Слушатель НЕ снимаем после первого показа: раньше он удалял сам себя,
        // и при повторном открытии список групп и дропдаун родителя больше не
        // перезагружались (в модалке висели устаревшие данные).
        modalEl.addEventListener('shown.bs.modal', async () => {
            initColorPicker();
            await loadGroupsList();

            // Контекст редактирования применяем ПОСЛЕ загрузки списка и
            // дропдауна родителей — иначе выбранный родитель затирается
            // перерисовкой <select>.
            if (pendingEditGroup) {
                const { id, name, color, fontSize } = pendingEditGroup;
                pendingEditGroup = null;
                editGroup(id, name, color, fontSize);
            } else {
                document.getElementById('group_name')?.focus();
            }
        });
    }

    // Предвыбираем родителя (пункт «создать подгруппу») либо открываем сразу в
    // режиме редактирования (пункт «редактировать группу» в контекстном меню).
    if (options.parentGroupId) pendingParentGroupId = options.parentGroupId;
    pendingEditGroup = options.editGroup || null;

    resetGroupForm();
    const fontSizeInput = document.getElementById('group_font_size');
    if (fontSizeInput) fontSizeInput.value = 11;

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
