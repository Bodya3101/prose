import os
import sys
import webview
from api import DesktopApi

def main():
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.abspath(os.path.join(backend_dir, '..'))
    
    # Автоматически создаем файл-перенаправление в корне (Защита путей веб-сервера)
    root_redirect = os.path.join(root_dir, 'index.html')
    if not os.path.exists(root_redirect):
        with open(root_redirect, 'w', encoding='utf-8') as f:
            f.write("<script>window.location.href = './frontend/index.html';</script>")

    api_instance = DesktopApi(root_dir)

    # Запускаем плагины до создания окна
    from plugin_manager import PluginManager
    plugin_mgr = PluginManager(root_dir, api_instance)
    plugin_mgr.load_plugins()

    # Точкой входа сервера становится корень проекта (root_redirect), а не папка frontend!
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

    webview.start(debug=True, http_server=True)

if __name__ == '__main__':
    main()