import os
import sys
import shutil
import zipfile
import subprocess

def run_cmd(cmd):
    res = subprocess.run(cmd, shell=True)
    if res.returncode != 0:
        print(f"Build error on: {cmd}")
        sys.exit(1)

def cleanup_pycache(root_dir):
    """Автоматически вычищает кэши Питона перед сборкой"""
    for root, dirs, files in os.walk(root_dir):
        for d in list(dirs):
            if d == '__pycache__':
                full_path = os.path.join(root, d)
                shutil.rmtree(full_path, ignore_errors=True)
        for f in files:
            if f.endswith('.pyc') or f.endswith('.pyo'):
                full_path = os.path.join(root, f)
                try:
                    os.remove(full_path)
                except OSError:
                    pass

def get_icon_flag(root_dir: str, icon_filename: str) -> str:
    icons_dir = os.path.join(root_dir, "frontend", "assets", "icons")
    candidates = [icon_filename, "logo.ico", "logo_installer.ico", "app_icon.ico"]
    for cand in candidates:
        icon_path = os.path.join(icons_dir, cand)
        if os.path.exists(icon_path):
            print(f"✓ Найдена иконка: {cand}")
            return f'--icon="{icon_path}" '
    return ''

def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    dist_dir = os.path.join(root_dir, "dist")
    build_dir = os.path.join(root_dir, "build")
    
    print("=== 1. ОЧИСТКА ВРЕМЕННОГО КЕША ПИТОНА И СТАРЫХ СБОРК ===")
    cleanup_pycache(root_dir)
    
    if os.path.exists(dist_dir): shutil.rmtree(dist_dir)
    if os.path.exists(build_dir): shutil.rmtree(build_dir)

    app_icon_flag = get_icon_flag(root_dir, "logo.ico")
    setup_icon_flag = get_icon_flag(root_dir, "logo_installer.ico")

    # 1. Собираем Prose.exe
    print("\n--- 2. Сборка основного приложения Prose.exe ---")
    pyinstaller_app_cmd = (
        f'pyinstaller --noconfirm --onedir --windowed {app_icon_flag}'
        f'--name "Prose" '
        f'--add-data "{os.path.join(root_dir, "frontend")};frontend" '
        f'--add-data "{os.path.join(root_dir, "backend")};backend" '
        f'"{os.path.join(root_dir, "backend", "main.py")}"'
    )
    run_cmd(pyinstaller_app_cmd)

    prose_dist_dir = os.path.join(dist_dir, "Prose")
    
    shutil.copytree(os.path.join(root_dir, "plugins"), os.path.join(prose_dist_dir, "plugins"), dirs_exist_ok=True)
    os.makedirs(os.path.join(prose_dist_dir, "datasets"), exist_ok=True)
    os.makedirs(os.path.join(prose_dist_dir, "config"), exist_ok=True)

    # Вторичная очистка скопированных плагинов от __pycache__
    cleanup_pycache(prose_dist_dir)

    # 2. Упаковываем в портативный ZIP
    print("\n--- 3. Упаковка Portable ZIP ---")
    zip_portable_path = os.path.join(dist_dir, "Prose_v1.0_Portable.zip")
    with zipfile.ZipFile(zip_portable_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(prose_dist_dir):
            for file in files:
                abs_file = os.path.join(root, file)
                rel_file = os.path.relpath(abs_file, prose_dist_dir)
                zipf.write(abs_file, rel_file)

    # 3. Собираем установщик Prose_Setup.exe с зашитым ZIP
    print("\n--- 4. Сборка автономного установщика Prose_Setup.exe ---")
    installer_dir = os.path.join(root_dir, "installer")
    pyinstaller_setup_cmd = (
        f'pyinstaller --noconfirm --onefile --windowed {setup_icon_flag}'
        f'--name "Prose_Setup" '
        f'--add-data "{zip_portable_path};." '
        f'--add-data "{os.path.join(installer_dir, "frontend")};frontend" '
        f'"{os.path.join(installer_dir, "main.py")}"'
    )
    run_cmd(pyinstaller_setup_cmd)

    print("\n==========================================")
    print(" СБОРКА УСПЕШНО ЗАВЕРШЕНА!")
    print(f" 1. Файл установки: {os.path.join(dist_dir, 'Prose_Setup.exe')}")
    print(f" 2. Portable архив: {zip_portable_path}")
    print(f" 3. Распакованная программа: {prose_dist_dir}")
    print("==========================================")

if __name__ == '__main__':
    main()