import os
import json
import importlib.util
import logging

class PluginManager:
    """Менеджер динамической загрузки плагинов в пространство DesktopApi"""
    def __init__(self, root_dir: str, api_instance):
        self.root_dir = root_dir
        self.plugins_dir = os.path.join(root_dir, 'plugins')
        self.api = api_instance
        os.makedirs(self.plugins_dir, exist_ok=True)

    def load_plugins(self):
        if not os.path.exists(self.plugins_dir):
            return

        # Получаем список активных плагинов из конфига
        active_list = self.api.settings_manager.settings.get("active_plugins", [])

        for folder in os.listdir(self.plugins_dir):
            plugin_path = os.path.join(self.plugins_dir, folder)
            if not os.path.isdir(plugin_path):
                continue

            about_file = os.path.join(plugin_path, 'about.json')
            if not os.path.exists(about_file):
                continue

            try:
                with open(about_file, 'r', encoding='utf-8') as f:
                    meta = json.load(f)

                # ИНИЦИАЛИЗИРУЕМ БЭКЕНД ТОЛЬКО ЕСЛИ ПЛАГИН ВКЛЮЧЕН В НАСТРОЙКАХ
                if meta['id'] in active_list:
                    backend_py = os.path.join(plugin_path, 'backend', 'plugin.py')
                    if os.path.exists(backend_py):
                        spec = importlib.util.spec_from_file_location(f"plugin_{meta['id']}", backend_py)
                        module = importlib.util.module_from_spec(spec)
                        spec.loader.exec_module(module)

                        if hasattr(module, 'initialize_plugin'):
                            module.initialize_plugin(self.api)
                            logging.info(f"Инициализирован плагин: {meta['name']} v{meta['version']}")

            except Exception as e:
                logging.error(f"Ошибка загрузки плагина {folder}: {e}")