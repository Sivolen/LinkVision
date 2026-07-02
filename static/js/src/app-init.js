// app-init.js – читает data-* атрибуты и устанавливает window.*
(function () {
    'use strict';

    var body = document.body;
    if (!body) return;

    // Данные пользователя (из base.html body data-*)
    var userId = body.dataset.userId;
    window.currentUserId = userId ? Number(userId) : null;
    window.isAdmin = body.dataset.isAdmin === 'true';
    window.isOperator = body.dataset.isOperator === 'true';
    window.debugMode = body.dataset.debugMode === 'true';

    // Карта: data-map-id может быть установлен позже (в map_view.html)
    var mapId = body.dataset.mapId;
    if (mapId) {
        window.currentMapId = Number(mapId);
    }
})();
