import os
import json
import logging

class SettingsManager:
    """Управление настройками с валидацией (English Default)"""
    
    DEFAULT_SETTINGS = {
        "use_accent_colors": True,
        "language": "en", # ЯЗЫК ПО УМОЛЧАНИЮ -> ENGLISH
        "auto_save_interval": 5,
        "disable_animations": False,
        "disable_accents": False,
        "font_size": 14,
        "dev_mode": False,
        "active_plugins": ["openrouter_plugin", "chinese_translation_plugin"]
    }

    def __init__(self, root_dir: str):
        self.config_dir = os.path.join(root_dir, 'config')
        self.config_path = os.path.join(self.config_dir, 'settings.json')
        os.makedirs(self.config_dir, exist_ok=True)
        self.settings = self._load_settings()

    def _load_settings(self) -> dict:
        if not os.path.exists(self.config_path):
            self._save_settings(self.DEFAULT_SETTINGS)
            return self.DEFAULT_SETTINGS.copy()

        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            validated = self.DEFAULT_SETTINGS.copy()
            if isinstance(data.get("use_accent_colors"), bool):
                validated["use_accent_colors"] = data["use_accent_colors"]
            if isinstance(data.get("language"), str):
                validated["language"] = data["language"]
            if isinstance(data.get("disable_animations"), bool):
                validated["disable_animations"] = data["disable_animations"]
            if isinstance(data.get("disable_accents"), bool):
                validated["disable_accents"] = data["disable_accents"]
            if isinstance(data.get("dev_mode"), bool):
                validated["dev_mode"] = data["dev_mode"]
            if isinstance(data.get("font_size"), int) and 12 <= data.get("font_size") <= 22:
                validated["font_size"] = data.get("font_size")
            if isinstance(data.get("active_plugins"), list):
                validated["active_plugins"] = [str(x) for x in data["active_plugins"]]
                
            for k, v in data.items():
                if k.startswith("plugin_") or k.startswith("skip_"):
                    validated[k] = v
                
            return validated
        except (json.JSONDecodeError, OSError) as e:
            logging.error(f"Config corrupted, using defaults: {e}")
            return self.DEFAULT_SETTINGS.copy()

    def _save_settings(self, data: dict) -> None:
        try:
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
        except OSError as e:
            logging.error(f"Error saving settings: {e}")

    def update_setting(self, key: str, value: any) -> bool:
        if key in self.DEFAULT_SETTINGS and type(value) == type(self.DEFAULT_SETTINGS[key]):
            self.settings[key] = value
            self._save_settings(self.settings)
            return True
        elif key.startswith("plugin_") or key.startswith("skip_"):
            self.settings[key] = value
            self._save_settings(self.settings)
            return True
        return False
        
    def get_all(self) -> dict:
        return self.settings