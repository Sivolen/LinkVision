// base.js - глобальные функции для всех страниц
let connectionToast = null;
let wasDisconnected = false;

(function() {
    // Глобальные переменные (устанавливаются из шаблона)
    window.Logger = {
        enabledDebug: window.debugMode || false,
        info: function(...args) { console.log('[INFO]', ...args); },
        warn: function(...args) { console.warn('[WARN]', ...args); },
        error: function(...args) { console.error('[ERROR]', ...args); },
        debug: function(...args) { if (this.enabledDebug) console.debug('[DEBUG]', ...args); }
    };
    // ============================================================================
    // УТИЛИТА: Модальное окно подтверждения действия (Promise-based)
    // ============================================================================
    window.confirmAction = function({
        title = t('common.confirmTitle'),
        message = t('common.areYouSure'),
        confirmText = t('common.delete'),
        variant = 'danger'
    } = {}, onConfirm = null, onCancel = null) {
        let opts;
        // Поддержка старого синтаксиса: confirmAction(title, message, onConfirm, onCancel)
        if (arguments.length > 0 && typeof arguments[0] === 'string') {
            opts = {
                title: arguments[0],
                message: arguments[1] || t('common.areYouSure'),
                confirmText: t('common.delete'),
                variant: 'danger'
            };
            if (typeof arguments[2] === 'function') opts.onConfirm = arguments[2];
            if (typeof arguments[3] === 'function') opts.onCancel = arguments[3];
        } else {
            opts = { title, message, confirmText, variant };
            if (typeof onConfirm === 'function') opts.onConfirm = onConfirm;
            if (typeof onCancel === 'function') opts.onCancel = onCancel;
        }

        return new Promise((resolve) => {
            const modalEl = document.getElementById('confirmModal');
            if (!modalEl) {
                // Fallback: нативный confirm(), если модалки нет
                const confirmed = confirm(`${opts.title}\n\n${opts.message}`);
                if (confirmed && opts.onConfirm) opts.onConfirm();
                else if (!confirmed && opts.onCancel) opts.onCancel();
                resolve(confirmed);
                return;
            }

            const modalTitle = modalEl.querySelector('.modal-title');
            const modalMessage = modalEl.querySelector('.modal-body');
            const confirmBtn = modalEl.querySelector('.btn-danger');
            const cancelBtn = modalEl.querySelector('.btn-secondary');

            modalTitle.textContent = opts.title;
            modalMessage.textContent = opts.message;
            confirmBtn.textContent = opts.confirmText || t('common.delete');
            confirmBtn.className = `btn btn-${opts.variant || 'danger'}`;
            confirmBtn.disabled = false;

            const cleanup = () => {
                confirmBtn.removeEventListener('click', onConfirmClick);
                cancelBtn.removeEventListener('click', onCancelClick);
                modalEl.removeEventListener('hidden.bs.modal', onHidden);
                confirmBtn.disabled = false;
            };

            const onConfirmClick = () => {
                confirmBtn.disabled = true;
                confirmBtn.textContent = t('common.running');
                if (opts.onConfirm) {
                    const result = opts.onConfirm();
                    if (result && typeof result.finally === 'function') {
                        // Async: ждём промис
                        result.finally(() => {
                            cleanup();
                            resolve(true);
                            const modal = bootstrap.Modal.getInstance(modalEl);
                            modal?.hide();
                        });
                    } else {
                        cleanup();
                        resolve(true);
                        const modal = bootstrap.Modal.getInstance(modalEl);
                        modal?.hide();
                    }
                } else {
                    cleanup();
                    resolve(true);
                    const modal = bootstrap.Modal.getInstance(modalEl);
                    modal?.hide();
                }
            };

            const onCancelClick = () => {
                cleanup();
                resolve(false);
                const modal = bootstrap.Modal.getInstance(modalEl);
                modal?.hide();
            };

            const onHidden = () => {
                cleanup();
                resolve(false);
            };

            confirmBtn.addEventListener('click', onConfirmClick);
            cancelBtn.addEventListener('click', onCancelClick);
            modalEl.addEventListener('hidden.bs.modal', onHidden);

            const modal = new bootstrap.Modal(modalEl);
            modal.show();
        });
    };
    window.getCsrfToken = function() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    };

    window.showToast = function(title, message, type = 'success', options = {}) {
        const toastEl = document.getElementById('liveToast');
        if (!toastEl) {
            console.log(`[${type}] ${title}: ${message}`);
            if (type === 'error') alert(title + ': ' + message);
            return null;
        }
        const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: options.autoHide === false ? 0 : 3500 });
        document.getElementById('toastTitle').textContent = title;
        document.getElementById('toastMessage').textContent = message;
        document.getElementById('toastTime').textContent = t('common.justNow');
        const icon = document.getElementById('toastIcon');
        const header = toastEl.querySelector('.toast-header');
        if (type === 'error') {
            if (icon) icon.className = 'fas fa-exclamation-circle text-danger me-2';
            if (header) header.style.borderLeft = '4px solid #ef4444';
        } else if (type === 'info') {
            if (icon) icon.className = 'fas fa-info-circle text-info me-2';
            if (header) header.style.borderLeft = '4px solid #3b82f6';
        } else {
            if (icon) icon.className = 'fas fa-check-circle text-success me-2';
            if (header) header.style.borderLeft = '4px solid #22c55e';
        }
        toast.show();
        return toast;
    };

    window.getErrorMessage = async function(response) {
        try {
            const data = await response.clone().json();
            return data.error || t('toast.httpError', { status: response.status, statusText: response.statusText });
        } catch (e) {
            try {
                const text = await response.clone().text();
                if (text) return text;
            } catch (e2) {}
            return t('toast.httpError', { status: response.status, statusText: response.statusText });
        }
    };

    window.updateBackendStatus = function(isConnected) {
        const dot = document.getElementById('backend-status-dot');
        const text = document.getElementById('backend-status-text');
        if (!dot || !text) return;
        if (isConnected) {
            dot.className = 'status-dot online';
            text.textContent = t('connection.serverUp');
        } else {
            dot.className = 'status-dot offline';
            text.textContent = t('connection.serverDown');
        }
    };

    window.toggleSidebar = function() {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebarToggle');
        sidebar.classList.toggle('collapsed');
        const icon = toggle.querySelector('i');
        if (sidebar.classList.contains('collapsed')) {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-chevron-right');
        } else {
            icon.classList.remove('fa-chevron-right');
            icon.classList.add('fa-bars');
        }
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    };

    window.toggleTheme = function() {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        const icon = document.querySelector('.theme-toggle i');
        if (newTheme === 'dark') {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        } else {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }
        if (typeof updateGroupLabelColor === 'function') {
            updateGroupLabelColor();
        }
    };

    window.toggleMobileSidebar = function() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.toggle('show');
        }
    };

    // ─── Дерево сайдбара (папки + карты) ───────────────────────────────────

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    function getExpandedFolderIds() {
        try {
            const raw = localStorage.getItem('sidebarExpandedFolders');
            return new Set(raw ? JSON.parse(raw) : []);
        } catch (e) {
            return new Set();
        }
    }

    function setExpandedFolderIds(set) {
        localStorage.setItem('sidebarExpandedFolders', JSON.stringify(Array.from(set)));
    }

    // Плоский индекс папок последнего загруженного дерева — используется для
    // заполнения select'а "переместить в папку", чтобы не делать отдельный
    // запрос ради одного списка имён.
    let lastSidebarTree = null;

    function flattenFolders(node, depth, out) {
        (node.folders || []).forEach(folder => {
            out.push({ id: folder.id, name: folder.name, depth });
            flattenFolders(folder, depth + 1, out);
        });
    }

    function buildMapElement(map, depth) {
        const isActive = window.currentMapId && window.currentMapId == map.id;
        const currentUserId = window.currentUserId || 0;
        const isAdmin = window.isAdmin || false;
        const canManage = map.owner_id == currentUserId || isAdmin;
        let actionsHtml = '';
        if (canManage) {
            const safeName = escapeHtml(map.name).replace(/'/g, "\'");
            actionsHtml = `
                <button class="btn-map-action" onclick="editMap(event, ${map.id}, '${safeName}')" title="${escapeHtml(t('contextMenu.edit') || 'Edit')}">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-map-action" onclick="moveMapPrompt(event, ${map.id}, '${safeName}')" title="${escapeHtml(t('sidebar.moveToFolder') || 'Move')}">
                    <i class="fas fa-folder-open"></i>
                </button>
                <button class="btn-map-action" onclick="deleteMap(event, ${map.id})" title="${escapeHtml(t('common.delete') || 'Delete')}">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        }
        const badgeHtml = map.down_count > 0 ? `<span class="badge bg-danger">${map.down_count}</span>` : '';
        const li = document.createElement('li');
        li.innerHTML = `
            <a href="/map/${map.id}" class="map-item ${isActive ? 'active' : ''}" style="padding-left: ${12 + depth * 16}px">
                <span class="map-item-icon"><i class="fas fa-map-marked-alt"></i></span>
                <span class="map-item-name">${escapeHtml(map.name)}</span>
                <div class="map-item-right">
                    <div class="map-item-actions">${actionsHtml}</div>
                    ${badgeHtml}
                </div>
            </a>
        `;
        return li;
    }

    function buildFolderElement(folder, depth, expandedIds) {
        const currentUserId = window.currentUserId || 0;
        const isAdmin = window.isAdmin || false;
        const canManage = folder.owner_id == currentUserId || isAdmin;
        const isExpanded = expandedIds.has(folder.id);

        const li = document.createElement('li');
        li.className = 'folder-item-wrapper';

        const row = document.createElement('div');
        row.className = 'map-item folder-item';
        row.style.paddingLeft = `${12 + depth * 16}px`;

        let actionsHtml = '';
        if (canManage) {
            const safeName = escapeHtml(folder.name).replace(/'/g, "\'");
            actionsHtml = `
                <button class="btn-map-action" onclick="renameFolderPrompt(event, ${folder.id}, '${safeName}')" title="${escapeHtml(t('contextMenu.edit') || 'Rename')}">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-map-action" onclick="openFolderPermissionsModal(event, ${folder.id}, '${safeName}')" title="${escapeHtml(t('sidebar.folderPermissions') || 'Permissions')}">
                    <i class="fas fa-user-shield"></i>
                </button>
                <button class="btn-map-action" onclick="deleteFolderPrompt(event, ${folder.id}, '${safeName}')" title="${escapeHtml(t('common.delete') || 'Delete')}">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        }
        const badgeHtml = folder.down_count > 0 ? `<span class="badge bg-danger">${folder.down_count}</span>` : '';

        row.innerHTML = `
            <span class="map-item-icon folder-toggle-icon"><i class="fas fa-chevron-${isExpanded ? 'down' : 'right'}"></i></span>
            <span class="map-item-icon"><i class="fas fa-folder${isExpanded ? '-open' : ''}"></i></span>
            <span class="map-item-name">${escapeHtml(folder.name)}</span>
            <div class="map-item-right">
                <div class="map-item-actions">${actionsHtml}</div>
                ${badgeHtml}
            </div>
        `;
        row.addEventListener('click', () => window.toggleSidebarFolder(folder.id));
        li.appendChild(row);

        const childrenUl = document.createElement('ul');
        childrenUl.className = 'map-list folder-children';
        if (!isExpanded) childrenUl.style.display = 'none';
        renderSidebarNode(childrenUl, folder, depth + 1, expandedIds);
        li.appendChild(childrenUl);

        return li;
    }

    function renderSidebarNode(container, node, depth, expandedIds) {
        (node.folders || []).forEach(folder => {
            container.appendChild(buildFolderElement(folder, depth, expandedIds));
        });
        (node.maps || []).forEach(map => {
            container.appendChild(buildMapElement(map, depth));
        });
    }

    window.toggleSidebarFolder = function(folderId) {
        const expanded = getExpandedFolderIds();
        if (expanded.has(folderId)) {
            expanded.delete(folderId);
        } else {
            expanded.add(folderId);
        }
        setExpandedFolderIds(expanded);
        window.loadSidebarMaps();
    };

    window.loadSidebarMaps = function() {
        fetch('/api/sidebar-tree', { cache: 'no-store' })
            .then(res => res.ok ? res.json() : { folders: [], maps: [] })
            .then(tree => {
                lastSidebarTree = tree;
                const list = document.getElementById('sidebarMapList');
                if (!list) return;
                list.innerHTML = '';
                renderSidebarNode(list, tree, 0, getExpandedFolderIds());
            })
            .catch(err => Logger.error('Error loading sidebar tree:', err));
    };

    // ─── CRUD папок ─────────────────────────────────────────────────────────

    // Одна модалка на создание И переименование — отличаются только заголовком
    // и тем, какой запрос уходит по подтверждению (см. confirmFolderNameModal).
    let folderNameModalMode = null;     // 'create' | 'rename'
    let folderNameModalContext = null;  // parentId для create, folderId для rename

    function openFolderNameModal(mode, context, titleKey, titleFallback, initialValue) {
        folderNameModalMode = mode;
        folderNameModalContext = context;

        const titleEl = document.getElementById('folderNameModalTitle');
        if (titleEl) titleEl.textContent = t(titleKey) || titleFallback;

        const input = document.getElementById('folderNameInput');
        if (input) input.value = initialValue || '';

        const modalEl = document.getElementById('folderNameModal');
        if (!modalEl) return;
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
        modalEl.addEventListener('shown.bs.modal', () => {
            if (input) {
                input.focus();
                input.select();
            }
        }, { once: true });
    }

    window.createFolderPrompt = function(parentId) {
        openFolderNameModal('create', parentId, 'sidebar.newFolderTitle', 'New folder', '');
    };

    window.renameFolderPrompt = function(event, folderId, currentName) {
        event.stopPropagation();
        openFolderNameModal('rename', folderId, 'sidebar.renameFolderTitle', 'Rename folder', currentName);
    };

    window.confirmFolderNameModal = function() {
        const input = document.getElementById('folderNameInput');
        const name = input ? input.value.trim() : '';
        if (!name) {
            showToast(t('toast.errorTitle'), t('sidebar.folderNameRequired') || 'Folder name is required', 'warning');
            return;
        }

        const modalEl = document.getElementById('folderNameModal');
        const closeModal = () => {
            const inst = modalEl && bootstrap.Modal.getInstance(modalEl);
            if (inst) inst.hide();
        };

        if (folderNameModalMode === 'create') {
            const parentId = folderNameModalContext;
            fetch('/api/folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ name, parent_id: parentId }),
            })
                .then(async res => {
                    if (!res.ok) throw new Error(await window.getErrorMessage(res));
                    closeModal();
                    if (parentId) {
                        const expanded = getExpandedFolderIds();
                        expanded.add(parentId);
                        setExpandedFolderIds(expanded);
                    }
                    window.loadSidebarMaps();
                })
                .catch(err => showToast(t('toast.errorTitle'), err.message, 'error'));
        } else if (folderNameModalMode === 'rename') {
            fetch(`/api/folder/${folderNameModalContext}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ name }),
            })
                .then(async res => {
                    if (!res.ok) throw new Error(await window.getErrorMessage(res));
                    closeModal();
                    window.loadSidebarMaps();
                })
                .catch(err => showToast(t('toast.errorTitle'), err.message, 'error'));
        }
    };

    // Enter в поле ввода = подтвердить, как обычно ждут от диалога с одним полем
    document.addEventListener('DOMContentLoaded', () => {
        const input = document.getElementById('folderNameInput');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    window.confirmFolderNameModal();
                }
            });
        }
    });

    window.deleteFolderPrompt = function(event, folderId, folderName) {
        event.stopPropagation();
        confirmAction(
            t('sidebar.deleteFolderTitle') || 'Delete folder',
            t('sidebar.deleteFolderConfirm', { name: folderName }) || `Delete folder "${folderName}"?`,
            () => {
                fetch(`/api/folder/${folderId}`, { method: 'DELETE', headers: { 'X-CSRFToken': getCsrfToken() } })
                    .then(async res => {
                        if (res.status === 409) {
                            // Папка не пуста — уточняем, действительно ли переносить
                            // содержимое в корень, а не молча отказывать.
                            confirmAction(
                                t('sidebar.deleteFolderTitle') || 'Delete folder',
                                t('sidebar.deleteFolderCascadeConfirm', { name: folderName })
                                    || `Folder "${folderName}" is not empty. Delete it anyway? Maps inside will be moved to the root, subfolders will be removed as well (maps in them are also just moved to root, not deleted).`,
                                () => {
                                    fetch(`/api/folder/${folderId}?cascade=true`, { method: 'DELETE', headers: { 'X-CSRFToken': getCsrfToken() } })
                                        .then(async res2 => {
                                            if (!res2.ok) throw new Error(await window.getErrorMessage(res2));
                                            window.loadSidebarMaps();
                                        })
                                        .catch(err => showToast(t('toast.errorTitle'), err.message, 'error'));
                                }
                            );
                            return;
                        }
                        if (!res.ok) throw new Error(await window.getErrorMessage(res));
                        window.loadSidebarMaps();
                    })
                    .catch(err => showToast(t('toast.errorTitle'), err.message, 'error'));
            }
        );
    };

    // ─── Перемещение карты между папками ───────────────────────────────────

    let moveMapTargetId = null;

    window.moveMapPrompt = function(event, mapId, mapName) {
        event.preventDefault();
        event.stopPropagation();
        moveMapTargetId = mapId;

        const label = document.getElementById('moveMapLabel');
        if (label) label.textContent = mapName;

        const select = document.getElementById('moveMapFolderSelect');
        if (select && lastSidebarTree) {
            select.innerHTML = '<option value="">' + (t('sidebar.rootNoFolder') || '— Root (no folder) —') + '</option>';
            const flat = [];
            flattenFolders(lastSidebarTree, 0, flat);
            flat.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.id;
                opt.textContent = '\u00A0\u00A0'.repeat(f.depth) + f.name;
                select.appendChild(opt);
            });
        }

        const modalEl = document.getElementById('moveMapModal');
        if (modalEl) new bootstrap.Modal(modalEl).show();
    };

    window.confirmMoveMap = function() {
        if (!moveMapTargetId) return;
        const select = document.getElementById('moveMapFolderSelect');
        const folderId = select && select.value ? parseInt(select.value) : null;

        fetch(`/api/map/${moveMapTargetId}/folder`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() }, body: JSON.stringify({ folder_id: folderId }) })
            .then(async res => {
                if (!res.ok) throw new Error(await window.getErrorMessage(res));
                const modalEl = document.getElementById('moveMapModal');
                if (modalEl) {
                    const inst = bootstrap.Modal.getInstance(modalEl);
                    if (inst) inst.hide();
                }
                if (folderId) {
                    const expanded = getExpandedFolderIds();
                    expanded.add(folderId);
                    setExpandedFolderIds(expanded);
                }
                window.loadSidebarMaps();
            })
            .catch(err => showToast(t('toast.errorTitle'), err.message, 'error'));
    };

    // ─── Права на папку ─────────────────────────────────────────────────────

    let currentFolderPermissionsId = null;

    window.openFolderPermissionsModal = function(event, folderId, folderName) {
        event.stopPropagation();
        currentFolderPermissionsId = folderId;

        const nameEl = document.getElementById('folderPermissionsFolderName');
        if (nameEl) nameEl.textContent = folderName;

        loadFolderPermissions(folderId);
        loadUsersForFolderPermission();

        const modalEl = document.getElementById('folderPermissionsModal');
        if (modalEl) new bootstrap.Modal(modalEl).show();
    };

    function getRoleBadge(role) {
        const badges = {
            viewer: '<span class="badge bg-info">' + (t('modal.permissions.badgeViewer') || 'Viewer') + '</span>',
            editor: '<span class="badge bg-primary">' + (t('modal.permissions.badgeEditor') || 'Editor') + '</span>',
            admin: '<span class="badge bg-danger">' + (t('modal.permissions.badgeAdmin') || 'Admin') + '</span>',
        };
        return badges[role] || `<span class="badge bg-secondary">${escapeHtml(role)}</span>`;
    }

    function loadFolderPermissions(folderId) {
        const container = document.getElementById('folderPermissionsList');
        if (!container) return;
        container.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm"></div></div>';

        fetch(`/api/folder/${folderId}/permissions`)
            .then(res => res.ok ? res.json() : [])
            .then(permissions => {
                if (!permissions.length) {
                    container.innerHTML = '<p class="text-muted">' + (t('modal.permissions.noPerms') || 'No permissions yet') + '</p>';
                    return;
                }
                let html = '<div class="table-responsive"><table class="table table-sm"><tbody>';
                permissions.forEach(perm => {
                    const nameLabel = perm.username || (perm.role === 'editor'
                        ? (t('modal.permissions.allOperatorsEditor') || 'All operators (editor)')
                        : (t('modal.permissions.allOperatorsViewer') || 'All operators (viewer)'));
                    html += `<tr>
                        <td>${escapeHtml(nameLabel)}</td>
                        <td>${getRoleBadge(perm.role)}</td>
                        <td class="text-end">
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteFolderPermission(${perm.id})">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>`;
                });
                html += '</tbody></table></div>';
                container.innerHTML = html;
            })
            .catch(err => {
                container.innerHTML = '<div class="alert alert-danger">' + err.message + '</div>';
            });
    }

    function loadUsersForFolderPermission() {
        const select = document.getElementById('folderPermissionUserSelect');
        if (!select) return;
        select.innerHTML = '<option value="">' + t('common.loading') + '</option>';

        // Тот же приём, что и в permissions.js для карт: страница /admin/users
        // рендерит обычную HTML-таблицу пользователей, парсим её вместо
        // отдельного JSON API (которого для списка пользователей сейчас нет).
        fetch('/admin/users')
            .then(res => res.text())
            .then(html => {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const rows = doc.querySelectorAll('table tbody tr');
                select.innerHTML = '<option value="">' + (t('modal.permissions.selectUser') || 'Select user') + '</option>';
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 6) return;
                    const isAdminCell = cells[2];
                    if (isAdminCell.querySelector('.bg-success')) return; // пропускаем админов
                    const userId = parseInt(cells[0].textContent.replace('#', '').trim());
                    const username = cells[1].textContent.trim();
                    const isOperator = cells[3].querySelector('.bg-info') !== null;
                    const option = document.createElement('option');
                    option.value = userId;
                    option.textContent = username + (isOperator ? ' (Operator)' : '');
                    select.appendChild(option);
                });
            })
            .catch(() => {
                select.innerHTML = '<option value="">' + t('common.loadError') + '</option>';
            });
    }

    window.addFolderPermission = function() {
        if (!currentFolderPermissionsId) return;
        const userId = document.getElementById('folderPermissionUserSelect').value;
        const role = document.getElementById('folderPermissionRoleSelect').value;
        if (!userId) {
            showToast(t('toast.errorTitle'), t('modal.permissions.selectUser'), 'warning');
            return;
        }
        fetch(`/api/folder/${currentFolderPermissionsId}/permissions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() }, body: JSON.stringify({ user_id: parseInt(userId), role }) })
            .then(async res => {
                if (!res.ok) throw new Error(await window.getErrorMessage(res));
                loadFolderPermissions(currentFolderPermissionsId);
                loadUsersForFolderPermission();
                window.loadSidebarMaps();
            })
            .catch(err => showToast(t('toast.errorTitle'), err.message, 'error'));
    };

    window.addFolderRolePermission = function() {
        if (!currentFolderPermissionsId) return;
        const role = document.getElementById('folderOperatorRoleSelect').value;
        fetch(`/api/folder/${currentFolderPermissionsId}/permissions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() }, body: JSON.stringify({ role }) })
            .then(async res => {
                if (!res.ok) throw new Error(await window.getErrorMessage(res));
                loadFolderPermissions(currentFolderPermissionsId);
                window.loadSidebarMaps();
            })
            .catch(err => showToast(t('toast.errorTitle'), err.message, 'error'));
    };

    window.deleteFolderPermission = function(permId) {
        if (!currentFolderPermissionsId) return;
        fetch(`/api/folder/${currentFolderPermissionsId}/permissions/${permId}`, { method: 'DELETE', headers: { 'X-CSRFToken': getCsrfToken() } })
            .then(async res => {
                if (!res.ok) throw new Error(await window.getErrorMessage(res));
                loadFolderPermissions(currentFolderPermissionsId);
                window.loadSidebarMaps();
            })
            .catch(err => showToast(t('toast.errorTitle'), err.message, 'error'));
    };

    window.deleteMap = function(event, mapId) {
        event.preventDefault();
        event.stopPropagation();
        confirmAction(t('map.deleteTitle'), t('map.deleteConfirm'), () => {
            window.setSkipNextMapUpdate();
            fetch(`/api/map/${mapId}`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': getCsrfToken() }
            })
            .then(async res => {
                if (res.ok) {
                    if (window.currentMapId == mapId) {
                        window.location.href = '/';
                        return;
                    }
                    const mapItemElement = document.querySelector(`.map-item[href="/map/${mapId}"]`);
                    if (mapItemElement) {
                        const li = mapItemElement.closest('li');
                        if (li) li.remove();
                    }
                    showToast(t('toast.successTitle'), t('map.deleted'), 'success');
                } else {
                    const errorMsg = await getErrorMessage(res);
                    showToast(t('toast.errorTitle'), errorMsg, 'error');
                }
            })
            .catch(err => {
                Logger.error('Error deleting map:', err);
                showToast(t('toast.errorTitle'), t('map.deleteFailed'), 'error');
            })
            .finally(() => window.clearSkipNextMapUpdate());
        });
    };

    window.editMap = function(event, mapId, mapName) {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('edit_map_id').value = mapId;
        document.getElementById('edit_map_name').value = mapName;
        document.getElementById('edit_map_background').value = '';
        document.getElementById('edit_map_remove_bg').checked = false;
        const modal = new bootstrap.Modal(document.getElementById('editMapModal'));
        modal.show();
    };

    window.importMapNew = function() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(ev) {
                try {
                    const data = JSON.parse(ev.target.result);
                    data.id = null;
                    window.setSkipNextMapUpdate();
                    fetch('/api/map/import', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCsrfToken()
                        },
                        body: JSON.stringify(data)
                    })
                    .then(async res => {
                        if (!res.ok) {
                            const errorMsg = await getErrorMessage(res);
                            throw new Error(errorMsg);
                        }
                        return res.json();
                    })
                    .then(result => {
                        alert(t('importExport.done'));
                        if (result.id) {
                            window.location.href = `/map/${result.id}`;
                        } else {
                            location.reload();
                        }
                    })
                    .catch(err => {
                        Logger.error(err);
                        alert(err.message || t('importExport.error'));
                    })
                    .finally(() => window.clearSkipNextMapUpdate());
                } catch (ex) {
                    alert(t('importExport.badJson'));
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    // Инициализация при загрузке DOM
    document.addEventListener('DOMContentLoaded', function() {
        // Глобальный обработчик для data-confirm-delete (замена confirm())
        document.addEventListener('submit', async function(e) {
            const form = e.target;
            const confirmBtn = form.querySelector('[data-confirm-delete]');
            if (!confirmBtn) return;

            e.preventDefault();
            const action = confirmBtn.getAttribute('data-confirm-delete');
            const label = t(`confirmDelete.labels.${action}`);
            // t() вернёт сам ключ, если метки нет — тогда падаем на «элемент»
            const safeLabel = label.startsWith('confirmDelete.') ? t('common.element') : label;
            const confirmed = await window.confirmAction({
                title: t('confirmDelete.title'),
                message: t('confirmDelete.message', { label: safeLabel }),
                confirmText: t('common.delete'),
                variant: 'danger'
            });
            if (!confirmed) return;

            // Восстанавливаем обработчик и отправляем форму
            form.removeEventListener('submit', arguments.callee);
            form.submit();
        });

        // Ширина сайдбара из localStorage + перетаскиваемый сплиттер
        (function setupSidebarResizer() {
            const MIN = 200, MAX = 480, KEY = 'sidebarWidth';
            const root = document.documentElement;

            const saved = parseInt(localStorage.getItem(KEY), 10);
            if (saved && saved >= MIN && saved <= MAX) {
                root.style.setProperty('--sidebar-width', saved + 'px');
            }

            const sidebar = document.getElementById('sidebar');
            const resizer = document.getElementById('sidebarResizer');
            if (!sidebar || !resizer) return;

            let dragging = false;

            const onMove = (e) => {
                if (!dragging) return;
                const w = Math.max(200, Math.min(800, e.clientX));
                root.style.setProperty('--sidebar-width', w + 'px');
            };
            const onUp = () => {
                if (!dragging) return;
                dragging = false;
                resizer.classList.remove('dragging');
                document.body.classList.remove('resizing-sidebar');
                const px = parseInt(getComputedStyle(root).getPropertyValue('--sidebar-width'), 10);
                if (px) localStorage.setItem(KEY, px);
            };

            resizer.addEventListener('pointerdown', (e) => {
                if (sidebar.classList.contains('collapsed')) return; // свёрнутый не тянем
                dragging = true;
                resizer.setPointerCapture(e.pointerId);
                resizer.classList.add('dragging');
                document.body.classList.add('resizing-sidebar');
                e.preventDefault();
            });
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);

            // Двойной клик по ручке — сброс к ширине по умолчанию
            resizer.addEventListener('dblclick', () => {
                root.style.removeProperty('--sidebar-width');
                localStorage.removeItem(KEY);
            });
        })();

        // Кастомный тултип с названием карты, когда сайдбар свёрнут
        // (названия скрыты, показываем их по наведению рядом с пунктом).
        (function setupCollapsedMapTooltip() {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            let tip = null;

            const hide = () => { if (tip) tip.classList.remove('visible'); };

            sidebar.addEventListener('mouseover', (e) => {
                if (!sidebar.classList.contains('collapsed')) return;
                const item = e.target.closest('.map-item');
                if (!item) return;
                const nameEl = item.querySelector('.map-item-name');
                const name = (nameEl ? nameEl.textContent : item.textContent).trim();
                if (!name) return;
                if (!tip) {
                    tip = document.createElement('div');
                    tip.className = 'sidebar-tooltip';
                    document.body.appendChild(tip);
                }
                tip.textContent = name;
                const r = item.getBoundingClientRect();
                tip.style.top = (r.top + r.height / 2) + 'px';
                tip.style.left = (r.right + 12) + 'px';
                tip.classList.add('visible');
            });
            sidebar.addEventListener('mouseout', (e) => {
                const item = e.target.closest('.map-item');
                if (!item) return;
                // Не прячем, пока курсор переходит между внутренними элементами
                // того же пункта (иначе тултип мигает при движении по иконке/тексту).
                if (e.relatedTarget && item.contains(e.relatedTarget)) return;
                hide();
            });
            // Прячем при уходе курсора из сайдбара. (Раньше был transitionend на
            // сайдбаре — он ловил анимацию :hover самого пункта и прятал тултип
            // сразу после показа.)
            sidebar.addEventListener('mouseleave', hide);
        })();

        const savedSidebar = localStorage.getItem('sidebarCollapsed');
        if (savedSidebar === 'true') {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.add('collapsed');
                const icon = document.querySelector('#sidebarToggle i');
                if (icon) {
                    icon.classList.remove('fa-bars');
                    icon.classList.add('fa-chevron-right');
                }
            }
        }
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        if (savedTheme === 'dark') {
            const icon = document.querySelector('.theme-toggle i');
            if (icon) {
                icon.classList.remove('fa-moon');
                icon.classList.add('fa-sun');
            }
        }
        if (document.getElementById('sidebar') && typeof loadSidebarMaps === 'function') {
            loadSidebarMaps();
        }
        const sidebar = document.getElementById('sidebar');
        const toggleIcon = document.querySelector('.sidebar-toggle i');
        if (sidebar && toggleIcon) {
            if (sidebar.classList.contains('collapsed')) {
                toggleIcon.classList.remove('fa-bars');
                toggleIcon.classList.add('fa-chevron-right');
            } else {
                toggleIcon.classList.remove('fa-chevron-right');
                toggleIcon.classList.add('fa-bars');
            }
        }
        setInterval(() => {
        fetch('/api/maps', {
                method: 'GET',
                headers: { 'X-CSRFToken': getCsrfToken() }
            }).catch(() => {});
        }, 5 * 60 * 1000);
    });

    // Инициализация сокета (только для авторизованных)
    if (window.currentUserId !== undefined && window.currentUserId !== null) {
        (function initGlobalSocket() {
            if (window.socket) return;
            window.socket = io({
                reconnection: true,
                reconnectionDelay: 5000,
                reconnectionDelayMax: 10000,
                reconnectionAttempts: 5
            });
            window.socket.on('connect', () => {
                if (window.debugMode) Logger.info('Socket connected (global)');
                if (window.currentMapId) {
                    window.socket.emit('join_room', `map_${window.currentMapId}`);
                }
                updateBackendStatus(true);
                if (wasDisconnected) {
                    if (connectionToast) connectionToast.hide();
                    connectionToast = showToast(t('connection.restoredTitle'), t('connection.restoredMsg'), 'success', { autoHide: 3000 });
                    wasDisconnected = false;
                }
            });
            window.socket.on('disconnect', (reason) => {
                Logger.debug('Socket disconnected (global):', reason);
                updateBackendStatus(false);
                if (!connectionToast) {
                    connectionToast = showToast(t('connection.lostTitle'), t('connection.lostMsg'), 'error', { autoHide: false });
                    wasDisconnected = true;
                }
            });
            window.socket.on('reconnect', (attemptNumber) => {
                if (window.debugMode) Logger.info('Socket reconnected after', attemptNumber, 'attempts');
                if (window.currentMapId) {
                    window.socket.emit('join_room', `map_${window.currentMapId}`);
                    window.socket.emit('request_status', { map_id: window.currentMapId });
                }
                updateBackendStatus(true);
                if (wasDisconnected) {
                    if (connectionToast) connectionToast.hide();
                    connectionToast = showToast(t('connection.restoredTitle'), t('connection.restoredMsg'), 'success', { autoHide: 3000 });
                    wasDisconnected = false;
                }
            });
            window.socket.on('connect_error', (error) => {
                Logger.warn('Socket connection error:', error);
                updateBackendStatus(false);
            });
        })();
    }
})();
// Обработчик формы редактирования карты
const editMapForm = document.getElementById('editMapForm');
if (editMapForm) {
    editMapForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const mapId = document.getElementById('edit_map_id').value;
        const name = document.getElementById('edit_map_name').value;
        const fileInput = document.getElementById('edit_map_background');
        const removeBg = document.getElementById('edit_map_remove_bg').checked;

        const formData = new FormData();
        formData.append('name', name);
        if (fileInput.files[0]) {
            formData.append('background', fileInput.files[0]);
        }
        if (removeBg) {
            formData.append('remove_background', 'true');
        }
        window.setSkipNextMapUpdate();
        fetch(`/api/map/${mapId}`, {
            method: 'PUT',
            headers: {
                'X-CSRFToken': getCsrfToken()
            },
            body: formData
        })
        .then(async res => {
            if (!res.ok) {
                const errorMsg = await getErrorMessage(res);
                throw new Error(errorMsg);
            }
            return res.json();
        })
        .then(data => {
            const mapItem = document.querySelector(`.map-item[href="/map/${mapId}"] .map-item-name`);
            if (mapItem) mapItem.textContent = data.name;
            if (window.currentMapId == mapId) {
                // Обновляем фон (если он изменился)
                if (typeof window.updateMapBackground === 'function') {
                    window.updateMapBackground(data.background);
                }
                // Перезагружаем все элементы карты (устройства, связи)
                if (typeof window.reloadMapElements === 'function') {
                    window.reloadMapElements();
                }
            }
            // Null-check: модалка может быть не инициализирована
            const editMapModalEl = document.getElementById('editMapModal');
            (bootstrap.Modal.getInstance(editMapModalEl) ?? new bootstrap.Modal(editMapModalEl)).hide();
            showToast(t('toast.successTitle'), t('map.updated'), 'success');
        })
        .catch(err => {
            Logger.error(err);
            showToast(t('toast.errorTitle'), err.message || t('map.saveError'), 'error');
        })
        .finally(() => window.clearSkipNextMapUpdate());
    });
}