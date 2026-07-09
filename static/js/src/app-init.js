// app-init.js – читает data-* атрибуты и устанавливает window.*

// ── i18n-рантайм ──────────────────────────────────────────────────────────
// Определяет window.t()/window.getLocale() из словаря, который сервер
// инъектирует в window.__I18N__ ДО этого скрипта (см. base.html). Плоский
// скрипт (не модуль) — грузится раньше base.min.js и бандлов, поэтому t()
// доступен и глобальному base.js, и ES-модулям (через тонкую i18n/i18n.js).
(function () {
    'use strict';

    var I18N = window.__I18N__ || {};
    var messages = I18N.messages || {};
    var fallback = I18N.fallback || messages;   // ru как fallback (см. сервер)

    function resolve(dict, key) {
        var parts = key.split('.');
        var acc = dict;
        for (var i = 0; i < parts.length; i++) {
            if (acc == null) return undefined;
            acc = acc[parts[i]];
        }
        return acc;
    }

    // t('map.deleted') -> "Карта удалена"
    // t('confirmDelete.message', { label: '...' }) -> подстановка {label}
    // Ключ не найден ни в текущем словаре, ни в fallback -> возвращаем сам ключ
    // (сразу видно в UI, легко найти при переводе).
    window.t = function (key, params) {
        var val = resolve(messages, key);
        if (val === undefined) val = resolve(fallback, key);
        if (typeof val !== 'string') return key;
        if (!params) return val;
        return val.replace(/\{(\w+)\}/g, function (whole, name) {
            return Object.prototype.hasOwnProperty.call(params, name)
                ? String(params[name])
                : whole;
        });
    };

    window.getLocale = function () { return I18N.locale || 'ru'; };
})();

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
