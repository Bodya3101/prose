import { store } from '../store.js';

export default {
    name: 'ProjectSettingsModal',
    setup() { return { store }; },
    data() {
        return {
            formData: {
                name: "",
                description: "",
                color: "#D9D9D9",
                logo_base64: null,
                use_single_prompt: false,
                use_thinking: false,
                tokenizer_preset: "llama3",
                dataset_format: "standard",
                global_system_prompt: ""
            },
            availableFormats: [],
            showFormatDropdown: false,
            showTokenizerDropdown: false,
            showColorPicker: false
        };
    },
    async mounted() {
        if (!store.activeProject) return;
        
        this.formData = {
            name: store.activeProject.name || "",
            description: store.activeProject.description || "",
            color: store.activeProject.color || "#D9D9D9",
            logo_base64: store.activeProject.logo_base64 || null,
            use_single_prompt: store.activeProject.use_single_prompt || false,
            use_thinking: store.activeProject.use_thinking || false,
            tokenizer_preset: store.activeProject.tokenizer_preset || "llama3",
            dataset_format: store.activeProject.dataset_format || "standard",
            global_system_prompt: store.activeProject.global_system_prompt || ""
        };

        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_available_formats === 'function') {
            try {
                this.availableFormats = await window.pywebview.api.get_available_formats();
            } catch (e) {
                console.error("Formats error:", e);
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
    methods: {
        close() { this.$emit('close'); },
        toggleColorPicker() { this.showColorPicker = !this.showColorPicker; },
        setDefaultColor() { this.formData.color = '#D9D9D9'; this.showColorPicker = false; },

        async handleImageUpload() {
            if (!window.pywebview) return;
            const r = await window.pywebview.api.select_and_process_image();
            if (r && r.success) this.formData.logo_base64 = r.logo_base64;
        },

        async save() {
            if (!window.pywebview || !store.activeProject) return;

            const updates = {
                name: this.formData.name.trim() || store.activeProject.name,
                description: this.formData.description.trim(),
                color: this.formData.color,
                logo_base64: this.formData.logo_base64,
                use_single_prompt: this.formData.use_single_prompt,
                use_thinking: this.formData.use_thinking,
                tokenizer_preset: this.formData.tokenizer_preset,
                dataset_format: this.formData.dataset_format,
                global_system_prompt: this.formData.global_system_prompt
            };

            const r = await window.pywebview.api.update_project(store.activeProject.id, updates);
            if (r.success) {
                Object.assign(store.activeProject, updates);
                this.$emit('close');
                await store.showAlert("Success", store.t('project_saved_msg', 'Project settings updated!'));
            } else {
                await store.showAlert("Error", r.error);
            }
        }
    },
    template: `
        <div class="or-warning-overlay" style="z-index: 10000;" @click.self="close">
            <div class="create-modal" style="max-width: 620px; background: #181818; border: 1px solid var(--border-main); border-radius: 16px; padding: 25px; box-shadow: 0 20px 50px rgba(0,0,0,0.9);">
                <div class="cm-header">
                    {{ store.t('project_settings_title', 'PROJECT SETTINGS') }}
                    <div class="cm-red-dot" @click="close" :data-tooltip="store.t('btn_cancel', 'Cancel')"></div>
                </div>
                
                <div class="cm-top-section" style="margin-top: 15px;">
                    <div class="cm-upload" @click="handleImageUpload" :data-tooltip="store.t('tooltip_upload', 'Upload logo')">
                        <img v-if="formData.logo_base64" :src="formData.logo_base64" style="border-radius: 12px; object-fit: cover;">
                        <img v-else src="assets/icons/upload.svg" alt="Up">
                    </div>
                    
                    <div class="cm-inputs">
                        <div style="display: flex; align-items: center; gap: 10px; position: relative;">
                            <input v-model="formData.name" :placeholder="store.t('placeholder_name', '*Project Name*')" class="cm-input-name" :style="{ color: formData.color }">
                            
                            <div style="position: relative;">
                                <img src="assets/icons/choose_color.svg" @click="toggleColorPicker" style="width: 24px; height: 24px; cursor: pointer; opacity: 0.8;" :data-tooltip="store.t('tooltip_color', 'Adjust color')">
                                <div v-if="showColorPicker" class="cp-popover">
                                    <div class="cp-row">
                                        <span>{{ store.t('color_palette', 'Palette:') }}</span>
                                        <input type="color" v-model="formData.color" class="cp-native">
                                    </div>
                                    <div class="cp-row">
                                        <span>HEX:</span>
                                        <input type="text" v-model="formData.color" class="cp-hex" maxlength="7">
                                    </div>
                                    <button @click="setDefaultColor" class="cp-default-btn">{{ store.t('btn_default', 'Default') }}</button>
                                </div>
                            </div>
                        </div>
                        <input v-model="formData.description" :placeholder="store.t('placeholder_desc', 'Description')" class="cm-input-desc">
                    </div>
                </div>

                <div class="cm-datasets-box" style="width: 100%; margin-top: 10px; max-height: 50vh; overflow-y: auto; padding-right: 5px;">
                    <!-- ВЫБОР ЦЕЛЕВОГО ТОКЕНИЗАТОРА -->
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <span style="font-size: 12px; color: #D9D9D9;">{{ store.t('tokenizer_label', 'Project Tokenizer:') }}</span>
                        <div style="position: relative; width: 100%;">
                            <div class="custom-select-trigger" @click="showTokenizerDropdown = !showTokenizerDropdown; showFormatDropdown = false;" style="padding: 10px 14px; font-weight: bold; background: #161616;">
                                <span>{{ selectedTokenizerName }}</span>
                                <span style="font-size: 10px; transition: transform 0.2s;" :style="{ transform: showTokenizerDropdown ? 'rotate(180deg)' : 'rotate(0deg)' }">▼</span>
                            </div>
                            
                            <div v-if="showTokenizerDropdown" class="custom-dropdown-list" style="top: 110%; z-index: 3100; max-height: 200px;">
                                <div v-for="(tok, tId) in store.tokenizers" :key="tId" class="custom-dropdown-item" @click="formData.tokenizer_preset = tId; showTokenizerDropdown = false;" style="padding: 10px 14px;">
                                    <div style="font-weight: bold;">{{ store.t('tokenizer_' + tId, tok.name) }}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- ВЫБОР ФОРМАТА РАЗМЕТКИ -->
                    <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px;">
                        <span style="font-size: 12px; color: #D9D9D9;">{{ store.t('format_label', 'Dataset format:') }}</span>
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

                    <!-- ТУМБЛЕРЫ ПРОЕКТА -->
                    <div class="cm-toggles-row" style="margin-top: 10px;">
                        <div class="cm-toggle-card">
                            <span v-html="store.t('toggle_single_prompt', 'use single<br>system prompt')"></span>
                            <label class="toggle-switch"><input type="checkbox" v-model="formData.use_single_prompt"><span class="toggle-slider"></span></label>
                        </div>
                        <div class="cm-toggle-card">
                            <span>{{ store.t('toggle_thinking', 'Thinking model') }}</span>
                            <label class="toggle-switch"><input type="checkbox" v-model="formData.use_thinking"><span class="toggle-slider"></span></label>
                        </div>
                    </div>

                    <!-- ГЛОБАЛЬНЫЙ СИСТЕМНЫЙ ПРОМПТ -->
                    <div v-if="formData.use_single_prompt" style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px;">
                        <span style="font-size: 12px; color: #4D986D; font-weight: bold;">{{ store.t('role_system', 'System Prompt') }} {{ store.t('role_system_global', '[Global]') }}:</span>
                        <textarea v-model="formData.global_system_prompt" class="message-textarea" style="min-height: 80px; font-size: 12px;" :placeholder="store.t('placeholder_global_sys', 'Enter global system prompt for the project...')"></textarea>
                    </div>
                </div>

                <button class="btn-primary cm-submit-btn" @click="save" style="margin-top: 15px;">{{ store.t('btn_save', 'Save') }}</button>
            </div>
        </div>
    `
};