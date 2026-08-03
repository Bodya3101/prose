
```markdown
<div align="center">

  <img src="frontend/assets/images/logo_about.png" width="120" alt="Prose Logo" style="border-radius: 18px;" />

  <h1 align="center" style="font-style: italic; color: #CB3153;">Prose</h1>

  <p align="center">
    <strong>Легкий и эргономичный визуальный редактор JSONL датасетов для обучения ИИ-моделей</strong>
    <br>
    <em>Lightweight visual JSONL dataset editor for LLM fine-tuning and alignment</em>
  </p>

  <img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=600&size=20&duration=3000&pause=1000&color=CB3153&center=true&vCenter=true&width=550&lines=Visual+LLM+Dataset+Editor;ChatML+%2B+ShareGPT+%2B+Alpaca+Support;1-Click+Format+Converter;AI+Batch+Dataset+Generator;Modular+Python+Plugin+Architecture" alt="Typing SVG" />

  <br><br>

  <a href="https://github.com/Bodya3101/prose/releases/latest">
    <img src="https://img.shields.io/badge/Release-v1.0.0-CB3153?style=for-the-badge&logo=github&logoColor=white" alt="Release"/>
  </a>
  <a href="https://t.me/BodyaAckerman">
    <img src="https://img.shields.io/badge/Telegram-Contact-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"/>
  </a>
  <a href="https://boosty.to/bodya3101">
    <img src="https://img.shields.io/badge/Boosty-Support-F05A23?style=for-the-badge&logo=boosty&logoColor=white" alt="Boosty"/>
  </a>

</div>

<br>

<details open>
<summary><b><code>[ RU ] Русский язык</code></b></summary>
<br>

### <img src="https://api.iconify.design/ph:sparkle-duotone.svg?color=%23CB3153" width="22" align="top"> Что такое Prose?
Если вы хоть раз редактировали наборы данных для обучения ИИ в обычных текстовых редакторах или VS Code, то знаете эту проблему: одна пропущенная скобка или кавычка ломает весь файл.

**Prose** решает эту задачу. Программа берет сырой `.jsonl` файл и превращает его в понятные графические блоки: системный промпт, сообщение пользователя, ход размышлений модели (CoT) и итоговый ответ.

### <img src="https://api.iconify.design/ph:lightning-duotone.svg?color=%23CB3153" width="22" align="top"> Ключевые возможности
* **Удобный визуальный редактор**: Наглядная карточная система вместо мешанины из JSON кода.
* **Конвертация форматов в 1 клик**: Изменяйте разметку на лету между **Standard JSONL**, **ChatML**, **ShareGPT** и **Alpaca**.
* **ИИ-Генератор датасетов**: Автоматическое расширение и генерация пачек данных прямо из редактора через OpenRouter API.
* **Модульная система плагинов**: Любой разработчик может легко написать свой плагин на Python или добавить новый язык интерфейса.
* **Мгновенное открытие гигабайтных файлов**: Чтение за время `O(1)` с использованием байтовых смещений, оперативная память ПК не забивается.
* **Интеграция с HuggingFace**: Выгрузка готовых наборов данных прямо в репозитории HF Datasets.
* **Строгая безопасность (Zero Trust)**: Все секретные ключи шифруются в реестре ОС через хранилище Keyring, а запись файлов происходит атомарно без риска потери данных.

### <img src="https://api.iconify.design/ph:download-simple-duotone.svg?color=%23CB3153" width="22" align="top"> Установка и запуск
1. Скачайте автономный установщик **`Prose_Setup.exe`** или портативный архив из раздела [Releases](https://github.com/Bodya3101/prose/releases).
2. Запустите установщик и следуйте простым шагам шага.

#### Сборка из исходного кода:
```bash
# Клонируйте репозиторий
git clone https://github.com/Bodya3101/prose.git
cd prose

# Установите зависимости
pip install pywebview keyring requests huggingface_hub Pillow

# Запустите проект
python backend/main.py
```

</details>

<br>

<details>
<summary><b><code>[ ENG ] English</code></b></summary>
<br>

### <img src="https://api.iconify.design/ph:sparkle-duotone.svg?color=%23CB3153" width="22" align="top"> What is Prose?
If you've ever edited AI training datasets in raw text editors or VS Code, you know the frustration: a single missing bracket or unescaped quote corrupts the whole file.

**Prose** fixes this completely. It takes raw `.jsonl` files and presents them as clean visual cards: System Prompt, User Message, Chain-of-Thought reasoning, and Assistant Response.

### <img src="https://api.iconify.design/ph:lightning-duotone.svg?color=%23CB3153" width="22" align="top"> Key Features
* **Ergonomic Visual Editor**: Clear structured UI instead of messy raw JSON text.
* **1-Click Format Converter**: Convert datasets on the fly between **Standard JSONL**, **ChatML**, **ShareGPT**, and **Alpaca**.
* **AI Batch Generator**: Auto-generate dataset samples directly within the editor using OpenRouter API.
* **Extensible Plugin System**: Write custom Python backend plugins, new markup adapters, or language packs effortlessly.
* **O(1) Seeking Performance**: Instant navigation through multi-gigabyte files via byte-offset indexing without overloading RAM.
* **HuggingFace Integration**: One-click upload directly to HuggingFace Datasets repositories.
* **Zero Trust Security**: API keys are securely encrypted inside OS Keyring locker, and file writes are atomic to prevent data corruption.

### <img src="https://api.iconify.design/ph:download-simple-duotone.svg?color=%23CB3153" width="22" align="top"> Installation
1. Download **`Prose_Setup.exe`** or the portable ZIP from the [Releases](https://github.com/Bodya3101/prose/releases) page.
2. Run the installer and follow the setup wizard.

#### Build from Source:
```bash
# Clone the repository
git clone https://github.com/Bodya3101/prose.git
cd prose

# Install dependencies
pip install pywebview keyring requests huggingface_hub Pillow

# Run application
python backend/main.py
```

</details>

<br>

### <img src="https://api.iconify.design/ph:puzzle-piece-duotone.svg?color=%23CB3153" width="22" align="top"> Разработка плагинов / Plugin Development
Каждый плагин находится в своей папке внутри `/plugins/`. Вы можете добавить свою схему разметки датасета всего в пару строк на Python:

```python
def initialize_plugin(api_instance):
    def custom_to_canonical(raw_json):
        return {
            "system": raw_json.get("sys", ""),
            "user": raw_json.get("prompt", ""),
            "thought": raw_json.get("reasoning", ""),
            "assistant": raw_json.get("completion", "")
        }

    def custom_from_canonical(canonical):
        return {
            "sys": canonical.get("system", ""),
            "prompt": canonical.get("user", ""),
            "reasoning": canonical.get("thought", ""),
            "completion": canonical.get("assistant", "")
        }

    api_instance.register_format_adapter(
        format_id="my_custom_schema",
        display_name="Custom Schema (prompt / completion)",
        to_canonical=custom_to_canonical,
        from_canonical=custom_from_canonical
    )
```

<br>

### <img src="https://api.iconify.design/ph:code-duotone.svg?color=%23CB3153" width="22" align="top"> Стек технологий / Tech Stack
<div align="left">
  <a href="https://skillicons.dev">
    <img src="https://skillicons.dev/icons?i=python,html,css,js,vue,figma,git&theme=dark" alt="Prose Tech Stack" />
  </a>
</div>

<br>

### <img src="https://api.iconify.design/ph:heart-duotone.svg?color=%23CB3153" width="22" align="top"> Поддержка и Связь / Contact & Support

Разработка ведется в одиночку. Если вам нравится проект Prose, буду благодарен за звездочку на GitHub или поддержку на Boosty :)

<br>

<div align="left">
  <a href="https://t.me/BodyaAckerman">
    <img src="https://img.shields.io/badge/Telegram-BodyaAckerman-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"/>
  </a>
  <a href="https://boosty.to/bodya3101">
    <img src="https://img.shields.io/badge/Boosty-Donate-F05A23?style=for-the-badge&logo=boosty&logoColor=white" alt="Boosty"/>
  </a>
  <a href="https://github.com/Bodya3101">
    <img src="https://img.shields.io/badge/GitHub-Bodya3101-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Profile"/>
  </a>
</div>
```