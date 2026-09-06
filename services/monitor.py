import time
import datetime
import threading
import concurrent.futures
import os
import re
from extensions import db, socketio
from models import Device, Settings, DeviceHistory, DeviceQualityHistory
from utils.logger import monitor_logger
from cachetools import TTLCache
from sqlalchemy.orm import joinedload

try:
    from ping3 import ping

    PING3_AVAILABLE = True
except ImportError:
    PING3_AVAILABLE = False
    import subprocess
    import platform

app_instance = None
_monitor_thread = None
_monitor_stop_flag = False
_executor = None
_lock = threading.Lock()
settings_cache = TTLCache(maxsize=10, ttl=2)
_quality_windows = {}
_quality_last_persist = {}
QUALITY_PERSIST_SECONDS = 300
QUALITY_RETENTION_DAYS = 30
_last_quality_cleanup = 0


def init_monitor(app):
    global app_instance, _executor
    with _lock:
        if _executor is not None:
            try:
                _executor.shutdown(wait=False)
            except Exception:
                pass
        app_instance = app
        max_workers = min(50, (os.cpu_count() or 1) * 4)
        _executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        monitor_logger.info(f"Monitor initialized with {max_workers} workers")


def start_monitor():
    global _monitor_thread, _monitor_stop_flag
    with _lock:
        if _monitor_thread and _monitor_thread.is_alive():
            monitor_logger.warning("Monitor already started, skipping")
            return
        if _executor is None:
            monitor_logger.error("Monitor not initialized, call init_monitor first")
            return
        _monitor_stop_flag = False
        _monitor_thread = threading.Thread(target=monitor_loop, daemon=True)
        _monitor_thread.start()
        monitor_logger.info("Monitor started")


def stop_monitor():
    global _monitor_stop_flag, _monitor_thread, _executor
    with _lock:
        _monitor_stop_flag = True
        if _monitor_thread and _monitor_thread.is_alive():
            _monitor_thread.join(timeout=5)
        if _executor:
            _executor.shutdown(wait=True)
            _executor = None
        _monitor_thread = None
        monitor_logger.info("Monitor stopped")


def ping_host(ip, count=1):
    """Выполнить ICMP-проверку и вернуть RTT каждого успешного пакета в мс."""
    latencies = []
    if PING3_AVAILABLE:
        for i in range(count):
            try:
                response_time = ping(ip, timeout=2)
                if response_time is not None:
                    latencies.append(float(response_time) * 1000.0)
            except Exception:
                pass
            if i < count - 1:
                time.sleep(0.5)
        return latencies, count

    param = "-n" if platform.system().lower() == "windows" else "-c"
    timeout_seconds = 2
    try:
        if platform.system().lower() == "windows":
            cmd = ["ping", param, str(count), "-w", str(timeout_seconds * 1000), ip]
        else:
            cmd = ["ping", param, str(count), "-W", str(timeout_seconds), ip]
        output = subprocess.run(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout_seconds * count + 5, text=True,
        )
        values = [float(x) for x in re.findall(r'time[=<]([0-9]+(?:\.[0-9]+)?)', output.stdout, re.I)]
        return values, count
    except Exception:
        return [], count


def get_setting(key, default):
    cache_key = f"setting_{key}"
    if cache_key in settings_cache:
        return settings_cache[cache_key]
    if app_instance:
        with app_instance.app_context():
            s = Settings.query.filter_by(key=key).first()
            value = int(s.value) if s else default
            settings_cache[cache_key] = value
            return value
    return default


def _quality_from_metrics(metrics):
    if not metrics:
        return "unknown", None, None, None
    latencies = metrics.get("latencies", [])
    jitter_values = metrics.get("jitter_values", [])
    sent = metrics.get("samples", 0)
    received = len(latencies)
    loss = ((sent - received) / sent * 100.0) if sent else 100.0
    avg = sum(latencies) / len(latencies) if latencies else None
    jitter = sum(jitter_values) / len(jitter_values) if jitter_values else None
    if loss >= 5 or (avg is not None and avg >= 100) or (jitter is not None and jitter >= 30):
        quality = "bad"
    elif loss >= 1 or (avg is not None and avg >= 50) or (jitter is not None and jitter >= 10):
        quality = "degraded"
    else:
        quality = "good"
    return quality, avg, jitter, loss


def _record_quality_sample(device_id, metrics, now):
    """
    Накопить сэмпл в скользящее окно качества и, если окно (QUALITY_PERSIST_SECONDS)
    закрылось, записать агрегат в DeviceQualityHistory.

    Возвращает True, если в ЭТОТ вызов реально была добавлена строка истории —
    monitor_loop использует это как один из поводов освежить live-поля
    качества на самой Device (см. комментарий там), а не дёргать её при
    каждом сэмпле.
    """
    if not metrics or not metrics.get("samples"):
        return False
    window = _quality_windows.setdefault(device_id, {"sent": 0, "received": 0, "latencies": [], "jitter": []})
    window["sent"] += metrics.get("samples", 0)
    window["received"] += len(metrics.get("latencies", []))
    window["latencies"].extend(metrics.get("latencies", []))
    window["jitter"].extend(metrics.get("jitter_values", []))
    if now - _quality_last_persist.get(device_id, now) < QUALITY_PERSIST_SECONDS:
        return False
    latencies = window["latencies"]
    sent = window["sent"]
    # Пороги "good/degraded/bad" считаются ЧЕРЕЗ _quality_from_metrics — та же
    # функция, что даёт текущее (live) значение quality_status на карте.
    # Раньше формула была продублирована здесь отдельным if/elif с теми же
    # порогами — при следующей правке порогов кто-то поправил бы только одно
    # место, и то, что видно на карте прямо сейчас, молча разошлось бы с тем,
    # что легло в историю (device_quality_history).
    quality, avg, jitter, loss = _quality_from_metrics(
        {"samples": sent, "latencies": latencies, "jitter_values": window["jitter"]}
    )
    db.session.add(DeviceQualityHistory(device_id=device_id, samples=sent, loss_percent=loss, latency_min_ms=min(latencies) if latencies else None, latency_avg_ms=avg, latency_max_ms=max(latencies) if latencies else None, jitter_ms=jitter, quality=quality))
    global _last_quality_cleanup
    if now - _last_quality_cleanup >= 3600:
        cutoff = datetime.datetime.now() - datetime.timedelta(days=QUALITY_RETENTION_DAYS)
        db.session.query(DeviceQualityHistory).filter(DeviceQualityHistory.timestamp < cutoff).delete(synchronize_session=False)
        _last_quality_cleanup = now
    _quality_windows[device_id] = {"sent": 0, "received": 0, "latencies": [], "jitter": []}
    _quality_last_persist[device_id] = now
    return True


def monitor_loop():
    global _monitor_stop_flag, _executor
    monitor_logger.debug("Monitor loop started")
    cycle_count = 0
    while not _monitor_stop_flag:
        cycle_count += 1
        start_time = time.time()
        monitor_logger.debug(f"Monitor cycle {cycle_count} starting")
        try:
            if app_instance is None or _executor is None:
                monitor_logger.error("Monitor not properly initialized")
                time.sleep(5)
                continue

            # ---- ПОДГОТОВКА ДАННЫХ ДО ПОТОКОВ (ОДИН РАЗ ЗА ЦИКЛ) ----
            with app_instance.app_context():
                devices = (
                    Device.query.options(joinedload(Device.ips))
                    .filter_by(monitoring_enabled=True)
                    .all()
                )
                monitor_logger.info(
                    f"Found {len(devices)} devices with monitoring enabled"
                )
                if not devices:
                    time.sleep(5)
                    continue

                device_ips = {}
                for dev in devices:
                    device_ips[dev.id] = [ip.ip_address for ip in dev.ips]

                # Снимок состояния "как было" — берём его из ЭТИХ ЖЕ объектов
                # (они уже в памяти после запроса выше, второй поход в БД не
                # нужен). Используется ниже вместо time-based дебаунса, чтобы
                # решить, какие устройства реально нужно писать в БД — вместо
                # того, чтобы гонять батч-запрос на ВСЕ устройства каждый цикл.
                prev_status_by_id = {dev.id: dev.status for dev in devices}
                prev_quality_by_id = {dev.id: dev.quality_status for dev in devices}

                ping_count = get_setting("ping_count", 4)
                ping_interval = get_setting("ping_interval", 10)

            # ---- ФУНКЦИЯ ПРОВЕРКИ ----
            def _check_device(dev_id, ips, pcnt):
                if not ips:
                    return dev_id, "down", {"addresses": [], "samples": 0, "loss_percent": 100.0, "latencies": [], "jitter_values": []}

                address_results = []
                for ip in ips:
                    latencies, sent = ping_host(ip, pcnt)
                    address_results.append({"ip": ip, "latencies": latencies, "sent": sent})

                up_count = sum(1 for item in address_results if item["latencies"])
                if up_count == len(address_results):
                    status = "up"
                elif up_count > 0:
                    status = "partial"
                else:
                    status = "down"

                all_latencies = [v for item in address_results for v in item["latencies"]]
                total_sent = sum(item["sent"] for item in address_results)
                total_received = len(all_latencies)
                loss_percent = ((total_sent - total_received) / total_sent * 100.0) if total_sent else 100.0
                jitter_values = []
                for item in address_results:
                    vals = item["latencies"]
                    # Джиттер здесь — mean absolute successive difference (среднее
                    # абсолютное изменение RTT между соседними пингами), а НЕ RFC
                    # 3550/стандарт Cisco IPSLA (там своя сглаживающая формула).
                    # Для внутренней сравнительной статистики (better/worse на
                    # ЭТОЙ карте) это нормально, но цифра НЕ будет буквально
                    # совпадать с тем, что покажет Zabbix/Cisco для того же
                    # линка — методика другая, не баг. В UI поэтому явно подписано
                    # "Джиттер (среднее изменение RTT)", см. i18n modal.quality.jitter.
                    jitter_values.extend(abs(vals[i] - vals[i - 1]) for i in range(1, len(vals)))

                return dev_id, status, {
                    "addresses": address_results,
                    "samples": total_sent,
                    "loss_percent": loss_percent,
                    "latencies": all_latencies,
                    "jitter_values": jitter_values,
                }


            # ---- РАЗБИЕНИЕ НА БАТЧИ ДЛЯ ИЗБЕЖАНИЯ ПЕРЕГРУЗКИ ----
            batch_size = 50
            all_device_checks = [
                (dev.id, device_ips[dev.id], ping_count) for dev in devices
            ]

            results = []
            for batch_start in range(0, len(all_device_checks), batch_size):
                batch_checks = all_device_checks[batch_start : batch_start + batch_size]

                # Проверка состояния пула перед отправкой задач
                with _lock:
                    if _executor is None:
                        max_workers = min(50, (os.cpu_count() or 1) * 4)
                        _executor = concurrent.futures.ThreadPoolExecutor(
                            max_workers=max_workers
                        )
                        monitor_logger.info(
                            f"Executor recreated with {max_workers} workers"
                        )

                futures = {}
                for dev_id, ips, pcnt in batch_checks:
                    try:
                        future = _executor.submit(_check_device, dev_id, ips, pcnt)
                        futures[future] = dev_id
                    except RuntimeError as e:
                        monitor_logger.error(
                            f"Failed to submit check for device {dev_id}: {e}"
                        )
                        # Попытка переинициализировать пул
                        with _lock:
                            try:
                                if _executor is not None:
                                    _executor.shutdown(wait=False)
                            except Exception:
                                pass
                            max_workers = min(50, (os.cpu_count() or 1) * 4)
                            _executor = concurrent.futures.ThreadPoolExecutor(
                                max_workers=max_workers
                            )
                            monitor_logger.info(
                                f"Executor recreated after error with {max_workers} workers"
                            )
                        continue

                for future in concurrent.futures.as_completed(
                    futures, timeout=ping_interval * 2
                ):
                    try:
                        dev_id, new_status, metrics = future.result(timeout=10)
                        results.append((dev_id, new_status, metrics))
                    except concurrent.futures.TimeoutError:
                        dev_id = futures.get(future, "unknown")
                        monitor_logger.warning(
                            f"Timeout checking device {dev_id}, marking as down"
                        )
                        results.append((dev_id, "down", {}))
                    except Exception as e:
                        dev_id = futures.get(future, "unknown")
                        monitor_logger.error(f"Error checking device {dev_id}: {e}")
                        results.append((dev_id, "down", {}))

                time.sleep(0.5)

            # ---- ОБРАБОТКА ИЗМЕНЕНИЙ ----
            current_time = time.time()
            # Сгруппируем emit по комнатам карт: room -> список статусов
            emits_by_room = {}

            with _lock, app_instance.app_context():
                # Сначала считаем, кому вообще нужна запись в БД — БЕЗ единого
                # похода в БД, сравнивая с prev_status_by_id/prev_quality_by_id,
                # снятыми в начале ЭТОГО ЖЕ цикла. Раньше вместо этого
                # сравнения использовался time-based фильтр
                # (`current_time - last_emit_time >= 0.5`), который при
                # обычном ping_interval (секунды-десятки секунд, всегда
                # заведомо больше 0.5с) включал вообще ВСЕ устройства каждый
                # цикл — то есть Device.query.filter(Device.id.in_(...))
                # тянул из БД все 515 устройств на каждом цикле независимо от
                # того, изменилось ли у них хоть что-то.
                #
                # _record_quality_sample вызываем для КАЖДОГО устройства с
                # metrics ВСЕГДА (не только для тех, кто попадёт в
                # needs_db_update) — она копит скользящее окно и сама решает
                # раз в QUALITY_PERSIST_SECONDS, писать ли строку в
                # device_quality_history. Если звать её только для "реально
                # изменившихся", стабильные (good, никогда не флапающие)
                # устройства вообще перестали бы попадать в историю качества —
                # а это как раз самый частый и самый важный для трендов случай.
                needs_db_update = set()
                computed = {}
                for dev_id, new_status, metrics in results:
                    if dev_id not in prev_status_by_id:
                        continue  # устройство удалили/выключили из мониторинга уже после начала цикла

                    status_changed = prev_status_by_id[dev_id] != new_status

                    quality = q_latency = q_jitter = q_loss = None
                    quality_changed = False
                    history_persisted = False
                    if metrics:
                        quality, q_latency, q_jitter, q_loss = _quality_from_metrics(metrics)
                        quality_changed = prev_quality_by_id.get(dev_id) != quality
                        history_persisted = _record_quality_sample(dev_id, metrics, current_time)

                    # Пишем в саму Device (не в историю — та копится выше
                    # независимо), только когда есть реальный повод:
                    # - status_changed — очевидно, нужно;
                    # - quality_changed — категория качества реально сменилась;
                    # - history_persisted — 5-минутное окно закрылось, обновляем
                    #   "живые" числа в БД, чтобы они не зависали на значении
                    #   пятиминутной (или более старой) давности для карточки
                    #   устройства при обычной загрузке страницы — но НЕ на
                    #   каждый цикл (10с), а раз в QUALITY_PERSIST_SECONDS.
                    # Микро-колебания latency (2.1 -> 2.2ms) без флипа категории
                    # и без закрытия окна теперь НЕ вызывают UPDATE/commit —
                    # раньше квалити-поля (в т.ч. quality_last_check) писались в
                    # Device на КАЖДОМ цикле для любого устройства с metrics,
                    # то есть по факту на каждом цикле для всех живых устройств.
                    if status_changed or quality_changed or history_persisted:
                        needs_db_update.add(dev_id)
                        computed[dev_id] = (
                            new_status, quality, q_latency, q_jitter, q_loss,
                            status_changed, quality_changed,
                        )

                if needs_db_update:
                    devices_by_id = {
                        d.id: d
                        for d in Device.query.filter(Device.id.in_(needs_db_update)).all()
                    }

                    history_entries = []
                    for dev_id, values in computed.items():
                        new_status, quality, q_latency, q_jitter, q_loss, status_changed, quality_changed = values
                        device = devices_by_id.get(dev_id)
                        if not device:
                            continue

                        if quality is not None:
                            device.quality_status = quality
                            device.quality_latency_ms = q_latency
                            device.quality_jitter_ms = q_jitter
                            device.quality_loss_percent = q_loss
                            device.quality_last_check = datetime.datetime.now()

                        if status_changed:
                            history_entries.append(
                                DeviceHistory(
                                    device_id=device.id,
                                    old_status=device.status,
                                    new_status=new_status,
                                )
                            )
                            device.status = new_status
                            device.last_check = datetime.datetime.now()
                            monitor_logger.info(
                                f"Device {dev_id} status change -> {new_status}"
                            )

                        # Emit клиентам — только при реальном изменении статуса
                        # или категории качества (не при простом периодическом
                        # обновлении чисел на закрытие окна без флипа), чтобы не
                        # плодить socket-трафик там, где карте нечего перерисовывать.
                        if status_changed or quality_changed:
                            room = f"map_{device.map_id}"
                            emits_by_room.setdefault(room, []).append(
                                {
                                    "id": device.id,
                                    "status": device.status,
                                    "quality_status": device.quality_status,
                                    "quality_latency_ms": device.quality_latency_ms,
                                    "quality_jitter_ms": device.quality_jitter_ms,
                                    "quality_loss_percent": device.quality_loss_percent,
                                    "map_id": device.map_id,
                                }
                            )

                    if history_entries:
                        db.session.add_all(history_entries)
                    db.session.commit()

            # Emit ОДНИМ сообщением на комнату
            for room, statuses in emits_by_room.items():
                socketio.emit("device_status_batch", statuses, room=room)

            if not emits_by_room:
                monitor_logger.debug("No status changes this cycle")

        except Exception as e:
            monitor_logger.error(f"Monitor error: {e}")
            monitor_logger.exception("Monitor error")

        elapsed = time.time() - start_time
        sleep_time = max(0, ping_interval - elapsed)
        monitor_logger.debug(
            f"Cycle completed in {elapsed:.2f}s, sleeping {sleep_time:.2f}s"
        )
        time.sleep(sleep_time)

    monitor_logger.info("Monitor loop terminated")
