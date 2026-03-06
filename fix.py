from app import create_app
from extensions import db
from models import Link, Device

app = create_app()

with app.app_context():
    # Найдём все связи с проблемами
    broken = []
    for link in Link.query.all():
        src = Device.query.get(link.source_device_id)
        tgt = Device.query.get(link.target_device_id)
        if not src or not tgt:
            broken.append(link.id)
            print(f"⚠️ Битая связь #{link.id}: src={link.source_device_id}, tgt={link.target_device_id}")

    if broken:
        print(f"\n🗑️ Удаление {len(broken)} битых связей...")
        for lid in broken:
            link = Link.query.get(lid)
            if link:
                db.session.delete(link)
        db.session.commit()
        print("✅ Готово! Перезагрузите страницу карты.")
    else:
        print("✨ Битых связей не найдено")