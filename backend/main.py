import os
import sys
import webview
import logging
import bottle

from api import DesktopApi

def get_app_resource_dir():
    """Корень веб-ресурсов фронтенда (_internal в режиме .exe)"""
    if getattr(sys, 'frozen', False):
        return getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(backend_dir, '..'))

def get_user_data_dir():
    """Папка пользовательских данных (plugins, datasets, config) рядом с Prose.exe"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(backend_dir, '..'))

def main():
    resource_dir = get_app_resource_dir()
    data_dir = get_user_data_dir()

    root_redirect = os.path.join(resource_dir, 'index.html')
    if not os.path.exists(root_redirect):
        try:
            with open(root_redirect, 'w', encoding='utf-8') as f:
                f.write("<script>window.location.href = './frontend/index.html';</script>")
        except Exception as e:
            logging.error(f"Error creating root_redirect: {e}")

    plugins_dir = os.path.join(data_dir, 'plugins')
    @bottle.route('/plugins/<filepath:path>')
    def server_plugins(filepath):
        return bottle.static_file(filepath, root=plugins_dir)

    api_instance = DesktopApi(data_dir)

    from plugin_manager import PluginManager
    plugin_mgr = PluginManager(data_dir, api_instance)
    plugin_mgr.load_plugins()

    dev_mode = api_instance.get_settings().get("dev_mode", False)
    logging.info(f"Запуск Prose. Режим разработчика (DevTools): {dev_mode}")

    window = webview.create_window(
        title='Prose',
        url=root_redirect,
        js_api=api_instance,
        width=1200,
        height=800,
        min_size=(800, 600),
        background_color='#000000',
        text_select=False
    )

    webview.start(debug=dev_mode, http_server=True)

if __name__ == '__main__':
    main()