"""
Регресс-тесты мультиязычности (i18n).

Фаза 1 (бэкенд + пилот login.html):
- по умолчанию интерфейс на русском (msgid = русский текст);
- ?lang=en реально переключает рендер на английские переводы из каталога Babel;
- выбор языка сохраняется в сессии, а для авторизованного — в User.locale;
- невалидный код языка откатывается на дефолт.

Фаза 2 (JS-контур):
- сервер синхронно инъектирует словарь фронтенда в window.__I18N__ по текущей
  локали + ru как fallback (никакого fetch на клиенте).
"""


def _login(client, app, username):
    """Логиним пользователя через сессию (без формы)."""
    from models import User

    with app.app_context():
        uid = User.query.filter_by(username=username).first().id
    with client.session_transaction() as sess:
        sess["_user_id"] = str(uid)
        sess["_fresh"] = True
    return uid


# ПРИМЕЧАНИЕ по тестам локали: conftest держит app_context открытым на всё время
# фикстуры, а Flask-Babel кэширует выбранную локаль на текущем контексте. Поэтому
# в ОДНОМ тесте считается только ПЕРВАЯ локаль-определяющая отрисовка — все проверки
# рендера делаем одним запросом на тест (в проде каждый запрос — свой контекст).


class TestLocaleSelection:
    def test_default_locale_is_russian(self, client):
        resp = client.get("/auth/login")
        html = resp.get_data(as_text=True)
        assert resp.status_code == 200
        assert 'lang="ru"' in html
        assert 'data-locale="ru"' in html  # для фронтенда (Фаза 2)
        assert "Вход в систему" in html  # русский msgid показывается как есть

    def test_lang_query_param_switches_to_english(self, client):
        resp = client.get("/auth/login?lang=en")
        html = resp.get_data(as_text=True)
        assert resp.status_code == 200
        assert 'lang="en"' in html
        assert 'data-locale="en"' in html
        # Переводы из translations/en/LC_MESSAGES/messages.mo
        assert "Sign in" in html
        assert "Enter username" in html
        assert "Вход в систему" not in html


class TestSetLanguageRoute:
    def test_set_language_persists_in_session(self, client):
        client.post("/set-language/en", data={}, follow_redirects=False)
        with client.session_transaction() as sess:
            assert sess["locale"] == "en"
        # и последующий рендер уже английский
        assert "Sign in" in client.get("/auth/login").get_data(as_text=True)

    def test_invalid_lang_falls_back_to_default(self, client):
        client.post("/set-language/xx", data={})
        with client.session_transaction() as sess:
            assert sess["locale"] == "ru"

    def test_switch_back_to_russian(self, client):
        client.post("/set-language/en", data={})
        client.post("/set-language/ru", data={})
        assert "Вход в систему" in client.get("/auth/login").get_data(as_text=True)

    def test_next_redirect_is_local_only(self, client):
        # next на внешний хост игнорируется — редирект на дашборд
        resp = client.post(
            "/set-language/en",
            data={"next": "https://evil.example/phish"},
            follow_redirects=False,
        )
        assert resp.status_code in (301, 302)
        assert "evil.example" not in resp.headers.get("Location", "")


class TestUserLocalePersistence:
    def test_authenticated_user_locale_saved_to_db(self, client, app):
        _login(client, app, "testuser")
        client.post("/set-language/en", data={})

        from models import User

        with app.app_context():
            user = User.query.filter_by(username="testuser").first()
            assert user.locale == "en"

    def test_db_locale_used_when_no_session_override(self, client, app):
        # Пользователю с locale='en' в БД отдаём английский без ?lang и без session.
        # Авторизованного /auth/login редиректит на дашборд — идём по редиректу.
        from extensions import db
        from models import User

        _login(client, app, "testuser")
        with app.app_context():
            user = User.query.filter_by(username="testuser").first()
            user.locale = "en"
            db.session.commit()

        html = client.get("/", follow_redirects=True).get_data(as_text=True)
        assert 'lang="en"' in html


def _extract_i18n(html):
    """Достаёт объект из строки `window.__I18N__ = {...};</script>` и парсит JSON.
    tojson эскейпит кириллицу в \\uXXXX — json.loads возвращает её обратно."""
    import json
    import re

    m = re.search(r"window\.__I18N__ = (.+?);</script>", html, re.S)
    assert m, "window.__I18N__ не инъектирован"
    return json.loads(m.group(1))


class TestJsI18nInjection:
    """Фаза 2: словарь фронтенда инъектируется в window.__I18N__ синхронно."""

    def test_js_dict_injected_default_ru(self, client):
        data = _extract_i18n(client.get("/auth/login").get_data(as_text=True))
        assert data["locale"] == "ru"
        assert data["messages"]["connection"]["serverUp"] == "Сервер доступен"
        assert "fallback" not in data  # для ru fallback не нужен

    def test_js_dict_injected_en_with_ru_fallback(self, client):
        data = _extract_i18n(client.get("/auth/login?lang=en").get_data(as_text=True))
        assert data["locale"] == "en"
        assert data["messages"]["connection"]["serverUp"] == "Server is available"
        # ru как fallback — для ключей, которых нет в en
        assert data["fallback"]["connection"]["serverUp"] == "Сервер доступен"

    def test_js_dict_keys_match_between_locales(self, app):
        # ru и en должны иметь одинаковый набор ключей (иначе часть UI не
        # переведётся). Читаем словари напрямую — без HTTP (кэш локали в
        # держащемся app_context мешал бы двум запросам в одном тесте).
        from services.js_i18n import load_js_dict

        def flat(d, p=""):
            out = set()
            for k, v in d.items():
                out |= flat(v, p + k + ".") if isinstance(v, dict) else {p + k}
            return out

        with app.app_context():
            assert flat(load_js_dict("ru")) == flat(load_js_dict("en"))


class TestBatch3Templates:
    """Батч 3: каркас base.html + входные страницы переведены через Babel."""

    def test_register_page_translated_en(self, client):
        html = client.get("/auth/register?lang=en").get_data(as_text=True)
        assert "Sign up" in html                       # заголовок «Регистрация»
        assert "Already have an account? Sign in" in html
        assert "Регистрация" not in html

    def test_register_page_default_ru(self, client):
        html = client.get("/auth/register").get_data(as_text=True)
        assert "Регистрация" in html
        assert "Уже есть аккаунт? Войти" in html

    def test_dashboard_template_translated_en(self, app):
        # Дашборд «/» для юзера с картами редиректит, поэтому рендерим шаблон
        # напрямую с принудительной локалью (force_locale обходит и редирект,
        # и кэш локали в держащемся app_context).
        from flask import render_template
        from flask_babel import force_locale

        with app.test_request_context("/"):
            with force_locale("en"):
                html = render_template("dashboard.html", maps=[])
        assert 'lang="en"' in html
        assert "My maps" in html                     # заголовок
        assert "You don't have any maps yet" in html  # пустое состояние
        assert "Мои карты" not in html
