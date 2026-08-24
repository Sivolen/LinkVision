/**
 * Link Management Module
 * Управление связями между устройствами
 */

import { showToast } from '../utils/toast.js';
import { t } from '../i18n/i18n.js';
import { http } from '../utils/http.js';
import { beginSelfUpdate, endSelfUpdate } from '../utils/state.js';
import { parseRawId } from '../map/ids.js';

// Переменные модуля
let linkModal = null;

/**
 * Обновить предпросмотр связи
 */
function updateLinkPreview() {
    const src = document.getElementById('link_src_iface')?.value || 'eth0';
    const tgt = document.getElementById('link_tgt_iface')?.value || 'eth0';
    const preview = document.getElementById('link_preview');
    if (preview) preview.textContent = `${src} ↔ ${tgt}`;
}

/**
 * Открыть модальное окно для новой связи
 */
export function openLinkModal(sourceId, targetId) {
    if (!linkModal) {
        const el = document.getElementById('linkModal');
        if (el) linkModal = new bootstrap.Modal(el);
        else return;
    }
    
    document.getElementById('link_id').value = '';
    document.getElementById('link_source').value = sourceId;
    document.getElementById('link_target').value = targetId;
    document.getElementById('link_src_iface').value = 'eth0';
    document.getElementById('link_tgt_iface').value = 'eth0';
    document.getElementById('link_type').value = '';
    document.getElementById('link_line_color').value = '#6c757d';
    document.getElementById('link_line_width').value = 2;
    document.getElementById('link_line_style').value = 'solid';
    document.getElementById('linkModalTitle').textContent = t('modal.link.newTitle');
    document.getElementById('linkDeleteBtn').style.display = 'none';
    document.getElementById('link_font_size').value = 8;
    updateLinkPreview();

    applyLinkModalEditPermission();
    linkModal.show();
}

/**
 * Открыть модальное окно для редактирования связи
 */
export function openLinkModalForEdit(edge) {
    if (!linkModal) {
        const el = document.getElementById('linkModal');
        if (el) linkModal = new bootstrap.Modal(el);
        else return;
    }
    
    const data = edge.data();
    document.getElementById('link_id').value = data.id;
    document.getElementById('link_source').value = data.source;
    document.getElementById('link_target').value = data.target;
    
    let srcIface = data.srcIface;
    let tgtIface = data.tgtIface;
    if (!srcIface || !tgtIface) {
        const parts = (data.label || 'eth0↔eth0').split('↔');
        srcIface = parts[0].trim();
        tgtIface = parts[1].trim();
    }
    
    document.getElementById('link_src_iface').value = srcIface;
    document.getElementById('link_tgt_iface').value = tgtIface;
    document.getElementById('link_type').value = data.link_type || '';
    document.getElementById('link_line_color').value = data.color || '#6c757d';
    document.getElementById('link_line_width').value = data.width || 2;
    document.getElementById('link_line_style').value = data.style || 'solid';
    document.getElementById('linkModalTitle').textContent = t('modal.link.editTitle');
    document.getElementById('linkDeleteBtn').style.display = 'inline-block';
    document.getElementById('linkDeleteBtn').onclick = () => deleteLink(data.id);
    document.getElementById('link_font_size').value = data.font_size || 8;
    updateLinkPreview();
    applyLinkModalEditPermission();
    linkModal.show();
}

/**
 * Привести поля/кнопки модалки связи в соответствие с текущим правом
 * редактирования карты. Вызывается при КАЖДОМ открытии модалки и всегда
 * выставляет обе ветки (можно/нельзя) явно — иначе disabled, оставленный от
 * прошлого открытия в заблокированном состоянии карты, не снимается сам
 * после разблокировки, пока страница не будет перезагружена. Кнопки теперь
 * только отключаются (disabled), а не скрываются — видимость Delete
 * по-прежнему зависит от того, новая это связь или существующая (см. выше).
 */
function applyLinkModalEditPermission() {
    const canEdit = window.canEditMap === true;
    document.querySelectorAll('#linkModal input, #linkModal select').forEach(el => {
        el.disabled = !canEdit;
    });
    const saveBtn = document.querySelector('#linkModal .btn-primary');
    if (saveBtn) {
        saveBtn.disabled = !canEdit;
        saveBtn.title = canEdit ? '' : t('common.accessDenied');
    }
    const deleteBtn = document.querySelector('#linkModal .btn-danger');
    if (deleteBtn) {
        deleteBtn.disabled = !canEdit;
        deleteBtn.title = canEdit ? '' : t('common.accessDenied');
    }
}

/**
 * Подтвердить создание/обновление связи
 */
export function confirmCreateLink() {
    const linkId = document.getElementById('link_id').value;
    const src = document.getElementById('link_source')?.value;
    const tgt = document.getElementById('link_target')?.value;
    const srcIface = document.getElementById('link_src_iface')?.value || 'eth0';
    const tgtIface = document.getElementById('link_tgt_iface')?.value || 'eth0';
    const linkType = document.getElementById('link_type')?.value;
    const lineColor = document.getElementById('link_line_color')?.value;
    const lineWidth = parseInt(document.getElementById('link_line_width')?.value) || 2;
    const lineStyle = document.getElementById('link_line_style')?.value;
    const fontSize = parseInt(document.getElementById('link_font_size').value, 10) || 8;

    if (!src || !tgt) {
        showToast(t('toast.errorTitle'), t('modal.link.noDevices'), 'error');
        return;
    }

    const sourceId = typeof src === 'number' ? src : parseInt(src);
    const targetId = typeof tgt === 'number' ? tgt : parseInt(tgt);

    if (isNaN(sourceId) || isNaN(targetId)) {
        showToast(t('toast.errorTitle'), t('modal.link.invalidIds'), 'error');
        return;
    }

    window.setLinkSaving(true);
    if (linkModal) linkModal.hide();

    if (linkId) {
        updateLink(linkId, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle, fontSize);
    } else {
        createLinkWithInterfaces(sourceId, targetId, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle, fontSize);
    }
}

/**
 * Создать связь с интерфейсами
 */
function createLinkWithInterfaces(sourceId, targetId, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle, fontSize) {
    beginSelfUpdate();

    http.post('/api/link', {
        map_id: window.currentMapId,
        source_id: sourceId,
        target_id: targetId,
        src_iface: srcIface,
        tgt_iface: tgtIface,
        link_type: linkType || null,
        line_color: lineColor,
        line_width: lineWidth,
        line_style: lineStyle,
        font_size: fontSize
    })
    .then(data => {
        if (data.id && window.cy) {
            const linkId = `link_${data.id}`;

            // Защита от гонки: сервер рассылает 'link_created' всем клиентам
            // комнаты, включая того, кто создал связь (без skip_sid). Если
            // socket-эхо долетит раньше, чем разрешится этот же POST-запрос,
            // ребро уже будет добавлено обработчиком в index.js
            // (addLinkToGraph уже проверяет дубликаты) — тогда просто не
            // добавляем его повторно здесь.
            if (!window.cy.getElementById(linkId).length) {
                const sourceNode = window.cy.getElementById(String(sourceId));
                const targetNode = window.cy.getElementById(String(targetId));
                const srcX = sourceNode.position().x;
                const tgtX = targetNode.position().x;

                let label;
                if (srcX <= tgtX) {
                    label = `${srcIface} ↔ ${tgtIface}`;
                } else {
                    label = `${tgtIface} ↔ ${srcIface}`;
                }

                window.cy.batch(() => {
                    window.cy.add({
                        group: 'edges',
                        data: {
                            id: linkId,
                            source: String(sourceId),
                            target: String(targetId),
                            label: label,
                            srcIface: srcIface,
                            tgtIface: tgtIface,
                            link_type: linkType,
                            color: lineColor,
                            width: lineWidth,
                            style: lineStyle,
                            font_size: fontSize
                        }
                    });
                });
            }

            if (typeof window.resetLinkMode === 'function') window.resetLinkMode();
            showToast(t('toast.successTitle'), t('modal.link.created'), 'success');
        }
        if (linkModal) linkModal.hide();
    })
    .catch(err => {
        Logger.error('Ошибка создания связи:', err);
        showToast(t('toast.errorTitle'), err.message || t('modal.link.createFail'), 'error');
    })
    .finally(() => {
        endSelfUpdate();
        window.setLinkSaving(false);
    });
}

/**
 * Обновить связь
 */
export function updateLink(linkId, srcIface, tgtIface, linkType, lineColor, lineWidth, lineStyle, fontSize) {
    const numericId = parseRawId(linkId);
    beginSelfUpdate();

    http.put(`/api/link/${numericId}`, {
        source_interface: srcIface,
        target_interface: tgtIface,
        link_type: linkType || null,
        line_color: lineColor,
        line_width: lineWidth,
        line_style: lineStyle,
        font_size: fontSize
    })
    .then(data => {
        const edge = window.cy.getElementById(linkId);
        if (edge.length) {
            const sourceNode = edge.source();
            const targetNode = edge.target();
            const srcX = sourceNode.position().x;
            const tgtX = targetNode.position().x;
            
            let label;
            if (srcX <= tgtX) {
                label = `${srcIface} ↔ ${tgtIface}`;
            } else {
                label = `${tgtIface} ↔ ${srcIface}`;
            }
            
            edge.data({
                label: label,
                srcIface: srcIface,
                tgtIface: tgtIface,
                link_type: linkType,
                color: lineColor,
                width: lineWidth,
                style: lineStyle,
                font_size: fontSize
            });
            
            edge.style({
                'line-color': lineColor,
                'width': lineWidth,
                'line-style': lineStyle
            });
            
            window.cy.style().update();
        }
        
        showToast(t('toast.successTitle'), t('modal.link.updated'), 'success');
        if (linkModal) linkModal.hide();
    })
    .catch(err => {
        Logger.error('Ошибка обновления связи:', err);
        showToast(t('toast.errorTitle'), err.message || t('modal.link.updateFail'), 'error');
    })
    .finally(() => {
        endSelfUpdate();
        window.setLinkSaving(false);
    });
}

/**
 * Удалить связь
 */
export function deleteLink(linkId) {
    window.confirmAction(t('modal.link.deleteTitle'), t('modal.link.deleteMsg'), () => {
        const numericId = parseRawId(String(linkId));
        beginSelfUpdate();

        http.del(`/api/link/${numericId}`)
        .then(() => {
            if (window.cy) {
                window.cy.getElementById(String(linkId)).remove();
            }
            
            if (linkModal) linkModal.hide();
            showToast(t('toast.successTitle'), t('modal.link.deleted'), 'success');
        })
        .catch(err => {
            Logger.error('Ошибка удаления связи:', err);
            showToast(t('toast.errorTitle'), err.message || t('modal.link.deleteFail'), 'error');
        })
        .finally(() => {
            endSelfUpdate();
        });
    });
}

/**
 * Установить состояние сохранения связи
 */
export function setLinkSaving(isSaving) {
    const saveBtn = document.getElementById('saveLinkBtn');
    const btnText = saveBtn?.querySelector('.btn-text');
    const btnLoader = saveBtn?.querySelector('.btn-loader');
    
    if (!saveBtn) return;
    
    if (isSaving) {
        if (btnText) btnText.classList.add('d-none');
        if (btnLoader) btnLoader.classList.remove('d-none');
        saveBtn.disabled = true;
    } else {
        if (btnText) btnText.classList.remove('d-none');
        if (btnLoader) btnLoader.classList.add('d-none');
        saveBtn.disabled = false;
    }
}

/**
 * Применить пресет типа связи
 */
export function applyLinkTypePreset(type) {
    const presets = {
        '100m':  { color: '#d1d5db', width: 2, style: 'solid' },
        '1G':    { color: '#3b82f6', width: 3, style: 'solid' },
        '10G':   { color: '#2563eb', width: 4, style: 'solid' },
        '25G':   { color: '#4f46e5', width: 5, style: 'solid' },
        '100G':  { color: '#6b7280', width: 6, style: 'solid' },
        '400G':  { color: '#8b5cf6', width: 8, style: 'solid' },
        'vlan':  { color: '#94a3b8', width: 2, style: 'dashed' },
        'radio': { color: '#84cc16', width: 2, style: 'dotted' },
        'tunnel': { color: '#06b6d4', width: 2, style: 'dashed' }
    };
    
    if (type && presets[type]) {
        const colorInput = document.getElementById('link_line_color');
        const widthInput = document.getElementById('link_line_width');
        const styleSelect = document.getElementById('link_line_style');
        
        if (colorInput) colorInput.value = presets[type].color;
        if (widthInput) widthInput.value = presets[type].width;
        if (styleSelect) styleSelect.value = presets[type].style;
        updateLinkPreview();
    }
}

/**
 * Инициализация модального окна связей
 */
export function initLinkModal() {
    Logger.info('Link modal инициализирован');
}

// Экспорт для глобального доступа
window.openLinkModal = openLinkModal;
window.openLinkModalForEdit = openLinkModalForEdit;
window.confirmCreateLink = confirmCreateLink;
window.createLinkWithInterfaces = createLinkWithInterfaces;
window.updateLink = updateLink;
window.deleteLink = deleteLink;
window.setLinkSaving = setLinkSaving;
window.applyLinkTypePreset = applyLinkTypePreset;
