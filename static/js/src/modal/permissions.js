/**
 * permissions.js - Управление правами доступа к картам (v2.0)
 */

import { showToast } from '../utils/toast.js';
import { t } from '../i18n/i18n.js';
import { http } from '../utils/http.js';

let currentMapId = null;

/**
 * Открыть модальное окно управления правами
 */
export async function openPermissionsModal(mapId, mapName) {
    currentMapId = mapId;
    
    const modal = document.getElementById('permissionsModal');
    if (!modal) {
        console.error('Permissions modal not found');
        return;
    }
    
    // Обновить заголовок
    const titleEl = modal.querySelector('.modal-title');
    if (titleEl) {
        titleEl.querySelector('#permissionsMapName').textContent = mapName;
    }
    
    // Загрузить текущие права
    await loadPermissions(mapId);
    
    // Загрузить список пользователей для добавления
    await loadUsersForPermission(mapId);
    
    // Показать модальное окно
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

/**
 * Загрузить текущие права доступа
 */
async function loadPermissions(mapId) {
    const container = document.getElementById('permissionsList');
    if (!container) return;
    
    container.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm"></div> ' + t('common.loading') + '</div>';
    
    try {
        const response = await fetch(`/api/map/${mapId}/permissions`);
        if (!response.ok) {
            throw new Error('Failed to load permissions');
        }
        
        const permissions = await response.json();
        
        if (permissions.length === 0) {
            container.innerHTML = '<p class="text-muted">' + t('modal.permissions.noPerms') + '</p>';
            return;
        }
        
        let html = '<div class="table-responsive"><table class="table table-sm">';
        html += `<thead><tr><th>${t('modal.permissions.thType')}</th><th>${t('modal.permissions.thUserRole')}</th><th>${t('modal.permissions.thRole')}</th><th>${t('modal.permissions.thActions')}</th></tr></thead>`;
        html += '<tbody>';
        
        permissions.forEach(perm => {
            const typeLabel = perm.type === 'user' ? t('modal.permissions.typeUser') : t('modal.permissions.typeRole');
            const nameLabel = perm.username || (perm.role === 'editor' ? t('modal.permissions.allOperatorsEditor') : t('modal.permissions.allOperatorsViewer'));
            const roleBadge = getRoleBadge(perm.role);
            
            html += `<tr data-perm-id="${perm.id}">`;
            html += `<td><span class="badge bg-secondary">${typeLabel}</span></td>`;
            html += `<td>${nameLabel}</td>`;
            html += `<td>${roleBadge}</td>`;
            html += `<td>`;
            
            if (perm.type === 'user') {
                html += `
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="window.editPermission(${perm.id}, '${perm.role}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="window.deletePermission(${perm.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                `;
            } else {
                html += `
                    <button class="btn btn-sm btn-outline-danger" onclick="window.deletePermission(${perm.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                `;
            }
            
            html += `</td></tr>`;
        });
        
        html += '</tbody></table></div>';
        container.innerHTML = html;
        
    } catch (err) {
        console.error('Error loading permissions:', err);
        container.innerHTML = '<div class="alert alert-danger">' + t('modal.permissions.loadPermsError') + '</div>';
    }
}

/**
 * Загрузить пользователей для добавления права
 */
async function loadUsersForPermission(mapId) {
    const selectEl = document.getElementById('permissionUserSelect');
    if (!selectEl) return;
    
    selectEl.innerHTML = '<option value="">' + t('common.loading') + '</option>';
    
    try {
        const response = await fetch('/admin/users');
        if (!response.ok) {
            throw new Error('Failed to load users');
        }
        
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const rows = doc.querySelectorAll('table tbody tr');
        const users = [];
        
        console.log('🔍 Parsing users table, rows:', rows.length);

        rows.forEach((row, idx) => {
            const cells = row.querySelectorAll('td');
            console.log(`Row ${idx}: ${cells.length} cells`);

            if (cells.length >= 6) {
                const userIdText = cells[0].textContent.trim();
                const username = cells[1].textContent.trim();

                // Проверяем админа по классу бейджа
                const isAdminCell = cells[2];
                const isAdmin = isAdminCell.querySelector('.bg-success') !== null;

                console.log(`  User: ${username}, ID: "${userIdText}", Admin: ${isAdmin}`);

                if (!isAdmin) {
                    const isOperatorCell = cells[3];
                    const isOperator = isOperatorCell.querySelector('.bg-info') !== null;

                    // Извлекаем ID из текста "#1" -> 1
                    const userId = parseInt(userIdText.replace('#', '').trim());

                    console.log(`  → Added: id=${userId}, isOperator=${isOperator}`);

                    users.push({
                        id: userId,
                        username,
                        isOperator
                    });
                } else {
                    console.log(`  ✗ Skipped admin: ${username}`);
                }
            }
        });
        
        console.log(`👥 Total non-admin users: ${users.length}`);

        // Заполняем select
        selectEl.innerHTML = '<option value="">' + t('modal.permissions.selectUser') + '</option>';
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.username + (user.isOperator ? ' (Operator)' : '');
            selectEl.appendChild(option);
        });
        
    } catch (err) {
        console.error('Error loading users:', err);
        selectEl.innerHTML = '<option value="">' + t('common.loadError') + '</option>';
    }
}

/**
 * Добавить право пользователю
 */
export async function addPermission() {
    if (!currentMapId) return;
    
    const userId = document.getElementById('permissionUserSelect').value;
    const role = document.getElementById('permissionRoleSelect').value;
    
    if (!userId) {
        showToast(t('toast.errorTitle'), t('modal.permissions.selectUser'), 'warning');
        return;
    }
    
    if (!role) {
        showToast(t('toast.errorTitle'), t('modal.permissions.selectRole'), 'warning');
        return;
    }
    
    try {
        const result = await http.post(`/api/map/${currentMapId}/permissions`, {
            user_id: parseInt(userId),
            role
        });
        
        if (result) {
            showToast(t('toast.successTitle'), t('modal.permissions.permAdded'), 'success');
            await loadPermissions(currentMapId);
            await loadUsersForPermission(currentMapId);
        }
    } catch (err) {
        console.error('Error adding permission:', err);
        showToast(t('toast.errorTitle'), err.message || t('modal.permissions.permAddFail'), 'error');
    }
}

/**
 * Добавить право для роли (все операторы)
 */
export async function addRolePermission() {
    if (!currentMapId) return;
    
    const role = document.getElementById('operatorRoleSelect').value;

    if (!role || !['viewer', 'editor'].includes(role)) {
        showToast(t('toast.errorTitle'), t('modal.permissions.selectRoleVE'), 'warning');
        return;
    }
    
    try {
        const result = await http.post(`/api/map/${currentMapId}/permissions/role`, { role });

        if (result) {
            showToast(t('toast.successTitle'), t('modal.permissions.roleAddedForOperators', { role }), 'success');
            await loadPermissions(currentMapId);
        }
    } catch (err) {
        console.error('Error adding role permission:', err);
        showToast(t('toast.errorTitle'), err.message || t('modal.permissions.roleAddFail'), 'error');
    }
}

/**
 * Редактировать право
 */
window.editPermission = async function(permId, currentRole) {
    const newRole = prompt(t('modal.permissions.promptNewRole'), currentRole);
    if (!newRole || !['viewer', 'editor', 'admin'].includes(newRole)) {
        showToast(t('toast.errorTitle'), t('modal.permissions.invalidRole'), 'warning');
        return;
    }
    
    if (newRole === currentRole) return;
    
    try {
        const result = await http.put(`/api/map/${currentMapId}/permissions/${permId}`, { role: newRole });

        if (result) {
            showToast(t('toast.successTitle'), t('modal.permissions.roleUpdated'), 'success');
            await loadPermissions(currentMapId);
        }
    } catch (err) {
        console.error('Error updating permission:', err);
        showToast(t('toast.errorTitle'), err.message || t('modal.permissions.roleUpdateFail'), 'error');
    }
};

/**
 * Удалить право
 */
window.deletePermission = async function(permId) {
    const confirmed = await window.confirmAction({
        title: t('modal.permissions.deletePermTitle'),
        message: t('modal.permissions.deletePermMsg'),
        confirmText: t('common.delete'),
        variant: 'danger'
    });
    if (!confirmed) return;

    try {
        const result = await http.del(`/api/map/${currentMapId}/permissions/${permId}`);

        if (result) {
            showToast(t('toast.successTitle'), t('modal.permissions.permDeleted'), 'success');
            await loadPermissions(currentMapId);
        }
    } catch (err) {
        console.error('Error deleting permission:', err);
        showToast(t('toast.errorTitle'), err.message || t('modal.permissions.permDeleteFail'), 'error');
    }
};

/**
 * Получить HTML бейдж для роли
 */
function getRoleBadge(role) {
    const badges = {
        'viewer': '<span class="badge bg-info">' + t('modal.permissions.badgeViewer') + '</span>',
        'editor': '<span class="badge bg-primary">' + t('modal.permissions.badgeEditor') + '</span>',
        'admin': '<span class="badge bg-danger">' + t('modal.permissions.badgeAdmin') + '</span>',
    };
    return badges[role] || `<span class="badge bg-secondary">${role}</span>`;
}

/**
 * Переключить блокировку карты
 */
export async function toggleMapLock() {
    console.warn('toggleMapLock deprecated - use toolbar button instead');
    showToast(t('toast.infoTitle'), t('modal.permissions.lockInfo'), 'info');
}

// Экспорт глобальных функций
window.openPermissionsModal = openPermissionsModal;
window.addPermission = addPermission;
window.addRolePermission = addRolePermission;
// window.toggleMapLock = toggleMapLock;  // Убрано - дублирование
