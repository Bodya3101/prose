import os
import sys
import zipfile
import ctypes
import winreg
import subprocess
import logging
import shutil
from typing import Callable, Optional

class InstallerEngine:
    @staticmethod
    def is_admin() -> bool:
        try:
            return ctypes.windll.shell32.IsUserAnAdmin() != 0
        except Exception:
            return False

    @staticmethod
    def is_path_writable(path: str) -> bool:
        try:
            os.makedirs(path, exist_ok=True)
            test_file = os.path.join(path, ".perm_test")
            with open(test_file, "w") as f:
                f.write("1")
            os.remove(test_file)
            return True
        except (PermissionError, OSError):
            return False

    @staticmethod
    def request_uac_elevation(target_dir: str) -> None:
        script = sys.executable if getattr(sys, 'frozen', False) else __file__
        args = f'--elevated --dest="{target_dir}"'
        ctypes.windll.shell32.ShellExecuteW(None, "runas", script, args, None, 1)
        sys.exit(0)

    @classmethod
    def extract_embedded_payload(cls, zip_payload_path: str, dest_dir: str, progress_callback: Callable[[int, str], None]) -> bool:
        if not os.path.exists(zip_payload_path):
            logging.error(f"Payload ZIP not found: {zip_payload_path}")
            return False

        os.makedirs(dest_dir, exist_ok=True)
        dest_dir_abs = os.path.abspath(dest_dir)

        try:
            with zipfile.ZipFile(zip_payload_path, 'r') as zip_ref:
                members = zip_ref.infolist()
                
                # ЖЕСТКАЯ ПРОВЕРКА: Архив ОБЯЗАН содержать Prose.exe!
                filenames_lower = [m.filename.lower() for m in members]
                if not any('prose.exe' in f for f in filenames_lower):
                    logging.error(f"ОШИБКА: Архив {zip_payload_path} не содержит Prose.exe! Распаковка отменена.")
                    return False

                total_files = len(members)
                if total_files == 0:
                    return False

                for idx, member in enumerate(members):
                    target_file_path = os.path.abspath(os.path.join(dest_dir_abs, member.filename))
                    if not target_file_path.startswith(dest_dir_abs):
                        raise SecurityError(f"Zip Slip attempt blocked: {member.filename}")

                    # Не перезаписываем пользовательские данные при обновлении
                    is_user_data = member.filename.startswith('config/') or member.filename.startswith('datasets/')
                    if is_user_data and os.path.exists(target_file_path):
                        continue

                    if member.is_dir():
                        os.makedirs(target_file_path, exist_ok=True)
                        continue
                        
                    os.makedirs(os.path.dirname(target_file_path), exist_ok=True)
                    
                    with zip_ref.open(member) as source, open(target_file_path, "wb") as target:
                        shutil.copyfileobj(source, target)

                    percent = int(((idx + 1) / total_files) * 100)
                    progress_callback(percent, member.filename)

            return True
        except Exception as e:
            logging.error(f"Extract error: {e}")
            return False

    @staticmethod
    def create_windows_shortcut(target_exe: str, shortcut_path: str, icon_path: Optional[str] = None) -> bool:
        try:
            os.makedirs(os.path.dirname(shortcut_path), exist_ok=True)
            icon_arg = f'$s.IconLocation = "{icon_path}";' if icon_path and os.path.exists(icon_path) else ''
            ps_script = (
                f'$s = (New-Object -COM WScript.Shell).CreateShortcut("{shortcut_path}");'
                f'$s.TargetPath = "{target_exe}";'
                f'$s.WorkingDirectory = "{os.path.dirname(target_exe)}";'
                f'{icon_arg}'
                f'$s.Save();'
            )
            subprocess.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
                capture_output=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW
            )
            return True
        except Exception as e:
            logging.error(f"Shortcut error ({shortcut_path}): {e}")
            return False

    @classmethod
    def setup_shortcuts_and_uninstaller(cls, install_dir: str, create_desktop: bool, create_start_menu: bool) -> None:
        exe_path = os.path.join(install_dir, "Prose.exe")
        if not os.path.exists(exe_path):
            return

        if create_desktop:
            desktop_dir = os.path.join(os.environ["USERPROFILE"], "Desktop")
            cls.create_windows_shortcut(exe_path, os.path.join(desktop_dir, "Prose.lnk"))

        if create_start_menu:
            start_menu_dir = os.path.join(os.environ["APPDATA"], "Microsoft", "Windows", "Start Menu", "Programs", "Prose")
            cls.create_windows_shortcut(exe_path, os.path.join(start_menu_dir, "Prose.lnk"))

        uninstaller_bat = os.path.join(install_dir, "uninstall.bat")
        with open(uninstaller_bat, "w", encoding="cp866") as f:
            f.write(
                f'@echo off\n'
                f'title Удаление Prose\n'
                f'timeout /t 2 /nobreak >nul\n'
                f'cd ..\n'
                f'rmdir /s /q "{install_dir}"\n'
            )

        try:
            reg_key = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Prose"
            hive = winreg.HKEY_LOCAL_MACHINE if cls.is_admin() else winreg.HKEY_CURRENT_USER
            with winreg.CreateKey(hive, reg_key) as key:
                winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, "Prose Dataset Editor")
                winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, "1.0.0")
                winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, "Bodya3101")
                winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, install_dir)
                winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, exe_path)
                winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, f'"{uninstaller_bat}"')
        except Exception as e:
            logging.error(f"Registry error: {e}")

class SecurityError(Exception):
    pass