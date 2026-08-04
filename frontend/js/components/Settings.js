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
                font_size: 14
            },
            showLangDropdown: false,
            tempApiKey: "",
            hasApiKey: false,
            showApiKey: false,
            
            tempHfToken: "",
            hasHfToken: false,
            showHfToken: false,
            
            availableLanguages: ["ru", "en"]
        };
    },
    async mounted() {
        this.tempSettings = { ...store.settings };
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
    methods: {
        close() { 
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

        async deleteOpenRouterKey() {
            if (!window.pywebview) return;
            const confirmed = await store.showConfirm("Удаление ключа", "Вы действительно хотите удалить ключ OpenRouter из системы?");
            if (confirmed) {
                await window.pywebview.api.delete_openrouter_key();
                this.tempApiKey = "";
                this.hasApiKey = false;
            }
        },

        async save() {
            if (!window.pywebview) return;
            
            await window.pywebview.api.update_setting("language", this.tempSettings.language);
            await window.pywebview.api.update_setting("disable_animations", this.tempSettings.disable_animations);
            await window.pywebview.api.update_setting("disable_accents", this.tempSettings.disable_accents);
            await window.pywebview.api.update_setting("dev_mode", this.tempSettings.dev_mode);
            await window.pywebview.api.update_setting("font_size", this.tempSettings.font_size);
            
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
        <div class="create-modal" @click.self="showLangDropdown = false">
            <div class="cm-header">
                {{ store.t('settings_title', 'НАСТРОЙКИ') }}
                <div class="cm-red-dot" @click="close" data-tooltip="Назад"></div>
            </div>
            
            <div class="cm-datasets-box" style="width: 100%; max-width: 500px; margin-top: 10px;">
                <div class="settings-item-row">
                    <div style="display: flex; align-items: center; gap: 10px; font-size: 14px; color: #A0A0A0;">
                        <img src="assets/icons/language.svg" width="18" alt="Lang">
                        <span>{{ store.t('settings_lang', 'Язык интерфейса:') }}</span>
                    </div>

                    <div style="position: relative; width: 160px;">
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

                <div class="settings-item-row" style="flex-direction: column; align-items: flex-start; gap: 10px;">
                    <div style="display: flex; justify-content: space-between; width: 100%; color: #A0A0A0; font-size: 14px;">
                        <span>Размер шрифта:</span>
                        <span style="color: var(--text-main); font-weight: bold;">{{ tempSettings.font_size }}px</span>
                    </div>
                    <input type="range" v-model.number="tempSettings.font_size" min="12" max="22" step="1" class="custom-range" @input="updateRealtimeFont">
                </div>

                <div class="cm-toggle-card" style="background: #161616;">
                    <span>{{ store.t('settings_disable_animations', 'Отключить все анимации') }}</span>
                    <label class="toggle-switch"><input type="checkbox" v-model="tempSettings.disable_animations"><span class="toggle-slider"></span></label>
                </div>

                <div class="cm-toggle-card" style="background: #161616;">
                    <span>{{ store.t('settings_disable_accents', 'Отключить цвета ролей') }}</span>
                    <label class="toggle-switch"><input type="checkbox" v-model="tempSettings.disable_accents"><span class="toggle-slider"></span></label>
                </div>

                <!-- ТУМБЛЕР РЕЖИМА РАЗРАБОТЧИКА -->
                <div class="cm-toggle-card" style="background: #161616;">
                    <div style="display: flex; flex-direction: column;">
                        <span>{{ store.t('settings_dev_mode', 'Режим разработчика (DevTools)') }}</span>
                        <small style="font-size: 10px; color: #808080;">*Требуется перезапуск программы</small>
                    </div>
                    <label class="toggle-switch"><input type="checkbox" v-model="tempSettings.dev_mode"><span class="toggle-slider"></span></label>
                </div>

                <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                    <span style="font-size: 14px; color: #A0A0A0;">{{ store.t('settings_api_key', 'Ключ OpenRouter (AES-256 OS Keyring):') }}</span>
                    
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <input :type="showApiKey ? 'text' : 'password'" v-model="tempApiKey" :placeholder="store.t('settings_api_ph', 'sk-or-v1-...')" class="message-textarea" style="min-height: auto; padding: 10px; background: #161616; flex: 1;">
                        
                        <button class="icon-btn bg-icon" @click="showApiKey = !showApiKey" :data-tooltip="showApiKey ? 'Скрыть' : 'Показать'" style="width: 38px; height: 38px; flex-shrink: 0;">
                            <img :src="showApiKey ? 'assets/icons/close_eye.svg' : 'assets/icons/Eye.svg'">
                        </button>

                        <button v-if="hasApiKey" class="icon-btn bg-icon" @click="deleteOpenRouterKey" data-tooltip="Удалить из системы" style="width: 38px; height: 38px; flex-shrink: 0; background-color: rgba(211, 70, 70, 0.1);">
                            <img src="assets/icons/close_eye.svg" style="filter: brightness(0) saturate(100%) invert(43%) sepia(50%) saturate(884%) hue-rotate(314deg) brightness(88%) contrast(92%);">
                        </button>
                    </div>
                </div>

                <div style="margin-top: 15px; display: flex; flex-direction: column; gap: 8px;">
                    <span style="font-size: 14px; color: #A0A0A0;">Hugging Face Write Token (AES-256 OS Keyring):</span>
                    <input type="password" v-model="tempHfToken" placeholder="hf_..." class="message-textarea" style="min-height: auto; padding: 10px; background: #161616;">
                    <small v-if="hasHfToken" style="color: #4D986D;">Токен Hugging Face зашифрован в системе.</small>
                </div>
            </div>

            <button class="btn-primary cm-submit-btn" @click="save">
                {{ store.t('btn_save', 'Сохранить') }}
            </button>
        </div>
    `
};