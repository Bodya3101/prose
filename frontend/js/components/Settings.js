import { store } from '../store.js';

export default {
    name: 'Settings',
    setup() { return { store }; },
    data() {
        return {
            tempSettings: {
                language: 'ru',
                disable_animations: false,
                disable_accents: false,
                dev_mode: false,
                font_size: 14,
                hotkeys: {
                    nav_next: "ArrowRight",
                    nav_prev: "ArrowLeft",
                    nav_begin: "ArrowDown",
                    nav_end: "ArrowUp",
                    fav_toggle: "Ctrl+*",
                    jump_undo: "Ctrl+Z"
                }
            },
            showLangDropdown: false,
            tempApiKey: "", hasApiKey: false, showApiKey: false,
            tempHfToken: "", hasHfToken: false, showHfToken: false,
            availableLanguages: ["ru", "en"],
            recordingKeyAction: null
        };
    },
    async mounted() {
        this.tempSettings = { ...store.settings };
        if (!this.tempSettings.hotkeys) {
            this.tempSettings.hotkeys = {
                nav_next: "ArrowRight", nav_prev: "ArrowLeft",
                nav_begin: "ArrowDown", nav_end: "ArrowUp",
                fav_toggle: "Ctrl+*", jump_undo: "Ctrl+Z"
            };
        }
        if (window.pywebview) {
            this.hasApiKey = await window.pywebview.api.has_openrouter_key();
            this.hasHfToken = await window.pywebview.api.has_hf_token();
            this.availableLanguages = await window.pywebview.api.get_available_languages();
            if (this.hasApiKey) {
                const r = await window.pywebview.api.get_openrouter_key();
                if (r.success) this.tempApiKey = r.key;
            }
        }
    },
    unmounted() {
        this.stopRecordingKey();
    },
    methods: {
        close() { 
            this.stopRecordingKey();
            const savedSize = store.settings.font_size || 14;
            document.documentElement.style.setProperty('--font-size', `${savedSize}px`);
            store.currentView = 'home'; 
        },
        updateRealtimeFont() {
            document.documentElement.style.setProperty('--font-size', `${this.tempSettings.font_size}px`);
        },
        getLangLabel(lang) {
            if (!lang) return "";
            const l = String(lang).toLowerCase();
            if (l === 'ru') return 'Русский';
            if (l === 'en') return 'English';
            if (l.startsWith('zh') || l.includes('chinese')) return '中文 (Chinese)';
            return String(lang).toUpperCase();
        },
        
        resetDefaultHotkeys() {
            this.tempSettings.hotkeys = {
                nav_next: "ArrowRight",
                nav_prev: "ArrowLeft",
                nav_begin: "ArrowDown",
                nav_end: "ArrowUp",
                fav_toggle: "Ctrl+*",
                jump_undo: "Ctrl+Z"
            };
            this.stopRecordingKey();
        },

        unbindHotkey(actionKey) {
            this.tempSettings.hotkeys[actionKey] = null;
            if (this.recordingKeyAction === actionKey) this.stopRecordingKey();
        },

        getHotkeyKeyCaps(code) {
            if (!code) return ["—"];
            const parts = String(code).split('+');
            return parts.map(p => {
                if (p === "ArrowRight") return "→";
                if (p === "ArrowLeft") return "←";
                if (p === "ArrowDown") return "↓";
                if (p === "ArrowUp") return "↑";
                if (p === "Enter") return "↵ Enter";
                return p;
            });
        },

        startRecordingKey(actionKey) {
            if (this.recordingKeyAction) this.stopRecordingKey();
            this.recordingKeyAction = actionKey;
            window.addEventListener('keydown', this.handleKeyRecord);
        },
        stopRecordingKey() {
            this.recordingKeyAction = null;
            window.removeEventListener('keydown', this.handleKeyRecord);
        },
        handleKeyRecord(e) {
            e.preventDefault();
            e.stopPropagation();

            if (e.code === 'Escape') {
                this.stopRecordingKey();
                return;
            }

            let keyName = e.code;
            if (keyName.startsWith('Key')) keyName = keyName.replace('Key', '');
            if (keyName.startsWith('Digit')) keyName = keyName.replace('Digit', '');

            if (!['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
                let combo = [];
                if (e.ctrlKey) combo.push('Ctrl');
                if (e.altKey) combo.push('Alt');
                combo.push(keyName);

                this.tempSettings.hotkeys[this.recordingKeyAction] = combo.length > 1 ? combo.join('+') : e.code;
                this.stopRecordingKey();
            }
        },

        async save() {
            if (!window.pywebview) return;
            
            await window.pywebview.api.update_setting("language", this.tempSettings.language);
            await window.pywebview.api.update_setting("disable_animations", this.tempSettings.disable_animations);
            await window.pywebview.api.update_setting("disable_accents", this.tempSettings.disable_accents);
            await window.pywebview.api.update_setting("dev_mode", this.tempSettings.dev_mode);
            await window.pywebview.api.update_setting("font_size", this.tempSettings.font_size);
            await window.pywebview.api.update_setting("hotkeys", this.tempSettings.hotkeys);
            
            store.settings = { ...this.tempSettings };
            
            this.applyGlobalSystemStyles();
            await store.setLanguage(this.tempSettings.language);
            
            if (this.tempApiKey.trim() !== "") {
                await window.pywebview.api.save_openrouter_key(this.tempApiKey.trim());
                this.hasApiKey = true;
            }
            if (this.tempHfToken.trim() !== "") {
                await window.pywebview.api.save_hf_token(this.tempHfToken.trim());
                this.hasHfToken = true;
                store.hasHfToken = true;
                this.tempHfToken = "";
            }
            store.currentView = 'home';
        },
        applyGlobalSystemStyles() {
            document.documentElement.style.setProperty('--font-size', `${store.settings.font_size}px`);
            if (store.settings.disable_animations) document.body.classList.add('no-animations');
            else document.body.classList.remove('no-animations');
            if (!store.settings.disable_accents) document.body.classList.add('theme-accent');
            else document.body.classList.remove('theme-accent');
        }
    },
    template: `
        <div class="create-modal" style="max-width: 680px; width: 100%; padding: 25px;" @click.self="showLangDropdown = false">
            <div class="cm-header">
                {{ store.t('settings_title', 'НАСТРОЙКИ') }}
                <div class="cm-red-dot" @click="close" :data-tooltip="store.t('btn_back', 'Back')"></div>
            </div>
            
            <div class="cm-datasets-box" style="width: 100%; margin-top: 15px; max-height: 60vh; overflow-y: auto; padding-right: 12px; gap: 12px;">
                
                <!-- ЯЗЫК ИНТЕРФЕЙСА -->
                <div class="settings-item-row">
                    <div style="display: flex; align-items: center; gap: 10px; font-size: 14px; color: #A0A0A0;">
                        <img src="assets/icons/language.svg" width="18" alt="Lang">
                        <span>{{ store.t('settings_lang', 'Язык интерфейса:') }}</span>
                    </div>
                    <div style="position: relative; width: 170px;">
                        <div class="custom-select-trigger" @click="showLangDropdown = !showLangDropdown">
                            <span>{{ getLangLabel(tempSettings.language) }}</span>
                            <span style="font-size: 10px; transition: transform 0.2s;" :style="{ transform: showLangDropdown ? 'rotate(180deg)' : 'rotate(0deg)' }">▼</span>
                        </div>
                        <div v-if="showLangDropdown" class="custom-dropdown-list" style="top: 110%;">
                            <div v-for="lang in availableLanguages" :key="lang" class="custom-dropdown-item" @click="tempSettings.language = lang; showLangDropdown = false">
                                {{ getLangLabel(lang) }}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- РАЗМЕР ШРИФТА -->
                <div class="settings-item-row" style="flex-direction: column; align-items: flex-start; gap: 10px;">
                    <div style="display: flex; justify-content: space-between; width: 100%; color: #A0A0A0; font-size: 14px;">
                        <span>{{ store.t('settings_font_size', 'Font size:') }}</span>
                        <span style="color: var(--text-main); font-weight: bold;">{{ tempSettings.font_size }}px</span>
                    </div>
                    <input type="range" v-model.number="tempSettings.font_size" min="12" max="22" step="1" class="custom-range" @input="updateRealtimeFont">
                </div>

                <!-- ⌨️ ГОРЯЧИЕ КЛАВИШИ С ЕДИНЫМ ЦВЕТОМ И КНОПКОЙ СБРОСА -->
                <div style="margin-top: 5px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 14px; color: #A0A0A0; font-weight: bold;">{{ store.t('settings_hotkeys_title', 'Горячие клавиши') }}:</span>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span v-if="recordingKeyAction" style="font-size: 11px; color: #CB3153; font-weight: bold;">
                                {{ store.t('hk_recording_hint', 'Press any key (Esc to cancel)...') }}
                            </span>
                            <button class="cp-default-btn" @click="resetDefaultHotkeys" style="padding: 3px 8px; font-size: 11px;">
                                {{ store.t('btn_reset_hotkeys', 'Reset Hotkeys') }}
                            </button>
                        </div>
                    </div>
                    
                    <div v-for="(code, action) in tempSettings.hotkeys" :key="action" class="settings-item-row" style="padding: 10px 14px;">
                        <span style="font-size: 12px; color: #aaa;">{{ store.t('hk_' + action, action) }}</span>
                        
                        <div style="display: flex; align-items: center; gap: 10px; position: relative;">
                            <!-- Единые монолитные колпачки клавиш -->
                            <div style="display: flex; align-items: center; gap: 5px;">
                                <template v-for="(k, idx) in getHotkeyKeyCaps(code)" :key="idx">
                                    <div class="key-cap" 
                                         :class="{ disabled: !code, enter: k.includes('Enter') || k.includes('↵'), recording: recordingKeyAction === action }"
                                         @click="startRecordingKey(action)"
                                         :data-tooltip="store.t('tooltip_click_to_change', 'Click to change')">
                                        {{ recordingKeyAction === action ? '...' : k }}
                                    </div>
                                    <span v-if="idx < getHotkeyKeyCaps(code).length - 1" style="font-size: 10px; color: #666; font-weight: bold;">+</span>
                                </template>
                            </div>

                            <!-- Красный кружок отвязки клавиши -->
                            <div class="cm-red-dot" 
                                 @click="unbindHotkey(action)" 
                                 :data-tooltip="store.t('hk_unbind_tooltip', 'Отвязать клавишу')" 
                                 style="width: 14px; height: 14px; flex-shrink: 0; opacity: 0.8;">
                            </div>
                        </div>
                    </div>
                </div>

                <div class="cm-toggle-card" style="background: #161616;">
                    <span>{{ store.t('settings_disable_animations', 'Отключить все анимации') }}</span>
                    <label class="toggle-switch"><input type="checkbox" v-model="tempSettings.disable_animations"><span class="toggle-slider"></span></label>
                </div>

                <div class="cm-toggle-card" style="background: #161616;">
                    <span>{{ store.t('settings_disable_accents', 'Отключить цвета ролей') }}</span>
                    <label class="toggle-switch"><input type="checkbox" v-model="tempSettings.disable_accents"><span class="toggle-slider"></span></label>
                </div>

                <div class="cm-toggle-card" style="background: #161616;">
                    <div style="display: flex; flex-direction: column;">
                        <span>{{ store.t('settings_dev_mode', 'Режим разработчика (DevTools)') }}</span>
                        <small style="font-size: 10px; color: #808080;">*Требуется перезапуск программы</small>
                    </div>
                    <label class="toggle-switch"><input type="checkbox" v-model="tempSettings.dev_mode"><span class="toggle-slider"></span></label>
                </div>

                <!-- OPENROUTER KEY -->
                <div style="margin-top: 5px; display: flex; flex-direction: column; gap: 8px;">
                    <span style="font-size: 14px; color: #A0A0A0;">{{ store.t('settings_api_key', 'Ключ OpenRouter (AES-256 OS Keyring):') }}</span>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <input :type="showApiKey ? 'text' : 'password'" v-model="tempApiKey" :placeholder="store.t('settings_api_ph', 'sk-or-v1-...')" class="message-textarea" style="min-height: auto; padding: 10px; background: #161616; flex: 1;">
                        <button class="icon-btn bg-icon" @click="showApiKey = !showApiKey" :data-tooltip="showApiKey ? 'Скрыть' : 'Показать'" style="width: 38px; height: 38px; flex-shrink: 0;">
                            <img :src="showApiKey ? 'assets/icons/close_eye.svg' : 'assets/icons/Eye.svg'">
                        </button>
                    </div>
                </div>

                <!-- HUGGING FACE TOKEN -->
                <div style="margin-top: 5px; display: flex; flex-direction: column; gap: 8px;">
                    <span style="font-size: 14px; color: #A0A0A0;">Hugging Face Write Token (AES-256 OS Keyring):</span>
                    <input type="password" v-model="tempHfToken" placeholder="hf_..." class="message-textarea" style="min-height: auto; padding: 10px; background: #161616;">
                    <small v-if="hasHfToken" style="color: #4D986D;">Токен Hugging Face зашифрован в системе.</small>
                </div>

            </div>

            <!-- ПОЦЕНТРОВАННАЯ КНОПКА СОХРАНИТЬ -->
            <button class="btn-primary cm-submit-btn" @click="save" style="margin: 20px auto 0 auto; display: block; width: 100%; max-width: 220px;">
                {{ store.t('btn_save', 'Сохранить') }}
            </button>
        </div>
    `
};