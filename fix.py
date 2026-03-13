from app import create_app
from extensions import db
from models import Link, Device

app = create_app()

with app.app_context():
    broken = []
    for link in Link.query.all():
        # Проверяем наличие source и target, а также их существование в БД
        src = db.session.get(Device, link.source_device_id) if link.source_device_id else None
        tgt = db.session.get(Device, link.target_device_id) if link.target_device_id else None

        if not src or not tgt:
            broken.append(link.id)
            print(f"⚠️ Битая связь #{link.id}: src={link.source_device_id}, tgt={link.target_device_id}")

    if broken:
        print(f"\n🗑️ Удаление {len(broken)} битых связей...")
        # Удаляем связи напрямую по id (без дополнительных запросов)
        Link.query.filter(Link.id.in_(broken)).delete(synchronize_session=False)
        db.session.commit()
        print("✅ Готово! Перезагрузите страницу карты.")
    else:
        print("✨ Битых связей не найдено")