from services import monitor


def test_monitor_overload_requires_consecutive_cycles():
    old = monitor.get_monitor_health()
    old.pop("age_seconds", None)
    try:
        monitor._record_monitor_health(1, 10)
        monitor._record_monitor_health(20, 10)
        monitor._record_monitor_health(21, 10)
        assert monitor.get_monitor_health()["consecutive_overruns"] == 2
        monitor._record_monitor_health(22, 10)
        health = monitor.get_monitor_health()
        assert health["consecutive_overruns"] == 3
        assert health["elapsed"] == 22 and health["interval"] == 10
        monitor._record_monitor_health(70, 60)
        assert monitor.get_monitor_health()["consecutive_overruns"] == 1
        monitor._record_monitor_health(10, 60)
        assert monitor.get_monitor_health()["consecutive_overruns"] == 0
        monitor._record_monitor_health(70, 60, successful=False)
        assert monitor.get_monitor_health()["consecutive_overruns"] == 0
    finally:
        with monitor._monitor_health_lock:
            monitor._monitor_health.update(old)


def test_monitor_health_is_admin_only(app, client, login):
    assert client.get("/admin/monitor-health").status_code == 302
    login("testuser")
    assert client.get("/admin/monitor-health").status_code == 403
    login("admin")
    response = client.get("/admin/monitor-health")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert "consecutive_overruns" in response.get_json()


def test_monitor_health_hides_warning_after_interval_change(app, client, login):
    old = monitor.get_monitor_health()
    old.pop("age_seconds", None)
    try:
        with monitor._monitor_health_lock:
            monitor._monitor_health.update(
                consecutive_overruns=3, elapsed=20, interval=10, updated_at=1
            )
        login("admin")
        from services.settings_service import update_ping_settings

        with app.app_context():
            update_ping_settings(4, 60, 1.0, 7, 150)
        result = client.get("/admin/monitor-health").get_json()
        assert result["consecutive_overruns"] == 0
    finally:
        with monitor._monitor_health_lock:
            monitor._monitor_health.update(old)
