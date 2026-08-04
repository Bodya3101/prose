# Руководство по разработке плагинов для Prose

Prose поддерживает модульную систему расширений. С помощью плагинов вы можете добавлять новые функции в бэкенд на Python, расширять интерфейс на Vue 3, регистрировать собственные форматы разметки датасетов и создавать языковые пакеты.

---

## 📁 Структура папки плагина

Каждый плагин должен находиться в отдельной папке внутри `/plugins/`:

```text
plugins/my_custom_plugin/
├── about.json                  # Метаданные плагина (Манифест)
├── backend/
│   └── plugin.py               # Логика Питона (Бэкенд)
└── frontend/
    ├── main.js                 # Точка входа Vue 3 (Фронтенд)
    ├── MyPluginModal.js        # Компоненты интерфейса
    ├── style.css               # Стили плагина
    └── locales/
        ├── ru.json             # Переводы интерфейса
        ├── en.json
        └── zh.json
```

---

## Шаг 1: Манифест плагина (`about.json`)

Файл `about.json` объявляет плагин в системе:

```json
{
    "id": "my_custom_plugin",
    "name": "My Custom Plugin",
    "version": "1.0",
    "description": "Описание возможностей вашего плагина",
    "has_frontend": true
}
```

* `id`: Уникальный идентификатор (должен совпадать с названием папки).
* `has_frontend`: Укажите `true`, если плагин содержит пользовательский интерфейс (`frontend/main.js`).

---

## Шаг 2: Бэкенд на Python (`backend/plugin.py`)

Бэкенд инициализируется при старте программы. Файл должен содержать функцию `initialize_plugin(api_instance)`:

```python
import logging

def initialize_plugin(api):
    """
    api - это экземпляр класса DesktopApi.
    Вы можете инжектировать в него свои методы через setattr.
    """
    setattr(api, 'plugin_my_custom_method', my_custom_method)
    logging.info("My Custom Plugin успешно инициализирован")

def my_custom_method():
    return {"success": True, "message": "Привет от Питона!"}
```

---

## Шаг 3: Добавление своих форматов датасетов (Format Adapter API)

Если вы хотите, чтобы Prose поддерживал вашу собственную схему JSONL файлов, зарегистрируйте адаптер в `backend/plugin.py`:

```python
def initialize_plugin(api):
    # Конвертация из вашей схемы в каноническую схему Prose
    def to_canonical(raw_json):
        return {
            "system": raw_json.get("sys_prompt", ""),
            "user": raw_json.get("question", ""),
            "thought": raw_json.get("chain_of_thought", ""),
            "assistant": raw_json.get("answer", "")
        }

    # Конвертация из канонической схемы Prose в ваш формат при сохранении
    def from_canonical(canonical):
        return {
            "sys_prompt": canonical.get("system", ""),
            "question": canonical.get("user", ""),
            "chain_of_thought": canonical.get("thought", ""),
            "answer": canonical.get("assistant", "")
        }

    # Регистрируем адаптер в ядре Prose
    api.register_format_adapter(
        format_id="my_custom_schema",
        display_name="Custom Schema (question / answer)",
        to_canonical=to_canonical,
        from_canonical=from_canonical
    )
```

---

## Шаг 4: Фронтенд и UI Кнопки (`frontend/main.js`)

Если `has_frontend: true`, программа загружает `frontend/main.js`. Вы можете добавлять кнопки в шапку редактора и вызывать модальные окна:

```javascript
import MyPluginModal from './MyPluginModal.js';

const store = window.app_store;
const { markRaw } = Vue;

// Добавляем иконку в шапку редактора
store.editor_buttons.push({
    id: 'my_plugin_button',
    icon: '/plugins/my_custom_plugin/frontend/assets/icons/icon.svg',
    title: 'Моя функция',
    action() {
        // Открываем модальное окно (markRaw предотвращает лишнюю реактивность Vue)
        store.active_overlay = markRaw(MyPluginModal);
    }
});
```

---

## Шаг 5: Языковые пакеты (Locales)

Для добавления нового языка интерфейса достаточно положить JSON-файл в папку `frontend/locales/` (например `zh.json` или `fr.json`). Prose автоматически обнаружит новый язык и добавит его в выпадающий список настроек!
```

---

### 📄 Файл 2: `plugins/README.dev.en.md`

```markdown
# Prose Plugin Development Guide

Prose supports a modular architecture. Plugins allow you to extend the Python backend, customize the Vue 3 frontend, register custom dataset format schemas, and add new language packs.

---

## 📁 Plugin Folder Structure

Every plugin must reside in its own folder inside `/plugins/`:

```text
plugins/my_custom_plugin/
├── about.json                  # Plugin manifest
├── backend/
│   └── plugin.py               # Python backend entry point
└── frontend/
    ├── main.js                 # Vue 3 frontend entry point
    ├── MyPluginModal.js        # UI components
    ├── style.css               # Custom styles
    └── locales/
        ├── ru.json             # Translation files
        ├── en.json
        └── zh.json