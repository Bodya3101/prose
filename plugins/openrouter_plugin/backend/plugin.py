import ipaddress
import json
import logging
import re
import time
from collections import deque
from threading import Lock
from urllib.parse import urlsplit, urlunsplit

import keyring
import requests

APP_NAME = "LLM_Dataset_Editor"
DEFAULT_RPM = 60
MAX_RPM = 600
_RATE_WINDOW_SECONDS = 60.0
_api_instance = None
_rate_lock = Lock()
_request_timestamps = {}


def initialize_plugin(api_instance):
    global _api_instance
    _api_instance = api_instance
    setattr(api_instance, "plugin_openrouter_get_models", plugin_openrouter_get_models)
    setattr(api_instance, "plugin_openrouter_generate_batch", plugin_openrouter_generate_batch)
    setattr(api_instance, "plugin_openrouter_save_config", plugin_openrouter_save_config)


def _get_setting(name, default=None):
    if _api_instance is None:
        return default
    try:
        return _api_instance.get_settings().get(name, default)
    except Exception:
        return default


def _set_setting(name, value):
    if _api_instance is None:
        raise RuntimeError("Plugin API is not initialized.")
    if not _api_instance.update_setting(name, value):
        raise RuntimeError(f"Could not save setting: {name}")


def _normalize_base_url(value):
    """Validate a custom OpenAI-compatible API base URL."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Укажите Base URL кастомного провайдера.")
    value = value.strip()
    if any(char.isspace() for char in value):
        raise ValueError("Base URL не должен содержать пробелы.")
    try:
        parsed = urlsplit(value)
        _ = parsed.port
    except ValueError as exc:
        raise ValueError("Некорректный Base URL.") from exc

    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError("Base URL должен начинаться с http:// или https://.")
    host = (parsed.hostname or "").lower()
    if not host or parsed.username is not None or parsed.password is not None:
        raise ValueError("Укажите адрес без логина и пароля в URL.")
    if parsed.query or parsed.fragment:
        raise ValueError("Не помещайте API-ключи или параметры в query/fragment URL.")
    if parsed.path.endswith("/chat/completions") or parsed.path.endswith("/models"):
        raise ValueError("Укажите базовый URL API, например https://host.example/v1.")

    if scheme == "http":
        local_host = (
            host == "localhost"
            or host.endswith(".localhost")
            or host.endswith(".local")
            or host == "host.docker.internal"
        )
        try:
            address = ipaddress.ip_address(host)
            local_host = local_host or address.is_private or address.is_loopback or address.is_link_local
        except ValueError:
            pass
        if not local_host:
            raise ValueError("Для удалённого провайдера используйте HTTPS. HTTP разрешён для локальных адресов.")

    path = parsed.path.rstrip("/")
    return urlunsplit((scheme, parsed.netloc, path, "", ""))


def _validate_rpm(value):
    if isinstance(value, bool):
        raise ValueError("RPM должен быть целым числом от 1 до 600.")
    try:
        if isinstance(value, float) and not value.is_integer():
            raise ValueError
        raw = str(value).strip()
        if not re.fullmatch(r"\d+", raw):
            raise ValueError
        rpm = int(raw)
    except (TypeError, ValueError):
        raise ValueError("RPM должен быть целым числом от 1 до 600.")
    if not 1 <= rpm <= MAX_RPM:
        raise ValueError("RPM должен быть целым числом от 1 до 600.")
    return rpm


def _get_custom_key():
    return keyring.get_password(APP_NAME, "openrouter_custom_key") or ""


def _get_openrouter_key():
    return keyring.get_password(APP_NAME, "openrouter_key") or ""


def _headers_for(provider, api_key):
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/Bodya3101/prose"
        headers["X-Title"] = "Prose Dataset Editor"
    return headers


def _provider_config(provider):
    if provider not in ("openrouter", "custom"):
        raise ValueError("Неизвестный провайдер.")
    if provider == "openrouter":
        api_key = _get_openrouter_key()
        if not api_key.strip():
            raise ValueError("Ключ OpenRouter не найден в системном хранилище. Сохраните его в настройках Prose.")
        return "https://openrouter.ai/api/v1", api_key
    base_url = _normalize_base_url(_get_setting("plugin_openrouter_custom_base_url", ""))
    return base_url, _get_custom_key()


def _rate_limit(rpm, bucket):
    """Serialize concurrent calls and enforce a rolling 60-second RPM window."""
    while True:
        with _rate_lock:
            now = time.monotonic()
            timestamps = _request_timestamps.setdefault(bucket, deque())
            cutoff = now - _RATE_WINDOW_SECONDS
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if len(timestamps) < rpm:
                timestamps.append(now)
                return
            wait_seconds = max(0.01, _RATE_WINDOW_SECONDS - (now - timestamps[0]))
        time.sleep(wait_seconds)


def _http_error(response, api_key=""):
    status = getattr(response, "status_code", 0)
    if status in (301, 302, 303, 307, 308):
        return f"Провайдер вернул перенаправление (HTTP {status}). Перенаправления отключены по соображениям безопасности."
    if status in (401, 403):
        return f"Провайдер отклонил авторизацию (HTTP {status}). Проверьте API-ключ."
    if status == 429:
        return "Провайдер вернул HTTP 429: превышен его лимит запросов."
    return f"Провайдер вернул HTTP {status}."


def plugin_openrouter_save_config(provider="openrouter", base_url="", api_key="", rpm=DEFAULT_RPM, clear_custom_key=False):
    """Store preferences in app settings and credentials only in the OS Keyring."""
    try:
        if provider not in ("openrouter", "custom"):
            return {"success": False, "error": "Неизвестный провайдер."}
        rpm_value = _validate_rpm(rpm)
        normalized_url = _normalize_base_url(base_url) if provider == "custom" else None
        if not isinstance(api_key, str) or len(api_key) > 2048:
            return {"success": False, "error": "Некорректный API-ключ."}

        supplied_key = api_key.strip()
        if clear_custom_key:
            existing_key = keyring.get_password(APP_NAME, "openrouter_custom_key")
            if existing_key is not None:
                keyring.delete_password(APP_NAME, "openrouter_custom_key")
        elif supplied_key:
            keyring.set_password(APP_NAME, "openrouter_custom_key", supplied_key)

        if normalized_url is not None:
            _set_setting("plugin_openrouter_custom_base_url", normalized_url)
        _set_setting("plugin_openrouter_provider", provider)
        _set_setting("plugin_openrouter_rpm", rpm_value)
        return {
            "success": True,
            "provider": provider,
            "rpm": rpm_value,
            "base_url": normalized_url or _get_setting("plugin_openrouter_custom_base_url", ""),
            "has_custom_key": bool(_get_custom_key()),
        }
    except (ValueError, RuntimeError) as exc:
        return {"success": False, "error": str(exc)}
    except Exception as exc:
        logging.warning("Could not save OpenRouter plugin settings: %s", type(exc).__name__)
        return {"success": False, "error": "Не удалось сохранить настройки провайдера. Проверьте доступность системного Keyring."}


def plugin_openrouter_get_models(provider=None):
    """List models from OpenRouter or the selected OpenAI-compatible endpoint."""
    try:
        provider = provider or _get_setting("plugin_openrouter_provider", "openrouter")
        base_url, api_key = _provider_config(provider)
        response = requests.get(
            f"{base_url.rstrip('/')}/models",
            headers=_headers_for(provider, api_key),
            timeout=10,
            allow_redirects=False,
        )
        if not 200 <= response.status_code < 300:
            return {"success": False, "error": _http_error(response, api_key)}
        data = response.json()
        models = [
            item["id"] for item in data.get("data", [])
            if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"].strip()
        ]
        models.sort()
        return {"success": True, "models": models}
    except (ValueError, RuntimeError) as exc:
        return {"success": False, "error": str(exc)}
    except requests.RequestException:
        return {"success": False, "error": "Не удалось подключиться к API провайдера. Проверьте URL и сеть."}
    except (json.JSONDecodeError, AttributeError, TypeError):
        return {"success": False, "error": "Провайдер вернул некорректный список моделей."}
    except Exception as exc:
        logging.warning("Could not load provider models: %s", type(exc).__name__)
        return {"success": False, "error": "Не удалось получить список моделей провайдера."}


def plugin_openrouter_generate_batch(generator_prompt: str, empty_fields: list, hardcoded_context: dict, batch_size: int, model_name: str, provider: str = "openrouter") -> dict:
    try:
        base_url, api_key = _provider_config(provider)
        rpm = _validate_rpm(_get_setting("plugin_openrouter_rpm", DEFAULT_RPM))
        if not isinstance(generator_prompt, str) or not generator_prompt.strip():
            return {"success": False, "error": "Опишите задачу для генератора."}
        if not isinstance(model_name, str) or not model_name.strip() or len(model_name) > 300:
            return {"success": False, "error": "Укажите корректный ID модели."}
        if isinstance(batch_size, bool) or not isinstance(batch_size, int) or not 1 <= batch_size <= 100:
            return {"success": False, "error": "Размер пакета должен быть от 1 до 100."}
        if not isinstance(empty_fields, list) or not all(isinstance(field, str) for field in empty_fields):
            return {"success": False, "error": "Некорректный список полей датасета."}
        if not isinstance(hardcoded_context, dict):
            return {"success": False, "error": "Некорректный контекст датасета."}

        system_instruction = f"You are an AI dataset generator. Task:\n{generator_prompt}\n\n"
        if hardcoded_context:
            system_instruction += "CONTEXT (Use this to understand the dialogue, DO NOT generate these keys):\n"
            for key, value in hardcoded_context.items():
                if str(value).strip():
                    system_instruction += f"<{key}>{value}</{key}>\n"
        system_instruction += (
            f"\nCRITICAL INSTRUCTIONS:\n"
            f"1. You must return a JSON array containing EXACTLY {batch_size} objects.\n"
            f"2. DIVERSITY: All {batch_size} objects MUST be completely UNIQUE and explore DIFFERENT aspects, questions, or scenarios.\n"
            f"3. FORMAT: Each object MUST contain EXACTLY these keys: {json.dumps(empty_fields)}. Do NOT include any other keys!\n"
            f"4. OUTPUT: Return only the JSON array, without markdown code fences."
        )

        _rate_limit(rpm, f"{provider}:{base_url.rstrip('/')}")
        response = requests.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers=_headers_for(provider, api_key),
            json={
                "model": model_name.strip(),
                "messages": [{"role": "system", "content": system_instruction}],
                "temperature": 0.8,
            },
            timeout=(10, 120),
            allow_redirects=False,
        )
        if not 200 <= response.status_code < 300:
            return {"success": False, "error": _http_error(response, api_key)}
        response_data = response.json()
        choices = response_data.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            return {"success": False, "error": "Ответ ИИ не содержит результатов (choices)."}
        message = choices[0].get("message")
        if not isinstance(message, dict):
            return {"success": False, "error": "Ответ ИИ не содержит message.content."}
        content = message.get("content", "")
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") for part in content
                if isinstance(part, dict) and isinstance(part.get("text", ""), str)
            )
        if not isinstance(content, str) or not content.strip():
            return {"success": False, "error": "Провайдер вернул пустой текстовый ответ."}

        response_text = content.strip()
        fence = chr(96) * 3
        if response_text.startswith(fence):
            newline = response_text.find("\n")
            response_text = response_text[newline + 1:] if newline >= 0 else response_text[len(fence):]
        if response_text.rstrip().endswith(fence):
            response_text = response_text.rstrip()[:-len(fence)].strip()
        parsed_array = json.loads(response_text.strip())
        if not isinstance(parsed_array, list) or not all(isinstance(item, dict) for item in parsed_array):
            return {"success": False, "error": "ИИ должен вернуть JSON-массив объектов."}
        if len(parsed_array) != batch_size:
            return {"success": False, "error": f"ИИ вернул {len(parsed_array)} объектов вместо {batch_size}. Попробуйте повторить запрос."}
        return {"success": True, "data": parsed_array}
    except json.JSONDecodeError:
        return {"success": False, "error": "ИИ вернул некорректный JSON. Попробуйте другую модель или повторите запрос."}
    except (ValueError, RuntimeError) as exc:
        return {"success": False, "error": str(exc)}
    except requests.RequestException:
        return {"success": False, "error": "Не удалось подключиться к API провайдера. Проверьте Base URL и сеть."}
    except Exception as exc:
        logging.warning("OpenRouter plugin request failed: %s", type(exc).__name__)
        return {"success": False, "error": "Ошибка выполнения запроса к провайдеру."}
