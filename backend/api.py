import os
import sys
import json
import keyring
import logging
import base64
import re
import webview
import shutil
import webbrowser
from typing import Dict, List, Optional, Any

from settings import SettingsManager

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

APP_NAME = "LLM_Dataset_Editor"


class FormatAdapterManager:
    """Менеджер форматов датасетов с поддержкой встроенных стандартов и расширений плагинов"""
    def __init__(self):
        self.adapters = {}
        self._register_builtins()

    def register_adapter(self, format_id: str, display_name: str, to_canonical: callable, from_canonical: callable):
        self.adapters[format_id] = {
            "id": format_id,
            "name": display_name,
            "to_canonical": to_canonical,
            "from_canonical": from_canonical
        }

    def get_available_formats(self) -> list:
        return [{"id": k, "name": v["name"]} for k, v in self.adapters.items()]

    def to_canonical(self, raw_json: dict, format_id: str) -> dict:
        adapter = self.adapters.get(format_id, self.adapters["standard"])
        try:
            res = adapter["to_canonical"](raw_json)
            return {
                "system": str(res.get("system", "")),
                "user": str(res.get("user", "")),
                "thought": str(res.get("thought", "")),
                "assistant": str(res.get("assistant", ""))
            }
        except Exception as e:
            logging.error(f"Error converting to canonical ({format_id}): {e}")
            return {"system": "", "user": "", "thought": "", "assistant": ""}

    def from_canonical(self, canonical_data: dict, format_id: str) -> dict:
        adapter = self.adapters.get(format_id, self.adapters["standard"])
        try:
            return adapter["from_canonical"](canonical_data)
        except Exception as e:
            logging.error(f"Error converting from canonical ({format_id}): {e}")
            return canonical_data

    def _register_builtins(self):
        self.register_adapter(
            "standard", "Standard JSONL (system / user / assistant)",
            lambda j: {
                "system": j.get("system", ""),
                "user": j.get("user", ""),
                "thought": j.get("thought", ""),
                "assistant": j.get("assistant", "")
            },
            lambda c: {
                k: v for k, v in {
                    "system": c.get("system", ""),
                    "user": c.get("user", ""),
                    "thought": c.get("thought", "") if c.get("thought") else None,
                    "assistant": c.get("assistant", "")
                }.items() if v is not None
            }
        )

        def chatml_to_canonical(j):
            msgs = j.get("messages", [])
            sys_val, user_val, thought_val, asst_val = "", "", "", ""
            if isinstance(msgs, list):
                for m in msgs:
                    if not isinstance(m, dict): continue
                    role = m.get("role", "")
                    content = str(m.get("content", ""))
                    if role == "system": sys_val = content
                    elif role == "user": user_val = content
                    elif role == "assistant":
                        if "<think>" in content and "</think>" in content:
                            parts = content.split("</think>", 1)
                            thought_val = parts[0].replace("<think>", "").strip()
                            asst_val = parts[1].strip()
                        else: asst_val = content
            return {"system": sys_val, "user": user_val, "thought": thought_val, "assistant": asst_val}

        def chatml_from_canonical(c):
            msgs = []
            if c.get("system"): msgs.append({"role": "system", "content": c["system"]})
            if c.get("user"): msgs.append({"role": "user", "content": c["user"]})
            
            asst_content = c.get("assistant", "")
            if c.get("thought"):
                asst_content = f"<think>{c['thought']}</think>\n{asst_content}"
            msgs.append({"role": "assistant", "content": asst_content})
            return {"messages": msgs}

        self.register_adapter("chatml", "ChatML (OpenAI / HuggingFace)", chatml_to_canonical, chatml_from_canonical)

        def sharegpt_to_canonical(j):
            convs = j.get("conversations", [])
            sys_val = str(j.get("system", ""))
            user_val, asst_val = "", ""
            if isinstance(convs, list):
                for item in convs:
                    if not isinstance(item, dict): continue
                    sender = str(item.get("from", "")).lower()
                    val = str(item.get("value", ""))
                    if sender in ["system"]: sys_val = val
                    elif sender in ["human", "user"]: user_val = val
                    elif sender in ["gpt", "assistant"]: asst_val = val
            return {"system": sys_val, "user": user_val, "thought": j.get("thought", ""), "assistant": asst_val}

        def sharegpt_from_canonical(c):
            convs = []
            if c.get("user"): convs.append({"from": "human", "value": c["user"]})
            if c.get("assistant"): convs.append({"from": "gpt", "value": c["assistant"]})
            res = {"conversations": convs}
            if c.get("system"): res["system"] = c["system"]
            if c.get("thought"): res["thought"] = c["thought"]
            return res

        self.register_adapter("sharegpt", "ShareGPT (Conversations)", sharegpt_to_canonical, sharegpt_from_canonical)

        def alpaca_to_canonical(j):
            sys_val = str(j.get("system", ""))
            inst = str(j.get("instruction", ""))
            inp = str(j.get("input", ""))
            user_val = f"{inst}\n{inp}".strip() if inp else inst
            return {"system": sys_val, "user": user_val, "thought": str(j.get("thought", "")), "assistant": str(j.get("output", ""))}

        def alpaca_from_canonical(c):
            res = {"instruction": c.get("user", ""), "input": "", "output": c.get("assistant", "")}
            if c.get("system"): res["system"] = c["system"]
            if c.get("thought"): res["thought"] = c["thought"]
            return res

        self.register_adapter("alpaca", "Alpaca (Instruction / Output)", alpaca_to_canonical, alpaca_from_canonical)


class DesktopApi:
    def __init__(self, root_dir: str):
        self.root_dir = root_dir
        self.datasets_dir = os.path.join(root_dir, 'datasets')
        os.makedirs(self.datasets_dir, exist_ok=True)
        
        self.settings_manager = SettingsManager(root_dir)
        self.format_manager = FormatAdapterManager()
        
        self.current_file_path: Optional[str] = None
        self.current_project_format: str = "standard"
        self.line_offsets: List[int] = [] 
        
        self.projects_file = os.path.join(self.datasets_dir, 'projects_meta.json')
        self._init_projects_file()

        self.plugin_locales = {}
        self.plugin_meta_list = []

    def _get_resource_path(self, relative_path: str) -> str:
        """Резолвит пути к ресурсам фронтенда с учетом режима PyInstaller _internal"""
        if getattr(sys, 'frozen', False):
            base_dir = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        else:
            base_dir = self.root_dir
        return os.path.join(base_dir, relative_path)

    def _init_projects_file(self):
        if not os.path.exists(self.projects_file):
            with open(self.projects_file, 'w', encoding='utf-8') as f:
                json.dump([], f)

    def register_format_adapter(self, format_id: str, display_name: str, to_canonical: callable, from_canonical: callable):
        self.format_manager.register_adapter(format_id, display_name, to_canonical, from_canonical)

    def get_available_formats(self) -> list:
        return self.format_manager.get_available_formats()

    def get_settings(self) -> dict:
        return self.settings_manager.get_all()

    def update_setting(self, key: str, value: any) -> bool:
        return self.settings_manager.update_setting(key, value)

    def get_locale(self, lang_code: str) -> dict:
        """Загружает язык с поддержкой базового словаря и плагинов"""
        target_lang = lang_code.lower() if lang_code in ["ru", "en"] else "en"
        base_path = self._get_resource_path(os.path.join('frontend', 'locales', f'{target_lang}.json'))
        
        merged_data = {}
        if os.path.exists(base_path):
            try:
                with open(base_path, 'r', encoding='utf-8') as f:
                    merged_data = json.load(f)
            except Exception as e:
                logging.error(f"Error loading base locale {base_path}: {e}")

        plugins_dir = os.path.join(self.root_dir, 'plugins')
        if os.path.exists(plugins_dir):
            for folder in os.listdir(plugins_dir):
                plugin_path = os.path.join(plugins_dir, folder)
                if not os.path.isdir(plugin_path): continue

                for root, _, files in os.walk(plugin_path):
                    for file in files:
                        if not file.endswith('.json') or file == 'about.json': continue
                        file_lang = file[:-5].lower()
                        if file_lang == lang_code or (lang_code == 'zh' and file_lang.startswith('zh')):
                            target_file = os.path.join(root, file)
                            try:
                                with open(target_file, 'r', encoding='utf-8') as f:
                                    merged_data.update(json.load(f))
                            except Exception as e:
                                logging.error(f"Error reading locale {target_file}: {e}")

        return {"success": True, "data": merged_data}

    def get_available_languages(self) -> list:
        languages = ["ru", "en"]
        plugins_dir = os.path.join(self.root_dir, 'plugins')
        if os.path.exists(plugins_dir):
            for folder in os.listdir(plugins_dir):
                plugin_path = os.path.join(plugins_dir, folder)
                if not os.path.isdir(plugin_path): continue
                for root, _, files in os.walk(plugin_path):
                    for file in files:
                        if file.endswith('.json') and file not in ['about.json', 'projects_meta.json']:
                            raw_code = file[:-5].lower()
                            if len(raw_code) <= 6:
                                lang_code = 'zh' if raw_code.startswith('zh') else raw_code
                                if lang_code not in languages:
                                    languages.append(lang_code)
        return languages

    def save_openrouter_key(self, api_key: str) -> bool:
        try:
            if not isinstance(api_key, str) or len(api_key) > 200: raise ValueError("Invalid key format.")
            keyring.set_password(APP_NAME, "openrouter_key", api_key)
            return True
        except Exception as e:
            logging.error(f"Save key error: {e}")
            return False

    def has_openrouter_key(self) -> bool:
        return keyring.get_password(APP_NAME, "openrouter_key") is not None

    def get_openrouter_key(self) -> dict:
        try:
            val = keyring.get_password(APP_NAME, "openrouter_key")
            return {"success": True, "key": val if val else ""}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_openrouter_key(self) -> dict:
        try:
            keyring.delete_password(APP_NAME, "openrouter_key")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_projects(self, start_idx: int, count: int) -> dict:
        try:
            with open(self.projects_file, 'r', encoding='utf-8') as f:
                projects = json.load(f)
            sliced = projects[start_idx : start_idx + count]
            return {"success": True, "items": sliced, "total": len(projects)}
        except Exception as e:
            return {"error": str(e)}

    def create_project(self, name: str, desc: str, hex_color: str, use_single_prompt: bool, use_thinking: bool, logo_base64: str, datasets: list, dataset_format: str = "standard", tokenizer_preset: str = "llama3") -> dict:
        name = str(name or "").strip()[:50]
        desc = str(desc or "").strip()[:100]
        hex_color = str(hex_color or "")
        
        if not name: return {"error": "Имя пустое."}
        if not re.match(r'^#(?:[0-9a-fA-F]{3}){1,2}$', hex_color): hex_color = "#D9D9D9" 

        try:
            with open(self.projects_file, 'r', encoding='utf-8') as f:
                projects = json.load(f)
            
            import time
            project_id = f"proj_{int(time.time())}"
            project_datasets = []
            
            for ds in (datasets or []):
                custom_filename = str(ds.get("name", "")).strip()
                source_filepath = ds.get("source_path")
                
                dataset_filename = re.sub(r'[\\/*?:"<>|]', "", custom_filename).strip()
                if not dataset_filename.endswith('.jsonl'):
                    dataset_filename += ".jsonl"
                
                dest_path = os.path.abspath(os.path.join(self.datasets_dir, dataset_filename))
                
                if source_filepath and os.path.exists(source_filepath):
                    abs_source = os.path.abspath(source_filepath)
                    if abs_source != dest_path:
                        shutil.copy2(abs_source, dest_path)
                else:
                    if not os.path.exists(dest_path):
                        open(dest_path, 'a').close()
                
                project_datasets.append(dataset_filename)

            if not project_datasets:
                default_file = os.path.join(self.datasets_dir, "dataset_default.jsonl")
                project_datasets.append("dataset_default.jsonl")
                if not os.path.exists(default_file):
                    open(default_file, 'a').close()

            new_project = {
                "id": project_id, "name": name, "description": desc,
                "color": hex_color, "logo_base64": logo_base64,
                "dataset_files": project_datasets, "active_dataset": project_datasets[0],
                "dataset_format": dataset_format or "standard",
                "tokenizer_preset": tokenizer_preset or "llama3",
                "use_single_prompt": use_single_prompt, "use_thinking": use_thinking,
                "global_system_prompt": ""
            }
            
            projects.insert(0, new_project)
            with open(self.projects_file, 'w', encoding='utf-8') as f:
                json.dump(projects, f, indent=4, ensure_ascii=False)
                
            return {"success": True, "project": new_project}
        except Exception as e: return {"error": str(e)}

    def update_project(self, project_id: str, updates: dict) -> dict:
        try:
            with open(self.projects_file, 'r', encoding='utf-8') as f:
                projects = json.load(f)
            for p in projects:
                if p["id"] == project_id:
                    for k, v in updates.items(): p[k] = v
                    break
            with open(self.projects_file, 'w', encoding='utf-8') as f:
                json.dump(projects, f, indent=4, ensure_ascii=False)
            return {"success": True}
        except Exception as e: return {"error": str(e)}

    def delete_project(self, project_id: str) -> dict:
        try:
            with open(self.projects_file, 'r', encoding='utf-8') as f:
                projects = json.load(f)
            
            project_to_delete = next((p for p in projects if p["id"] == project_id), None)
            if not project_to_delete: return {"error": "Проект не найден."}
                
            projects = [p for p in projects if p["id"] != project_id]
            with open(self.projects_file, 'w', encoding='utf-8') as f:
                json.dump(projects, f, indent=4, ensure_ascii=False)
            
            dataset_files = project_to_delete.get("dataset_files", [])
            if "dataset_file" in project_to_delete: dataset_files.append(project_to_delete["dataset_file"])
                
            for filename in dataset_files:
                if not filename: continue
                safe_path = os.path.abspath(os.path.join(self.datasets_dir, filename))
                if safe_path.startswith(os.path.abspath(self.datasets_dir)):
                    if os.path.exists(safe_path):
                        try: os.remove(safe_path)
                        except OSError as e: logging.error(f"Cannot delete file {safe_path}: {e}")
                            
            return {"success": True}
        except Exception as e: return {"error": str(e)}

    def convert_dataset_format(self, filename: str, from_format: str, to_format: str) -> dict:
        safe_path = os.path.abspath(os.path.join(self.datasets_dir, filename))
        if not safe_path.startswith(os.path.abspath(self.datasets_dir)) or not os.path.exists(safe_path):
            return {"error": "Файл не найден."}

        temp_path = safe_path + ".tmp"
        try:
            with open(safe_path, 'rb') as src, open(temp_path, 'w', encoding='utf-8') as dst:
                for line in src:
                    line_str = line.decode('utf-8').strip()
                    if not line_str: continue
                    try:
                        raw_json = json.loads(line_str)
                        canonical = self.format_manager.to_canonical(raw_json, from_format)
                        new_json = self.format_manager.from_canonical(canonical, to_format)
                        dst.write(json.dumps(new_json, ensure_ascii=False) + "\n")
                    except Exception as e:
                        logging.error(f"Error converting line: {e}")

            os.replace(temp_path, safe_path)
            self.current_project_format = to_format
            self._reindex_current_file()
            return {"success": True}
        except Exception as e:
            if os.path.exists(temp_path): os.remove(temp_path)
            return {"error": str(e)}

    def _reindex_current_file(self) -> None:
        if not self.current_file_path or not os.path.exists(self.current_file_path):
            self.line_offsets = []
            return
        self.line_offsets = []
        try:
            with open(self.current_file_path, 'rb') as f:
                offset = 0
                for line in f:
                    self.line_offsets.append(offset)
                    offset += len(line)
        except Exception as e:
            logging.error(f"Reindex error: {e}")

    def load_dataset_index(self, filename: str, format_id: str = "standard") -> Dict[str, Any]:
        safe_path = os.path.abspath(os.path.join(self.datasets_dir, filename))
        if not safe_path.startswith(os.path.abspath(self.datasets_dir)):
            return {"error": "Path Traversal blocked."}

        if not os.path.exists(safe_path):
            return {"error": "File not found."}

        self.current_file_path = safe_path
        self.current_project_format = format_id or "standard"
        self._reindex_current_file()
        return {"success": True, "total_lines": len(self.line_offsets)}

    def get_dataset_entry(self, index: int) -> Dict[str, Any]:
        if not self.current_file_path or not self.line_offsets:
            return {"error": "No file."}
            
        if index < 0 or index >= len(self.line_offsets):
            return {"error": "Index out of bounds."}

        try:
            with open(self.current_file_path, 'rb') as f:
                f.seek(self.line_offsets[index])
                line_bytes = f.readline()
                if not line_bytes: return {"error": "Empty line read."}
                
                raw_json = json.loads(line_bytes.decode('utf-8'))
                canonical_data = self.format_manager.to_canonical(raw_json, self.current_project_format)
                return {"success": True, "data": canonical_data}
        except Exception as e:
            return {"error": str(e)}

    def save_dataset_entries(self, index: int, entries: list) -> dict:
        """Append a batch of canonical dataset entries and reindex only once."""
        if not self.current_file_path:
            return {"success": False, "error": "No file."}
        if not isinstance(entries, list) or not entries or len(entries) > 100:
            return {"success": False, "error": "Batch must contain between 1 and 100 entries."}

        try:
            # This fast path is deliberately append-only: it never overwrites old rows.
            if not isinstance(index, int) or index != len(self.line_offsets):
                return {"success": False, "error": "Dataset changed during generation. Reload the active dataset before saving more entries."}

            lines = []
            for new_data in entries:
                if not isinstance(new_data, dict):
                    return {"success": False, "error": "Every dataset entry must be an object."}
                clean_canonical = {
                    "system": str(new_data.get("system", "")),
                    "user": str(new_data.get("user", "")),
                    "assistant": str(new_data.get("assistant", ""))
                }
                if "thought" in new_data:
                    clean_canonical["thought"] = str(new_data.get("thought", ""))
                formatted_json = self.format_manager.from_canonical(
                    clean_canonical, self.current_project_format
                )
                lines.append(json.dumps(formatted_json, ensure_ascii=False) + "\n")

            with open(self.current_file_path, "a", encoding="utf-8", newline="") as output:
                output.write("".join(lines))
                output.flush()
                os.fsync(output.fileno())

            self._reindex_current_file()
            return {"success": True, "count": len(lines)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def save_dataset_entry(self, index: int, new_data: dict) -> dict:
        if not self.current_file_path: return {"error": "No file."}

        try:
            clean_canonical = {
                "system": str(new_data.get("system", "")),
                "user": str(new_data.get("user", "")),
                "assistant": str(new_data.get("assistant", ""))
            }
            if "thought" in new_data: clean_canonical["thought"] = str(new_data.get("thought", ""))

            formatted_json = self.format_manager.from_canonical(clean_canonical, self.current_project_format)
            json_line = json.dumps(formatted_json, ensure_ascii=False) + "\n"

            if index >= len(self.line_offsets):
                with open(self.current_file_path, 'a', encoding='utf-8') as f:
                    f.write(json_line)
                self._reindex_current_file()
                return {"success": True}

            temp_path = self.current_file_path + ".tmp"
            with open(self.current_file_path, 'r', encoding='utf-8') as src, \
                 open(temp_path, 'w', encoding='utf-8') as dst:
                for i, line in enumerate(src):
                    if i == index: dst.write(json_line)
                    else: dst.write(line)

            os.replace(temp_path, self.current_file_path)
            self._reindex_current_file()
            return {"success": True}

        except Exception as e:
            if 'temp_path' in locals() and os.path.exists(temp_path): os.remove(temp_path)
            return {"error": str(e)}

    def select_and_process_image(self) -> dict:
        file_types = ('Image Files (*.png;*.jpg;*.jpeg;*.svg)', 'All files (*.*)')
        result = webview.windows[0].create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False, file_types=file_types)
        if not result: return {"success": False, "message": "Отменено"}
            
        file_path = result[0]
        if os.path.getsize(file_path) > 2 * 1024 * 1024: return {"error": "Файл слишком большой (макс 2 МБ)."}

        ext = os.path.splitext(file_path)[1].lower()
        if ext not in ['.png', '.jpg', '.jpeg', '.svg']: return {"error": "Формат не поддерживается."}

        try:
            with open(file_path, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
            mime_type = "image/svg+xml" if ext == '.svg' else f"image/{ext[1:]}"
            base64_data_uri = f"data:{mime_type};base64,{encoded_string}"
            return {"success": True, "logo_base64": base64_data_uri}
        except Exception as e: return {"error": str(e)}

    def select_existing_dataset(self) -> dict:
        file_types = ('JSONL Files (*.jsonl)', 'All files (*.*)')
        result = webview.windows[0].create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False, file_types=file_types)
        if not result: return {"success": False}
        file_path = result[0]
        if not file_path.endswith('.jsonl'): return {"error": "Файл должен быть в формате .jsonl"}
        return {"success": True, "path": file_path, "name": os.path.basename(file_path)}

    def _extract_telegram_text(self, raw_text: Any) -> str:
        """
        Безопасно извлекает и объединяет текст из структуры Telegram JSON.
        Поддерживает как простые строки, так и массивы форматирования text_entities.
        """
        if isinstance(raw_text, str):
            return raw_text.strip()
        elif isinstance(raw_text, list):
            parts = []
            for item in raw_text:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict) and "text" in item:
                    parts.append(str(item.get("text", "")))
            return "".join(parts).strip()
        return ""

    def select_telegram_export_file(self) -> dict:
        """
        Открывает нативный диалог выбора файла result.json от Telegram Desktop,
        проверяет целостность и возвращает список участников диалога.
        """
        file_types = ('JSON Files (*.json)', 'All files (*.*)')
        result = webview.windows[0].create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False, file_types=file_types)
        if not result:
            return {"success": False}

        file_path = result[0]
        if not os.path.exists(file_path):
            return {"success": False, "error": "Файл не найден на диске."}

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            messages = data.get("messages", [])
            if not isinstance(messages, list):
                return {"success": False, "error": "Некорректная структура Telegram JSON (отсутствует массив messages)."}

            senders = set()
            msg_count = 0
            for m in messages:
                if isinstance(m, dict) and m.get("type") == "message":
                    sender = m.get("from")
                    if sender and isinstance(sender, str):
                        senders.add(sender)
                        msg_count += 1

            if not senders:
                return {"success": False, "error": "В файле экспорта не найдено текстовых сообщений."}

            chat_name = data.get("name", "Telegram_Chat")
            return {
                "success": True,
                "path": file_path,
                "participants": list(senders),
                "total_messages": msg_count,
                "chat_name": chat_name
            }
        except Exception as e:
            logging.error(f"Error parsing Telegram export: {e}")
            return {"success": False, "error": str(e)}

    def convert_telegram_export(self, source_path: str, user_sender: str, assistant_sender: str, output_filename: str, dataset_format: str = "standard", system_prompt: str = "") -> dict:
        """
        Конвертирует переписку из result.json в датасет формата Prose.
        Принимает кастомный системный промпт system_prompt для создаваемых строк.
        """
        if not source_path or not os.path.exists(source_path):
            return {"error": "Исходный файл экспорта не найден."}

        if user_sender == assistant_sender:
            return {"error": "Участники User и Assistant должны различаться."}

        clean_filename = re.sub(r'[\\/*?:"<>|]', "", str(output_filename or "dataset_telegram")).strip()
        if not clean_filename.endswith('.jsonl'):
            clean_filename += ".jsonl"

        dest_path = os.path.abspath(os.path.join(self.datasets_dir, clean_filename))
        if not dest_path.startswith(os.path.abspath(self.datasets_dir)):
            return {"error": "Path Traversal заблокирован."}

        try:
            with open(source_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            messages = data.get("messages", [])
            if not isinstance(messages, list):
                return {"error": "Некорректный массив сообщений."}

            grouped_turns = []
            for m in messages:
                if not isinstance(m, dict) or m.get("type") != "message":
                    continue
                sender = m.get("from")
                if sender not in [user_sender, assistant_sender]:
                    continue

                text = self._extract_telegram_text(m.get("text"))
                if not text:
                    continue

                if grouped_turns and grouped_turns[-1]["sender"] == sender:
                    grouped_turns[-1]["text"] += "\n" + text
                else:
                    grouped_turns.append({"sender": sender, "text": text})

            clean_sys_prompt = str(system_prompt or "").strip()
            entries = []
            i = 0
            while i < len(grouped_turns):
                curr = grouped_turns[i]
                if curr["sender"] == user_sender:
                    user_text = curr["text"]
                    asst_text = ""
                    if i + 1 < len(grouped_turns) and grouped_turns[i + 1]["sender"] == assistant_sender:
                        asst_text = grouped_turns[i + 1]["text"]
                        i += 1
                    
                    canonical = {"system": clean_sys_prompt, "user": user_text, "thought": "", "assistant": asst_text}
                    formatted = self.format_manager.from_canonical(canonical, dataset_format)
                    entries.append(formatted)
                i += 1

            if not entries:
                return {"error": "Не удалось создать ни одной пары диалога из выбранных участников."}

            temp_path = dest_path + ".tmp"
            with open(temp_path, 'w', encoding='utf-8') as out_f:
                for entry in entries:
                    out_f.write(json.dumps(entry, ensure_ascii=False) + "\n")

            os.replace(temp_path, dest_path)

            return {
                "success": True,
                "filename": clean_filename,
                "filepath": dest_path,
                "total_entries": len(entries)
            }
        except Exception as e:
            logging.error(f"Telegram conversion error: {e}")
            if 'temp_path' in locals() and os.path.exists(temp_path):
                os.remove(temp_path)
            return {"error": str(e)}

    def save_hf_token(self, token: str) -> bool:
        try:
            if not isinstance(token, str) or len(token) > 200: raise ValueError("Invalid format.")
            keyring.set_password(APP_NAME, "huggingface_token", token)
            return True
        except Exception as e:
            logging.error(f"Error saving HF token: {e}")
            return False

    def has_hf_token(self) -> bool:
        return keyring.get_password(APP_NAME, "huggingface_token") is not None

    def test_hf_connection(self) -> dict:
        token = keyring.get_password(APP_NAME, "huggingface_token")
        if not token: return {"success": False, "error": "Токен не найден."}
        try:
            from huggingface_hub import HfApi
            api = HfApi()
            user_info = api.whoami(token=token)
            return {"success": True, "username": user_info.get("name", "Unknown"), "fullname": user_info.get("fullname", "")}
        except ImportError: return {"success": False, "error": "Выполните: pip install huggingface_hub"}
        except Exception as e: return {"success": False, "error": str(e)}

    def upload_dataset_to_hf(self, repo_id: str, local_filename: str, private: bool = True) -> dict:
        token = keyring.get_password(APP_NAME, "huggingface_token")
        if not token: return {"success": False, "error": "HF токен не настроен."}
        local_path = os.path.join(self.datasets_dir, local_filename)
        if not os.path.exists(local_path): return {"success": False, "error": "Локальный файл не найден."}
        try:
            from huggingface_hub import HfApi
            api = HfApi(token=token)
            api.create_repo(repo_id=repo_id, repo_type="dataset", private=private, exist_ok=True)
            api.upload_file(path_or_fileobj=local_path, path_in_repo=local_filename, repo_id=repo_id, repo_type="dataset")
            return {"success": True, "url": f"https://huggingface.co/datasets/{repo_id}"}
        except Exception as e: return {"success": False, "error": str(e)}

    def split_dataset(self, filename: str, train_ratio: float = 0.8) -> dict:
        """
        Разделяет датасет на train (например 80%) и val (20%) без повреждения оригинала.
        """
        safe_path = os.path.abspath(os.path.join(self.datasets_dir, filename))
        if not safe_path.startswith(os.path.abspath(self.datasets_dir)) or not os.path.exists(safe_path):
            return {"error": "Файл не найден."}

        try:
            with open(safe_path, 'r', encoding='utf-8') as f:
                lines = [line for line in f if line.strip()]

            if len(lines) < 2:
                return {"error": "Слишком мало записей для разделения (минимум 2)."}

            import random
            shuffled = lines.copy()
            random.seed(42)  # Воспроизводимое распределение
            random.shuffle(shuffled)

            split_idx = max(1, int(len(shuffled) * train_ratio))
            train_lines = shuffled[:split_idx]
            val_lines = shuffled[split_idx:]

            base_name = filename[:-6] if filename.endswith('.jsonl') else filename
            train_filename = f"{base_name}_train.jsonl"
            val_filename = f"{base_name}_val.jsonl"

            train_path = os.path.join(self.datasets_dir, train_filename)
            val_path = os.path.join(self.datasets_dir, val_filename)

            with open(train_path + ".tmp", 'w', encoding='utf-8') as f:
                f.writelines(train_lines)
            os.replace(train_path + ".tmp", train_path)

            with open(val_path + ".tmp", 'w', encoding='utf-8') as f:
                f.writelines(val_lines)
            os.replace(val_path + ".tmp", val_path)

            return {
                "success": True,
                "train_file": train_filename,
                "train_count": len(train_lines),
                "val_file": val_filename,
                "val_count": len(val_lines)
            }
        except Exception as e:
            logging.error(f"Error splitting dataset: {e}")
            return {"error": str(e)}

    def audit_dataset(self, filename: str, format_id: str = "standard") -> dict:
        """
        Сканирует датасет на пустые реплики и дубликаты.
        Возвращает список аномалий для последующего ручного подтверждения пользователем.
        """
        safe_path = os.path.abspath(os.path.join(self.datasets_dir, filename))
        if not safe_path.startswith(os.path.abspath(self.datasets_dir)) or not os.path.exists(safe_path):
            return {"error": "Файл не найден."}

        issues = []
        seen_user_prompts = {}

        try:
            with open(safe_path, 'rb') as f:
                for idx, line in enumerate(f):
                    line_str = line.decode('utf-8').strip()
                    if not line_str:
                        continue
                    try:
                        raw_json = json.loads(line_str)
                        canonical = self.format_manager.to_canonical(raw_json, format_id)
                        user_text = canonical.get("user", "").strip()
                        asst_text = canonical.get("assistant", "").strip()

                        if not user_text or not asst_text:
                            issues.append({
                                "index": idx,
                                "type": "empty",
                                "user_preview": user_text[:60] if user_text else "[Пусто]",
                                "asst_preview": asst_text[:60] if asst_text else "[Пусто]"
                            })

                        if user_text:
                            if user_text in seen_user_prompts:
                                issues.append({
                                    "index": idx,
                                    "type": "duplicate",
                                    "original_index": seen_user_prompts[user_text],
                                    "user_preview": user_text[:60],
                                    "asst_preview": asst_text[:60]
                                })
                            else:
                                seen_user_prompts[user_text] = idx

                    except Exception:
                        issues.append({
                            "index": idx,
                            "type": "corrupted",
                            "user_preview": "Невалидный JSON",
                            "asst_preview": ""
                        })

            return {"success": True, "total_scanned": idx + 1 if 'idx' in locals() else 0, "issues": issues}
        except Exception as e:
            logging.error(f"Audit error: {e}")
            return {"error": str(e)}

    def delete_dataset_entries_bulk(self, filename: str, indices_to_delete: list) -> dict:
        """
        Атомарно удаляет выбранный массив индексов строк из датасета за 1 проход.
        """
        safe_path = os.path.abspath(os.path.join(self.datasets_dir, filename))
        if not safe_path.startswith(os.path.abspath(self.datasets_dir)) or not os.path.exists(safe_path):
            return {"error": "Файл не найден."}

        delete_set = set(indices_to_delete)
        temp_path = safe_path + ".tmp"

        try:
            with open(safe_path, 'r', encoding='utf-8') as src, open(temp_path, 'w', encoding='utf-8') as dst:
                for idx, line in enumerate(src):
                    if idx not in delete_set:
                        dst.write(line)

            os.replace(temp_path, safe_path)
            self._reindex_current_file()
            return {"success": True, "deleted_count": len(delete_set)}
        except Exception as e:
            if os.path.exists(temp_path): os.remove(temp_path)
            return {"error": str(e)}

    def get_about_info(self) -> dict:
        about_path = os.path.join(self.root_dir, 'config', 'about.json')
        default_about = {
            "version": "1.0.3", "github_username": "Bodya3101",
            "github_profile_url": "https://github.com/Bodya3101",
            "github_repo_url": "https://github.com/Bodya3101/prose",
            "logo_placeholder_path": "assets/images/logo_about.png"
        }
        if not os.path.exists(about_path):
            os.makedirs(os.path.dirname(about_path), exist_ok=True)
            with open(about_path, 'w', encoding='utf-8') as f: json.dump(default_about, f, indent=4, ensure_ascii=False)
        try:
            with open(about_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                data["version"] = "1.0.1"
                data["logo_placeholder_path"] = "assets/images/logo_about.png"
                data["github_repo_url"] = "https://github.com/Bodya3101/prose"
                return data
        except Exception: return default_about

    def open_external_link(self, url: str) -> bool:
        if url.startswith("http://") or url.startswith("https://"):
            webbrowser.open(url)
            return True
        return False

    def get_field_history(self, current_index: int, field_name: str) -> dict:
        if not self.current_file_path or not self.line_offsets: return {"success": False, "error": "Датасет не загружен."}
        if field_name not in ["system", "user", "thought", "assistant"]: return {"success": False, "error": "Некорректное поле."}

        previous_val = None
        other_vals = set()
        try:
            with open(self.current_file_path, 'rb') as f:
                for i, offset in enumerate(self.line_offsets):
                    f.seek(offset)
                    line_bytes = f.readline()
                    try:
                        raw_data = json.loads(line_bytes.decode('utf-8'))
                        canonical = self.format_manager.to_canonical(raw_data, self.current_project_format)
                        val = canonical.get(field_name, "").strip()
                        if not val: continue
                        if i == current_index - 1: previous_val = val
                        elif i != current_index: other_vals.add(val)
                    except Exception: continue
            if previous_val in other_vals: other_vals.remove(previous_val)
            return {"success": True, "previous": previous_val, "others": list(other_vals)}
        except Exception as e: return {"success": False, "error": str(e)}

    def get_discovered_plugins(self) -> list:
        self.plugin_meta_list = []
        plugins_dir = os.path.join(self.root_dir, 'plugins')
        if os.path.exists(plugins_dir):
            for folder in os.listdir(plugins_dir):
                about_path = os.path.join(plugins_dir, folder, 'about.json')
                if os.path.exists(about_path):
                    try:
                        with open(about_path, 'r', encoding='utf-8') as f:
                            self.plugin_meta_list.append(json.load(f))
                    except Exception: pass
        return self.plugin_meta_list

    def get_plugin_guide(self, lang_code: str) -> dict:
        if lang_code not in ["ru", "en"]: lang_code = "en"
        guide_path = os.path.join(self.root_dir, 'plugins', f'README.dev.{lang_code}.md')
        try:
            with open(guide_path, 'r', encoding='utf-8') as f:
                return {"success": True, "content": f.read()}
        except Exception as e: return {"success": False, "error": str(e)}