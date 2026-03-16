from app import create_app
from extensions import db
from models import Link, Device
from utils.logger import fix_logger

app = create_app()

with app.app_context():
    broken = []
    for link in Link.query.all():
        src = db.session.get(Device, link.source_device_id) if link.source_device_id else None
        tgt = db.session.get(Device, link.target_device_id) if link.target_device_id else None

        if not src or not tgt:
            broken.append(link.id)
            fix_logger.warning(f"Broken link #{link.id}: src={link.source_device_id}, tgt={link.target_device_id}")

    if broken:
        fix_logger.info(f"Deleting {len(broken)} broken links...")
        Link.query.filter(Link.id.in_(broken)).delete(synchronize_session=False)
        db.session.commit()
        fix_logger.info("Done! Reload the map page.")
    else:
        fix_logger.info("No broken links found")