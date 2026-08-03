import os
import shutil
from typing import Dict, Any

class SystemRequirementsChecker:
    @staticmethod
    def check_disk_space(target_path: str, required_mb: int = 300) -> bool:
        try:
            drive = os.path.splitdrive(os.path.abspath(target_path))[0] or "C:"
            _, _, free = shutil.disk_usage(drive)
            return (free // (1024 * 1024)) >= required_mb
        except Exception:
            return True

    @classmethod
    def run_all_checks(cls, target_path: str) -> Dict[str, Any]:
        issues = []
        if not cls.check_disk_space(target_path):
            issues.append({
                "id": "disk_space_low",
                "title": "Недостаточно места",
                "message": "На выбранном диске менее 300 МБ свободного места. Освободите память и повторите попытку.",
                "download_url": None
            })

        return {"success": len(issues) == 0, "issues": issues}