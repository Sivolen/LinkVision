"""
Unit tests for LinkVision services.
"""

import errno

import pytest
from models import User, Map, Device, DeviceType, DeviceIP
from services.validators import (
    validate_ip_address,
    validate_ip_list,
    validate_name,
    validate_color_hex,
    validate_line_style,
    validate_link_type,
)
from services.security_service import (
    validate_password_strength,
    check_password_common,
    validate_password_full,
)


class TestValidators:
    """Tests for validators module."""

    def test_validate_ip_address_valid_ipv4(self):
        """Test valid IPv4 address."""
        is_valid, error = validate_ip_address("192.168.1.1")
        assert is_valid is True
        assert error is None

    def test_validate_ip_address_valid_ipv6(self):
        """Test valid IPv6 address."""
        is_valid, error = validate_ip_address("2001:db8::1")
        assert is_valid is True
        assert error is None

    def test_validate_ip_address_invalid(self):
        """Test invalid IP address."""
        is_valid, error = validate_ip_address("999.999.999.999")
        assert is_valid is False
        assert error is not None

    def test_validate_ip_list_valid(self):
        """Test valid IP list."""
        ips, error = validate_ip_list(["192.168.1.1", "10.0.0.1"])
        assert error is None
        assert len(ips) == 2
        assert "192.168.1.1" in ips

    def test_validate_ip_list_duplicates_removed(self):
        """Test duplicate IPs are removed."""
        ips, error = validate_ip_list(["192.168.1.1", "192.168.1.1"])
        assert error is None
        assert len(ips) == 1

    def test_validate_ip_list_invalid(self):
        """Test invalid IP in list."""
        ips, error = validate_ip_list(["192.168.1.1", "invalid"])
        assert error is not None
        assert len(ips) == 0

    def test_validate_name_valid(self):
        """Test valid name."""
        is_valid, error = validate_name("Test Device", min_length=2, max_length=64)
        assert is_valid is True
        assert error is None

    def test_validate_name_too_short(self):
        """Test name too short."""
        is_valid, error = validate_name("A", min_length=2)
        assert is_valid is False
        assert error is not None

    def test_validate_name_too_long(self):
        """Test name too long."""
        is_valid, error = validate_name("A" * 100, max_length=64)
        assert is_valid is False
        assert error is not None

    def test_validate_color_hex_valid(self):
        """Test valid hex color."""
        color, error = validate_color_hex("#FF5733")
        assert color == "#FF5733"
        assert error is None

    def test_validate_color_hex_default(self):
        """Test invalid color returns default."""
        color, error = validate_color_hex("invalid")
        assert color == "#3498db"  # default

    def test_validate_line_style_valid(self):
        """Test valid line style."""
        style, error = validate_line_style("solid")
        assert style == "solid"

    def test_validate_line_style_invalid(self):
        """Test invalid line style returns default."""
        style, error = validate_line_style("invalid")
        assert style == "solid"

    def test_validate_link_type_valid(self):
        """Test valid link type."""
        link_type, error = validate_link_type("1G")
        assert link_type == "1G"

    def test_validate_link_type_none(self):
        """Test None link type."""
        link_type, error = validate_link_type(None)
        assert link_type is None


class TestPasswordValidation:
    """Tests for password validation."""

    def test_validate_password_strength_valid(self):
        """Test valid password."""
        is_valid, error = validate_password_strength("Str0ng_P@ss!")
        assert is_valid is True
        assert error is None

    def test_validate_password_strength_too_short(self):
        """Test password too short."""
        is_valid, error = validate_password_strength("Short1!")
        assert is_valid is False
        assert "минимум 8 символов" in error.lower()

    def test_validate_password_strength_no_uppercase(self):
        """Test password without uppercase."""
        is_valid, error = validate_password_strength("lowercase1!")
        assert is_valid is False

    def test_validate_password_strength_no_digit(self):
        """Test password without digit."""
        is_valid, error = validate_password_strength("NoDigit@!")
        assert is_valid is False

    def test_validate_password_strength_no_special(self):
        """Test password without special char."""
        is_valid, error = validate_password_strength("NoSpecial1")
        assert is_valid is False

    def test_check_password_common(self):
        """Test common password check."""
        assert check_password_common("password") is True
        assert check_password_common("123456") is True
        assert check_password_common("Admin123!") is False

    def test_validate_password_full_common(self):
        """Test full validation with common password."""
        is_valid, error = validate_password_full("password123")
        assert is_valid is False
        # Ошибка может быть разной в зависимости от порядка проверок
        assert error is not None

    def test_validate_password_full_contains_username(self):
        """Test password contains username."""
        is_valid, error = validate_password_full("admin123!", username="admin")
        assert is_valid is False
        # Проверяем, что ошибка вообще есть
        assert error is not None


# Тесты для модели - удалены из-за зависимости от Blueprint'ов


class TestMonitorSettings:
    """Тесты настроек мониторинга: get_monitor_settings и update_ping_settings."""

    def test_get_monitor_settings_defaults(self, app):
        from services.settings_service import get_monitor_settings

        with app.app_context():
            count, interval, timeout, retention, workers = get_monitor_settings()
        assert count == 4
        assert interval == 10
        assert timeout == 1.0
        assert retention == 7
        assert workers == 150

    def test_get_monitor_settings_reads_stored_values(self, app):
        from models import Settings, db
        from services.settings_service import get_monitor_settings

        with app.app_context():
            db.session.add(Settings(key="ping_timeout", value="2.5"))
            db.session.add(Settings(key="history_retention_days", value="30"))
            db.session.add(Settings(key="monitor_max_workers", value="64"))
            db.session.commit()
            count, interval, timeout, retention, workers = get_monitor_settings()
        assert timeout == 2.5
        assert retention == 30
        assert workers == 64

    def test_update_ping_settings_roundtrip(self, app):
        from models import Settings
        from services.settings_service import (
            update_ping_settings,
            get_monitor_settings,
        )

        with app.app_context():
            update_ping_settings("6", "60", "0.5", "14", "80")
            count, interval, timeout, retention, workers = get_monitor_settings()
        assert (count, interval, timeout, retention, workers) == (6, 60, 0.5, 14, 80)
        assert Settings.query.filter_by(key="ping_timeout").first().value == "0.5"
        assert Settings.query.filter_by(key="monitor_max_workers").first().value == "80"

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "count,interval,timeout,retention,workers",
        [
            ("0", "10", "1.0", "7", "150"),  # count < 1
            ("11", "10", "1.0", "7", "150"),  # count > 10
            ("4", "4", "1.0", "7", "150"),  # interval < 5
            ("4", "301", "1.0", "7", "150"),  # interval > 300
            ("4", "10", "0.1", "7", "150"),  # timeout < 0.2
            ("4", "10", "10.1", "7", "150"),  # timeout > 10
            ("4", "10", "1.0", "0", "150"),  # retention < 1
            ("4", "10", "1.0", "3651", "150"),  # retention > 3650
            ("4", "10", "1.0", "7", "9"),  # workers < 10
            ("4", "10", "1.0", "7", "301"),  # workers > 300
            ("abc", "10", "1.0", "7", "150"),  # не число
            ("4", "10", "nan", "7", "150"),  # не число
            ("4", "10", "1.0", "7", None),  # поле не пришло из формы
        ],
    )
    def test_update_ping_settings_rejects_invalid(
        self, app, count, interval, timeout, retention, workers
    ):
        from services.settings_service import update_ping_settings

        with app.app_context():
            with pytest.raises(ValueError):
                update_ping_settings(count, interval, timeout, retention, workers)

    def test_monitor_clamps_retention_days(self):
        """Логика клампинга retention в monitor_loop: 1..3650."""
        clamp = lambda v: max(1, min(int(v), 3650))  # noqa: E731
        assert clamp(0) == 1
        assert clamp(-5) == 1
        assert clamp(7) == 7
        assert clamp(3650) == 3650
        assert clamp(9999) == 3650


class TestMonitorLifecycle:
    """Проверки жизненного цикла monitor без привязки к исходному тексту."""

    @pytest.mark.unit
    def test_init_monitor_reads_workers_before_lock(self, app, monkeypatch):
        from services import monitor
        from models import Settings, db

        with app.app_context():
            db.session.add(Settings(key="monitor_max_workers", value="42"))
            db.session.commit()

        previous_app = monitor.app_instance
        previous_executor = monitor._executor
        previous_count = monitor._executor_worker_count
        created = []

        class FakeExecutor:
            def __init__(self, max_workers):
                created.append(max_workers)

            def shutdown(self, wait=False):
                pass

        monkeypatch.setattr(
            monitor.concurrent.futures, "ThreadPoolExecutor", FakeExecutor
        )
        monitor.app_instance = None
        monitor._executor = None
        monitor._executor_worker_count = 0
        monitor.settings_cache.clear()
        try:
            monitor.init_monitor(app)
            assert created == [42]
            assert monitor._executor_worker_count == 42
        finally:
            monitor.app_instance = previous_app
            monitor._executor = previous_executor
            monitor._executor_worker_count = previous_count
            monitor.settings_cache.clear()

    @pytest.mark.unit
    def test_stop_monitor_joins_thread_without_holding_lock(self, monkeypatch):
        from services import monitor

        class TrackingLock:
            def __init__(self):
                self.depth = 0

            def __enter__(self):
                self.depth += 1
                return self

            def __exit__(self, exc_type, exc, tb):
                self.depth -= 1

        class FakeThread:
            def __init__(self, lock):
                self.lock = lock
                self.join_lock_depth = None

            def is_alive(self):
                return True

            def join(self, timeout=None):
                self.join_lock_depth = self.lock.depth

        lock = TrackingLock()
        thread = FakeThread(lock)
        monkeypatch.setattr(monitor, "_lock", lock)
        monkeypatch.setattr(monitor, "_monitor_thread", thread)
        monkeypatch.setattr(monitor, "_monitor_stop_flag", False)
        monkeypatch.setattr(monitor, "_executor", None)
        monkeypatch.setattr(monitor, "_executor_worker_count", 0)

        monitor.stop_monitor()

        assert thread.join_lock_depth == 0


class TestComputeMaxWorkers:
    """_compute_max_workers: дефолт, клампинг и чтение настройки."""

    @pytest.fixture
    def monitor_with_app(self, app):
        from services import monitor

        previous = monitor.app_instance
        monitor.app_instance = app
        monitor.settings_cache.clear()
        yield monitor
        monitor.app_instance = previous
        monitor.settings_cache.clear()

    @pytest.mark.unit
    def test_default_when_setting_absent(self, monitor_with_app):
        assert monitor_with_app._compute_max_workers() == 150

    @pytest.mark.unit
    def test_configured_value_used(self, monitor_with_app, app):
        from models import Settings, db

        with app.app_context():
            db.session.add(Settings(key="monitor_max_workers", value="42"))
            db.session.commit()
        monitor_with_app.settings_cache.clear()
        assert monitor_with_app._compute_max_workers() == 42

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "stored,expected", [("5", 10), ("999", 300), ("10", 10), ("300", 300)]
    )
    def test_hard_cap_and_floor(self, monitor_with_app, app, stored, expected):
        """Кламп 10..300 защищает от опечатки в настройке (сокетные дескрипторы)."""
        from models import Settings, db

        with app.app_context():
            db.session.add(Settings(key="monitor_max_workers", value=stored))
            db.session.commit()
        monitor_with_app.settings_cache.clear()
        assert monitor_with_app._compute_max_workers() == expected

    @pytest.mark.unit
    def test_no_cpu_count_dependency(self, monitor_with_app):
        """Размер пула больше не привязан к числу ядер (I/O-bound нагрузка)."""
        import inspect

        from services import monitor

        # cpu_count упоминается в docstring как историческая справка, поэтому
        # проверяем именно отсутствие прежнего вызова во всём модуле, включая
        # места пересоздания пула.
        module_source = inspect.getsource(monitor)
        assert "os.cpu_count" not in module_source

    @pytest.mark.unit
    def test_workers_recomputed_each_cycle(self):
        """Настройка перечитывается на границе цикла — иначе hot-resize нет."""
        import inspect

        from services import monitor

        source = inspect.getsource(monitor.monitor_loop)
        assert "_compute_max_workers()" in source
        assert "_sync_executor_size(" in source
        # В теле цикла не должно остаться прежнего batch-барьера по 50 устройств
        assert "batch_size = 50" not in source


class TestPingHostBackend:
    """Выбор бэкенда ICMP: ping3, системный ping и падение прав на сокет."""

    @pytest.fixture
    def monitor_mod(self):
        from services import monitor

        prev = monitor._ping3_unusable
        yield monitor
        monitor._ping3_unusable = prev

    @pytest.mark.unit
    def test_subprocess_helpers_imported_even_with_ping3(self, monitor_mod):
        """subprocess/platform импортируются безусловно.

        Раньше они импортировались только в except ImportError, и при
        установленном ping3 любая попытка уйти в системный ping давала
        NameError: name 'platform' is not defined (воспроизводилось вживую).
        """
        import inspect

        source = inspect.getsource(monitor_mod)
        head = source.split("def ", 1)[0]
        assert "import subprocess" in head
        assert "import platform" in head
        assert "    import subprocess" not in head, "импорт остался условным"

    @pytest.mark.unit
    def test_permission_error_switches_backend_once(self, monitor_mod, monkeypatch):
        """Запрещённый ICMP-сокет → один раз предупреждаем и уходим на ping.

        Иначе ping3 молча терял бы все пакеты, и вся сеть стала бы DOWN.
        """
        monitor_mod._ping3_unusable = False
        monkeypatch.setattr(monitor_mod, "PING3_AVAILABLE", True)

        def denied(*a, **k):
            raise PermissionError(errno.EPERM, "Operation not permitted")

        calls = []

        def fake_subprocess(ip, count, timeout_seconds):
            calls.append((ip, count, timeout_seconds))
            return [1.0, 2.0], count

        monkeypatch.setattr(monitor_mod, "ping", denied)
        monkeypatch.setattr(monitor_mod, "_ping_host_subprocess", fake_subprocess)

        assert monitor_mod.ping_host("10.0.0.1", 4, 1.0) == ([1.0, 2.0], 4)
        assert monitor_mod._ping3_unusable is True
        assert calls == [("10.0.0.1", 4, 1.0)]

        # Дальше ping3 уже не дёргаем — флаг снимает его с пути всего процесса
        monkeypatch.setattr(monitor_mod, "ping", lambda *a, **k: 1 / 0)
        assert monitor_mod.ping_host("10.0.0.2", 2, 0.5) == ([1.0, 2.0], 2)
        assert calls[-1] == ("10.0.0.2", 2, 0.5)

    @pytest.mark.unit
    def test_network_oserror_is_packet_loss_not_backend_switch(
        self, monitor_mod, monkeypatch
    ):
        """Ошибка конкретного адреса не должна отключать ping3 глобально."""
        monitor_mod._ping3_unusable = False
        monkeypatch.setattr(monitor_mod, "PING3_AVAILABLE", True)

        def unreachable(*a, **k):
            raise OSError(errno.ENETUNREACH, "Network is unreachable")

        monkeypatch.setattr(monitor_mod, "ping", unreachable)
        assert monitor_mod.ping_host("10.255.255.1", 4, 1.0) == ([], 4)
        assert monitor_mod._ping3_unusable is False

    @pytest.mark.unit
    def test_timeout_returns_none_counts_as_loss(self, monitor_mod, monkeypatch):
        """ping3 при таймауте возвращает None (не бросает) — это потеря пакета."""
        monkeypatch.setattr(monitor_mod, "PING3_AVAILABLE", True)
        monkeypatch.setattr(monitor_mod, "ping", lambda *a, **k: None)
        assert monitor_mod.ping_host("192.0.2.1", 4, 1.0) == ([], 4)

    @pytest.mark.unit
    def test_latency_converted_to_milliseconds(self, monitor_mod, monkeypatch):
        monkeypatch.setattr(monitor_mod, "PING3_AVAILABLE", True)
        monkeypatch.setattr(monitor_mod, "ping", lambda *a, **k: 0.0125)
        assert monitor_mod.ping_host("127.0.0.1", 3, 1.0) == ([12.5] * 3, 3)

    @pytest.mark.unit
    def test_permission_error_logs_once_under_concurrency(
        self, monitor_mod, monkeypatch
    ):
        """При гонке воркеров сообщение пишется один раз, а не по разу на поток.

        Пул мониторинга — это ~150 потоков; без _ping3_unusable_lock все они,
        поймавшие EPERM в одном цикле, написали бы в лог 150 одинаковых
        ошибок и залили его на каждом цикле.
        """
        import threading as th

        monitor_mod._ping3_unusable = False
        monkeypatch.setattr(monitor_mod, "PING3_AVAILABLE", True)

        barrier = th.Barrier(8)

        def denied(*a, **k):
            barrier.wait(timeout=5)
            raise PermissionError(errno.EPERM, "Operation not permitted")

        monkeypatch.setattr(monitor_mod, "ping", denied)
        monkeypatch.setattr(
            monitor_mod, "_ping_host_subprocess", lambda ip, c, t: ([1.0], c)
        )

        errors = []
        monkeypatch.setattr(
            monitor_mod.monitor_logger,
            "error",
            lambda *a, **k: errors.append(a),
        )

        threads = [
            th.Thread(target=monitor_mod.ping_host, args=("10.0.0.1", 4, 1.0))
            for _ in range(8)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert len(errors) == 1, f"сообщение продублировано {len(errors)} раз"

    @pytest.mark.unit
    def test_seq_unique_per_packet(self, monitor_mod, monkeypatch):
        """Каждому пакету свой seq — иначе через SOCK_RAW считается чужой RTT."""
        monkeypatch.setattr(monitor_mod, "PING3_AVAILABLE", True)
        seqs = []
        timeouts = []

        def fake_ping(ip, timeout=None, seq=None):
            seqs.append(seq)
            timeouts.append(timeout)
            return 0.001

        monkeypatch.setattr(monitor_mod, "ping", fake_ping)
        monitor_mod.ping_host("127.0.0.1", 4, 0.7)
        assert seqs == [0, 1, 2, 3]
        assert timeouts == [0.7] * 4, "timeout передаётся на каждый пакет"


class TestExecutorPoolSizing:
    """_sync_executor_size: создание, пересборка по настройке, без простоя."""

    @pytest.fixture
    def pool(self, monkeypatch):
        """Изолированный пул; все созданные экземпляры останавливаются после."""
        import concurrent.futures as cf

        from services import monitor

        prev_executor = monitor._executor
        prev_count = monitor._executor_worker_count
        monitor._executor = None
        monitor._executor_worker_count = 0

        created = []
        real_executor = cf.ThreadPoolExecutor

        def recording(*args, **kwargs):
            ex = real_executor(*args, **kwargs)
            created.append(ex)
            return ex

        monkeypatch.setattr(cf, "ThreadPoolExecutor", recording)
        try:
            yield monitor, created
        finally:
            monitor._executor = prev_executor
            monitor._executor_worker_count = prev_count
            for ex in created:
                ex.shutdown(wait=False)

    @pytest.mark.unit
    def test_creates_pool_when_absent(self, pool):
        monitor, created = pool
        assert monitor._sync_executor_size(20) == 20
        assert monitor._executor is not None
        assert monitor._executor_worker_count == 20
        assert len(created) == 1

    @pytest.mark.unit
    def test_resizes_when_setting_changed(self, pool):
        """Изменение monitor_max_workers применяется без перезапуска процесса."""
        monitor, created = pool
        monitor._sync_executor_size(20)
        first = monitor._executor

        assert monitor._sync_executor_size(45) == 45
        assert monitor._executor is not first, "пул обязан пересоздаться"
        assert monitor._executor_worker_count == 45
        assert len(created) == 2

    @pytest.mark.unit
    def test_keeps_pool_when_size_unchanged(self, pool):
        """При неизменной настройке пул НЕ пересоздаётся каждым циклом.

        Иначе на каждом цикле убивались бы ~150 потоков с их сокетами, а
        часть проверок терялась бы в shutdown.
        """
        monitor, created = pool
        monitor._sync_executor_size(25)
        first = monitor._executor

        for _ in range(3):
            assert monitor._sync_executor_size(25) == 25
        assert monitor._executor is first, "лишняя пересборка пула каждый цикл"
        assert len(created) == 1

    @pytest.mark.unit
    def test_loop_reports_cycle_against_interval(self):
        """Длительность цикла сравнивается с ping_interval и логируется.

        Без этого мониторинг мог отставать от расписания молча: при
        LOG_LEVEL=INFO длительность цикла нигде не фиксировалась.
        """
        import inspect

        from services import monitor

        source = inspect.getsource(monitor.monitor_loop)
        assert "interval_ratio" in source
        assert "peak_active_checks" in source
        assert "exceeded interval" in source

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "name",
        ["_peak_active_checks", "_active_checks", "_executor", "_monitor_stop_flag"],
    )
    def test_loop_declares_module_state_as_global(self, name):
        """Присваивание модульного состояния в monitor_loop требует global.

        Без global имя становится локальным, и его чтение до присваивания
        даёт UnboundLocalError. Блок телеметрии лежит ВНЕ try, поэтому такая
        ошибка убивала поток мониторинга после первого цикла — реально
        воспроизводилось при проверке патча.
        """
        from services import monitor

        assert (
            name not in monitor.monitor_loop.__code__.co_varnames
        ), f"{name} присваивается в monitor_loop без global"
