import os
import sys
import webview
import logging

from api import DesktopApi

def get_app_resource_dir():
    """Определяет корень веб-ресурсов (frontend) для .exe и обычной разработки"""
    if getattr(sys, 'frozen', False):
        # В скомпилированном .exe файлы фронтенда упакованы в sys._MEIPASS (_internal)
        return getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(backend_dir, '..'))

def get_user_data_dir():
    """Определяет папку для пользовательских данных (plugins, datasets, config) рядом с Prose.exe"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(backend_dir, '..'))

def main():
    resource_dir = get_app_resource_dir()
    data_dir = get_user_data_dir()

    # Перенаправление создаем в папке ресурсов фронтенда
    root_redirect = os.path.join(resource_dir, 'index.html')
    if not os.path.exists(root_redirect):
        try:
            with open(root_redirect, 'w', encoding='utf-8') as f:
                f.write("<script>window.location.href = './frontend/index.html';</script>")
        except Exception as e:
            logging.error(f"Error creating root_redirect: {e}")

    # API и Плагины завязываем на внешнюю папку рядом с Prose.exe
    api_instance = DesktopApi(data_dir)

    from plugin_manager import PluginManager
    plugin_mgr = PluginManager(data_dir, api_instance)
    plugin_mgr.load_plugins()

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

    webview.start(debug=False, http_server=True)

if __name__ == '__main__':
    main()