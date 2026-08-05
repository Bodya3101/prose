import { store } from '../store.js';

export default {
    name: 'CreateProject',
    setup() { return { store }; },
    data() {
        return {
            formData: {
                name: "", desc: "", color: "#D9D9D9",
                logo_base64: null, use_single_prompt: false, use_thinking: false,
                tokenizer_preset: "llama3",
                dataset_format: "standard",
                datasets: [
                    { name: "Dataset.jsonl", source_path: null, edited: false }
                ]
            },
            availableFormats: [],
            showFormatDropdown: false,
            showTokenizerDropdown: false,
            showColorPicker: false,

            showTgModal: false,
            tgFilePath: "",
            tgParticipants: [],
            tgUserSender: "",
            tgAssistantSender: "",
            tgDatasetName: "",
            tgSystemPrompt: "",
            tgTotalMessages: 0
        };
    },
    async mounted() {
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_available_formats === 'function') {
            try {
                this.availableFormats = await window.pywebview.api.get_available_formats();
            } catch (e) {
                console.error("Ошибка загрузки форматов:", e);
            }
        }
        
        if (!this.availableFormats || this.availableFormats.length === 0) {
            this.availableFormats = [
                { id: "standard", name: "Standard JSONL (system / user / assistant)" },
                { id: "chatml", name: "ChatML (OpenAI / HuggingFace)" },
                { id: "sharegpt", name: "ShareGPT (Conversations)" },
                { id: "alpaca", name: "Alpaca (Instruction / Output)" }
            ];
        }
    },
    computed: {
        selectedFormatName() {
            const found = this.availableFormats.find(f => f.id === this.formData.dataset_format);
            return found ? found.name : "Standard JSONL";
        },
        selectedTokenizerName() {
            const tok = store.tokenizers[this.formData.tokenizer_preset];
            return tok ? store.t('tokenizer_' + tok.id, tok.name) : "Llama 3";
        }
    },
    watch: {
        'formData.name'(newVal) {
            const firstDs = this.formData.datasets[0];
            if (firstDs && !firstDs.edited) {
                if (!newVal) {
                    firstDs.name = "Dataset.jsonl";
                } else {
                    const safeName = newVal.replace(/[^\w\s-]/gi, '').trim().replace(/\s+/g, '_');
                    firstDs.name = safeName ? `dataset_${safeName}.jsonl` : "Dataset.jsonl";
                }
            }
        }
    },
    methods: {
        close() { store.currentView = 'home'; },
        toggleColorPicker() { this.showColorPicker = !this.showColorPicker; },
        setDefaultColor() { this.formData.color = '#D9D9D9'; this.showColorPicker = false; },

        async handleImageUpload() {
            if (!window.pywebview) return;
            const r = await window.pywebview.api.select_and_process_image();
            if (r && r.success) this.formData.logo_base64 = r.logo_base64;
        },

        addEmptyDataset() {
            const num = this.formData.datasets.length + 1;
            this.formData.datasets.push({
                name: `dataset_extra_${num}.jsonl`,
                source_path: null,
                edited: true
            });
        },

        async importDataset() {
            if (!window.pywebview) return;
            const r = await window.pywebview.api.select_existing_dataset();
            if (r && r.success) {
                this.formData.datasets.push({
                    name: r.name,
                    source_path: r.path,
                    edited: true
                });
            }
        },

        async importTelegramDataset() {
            if (!window.pywebview) return;
            const r = await window.pywebview.api.select_telegram_export_file();
            if (r && r.success) {
                this.tgFilePath = r.path;
                this.tgParticipants = r.participants || [];
                this.tgTotalMessages = r.total_messages || 0;
                
                this.tgUserSender = this.tgParticipants[0] || "";
                this.tgAssistantSender = this.tgParticipants[1] || this.tgParticipants[0] || "";
                
                const cleanChatName = (r.chat_name || "chat").replace(/[^\w\s-]/gi, '').trim().replace(/\s+/g, '_');
                const safeChatName = cleanChatName || "chat";
                this.tgDatasetName = `tg_${safeChatName}.jsonl`;
                
                this.showTgModal = true;
            } else if (r && r.error) {
                await store.showAlert(store.t('alert_error_title', 'Error'), r.error);
            }
        },

        swapTgSenders() {
            const temp = this.tgUserSender;
            this.tgUserSender = this.tgAssistantSender;
            this.tgAssistantSender = temp;
        },

        async processTelegramConversion() {
            if (!window.pywebview) return;
            if (this.tgUserSender === this.tgAssistantSender) {
                await store.showAlert(
                    store.t('alert_error_title', 'Error'), 
                    store.t('tg_err_same_person', 'User and Assistant cannot be the same participant!')
                );
                return;
            }

            const finalSysPrompt = this.formData.use_single_prompt ? "" : this.tgSystemPrompt;

            const res = await window.pywebview.api.convert_telegram_export(
                this.tgFilePath,
                this.tgUserSender,
                this.tgAssistantSender,
                this.tgDatasetName,
                this.formData.dataset_format,
                finalSysPrompt
            );

            if (res && res.success) {
                this.formData.datasets.push({
                    name: res.filename,
                    source_path: res.filepath,
                    edited: true
                });
                this.showTgModal = false;
            } else {
                await store.showAlert(
                    store.t('alert_error_title', 'Error'), 
                    (res ? res.error : store.t('tg_err_no_messages', 'Conversion failed.'))
                );
            }
        },

        removeDataset(idx) {
            this.formData.datasets.splice(idx, 1);
        },

        async submit() {
            if (!window.pywebview) return;
            if (!this.formData.name.trim()) { 
                await store.showAlert(
                    store.t('alert_error_title', 'Error'), 
                    store.t('alert_enter_project_name', 'Please enter a project name!')
                ); 
                return; 
            }
            
            const r = await window.pywebview.api.create_project(
                this.formData.name, 
                this.formData.desc, 
                this.formData.color, 
                this.formData.use_single_prompt, 
                this.formData.use_thinking, 
                this.formData.logo_base64,
                this.formData.datasets,
                this.formData.dataset_format,
                this.formData.tokenizer_preset
            );
            
            if (r.success) {
                store.visibleProjects.unshift(r.project);
                store.activeProject = r.project;
                store.currentView = 'editor';
            } else {
                await store.showAlert(
                    store.t('alert_error_title', 'Error'), 
                    store.t('alert_create_error', 'Creation error: ') + r.error
                );
            }
        }
    },
    template: `
        <div class="create-modal" @click.self="showColorPicker = false; showFormatDropdown = false; showTokenizerDropdown = false;">
            <div class="cm-header">
                {{ store.t('create_title', 'СОЗДАНИЕ ПРОЕКТА') }}
                <div class="cm-red-dot" @click="close" :data-tooltip="store.t('btn_cancel', 'Отмена')"></div>
            </div>
            
            <div class="cm-top-section">
                <div class="cm-upload" @click="handleImageUpload" :data-tooltip="store.t('tooltip_upload', 'Загрузить лого')">
                    <img v-if="formData.logo_base64" :src="formData.logo_base64" style="border-radius: 12px; object-fit: cover;">
                    <img v-else src="assets/icons/upload.svg" alt="Up">
                </div>
                
                <div class="cm-inputs">
                    <div style="display: flex; align-items: center; gap: 10px; position: relative;">
                        <input v-model="formData.name" :placeholder="store.t('placeholder_name', '*Название проекта*')" class="cm-input-name" :style="{ color: formData.color }">
                        
                        <div style="position: relative;">
                            <img src="assets/icons/choose_color.svg" @click="toggleColorPicker" style="width: 24px; height: 24px; cursor: pointer; opacity: 0.8;" :data-tooltip="store.t('tooltip_color', 'Настроить цвет')">
                            <div v-if="showColorPicker" class="cp-popover">
                                <div class="cp-row">
                                    <span>{{ store.t('color_palette', 'Палитра:') }}</span>
                                    <input type="color" v-model="formData.color" class="cp-native">
                                </div>
                                <div class="cp-row">
                                    <span>HEX:</span>
                                    <input type="text" v-model="formData.color" class="cp-hex" maxlength="7">
                                </div>
                                <button @click="setDefaultColor" class="cp-default-btn">{{ store.t('btn_default', 'По умолчанию') }}</button>
                            </div>
                        </div>
                    </div>
                    <input v-model="formData.desc" :placeholder="store.t('placeholder_desc', 'Описание')" class="cm-input-desc">
                </div>
            </div>

            <!-- ВЫБОР ЦЕЛЕВОГО ТОКЕНИЗАТОРА -->
            <div class="cm-datasets-box" style="gap: 8px;">
                <h3>{{ store.t('tokenizer_label', 'Токенизатор проекта:') }}</h3>
                <div style="position: relative; width: 100%;">
                    <div class="custom-select-trigger" @click="showTokenizerDropdown = !showTokenizerDropdown; showFormatDropdown = false;" style="padding: 10px 14px; font-weight: bold; background: #161616;">
                        <span>{{ selectedTokenizerName }}</span>
                        <span style="font-size: 10px; transition: transform 0.2s;" :style="{ transform: showTokenizerDropdown ? 'rotate(180deg)' : 'rotate(0deg)' }">▼</span>
                    </div>
                    
                    <div v-if="showTokenizerDropdown" class="custom-dropdown-list" style="top: 110%; z-index: 3100; max-height: 220px;">
                        <div v-for="(tok, tId) in store.tokenizers" :key="tId" class="custom-dropdown-item" @click="formData.tokenizer_preset = tId; showTokenizerDropdown = false;" style="padding: 10px 14px;">
                            <div style="font-weight: bold;">{{ store.t('tokenizer_' + tId, tok.name) }}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ВЫБОР ФОРМАТА РАЗМЕТКИ ДАТАСЕТА -->
            <div class="cm-datasets-box" style="gap: 8px;">
                <h3>{{ store.t('format_label', 'Разметка датасета:') }}</h3>
                <div style="position: relative; width: 100%;">
                    <div class="custom-select-trigger" @click="showFormatDropdown = !showFormatDropdown; showTokenizerDropdown = false;" style="padding: 10px 14px; font-weight: bold; background: #161616;">
                        <span>{{ selectedFormatName }}</span>
                        <span style="font-size: 10px; transition: transform 0.2s;" :style="{ transform: showFormatDropdown ? 'rotate(180deg)' : 'rotate(0deg)' }">▼</span>
                    </div>
                    
                    <div v-if="showFormatDropdown" class="custom-dropdown-list" style="top: 110%; z-index: 3000;">
                        <div v-for="fmt in availableFormats" :key="fmt.id" class="custom-dropdown-item" @click="formData.dataset_format = fmt.id; showFormatDropdown = false;" style="padding: 10px 14px;">
                            <div style="font-weight: bold;">{{ fmt.name }}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ИНТЕРАКТИВНЫЙ СПИСОК ДАТАСЕТОВ -->
            <div class="cm-datasets-box">
                <h3>{{ store.t('datasets_label', 'Датасеты:') }}</h3>
                <div v-for="(ds, idx) in formData.datasets" :key="idx" class="cm-dataset-file" style="padding: 10px 15px; margin-bottom: 8px;">
                    <img src="assets/icons/dataset_icon.svg" width="20"> 
                    <input v-model="ds.name" @input="ds.edited = true" class="cm-dataset-input" :data-tooltip="store.t('tooltip_rename', 'Нажмите для переименования')">
                    
                    <button v-if="formData.datasets.length > 1" class="icon-btn" @click="removeDataset(idx)" style="background: transparent; border: none; margin-left: 10px;" :data-tooltip="store.t('btn_delete', 'Удалить')">
                        <img src="assets/icons/close_eye.svg" style="width: 16px; height: 16px; filter: invert(0.3);">
                    </button>
                </div>
                
                <div style="display: flex; gap: 8px; margin-top: 5px; width: 100%; flex-wrap: wrap;">
                    <button @click="addEmptyDataset" style="padding: 6px 12px; font-size: 12px; background: #161616;">{{ store.t('btn_add_empty', '+ Пустой') }}</button>
                    <button @click="importDataset" style="padding: 6px 12px; font-size: 12px; background: #161616;">{{ store.t('btn_import', '+ Импорт') }}</button>
                    <button @click="importTelegramDataset" style="padding: 6px 12px; font-size: 12px; background: #1a2733; color: #52a8e8; border: 1px solid #2b4863;">{{ store.t('btn_import_tg', '+ Telegram (.json)') }}</button>
                </div>
            </div>

            <div class="cm-toggles-row">
                <div class="cm-toggle-card">
                    <span v-html="store.t('toggle_single_prompt', 'использовать единый<br>системный промпт')"></span>
                    <label class="toggle-switch"><input type="checkbox" v-model="formData.use_single_prompt"><span class="toggle-slider"></span></label>
                </div>
                <div class="cm-toggle-card">
                    <span>{{ store.t('toggle_thinking', 'Думающая модель') }}</span>
                    <label class="toggle-switch"><input type="checkbox" v-model="formData.use_thinking"><span class="toggle-slider"></span></label>
                </div>
            </div>
            <button class="btn-primary cm-submit-btn" @click="submit">{{ store.t('btn_create', 'Создать') }}</button>

            <!-- ✈️ МОДАЛЬНОЕ ОКНО ИМПОРТА ИЗ TELEGRAM -->
            <div v-if="showTgModal" class="cp-popover" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 420px; z-index: 4000; background: #121212; border: 1px solid #2a2a2a; border-radius: 16px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.8);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #222; padding-bottom: 10px;">
                    <h4 style="margin: 0; font-size: 14px; letter-spacing: 1px; color: #52a8e8; display: flex; align-items: center; gap: 6px;">
                        <img src="assets/icons/telegram_convertion.svg" style="width: 16px; height: 16px;">
                        {{ store.t('tg_modal_title', 'ИМПОРТ ИЗ TELEGRAM') }}
                    </h4>
                    <div class="cm-red-dot" @click="showTgModal = false" :data-tooltip="store.t('btn_cancel', 'Отмена')"></div>
                </div>

                <div style="font-size: 12px; color: #888; margin-bottom: 12px;">
                    {{ store.t('tg_found_messages', 'Найдено сообщений в файле: ') }} <b>{{ tgTotalMessages }}</b>
                </div>

                <!-- ВЫБОР РОЛЕЙ С КНОПКОЙ СМЕНЫ 🔄 -->
                <div style="display: flex; gap: 8px; align-items: flex-end; margin-bottom: 12px;">
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                        <label style="font-size: 11px; color: #aaa;">{{ store.t('tg_select_user', 'Кто выступает в роли Пользователя (User):') }}</label>
                        <select v-model="tgUserSender" style="width: 100%; padding: 8px; background: #1a1a1a; color: #fff; border: 1px solid #333; border-radius: 8px; font-size: 12px;">
                            <option v-for="p in tgParticipants" :key="'user_'+p" :value="p">{{ p }}</option>
                        </select>
                    </div>

                    <button @click="swapTgSenders" class="cp-default-btn" style="padding: 6px; height: 32px; display: flex; align-items: center; justify-content: center;" :data-tooltip="store.t('tg_swap_tooltip', 'Поменять роли местами')">
                        <img src="assets/icons/change_dataset.svg" style="width: 14px; height: 14px; opacity: 0.9;">
                    </button>

                    <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                        <label style="font-size: 11px; color: #aaa;">{{ store.t('tg_select_assistant', 'Кто выступает в роли ИИ (Assistant):') }}</label>
                        <select v-model="tgAssistantSender" style="width: 100%; padding: 8px; background: #1a1a1a; color: #fff; border: 1px solid #333; border-radius: 8px; font-size: 12px;">
                            <option v-for="p in tgParticipants" :key="'asst_'+p" :value="p">{{ p }}</option>
                        </select>
                    </div>
                </div>

                <!-- ИМЯ ИТОГОВОГО ДАТАСЕТА -->
                <div style="margin-bottom: 20px;">
                    <label style="font-size: 12px; display: block; margin-bottom: 4px; color: #aaa;">{{ store.t('tg_dataset_name', 'Имя итогового датасета:') }}</label>
                    <input v-model="tgDatasetName" class="cm-dataset-input" style="width: 100%; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 8px;">
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button @click="showTgModal = false" style="padding: 8px 14px; background: #222; border: none; border-radius: 8px; color: #ccc; font-size: 12px; cursor: pointer;">{{ store.t('btn_cancel', 'Отмена') }}</button>
                    <button @click="processTelegramConversion" style="padding: 8px 14px; background: #0088cc; border: none; border-radius: 8px; color: #fff; font-size: 12px; font-weight: bold; cursor: pointer;">{{ store.t('tg_btn_convert', 'Сконвертировать и добавить') }}</button>
                </div>
            </div>
        </div>
    `
};