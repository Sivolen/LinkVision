/**
 * permissions.js - Управление правами доступа к картам (v2.0)
 */

import { showToast } from '../utils/toast.js';
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
    
    container.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm"></div> Загрузка...</div>';
    
    try {
        const response = await fetch(`/api/map/${mapId}/permissions`);
        if (!response.ok) {
            throw new Error('Failed to load permissions');
        }
        
        const permissions = await response.json();
        
        if (permissions.length === 0) {
            container.innerHTML = '<p class="text-muted">Нет назначенных прав. Добавьте пользователей или роль.</p>';
            return;
        }
        
        let html = '<div class="table-responsive"><table class="table table-sm">';
        html += '<thead><tr><th>Тип</th><th>Пользователь/Роль</th><th>Роль</th><th>Действия</th></tr></thead>';
        html += '<tbody>';
        
        permissions.forEach(perm => {
            const typeLabel = perm.type === 'user' ? 'Пользователь' : 'Роль';
            const nameLabel = perm.username || (perm.role === 'editor' ? 'Все операторы (редактор)' : 'Все операторы (просмотр)');
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
        container.innerHTML = '<div class="alert alert-danger">Ошибка загрузки прав</div>';
    }
}

/**
 * Загрузить пользователей для добавления права
 */
async function loadUsersForPermission(mapId) {
    const selectEl = document.getElementById('permissionUserSelect');
    if (!selectEl) return;
    
    selectEl.innerHTML = '<option value="">Загрузка...</option>';
    
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
        selectEl.innerHTML = '<option value="">Выберите пользователя</option>';
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.username + (user.isOperator ? ' (Operator)' : '');
            selectEl.appendChild(option);
        });
        
    } catch (err) {
        console.error('Error loading users:', err);
        selectEl.innerHTML = '<option value="">Ошибка загрузки</option>';
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
        showToast('Ошибка', 'Выберите пользователя', 'warning');
        return;
    }
    
    if (!role) {
        showToast('Ошибка', 'Выберите роль', 'warning');
        return;
    }
    
    try {
        const result = await http.post(`/api/map/${currentMapId}/permissions`, {
            user_id: parseInt(userId),
            role
        });
        
        if (result) {
            showToast('Успешно', 'Право доступа добавлено', 'success');
            await loadPermissions(currentMapId);
            await loadUsersForPermission(currentMapId);
        }
    } catch (err) {
        console.error('Error adding permission:', err);
        showToast('Ошибка', err.message || 'Не удалось добавить право', 'error');
    }
}

/**
 * Добавить право для роли (все операторы)
 */
export async function addRolePermission() {
    if (!currentMapId) return;
    
    const role = document.getElementById('operatorRoleSelect').value;

    if (!role || !['viewer', 'editor'].includes(role)) {
        showToast('Ошибка', 'Выберите роль (viewer или editor)', 'warning');
        return;
    }
    
    try {
        const result = await http.post(`/api/map/${currentMapId}/permissions/role`, { role });

        if (result) {
            showToast('Успешно', `Роль ${role} добавлена для всех операторов`, 'success');
            await loadPermissions(currentMapId);
        }
    } catch (err) {
        console.error('Error adding role permission:', err);
        showToast('Ошибка', err.message || 'Не удалось добавить роль', 'error');
    }
}

/**
 * Редактировать право
 */
window.editPermission = async function(permId, currentRole) {
    const newRole = prompt('Новая роль (viewer, editor, admin):', currentRole);
    if (!newRole || !['viewer', 'editor', 'admin'].includes(newRole)) {
        showToast('Ошибка', 'Некорректная роль', 'warning');
        return;
    }
    
    if (newRole === currentRole) return;
    
    try {
        const result = await http.put(`/api/map/${currentMapId}/permissions/${permId}`, { role: newRole });

        if (result) {
            showToast('Успешно', 'Роль обновлена', 'success');
            await loadPermissions(currentMapId);
        }
    } catch (err) {
        console.error('Error updating permission:', err);
        showToast('Ошибка', err.message || 'Не удалось обновить роль', 'error');
    }
};

/**
 * Удалить право
 */
window.deletePermission = async function(permId) {
    if (!confirm('Вы уверены, что хотите удалить это право доступа?')) return;
    
    try {
        const result = await http.del(`/api/map/${currentMapId}/permissions/${permId}`);

        if (result) {
            showToast('Успешно', 'Право доступа удалено', 'success');
            await loadPermissions(currentMapId);
        }
    } catch (err) {
        console.error('Error deleting permission:', err);
        showToast('Ошибка', err.message || 'Не удалось удалить право', 'error');
    }
};

/**
 * Получить HTML бейдж для роли
 */
function getRoleBadge(role) {
    const badges = {
        'viewer': '<span class="badge bg-info">Просмотр</span>',
        'editor': '<span class="badge bg-primary">Редактор</span>',
        'admin': '<span class="badge bg-danger">Админ</span>',
    };
    return badges[role] || `<span class="badge bg-secondary">${role}</span>`;
}

/**
 * Переключить блокировку карты
 */
export async function toggleMapLock() {
    console.warn('toggleMapLock deprecated - use toolbar button instead');
    showToast('Инфо', 'Блокировка карты доступна через кнопку на панели инструментов', 'info');
}

// Экспорт глобальных функций
window.openPermissionsModal = openPermissionsModal;
window.addPermission = addPermission;
window.addRolePermission = addRolePermission;
// window.toggleMapLock = toggleMapLock;  // Убрано - дублирование
