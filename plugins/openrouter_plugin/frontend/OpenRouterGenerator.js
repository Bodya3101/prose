export default {
    name: 'OpenRouterGenerator',
    setup() {
        return { store: window.app_store };
    },
    data() {
        return {
            step: 'disclaimer',
            countdown: 15,
            timerInterval: null,
            dontShowAgain: false,

            modelsList: ["google/gemma-2-9b-it:free"],
            selectedModel: "google/gemma-2-9b-it:free",
            showModelDropdown: false,
            provider: 'openrouter',
            customBaseUrl: '',
            customApiKey: '',
            clearCustomKey: false,
            rpm: 60,
            providerStatus: '', 
            
            genMode: 'single', 
            batchSize: 5,
            generatorPrompt: "Сгенерируй датасет вопросов по истории Рима и глубоких ответов на них.",
            
            hardcodeFields: {
                system: "", user: "", thought: "", assistant: ""
            },
            
            isGenerating: false,
            statusMessage: ""
        };
    },
    computed: {
        filteredModels() {
            if (!this.selectedModel) return this.modelsList.slice(0, 40);
            const q = this.selectedModel.toLowerCase();
            return this.modelsList.filter(m => m.toLowerCase().includes(q)).slice(0, 40);
        }
    },
    async mounted() {
        this.provider = this.store.settings.plugin_openrouter_provider || 'openrouter';
        this.customBaseUrl = this.store.settings.plugin_openrouter_custom_base_url || '';
        this.rpm = Number(this.store.settings.plugin_openrouter_rpm) || 60;

        if (this.store.settings.skip_openrouter_disclaimer) {
            this.step = 'dashboard';
        } else {
            this.startTimer();
        }

        if (window.pywebview) await this.loadModels();
    },
    unmounted() {
        if (this.timerInterval) clearInterval(this.timerInterval);
    },
    methods: {
        close() { this.$emit('close'); },
        async loadModels() {
            if (!window.pywebview) return;
            if (this.provider === 'custom' && !this.customBaseUrl.trim()) {
                this.modelsList = [];
                this.providerStatus = this.store.t('or_custom_base_url_required', 'Enter and save a custom Base URL to load models.');
                return;
            }

            const result = await window.pywebview.api.plugin_openrouter_get_models(this.provider);
            if (result.success) {
                this.modelsList = result.models || [];
                this.providerStatus = this.modelsList.length
                    ? this.store.t('or_models_loaded', 'Models loaded.')
                    : this.store.t('or_models_empty', 'Provider returned no models; you can enter a model ID manually.');
                if (this.modelsList.length && !this.modelsList.includes(this.selectedModel)) {
                    this.selectedModel = this.modelsList[0];
                }
            } else {
                this.modelsList = [];
                this.providerStatus = result.error || this.store.t('or_models_error', 'Could not load models.');
            }
        },
        async providerChanged() {
            this.modelsList = [];
            if (this.provider === 'openrouter') {
                await this.loadModels();
            } else {
                this.providerStatus = this.store.t('or_custom_save_first', 'Save the custom provider settings to load its models.');
                if (this.customBaseUrl.trim() && this.customBaseUrl === this.store.settings.plugin_openrouter_custom_base_url) {
                    await this.loadModels();
                }
            }
        },
        async persistProviderSettings(refreshModels = true) {
            if (!window.pywebview) return false;
            const result = await window.pywebview.api.plugin_openrouter_save_config(
                this.provider,
                this.customBaseUrl,
                this.customApiKey,
                this.rpm,
                this.clearCustomKey
            );
            if (!result.success) {
                this.providerStatus = result.error || this.store.t('or_settings_error', 'Could not save provider settings.');
                await this.store.showAlert(
                    this.store.t('alert_error_title', 'Error'),
                    this.providerStatus
                );
                return false;
            }

            this.store.settings.plugin_openrouter_provider = this.provider;
            this.store.settings.plugin_openrouter_rpm = Number(result.rpm) || Number(this.rpm) || 60;
            this.store.settings.plugin_openrouter_custom_base_url = result.base_url || this.customBaseUrl;
            this.customApiKey = '';
            this.clearCustomKey = false;
            this.providerStatus = this.store.t('or_settings_saved', 'Provider settings saved.');
            if (refreshModels) await this.loadModels();
            return true;
        },
        startTimer() {
            this.timerInterval = setInterval(() => {
                if (this.countdown > 0) this.countdown--;
                else clearInterval(this.timerInterval);
            }, 1000);
        },
        async acceptDisclaimer() {
            if (this.dontShowAgain && window.pywebview) {
                await window.pywebview.api.update_setting("skip_openrouter_disclaimer", true);
                this.store.settings.skip_openrouter_disclaimer = true;
            }
            this.step = 'dashboard';
        },
        
        async startGeneration() {
            if (!this.generatorPrompt.trim()) { 
                await this.store.showAlert(
                    this.store.t('alert_error_title', 'Error'), 
                    this.store.t('or_err_no_prompt', 'Please describe the task to the generator!')
                ); 
                return; 
            }
            if (!this.selectedModel.trim()) { 
                await this.store.showAlert(
                    this.store.t('alert_error_title', 'Error'), 
                    this.store.t('or_err_no_model', 'Please select or enter a model ID!')
                ); 
                return; 
            }
            
            if (!await this.persistProviderSettings(false)) return;

            this.isGenerating = true;
            this.statusMessage = "Analyzing fields...";

            const emptyFields = [];
            const hardcodedContext = {};

            if (!this.hardcodeFields.system.trim() && !this.store.activeProject.use_single_prompt) {
                emptyFields.push("system");
            } else {
                hardcodedContext.system = this.store.activeProject.use_single_prompt 
                    ? (this.store.activeProject.global_system_prompt || "") 
                    : this.hardcodeFields.system;
            }

            if (!this.hardcodeFields.user.trim()) {
                emptyFields.push("user");
            } else {
                hardcodedContext.user = this.hardcodeFields.user;
            }

            if (this.store.activeProject.use_thinking) {
                if (!this.hardcodeFields.thought.trim()) {
                    emptyFields.push("thought");
                } else {
                    hardcodedContext.thought = this.hardcodeFields.thought;
                }
            }

            if (!this.hardcodeFields.assistant.trim()) {
                emptyFields.push("assistant");
            } else {
                hardcodedContext.assistant = this.hardcodeFields.assistant;
            }

            if (emptyFields.length === 0) {
                await this.store.showAlert(
                    this.store.t('alert_warning_title', 'Warning'), 
                    this.store.t('or_err_all_hardcoded', 'All fields are fixed! AI has nothing to generate.')
                );
                this.isGenerating = false;
                return;
            }

            const count = Math.max(1, parseInt(this.batchSize) || 1);
            this.statusMessage = `Generating batch of ${count} entries...`;

            const r = await window.pywebview.api.plugin_openrouter_generate_batch(
                this.generatorPrompt,
                emptyFields,
                hardcodedContext,
                count,
                this.selectedModel.trim(),
                this.provider
            );

            if (r.success && Array.isArray(r.data)) {
                this.statusMessage = "Merging context and saving...";
                
                for (const aiEntry of r.data) {
                    const indexToSave = this.$parent.totalEntries;
                    
                    const finalPayload = {
                        system: hardcodedContext.system ? hardcodedContext.system : (aiEntry.system || ""),
                        user: hardcodedContext.user ? hardcodedContext.user : (aiEntry.user || ""),
                        assistant: hardcodedContext.assistant ? hardcodedContext.assistant : (aiEntry.assistant || "")
                    };
                    
                    if (this.store.activeProject.use_thinking) {
                        finalPayload.thought = hardcodedContext.thought ? hardcodedContext.thought : (aiEntry.thought || "");
                    }

                    await window.pywebview.api.save_dataset_entry(indexToSave, finalPayload);
                    this.$parent.totalEntries++; 
                }
                
                this.$parent.currentEntryIndex = this.$parent.totalEntries - 1;
                await this.$parent.loadEntry(this.$parent.currentEntryIndex);
                
                this.statusMessage = "Done!";
                setTimeout(() => { this.close(); }, 1500);
            } else {
                await this.store.showAlert(
                    this.store.t('alert_error_title', 'Error'), 
                    r.error || "Invalid AI response format"
                );
                this.isGenerating = false;
            }
        }
    },
    template: `
        <div v-if="step === 'disclaimer'" class="or-warning-overlay" @click.self="close">
            <div class="or-warning-modal">
                <div class="or-warning-header">
                    <img src="/plugins/openrouter_plugin/frontend/assets/icons/warning.svg" class="or-warning-icon" alt="!">
                    {{ store.t('or_warning_title', 'Warning!') }}
                </div>
                <div class="or-warning-text" v-html="store.t('or_warning_text', 'Automated dataset generation using API providers may violate their Terms of Service (ToS).<br><br>You assume full responsibility for using generated data.')">
                </div>
                
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; width: 100%; padding: 0 5px; color: #A0A0A0;">
                    <span>{{ store.t('or_dont_show', 'Do not show again') }}</span>
                    <label class="toggle-switch"><input type="checkbox" v-model="dontShowAgain"><span class="toggle-slider"></span></label>
                </div>

                <div class="or-warning-buttons">
                    <button class="or-btn-danger" @click="acceptDisclaimer" :disabled="countdown > 0">
                        {{ store.t('or_accept', 'I agree') }} {{ countdown > 0 ? '(' + countdown + 's...)' : '' }}
                    </button>
                    <button class="or-btn-cancel" @click="close">{{ store.t('or_decline', 'Decline') }}</button>
                </div>
            </div>
        </div>

        <div v-else-if="step === 'dashboard'" class="create-modal" style="max-width: 600px; padding: 25px; gap: 15px;">
            <div class="cm-header">{{ store.t('or_title', 'AI GENERATOR') }}<div class="cm-red-dot" @click="close" data-tooltip="Close"></div></div>

            <div style="display: flex; flex-direction: column; gap: 5px; width: 100%; text-align: left;">
                <span style="font-size: 12px; color: #4E6DB2; font-weight: bold;">{{ store.t('or_prompt_label', 'Task for AI Generator:') }}</span>
                <textarea v-model="generatorPrompt" class="message-textarea" style="min-height: 50px; border-color: #4E6DB2;" :placeholder="store.t('or_prompt_placeholder', 'Describe what to generate...')"></textarea>
            </div>

            <div style="display: flex; gap: 15px; width: 100%; align-items: flex-end;">
                <div style="display: flex; flex-direction: column; gap: 5px; flex: 1;">
                    <span style="font-size: 12px; color: #A0A0A0;">{{ store.t('or_provider_label', 'Provider:') }}</span>
                    <select v-model="provider" @change="providerChanged" class="message-textarea" style="min-height: auto; padding: 8px; font-size: 12px; width: 100%;">
                        <option value="openrouter">{{ store.t('or_provider_openrouter', 'OpenRouter') }}</option>
                        <option value="custom">{{ store.t('or_provider_custom', 'Custom OpenAI-compatible') }}</option>
                    </select>
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px; width: 120px;">
                    <span style="font-size: 12px; color: #A0A0A0;">{{ store.t('or_rpm_label', 'RPM (requests/min):') }}</span>
                    <input type="number" v-model.number="rpm" min="1" max="600" step="1" class="cm-hex-input-box" style="width: 100%; padding: 8px; font-size: 16px; text-align: center;">
                </div>
            </div>

            <div v-if="provider === 'custom'" style="display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 12px; border: 1px solid var(--border-main); border-radius: 8px;">
                <label style="display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #A0A0A0;">
                    {{ store.t('or_custom_base_url_label', 'OpenAI-compatible Base URL:') }}
                    <input type="url" v-model.trim="customBaseUrl" class="message-textarea" style="min-height: auto; padding: 8px; font-size: 12px;" :placeholder="store.t('or_custom_base_url_ph', 'https://api.example.com/v1 or http://localhost:1234/v1')">
                </label>
                <label style="display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #A0A0A0;">
                    {{ store.t('or_custom_api_key_label', 'API key (optional for local servers):') }}
                    <input type="password" v-model="customApiKey" @input="clearCustomKey = false" autocomplete="off" class="message-textarea" style="min-height: auto; padding: 8px; font-size: 12px;" :placeholder="store.t('or_custom_api_key_ph', 'Leave blank to keep the saved key')">
                </label>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #A0A0A0;">
                    <input type="checkbox" v-model="clearCustomKey">
                    {{ store.t('or_clear_custom_key', 'Remove saved custom API key') }}
                </label>
            </div>

            <button class="btn-primary" @click="persistProviderSettings()" style="width: 100%; padding: 9px; font-size: 13px;">
                {{ store.t('or_save_provider', 'Save provider settings') }}
            </button>
            <div v-if="providerStatus" style="width: 100%; font-size: 12px; color: #A0A0A0; overflow-wrap: anywhere;">{{ providerStatus }}</div>

            <div style="display: flex; gap: 15px; width: 100%;">
                <div style="display: flex; flex-direction: column; gap: 5px; flex: 1; position: relative;">
                    <span style="font-size: 12px; color: #A0A0A0;">{{ store.t('or_model_id_label', 'Model ID:') }}</span>
                    <input type="text" 
                           v-model="selectedModel" 
                           @focus="showModelDropdown = true" 
                           @input="showModelDropdown = true"
                           class="message-textarea" 
                           style="min-height: auto; padding: 8px; font-size: 12px;" 
                           placeholder="Select or enter ID...">

                    <div v-if="showModelDropdown && filteredModels.length > 0" class="custom-dropdown-list">
                        <div v-for="m in filteredModels" :key="m" class="custom-dropdown-item" @click="selectedModel = m; showModelDropdown = false">
                            {{ m }}
                        </div>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 5px; width: 120px;">
                    <span style="font-size: 12px; color: #A0A0A0;">{{ store.t('or_count_label', 'Count:') }}</span>
                    <input type="number" v-model.number="batchSize" min="1" max="100" class="cm-hex-input-box" style="width: 100%; padding: 8px; font-size: 16px; text-align: center;">
                </div>
            </div>

            <div style="width: 100%; background: #161616; padding: 15px; border-radius: 8px; border: 1px solid var(--border-main);" @click="showModelDropdown = false">
                <span style="font-size: 11px; color: #A0A0A0; display: block; margin-bottom: 10px;">
                    {{ store.t('or_hint', 'If EMPTY - AI generates it. If FILLED - AI receives it as context (saves output tokens).') }}
                </span>
                
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <div v-if="!store.activeProject.use_single_prompt">
                        <input type="text" v-model="hardcodeFields.system" :placeholder="store.t('or_fix_system', 'Fixed System (leave empty for auto)')" class="message-textarea" style="min-height: auto; padding: 8px; font-size: 12px;">
                    </div>
                    <input type="text" v-model="hardcodeFields.user" :placeholder="store.t('or_fix_user', 'Fixed User (leave empty for auto)')" class="message-textarea" style="min-height: auto; padding: 8px; font-size: 12px;">
                    <input v-if="store.activeProject.use_thinking" type="text" v-model="hardcodeFields.thought" :placeholder="store.t('or_fix_thought', 'Fixed Thought (leave empty for auto)')" class="message-textarea" style="min-height: auto; padding: 8px; font-size: 12px;">
                    <input type="text" v-model="hardcodeFields.assistant" :placeholder="store.t('or_fix_assistant', 'Fixed Assistant (leave empty for auto)')" class="message-textarea" style="min-height: auto; padding: 8px; font-size: 12px;">
                </div>
            </div>

            <div v-if="isGenerating" style="width: 100%; text-align: center;">
                <span style="font-size: 12px; color: #4D986D; font-weight: bold;">{{ statusMessage }}</span>
                <div class="or-progress-bar"><div class="or-progress-fill" style="width: 100%; animation: pulse 1s infinite alternate;"></div></div>
            </div>
            
            <button class="btn-primary" @click="startGeneration" :disabled="isGenerating" style="width: 100%; padding: 12px; font-size: 16px;">
                {{ isGenerating ? store.t('or_btn_thinking', 'AI is thinking...') : store.t('or_btn_start', 'Start Generation') }}
            </button>
        </div>
    `
};