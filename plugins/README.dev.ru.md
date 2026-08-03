# Руководство по созданию плагинов

Каждый плагин должен находиться в своей папке внутри `/plugins/`.

## Структура папки:
1. `about.json` - Метаданные плагина.
2. `backend/plugin.py` - Основной код Питона.

## Шаг 1: Создание about.json
```json
{
  "id": "my_plugin",
  "name": "My Plugin Name",
  "version": "1.0",
  "description": "Description"
}
```

## Шаг 2: Создание backend/plugin.py
Файл должен содержать функцию `initialize_plugin(api_instance)`.
Пример:
```python
def initialize_plugin(api):
    setattr(api, 'plugin_my_method', lambda: 'Hello from Plugin!')
```
