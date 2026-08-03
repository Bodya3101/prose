import os
import sys
import webview
import logging
import webbrowser
import subprocess
import ctypes
from typing import Dict, Any

from requirements_check import SystemRequirementsChecker
from installer_api import InstallerEngine

class InstallerApiBridge:
    def __init__(self, root_dir: str, window_ref=None):
        self.root_dir = root_dir
        self.window = window_ref

    def set_window(self, window):
        self.window = window

    def get_installer_info(self) -> Dict[str, Any]:
        local_app_data = os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
        def_path = os.path.join(local_app_data, "Programs", "Prose")
        
        # Сканируем архив, игнорируя служебный base_library.zip
        zip_name = "Prose"
        search_dir = getattr(sys, '_MEIPASS', self.root_dir)
        for f in os.listdir(search_dir):
            fname = f.lower()
            if fname.endswith('.zip') and fname != 'base_library.zip':
                zip_name = os.path.splitext(f)[0]
                break
                
        return {
            "default_path": def_path,
            "version_name": zip_name
        }

    def check_is_update(self, target_path: str) -> bool:
        return os.path.exists(os.path.join(target_path, "Prose.exe"))

    def select_folder_dialog(self) -> str:
        if not self.window: return ""
        result = self.window.create_file_dialog(webview.FOLDER_DIALOG)
        return result[0] if result else ""

    def check_system_requirements(self, target_path: str) -> Dict[str, Any]:
        return SystemRequirementsChecker.run_all_checks(target_path)

    def open_external_link(self, url: str) -> bool:
        if url.startswith("http://") or url.startswith("https://"):
            webbrowser.open(url)
            return True
        return False

    def start_installation(self, install_path: str, create_desktop: bool, create_start_menu: bool) -> Dict[str, Any]:
        install_path = os.path.abspath(install_path)

        if not InstallerEngine.is_path_writable(install_path):
            if not InstallerEngine.is_admin():
                InstallerEngine.request_uac_elevation(install_path)
                return {"success": False, "reason": "uac_requested"}

        # Игнорируем base_library.zip от PyInstaller и берем ТОЛЬКО наш архив программы
        search_dir = getattr(sys, '_MEIPASS', self.root_dir)
        zip_payload = None
        for f in os.listdir(search_dir):
            fname = f.lower()
            if fname.endswith('.zip') and fname != 'base_library.zip':
                zip_payload = os.path.join(search_dir, f)
                break
                
        if not zip_payload:
            return {"success": False, "error": "Архив с дистрибутивом Prose не найден внутри установщика."}

        def progress_callback(percent: int, current_file: str):
            if self.window:
                safe_file = current_file.replace('\\', '/').replace("'", "\\'")
                self.window.evaluate_js(f"if (window.installer_store) window.installer_store.updateProgress({percent}, '{safe_file}');")

        success = InstallerEngine.extract_embedded_payload(zip_payload, install_path, progress_callback)

        if success:
            InstallerEngine.setup_shortcuts_and_uninstaller(install_path, create_desktop, create_start_menu)
            return {"success": True}
        else:
            return {"success": False, "reason": "extract_failed", "error": "Не удалось распаковать архив программы."}

    def finish_and_launch(self, install_path: str) -> None:
        exe_path = os.path.join(install_path, "Prose.exe")
        if os.path.exists(exe_path):
            subprocess.Popen([exe_path], cwd=install_path)
        if self.window:
            self.window.destroy()

    def close_installer(self) -> None:
        if self.window:
            self.window.destroy()


def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_html = os.path.join(root_dir, "frontend", "index.html")

    api_bridge = InstallerApiBridge(root_dir)

    window = webview.create_window(
        title='Prose Setup',
        url=frontend_html,
        js_api=api_bridge,
        width=580,
        height=520,
        resizable=False,
        frameless=True,
        background_color='#000000'
    )
    api_bridge.set_window(window)

    try:
        webview.start(gui='edgechromium', debug=False)
    except Exception as e:
        logging.error(f"WebView2 initialization failed: {e}")
        ctypes.windll.user32.MessageBoxW(
            0, 
            "Для работы установщика требуется Microsoft Edge WebView2 Runtime.\n\nНажмите ОК, чтобы открыть страницу скачивания компонента.", 
            "Отсутствует системный компонент", 
            0x10
        )
        webbrowser.open("https://developer.microsoft.com/en-us/microsoft-edge/webview2/")
        sys.exit(1)


if __name__ == '__main__':
    main()