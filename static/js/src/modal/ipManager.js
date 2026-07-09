/**
 * IP Management Module
 * Управление списком IP-адресов в форме устройства
 */

import { escapeHtml } from './utils.js';
import { t } from '../i18n/i18n.js';

/**
 * Добавить строку с IP
 */
export function addIpRow(value = '') {
    const container = document.getElementById('ips-container');
    if (!container) return;
    
    const row = document.createElement('div');
    row.className = 'ip-row';
    row.innerHTML = `
        <div class="ip-input-wrapper">
            <input type="text" class="form-control ip-input" placeholder="${t('modal.ip.placeholder')}" value="${escapeHtml(value)}">
            <button class="btn-remove-ip" type="button" title="${t('modal.ip.removeIp')}">&times;</button>
        </div>
    `;
    
    const removeBtn = row.querySelector('.btn-remove-ip');
    removeBtn.addEventListener('click', () => {
        if (container.children.length > 1) {
            row.remove();
        } else {
            row.querySelector('.ip-input').value = '';
        }
    });
    
    const ipInput = row.querySelector('.ip-input');
    ipInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = ipInput.value.trim();
            if (val) {
                addIpRow('');
                ipInput.disabled = true;
                const newInput = container.lastChild.querySelector('.ip-input');
                newInput.focus();
            }
        }
    });
    
    container.appendChild(row);
    return row;
}

/**
 * Получить IP из формы
 */
export function getIpsFromForm() {
    const inputs = document.querySelectorAll('#ips-container .ip-input');
    const ips = [];
    
    inputs.forEach(inp => {
        const val = inp.value.trim();
        if (val && !ips.includes(val)) {
            ips.push(val);
        }
    });
    
    return ips;
}

/**
 * Установить IP в форму
 */
export function setIpsInForm(ips) {
    const container = document.getElementById('ips-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!ips || ips.length === 0) {
        addIpRow('');
    } else {
        ips.forEach(ip => addIpRow(ip));
        addIpRow('');
    }
}

/**
 * Инициализация управления IP
 */
export function initIpManagement() {
    Logger.info('✅ IP manager инициализирован');
}
