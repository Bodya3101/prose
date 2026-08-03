import keyring
import requests
import json
import logging

APP_NAME = "LLM_Dataset_Editor"

def initialize_plugin(api_instance):
    setattr(api_instance, 'plugin_openrouter_get_models', plugin_openrouter_get_models)
    setattr(api_instance, 'plugin_openrouter_generate_batch', plugin_openrouter_generate_batch)

def plugin_openrouter_get_models() -> dict:
    """Возвращает список всех доступных моделей с сервера OpenRouter"""
    try:
        r = requests.get("https://openrouter.ai/api/v1/models", timeout=10)
        if r.status_code != 200:
            return {"success": False, "error": f"Ошибка сервера OpenRouter: HTTP {r.status_code}"}
            
        data = r.json()
        models = [m["id"] for m in data.get("data", [])]
        models.sort()
        return {"success": True, "models": models}
    except Exception as e:
        return {"success": False, "error": f"Не удалось получить список моделей: {str(e)}"}

def plugin_openrouter_generate_batch(generator_prompt: str, empty_fields: list, hardcoded_context: dict, batch_size: int, model_name: str) -> dict:
    api_key = keyring.get_password(APP_NAME, "openrouter_key")
    if not api_key or not api_key.strip(): 
        return {"success": False, "error": "Ключ OpenRouter не найден в OS Keyring. Перейдите в Настройки и сохраните API ключ."}
    
    system_instruction = f"You are an AI dataset generator. Task:\n{generator_prompt}\n\n"
    
    if hardcoded_context:
        system_instruction += "CONTEXT (Use this to understand the dialogue, DO NOT generate these keys):\n"
        for k, v in hardcoded_context.items():
            if str(v).strip(): 
                system_instruction += f"<{k}>{v}</{k}>\n"
                
    system_instruction += (
        f"\nCRITICAL INSTRUCTIONS:\n"
        f"1. You must return a JSON array containing EXACTLY {batch_size} objects.\n"
        f"2. DIVERSITY: All {batch_size} objects MUST be completely UNIQUE and explore DIFFERENT aspects, questions, or scenarios.\n"
        f"3. FORMAT: Each object MUST contain EXACTLY these keys: {json.dumps(empty_fields)}. Do NOT include any other keys!\n"
        f"4. OUTPUT: Your response must start with '[' and end with ']'. Do NOT use markdown code blocks like ```json."
    )

    try:
        headers = {
            "Authorization": f"Bearer {api_key.strip()}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/Bodya3101/datasets_editor",
            "X-Title": "LLM Dataset Editor"
        }
        
        payload = {
            "model": model_name,
            "messages": [{"role": "system", "content": system_instruction}],
            "temperature": 0.8
        }

        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=120
        )

        res_data = response.json()

        if "error" in res_data:
            err_info = res_data["error"]
            err_msg = err_info.get("message", str(err_info)) if isinstance(err_info, dict) else str(err_info)
            return {"success": False, "error": f"OpenRouter API: {err_msg}"}

        if "choices" not in res_data or not res_data["choices"]:
            return {"success": False, "error": f"Ответ ИИ не содержит результатов (choices). HTTP status: {response.status_code}"}

        text = res_data["choices"][0]["message"]["content"].strip()
        
        if text.startswith("```json"): text = text[7:]
        if text.startswith("```"): text = text[3:]
        if text.endswith("```"): text = text[:-3]
        
        parsed_array = json.loads(text.strip())
        if not isinstance(parsed_array, list):
            raise ValueError("ИИ вернул ответ не в формате JSON-массива.")
            
        return {"success": True, "data": parsed_array}
    except json.JSONDecodeError:
        return {"success": False, "error": "ИИ вернул некорректный JSON. Попробуйте выбрать более мощную модель (например, Anthropic или OpenAI)."}
    except Exception as e:
        return {"success": False, "error": f"Ошибка выполнения: {str(e)}"}