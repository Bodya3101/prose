import base64
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import plugin


class OpenRouterPluginValidationTests(unittest.TestCase):
    def test_normalizes_openai_compatible_base_url(self):
        self.assertEqual(plugin._normalize_base_url("https://api.example.com/v1/"), "https://api.example.com/v1")
        self.assertEqual(plugin._normalize_base_url("http://localhost:1234/v1"), "http://localhost:1234/v1")

    def test_rejects_unsafe_url_shapes(self):
        bad_urls = [
            "https://user:password@api.example.com/v1",
            "https://api.example.com/v1?api_key=secret",
            "file:///tmp/provider",
            "https://api.example.com/v1#token",
            "http://api.example.com/v1",
        ]
        for url in bad_urls:
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    plugin._normalize_base_url(url)

    def test_rpm_bounds(self):
        self.assertEqual(plugin._validate_rpm(60), 60)
        self.assertEqual(plugin._validate_rpm("1"), 1)
        self.assertEqual(plugin._validate_rpm(600), 600)
        for rpm in (0, 601, 1.5, True, "fast"):
            with self.subTest(rpm=rpm):
                with self.assertRaises(ValueError):
                    plugin._validate_rpm(rpm)

    def test_rpm_limiter_waits_for_the_rolling_window(self):
        bucket = "test-rpm-limiter"
        plugin._request_timestamps.pop(bucket, None)
        with patch.object(plugin.time, "monotonic", side_effect=[0.0, 0.0, 60.1]):
            with patch.object(plugin.time, "sleep") as sleep:
                plugin._rate_limit(1, bucket)
                plugin._rate_limit(1, bucket)
        self.assertEqual(sleep.call_count, 1)
        self.assertGreaterEqual(sleep.call_args.args[0], 59.9)
        plugin._request_timestamps.pop(bucket, None)

    def test_custom_model_request_uses_key_and_disables_redirects(self):
        api = Mock()
        api.get_settings.return_value = {"plugin_openrouter_custom_base_url": "https://api.example.com/v1"}
        plugin.initialize_plugin(api)
        response = Mock(status_code=200)
        response.json.return_value = {"data": [{"id": "org/model-a"}]}
        with patch.object(plugin.keyring, "get_password", return_value="test-secret"):
            with patch.object(plugin, "_rate_limit") as rate_limit:
                with patch.object(plugin.requests, "get", return_value=response) as get:
                    result = plugin.plugin_openrouter_get_models("custom")
        rate_limit.assert_called_once_with(60, "custom:https://api.example.com/v1")
        self.assertTrue(result["success"])
        self.assertEqual(result["models"], ["org/model-a"])
        args, kwargs = get.call_args
        self.assertEqual(args[0], "https://api.example.com/v1/models")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer test-secret")
        self.assertFalse(kwargs["allow_redirects"])

    def test_openrouter_model_list_is_public_without_saved_key(self):
        api = Mock()
        api.get_settings.return_value = {"plugin_openrouter_provider": "openrouter"}
        plugin.initialize_plugin(api)
        response = Mock(status_code=200)
        response.json.return_value = {"data": [{"id": "org/model-b"}]}
        with patch.object(plugin.keyring, "get_password", return_value=""):
            with patch.object(plugin.requests, "get", return_value=response) as get:
                result = plugin.plugin_openrouter_get_models("openrouter")
        self.assertTrue(result["success"])
        self.assertEqual(result["models"], ["org/model-b"])
        self.assertNotIn("Authorization", get.call_args.kwargs["headers"])

    def test_custom_key_is_persisted_in_system_keyring(self):
        api = Mock()
        api.get_settings.return_value = {"plugin_openrouter_custom_base_url": "https://api.example.com/v1"}
        api.update_setting.return_value = True
        plugin.initialize_plugin(api)
        with patch.object(plugin.keyring, "set_password") as set_password:
            with patch.object(plugin.keyring, "get_password", return_value="persisted-secret"):
                result = plugin.plugin_openrouter_save_config(
                    "custom", "https://api.example.com/v1", "persisted-secret", 60, False
                )
        self.assertTrue(result["success"])
        self.assertTrue(result["has_custom_key"])
        set_password.assert_called_once_with(plugin.APP_NAME, "openrouter_custom_key", "persisted-secret")

    def test_config_status_never_returns_the_secret(self):
        api = Mock()
        api.get_settings.return_value = {
            "plugin_openrouter_provider": "custom",
            "plugin_openrouter_custom_base_url": "https://api.example.com/v1",
            "plugin_openrouter_rpm": 30,
        }
        plugin.initialize_plugin(api)
        with patch.object(plugin.keyring, "get_password", return_value="do-not-return-this"):
            result = plugin.plugin_openrouter_get_config()
        self.assertTrue(result["success"])
        self.assertTrue(result["has_custom_key"])
        self.assertNotIn("do-not-return-this", str(result))

    def test_extracts_text_attachment(self):
        content = "Chapter One\nA sufficiently useful source document."
        encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
        result = plugin.plugin_openrouter_extract_documents([{"name": "source.txt", "data_base64": encoded}])
        self.assertTrue(result["success"])
        self.assertEqual(result["documents"][0]["text"], content)

    def test_attachment_count_and_extension_are_validated(self):
        too_many = [{"name": "a.txt", "data_base64": base64.b64encode(b"x").decode("ascii")}] * 6
        result = plugin.plugin_openrouter_extract_documents(too_many)
        self.assertFalse(result["success"])
        self.assertIn("не более 5", result["error"])
        unknown = plugin.plugin_openrouter_extract_documents([{
            "name": "program.exe", "data_base64": base64.b64encode(b"x").decode("ascii")
        }])
        self.assertFalse(unknown["success"])

    def test_custom_generation_posts_to_chat_completions(self):
        api = Mock()
        api.get_settings.return_value = {
            "plugin_openrouter_custom_base_url": "https://api.example.com/v1",
            "plugin_openrouter_rpm": 60,
        }
        plugin.initialize_plugin(api)
        response = Mock(status_code=200)
        response.json.return_value = {"choices": [{"message": {"content": '[{"user":"Hi","assistant":"Hello"}]'}}]}
        with patch.object(plugin.keyring, "get_password", return_value="test-secret"):
            with patch.object(plugin.requests, "post", return_value=response) as post:
                result = plugin.plugin_openrouter_generate_batch(
                    "Generate a greeting", ["user", "assistant"], {}, 1, "org/model-a", "custom", {
                        "min_assistant_words": 60, "max_output_tokens": 4096,
                        "diversity_enabled": True, "topic_plan": "balanced",
                        "source_documents": [{"name": "roman-history.txt", "text": "Julius Caesar crossed the Rubicon."}]
                    }
                )
        self.assertTrue(result["success"])
        self.assertEqual(result["data"][0]["assistant"], "Hello")
        args, kwargs = post.call_args
        self.assertEqual(args[0], "https://api.example.com/v1/chat/completions")
        self.assertEqual(kwargs["json"]["model"], "org/model-a")
        self.assertEqual(kwargs["json"]["max_tokens"], 4096)
        self.assertIn("at least 60 words", kwargs["json"]["messages"][0]["content"])
        self.assertIn("balanced", kwargs["json"]["messages"][0]["content"])
        self.assertIn("roman-history.txt", kwargs["json"]["messages"][0]["content"])
        self.assertIn("crossed the Rubicon", kwargs["json"]["messages"][0]["content"])
        self.assertFalse(kwargs["allow_redirects"])


if __name__ == "__main__":
    unittest.main()
