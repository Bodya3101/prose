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
        if (this.store.settings.skip_openrouter_disclaimer) {
            this.step = 'dashboard';
        } else {
            this.startTimer();
        }

        if (window.pywebview) {
            const r = await window.pywebview.api.plugin_openrouter_get_models();
            if (r.success && r.models.length > 0) this.modelsList = r.models;
        }
    },
    unmounted() {
        if (this.timerInterval) clearInterval(this.timerInterval);
    },
    methods: {
        close() { this.$emit('close'); },
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
                    this.store.t('or_err_no_prompt', 'Опишите задачу генератору!')
                ); 
                return; 
            }
            if (!this.selectedModel.trim()) { 
                await this.store.showAlert(
                    this.store.t('alert_error_title', 'Error'), 
                    this.store.t('or_err_no_model', 'Выберите или введите модель!')
                ); 
                return; 
            }
            
            this.isGenerating = true;
            this.statusMessage = "Анализ полей...";

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
                    this.store.t('or_err_all_hardcoded', 'Все поля захардкожены! ИИ нечего генерировать.')
                );
                this.isGenerating = false;
                return;
            }

            const count = Math.max(1, parseInt(this.batchSize) || 1);
            this.statusMessage = `Генерация пакета из ${count} записей...`;

            const r = await window.pywebview.api.plugin_openrouter_generate_batch(
                this.generatorPrompt,
                emptyFields,
                hardcodedContext,
                count,
                this.selectedModel.trim() 
            );

            if (r.success && Array.isArray(r.data)) {
                this.statusMessage = "Сшивание контекста и запись...";
                
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
                
                this.statusMessage = "Готово!";
                setTimeout(() => { this.close(); }, 1500);
            } else {
                await this.store.showAlert(
                    this.store.t('alert_error_title', 'Error'), 
                    r.error || "Неверный формат ответа ИИ"
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
                    {{ store.t('or_warning_title', 'Внимание!') }}
                </div>
                <div class="or-warning-text" v-html="store.t('or_warning_text', 'Автоматическая генерация датасетов с использованием API-провайдеров может нарушать их Условия Использования (ToS).<br><br>Вы берете на себя полную ответственность за использование сгенерированных данных.')">
                </div>
                
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; width: 100%; padding: 0 5px; color: #A0A0A0;">
                    <span>{{ store.t('or_dont_show', 'Больше не показывать') }}</span>
                    <label class="toggle-switch"><input type="checkbox" v-model="dontShowAgain"><span class="toggle-slider"></span></label>
                </div>

                <div class="or-warning-buttons">
                    <button class="or-btn-danger" @click="acceptDisclaimer" :disabled="countdown > 0">
                        {{ store.t('or_accept', 'Я согласен') }} {{ countdown > 0 ? '(' + countdown + 's...)' : '' }}
                    </button>
                    <button class="or-btn-cancel" @click="close">{{ store.t('or_decline', 'Отказаться') }}</button>
                </div>
            </div>
        </div>

        <div v-else-if="step === 'dashboard'" class="create-modal" style="max-width: 600px; padding: 25px; gap: 15px;">
            <div class="cm-header">AI GENERATOR<div class="cm-red-dot" @click="close" data-tooltip="Закрыть"></div></div>

            <div style="display: flex; flex-direction: column; gap: 5px; width: 100%; text-align: left;">
                <span style="font-size: 12px; color: #4E6DB2; font-weight: bold;">Задача для ИИ-генератора:</span>
                <textarea v-model="generatorPrompt" class="message-textarea" style="min-height: 50px; border-color: #4E6DB2;" placeholder="Опишите, что нужно сгенерировать..."></textarea>
            </div>

            <div style="display: flex; gap: 15px; width: 100%;">
                <div style="display: flex; flex-direction: column; gap: 5px; flex: 1; position: relative;">
                    <span style="font-size: 12px; color: #A0A0A0;">Модель OpenRouter:</span>
                    <input type="text" 
                           v-model="selectedModel" 
                           @focus="showModelDropdown = true" 
                           @input="showModelDropdown = true"
                           class="message-textarea" 
                           style="min-height: auto; padding: 8px; font-size: 12px;" 
                           placeholder="Выберите или введите ID...">

                    <div v-if="showModelDropdown && filteredModels.length > 0" class="custom-dropdown-list">
                        <div v-for="m in filteredModels" :key="m" class="custom-dropdown-item" @click="selectedModel = m; showModelDropdown = false">
                            {{ m }}
                        </div>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 5px; width: 120px;">
                    <span style="font-size: 12px; color: #A0A0A0;">Кол-во записей:</span>
                    <input type="number" v-model.number="batchSize" min="1" max="100" class="cm-hex-input-box" style="width: 100%; padding: 8px; font-size: 16px; text-align: center;">
                </div>
            </div>

            <div style="width: 100%; background: #161616; padding: 15px; border-radius: 8px; border: 1px solid var(--border-main);" @click="showModelDropdown = false">
                <span style="font-size: 11px; color: #A0A0A0; display: block; margin-bottom: 10px;">
                    Если параметр ПУСТОЙ — ИИ генерирует его сам. Если ЗАПОЛНЕН — ИИ получает его как контекст (экономия выходных токенов).
                </span>
                
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <div v-if="!store.activeProject.use_single_prompt">
                        <input type="text" v-model="hardcodeFields.system" placeholder="Фиксированный System (оставьте пустым для авто)" class="message-textarea" style="min-height: auto; padding: 8px; font-size: 12px;">
                    </div>
                    <input type="text" v-model="hardcodeFields.user" placeholder="Фиксированный User (оставьте пустым для авто)" class="message-textarea" style="min-height: auto; padding: 8px; font-size: 12px;">
                    <input v-if="store.activeProject.use_thinking" type="text" v-model="hardcodeFields.thought" placeholder="Фиксированный Thought (оставьте пустым для авто)" class="message-textarea" style="min-height: auto; padding: 8px; font-size: 12px;">
                    <input type="text" v-model="hardcodeFields.assistant" placeholder="Фиксированный Assistant (оставьте пустым для авто)" class="message-textarea" style="min-height: auto; padding: 8px; font-size: 12px;">
                </div>
            </div>

            <div v-if="isGenerating" style="width: 100%; text-align: center;">
                <span style="font-size: 12px; color: #4D986D; font-weight: bold;">{{ statusMessage }}</span>
                <div class="or-progress-bar"><div class="or-progress-fill" style="width: 100%; animation: pulse 1s infinite alternate;"></div></div>
            </div>
            
            <button class="btn-primary" @click="startGeneration" :disabled="isGenerating" style="width: 100%; padding: 12px; font-size: 16px;">
                {{ isGenerating ? 'ИИ думает...' : 'Запустить генерацию' }}
            </button>
        </div>
    `
};