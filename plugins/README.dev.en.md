## Step 1: Manifest (`about.json`)

The `about.json` file declares your plugin to the Prose engine:

```json
{
    "id": "my_custom_plugin",
    "name": "My Custom Plugin",
    "version": "1.0",
    "description": "Description of your plugin features",
    "has_frontend": true
}
```

* `id`: Unique identifier (must match the folder name).
* `has_frontend`: Set to `true` if your plugin includes UI scripts (`frontend/main.js`).

---

## Step 2: Python Backend (`backend/plugin.py`)

The backend initializes on application startup. The file must expose an `initialize_plugin(api_instance)` function:

```python
import logging

def initialize_plugin(api):
    """
    api is an instance of DesktopApi.
    You can inject custom methods into it using setattr.
    """
    setattr(api, 'plugin_my_custom_method', my_custom_method)
    logging.info("My Custom Plugin successfully initialized")

def my_custom_method():
    return {"success": True, "message": "Hello from Python!"}
```

---

## Step 3: Custom Dataset Formats (Format Adapter API)

If you want Prose to support your custom JSONL schema, register an adapter in `backend/plugin.py`:

```python
def initialize_plugin(api):
    # Convert from your custom schema to Prose canonical schema
    def to_canonical(raw_json):
        return {
            "system": raw_json.get("sys_prompt", ""),
            "user": raw_json.get("question", ""),
            "thought": raw_json.get("chain_of_thought", ""),
            "assistant": raw_json.get("answer", "")
        }

    # Convert from Prose canonical schema back to your format on save
    def from_canonical(canonical):
        return {
            "sys_prompt": canonical.get("system", ""),
            "question": canonical.get("user", ""),
            "chain_of_thought": canonical.get("thought", ""),
            "answer": canonical.get("assistant", "")
        }

    # Register adapter into Prose core
    api.register_format_adapter(
        format_id="my_custom_schema",
        display_name="Custom Schema (question / answer)",
        to_canonical=to_canonical,
        from_canonical=from_canonical
    )
```

---

## Step 4: Frontend & UI Buttons (`frontend/main.js`)

When `has_frontend` is `true`, Prose loads `frontend/main.js`. You can append custom action buttons to the editor header:

```javascript
import MyPluginModal from './MyPluginModal.js';

const store = window.app_store;
const { markRaw } = Vue;

// Add action button to the editor header
store.editor_buttons.push({
    id: 'my_plugin_button',
    icon: '/plugins/my_custom_plugin/frontend/assets/icons/icon.svg',
    title: 'My Action',
    action() {
        // Open modal overlay (markRaw prevents unnecessary Vue reactivity overhead)
        store.active_overlay = markRaw(MyPluginModal);
    }
});
```

---

## Step 5: Language Packs (Locales)

To add a new interface language, simply drop a JSON file into `frontend/locales/` (e.g., `zh.json` or `fr.json`). Prose will automatically detect the new language and present it in the settings dropdown!