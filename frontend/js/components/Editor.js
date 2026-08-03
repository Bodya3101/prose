import { store } from '../store.js';

export default {
    name: 'Editor',
    setup() { return { store }; },
    data() {
        return {
            currentEntryIndex: 0, totalEntries: 0,
            hiddenBlocks: { system: false, user: false, thought: false, assistant: false },
            saveTimeout: null,
            activeDatasetName: "", showDatasetSelector: false, showHfModal: false,
            hfRepoId: "", hfPrivate: true, hfConnectionStatus: { success: null, message: "" }, isUploading: false,
            activeHistoryField: null, historyData: { previous: null, others: [] },
            
            // ФОРМАТЫ И КОНВЕРТАЦИЯ
            currentFormat: "standard",
            availableFormats: [],
            showFormatMenu: false
        };
    },
    computed: {
        systemPrompt: {
            get() {
                return store.activeProject.use_single_prompt 
                    ? (store.activeProject.global_system_prompt || "") 
                    : store.currentEntryData.system;
            },
            set(val) {
                if (store.activeProject.use_single_prompt) {
                    store.activeProject.global_system_prompt = val;
                    clearTimeout(this.saveTimeout);
                    this.saveTimeout = setTimeout(() => {
                        window.pywebview.api.update_project(store.activeProject.id, { global_system_prompt: val });
                    }, 1000);
                } else {
                    store.currentEntryData.system = val;
                }
            }
        },
        activeFormatLabel() {
            const found = this.availableFormats.find(f => f.id === this.currentFormat);
            return found ? found.name.split(' ')[0] : 'Standard';
        }
    },
    async mounted() {
        if (!store.activeProject || !window.pywebview) return;
        
        // ЗАЩИЩЕННЫЙ ВЫЗОВ ДЛЯ РЕДАКТОРА
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_available_formats === 'function') {
            try {
                this.availableFormats = await window.pywebview.api.get_available_formats();
            } catch (e) {
                console.error(e);
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

        this.currentFormat = store.activeProject.dataset_format || "standard";
        
        const files = store.activeProject.dataset_files || [store.activeProject.dataset_file];
        this.activeDatasetName = store.activeProject.active_dataset || files[0];
        this.hfRepoId = `username/${store.activeProject.name.toLowerCase().replace(/\s+/g, '-')}`;
        await this.loadDatasetIndexAndEntry();
    },
    methods: {
        async loadDatasetIndexAndEntry() {
            const idx = await window.pywebview.api.load_dataset_index(this.activeDatasetName, this.currentFormat);
            if (idx.success) {
                this.totalEntries = idx.total_lines;
                if (this.totalEntries === 0) this.clearFields();
                else {
                    this.currentEntryIndex = this.totalEntries - 1;
                    await this.loadEntry(this.currentEntryIndex);
                }
            }
        },

        clearFields() { 
            store.currentEntryData.system = "";
            store.currentEntryData.user = "";
            store.currentEntryData.thought = "";
            store.currentEntryData.assistant = "";
        },
        async loadEntry(index) {
            if (!window.pywebview) return;
            const r = await window.pywebview.api.get_dataset_entry(index);
            if (r.success) {
                store.currentEntryData.system = r.data.system || "";
                store.currentEntryData.user = r.data.user || "";
                store.currentEntryData.thought = r.data.thought || "";
                store.currentEntryData.assistant = r.data.assistant || "";
            }
        },

        async saveCurrentEntry() {
            if (!window.pywebview) return true; 
            const dataToSave = {
                system: this.systemPrompt,
                user: store.currentEntryData.user,
                assistant: store.currentEntryData.assistant
            };
            if (store.activeProject.use_thinking) {
                dataToSave.thought = store.currentEntryData.thought;
            }
            const r = await window.pywebview.api.save_dataset_entry(this.currentEntryIndex, dataToSave);
            return r.success;
        },

        // СМЕНА И КОНВЕРТАЦИЯ ФОРМАТА В 1 КЛИК
        async changeFormat(newFormatId) {
            if (newFormatId === this.currentFormat) {
                this.showFormatMenu = false;
                return;
            }

            const confirmed = await store.showConfirm(
                "Конвертация формата",
                `Переконвертировать весь файл "${this.activeDatasetName}" в новый формат? Файл на диске будет автоматически переписан под выбранную разметку.`
            );

            if (confirmed) {
                await this.saveCurrentEntry();
                const r = await window.pywebview.api.convert_dataset_format(
                    this.activeDatasetName,
                    this.currentFormat,
                    newFormatId
                );

                if (r.success) {
                    this.currentFormat = newFormatId;
                    store.activeProject.dataset_format = newFormatId;
                    await window.pywebview.api.update_project(store.activeProject.id, { dataset_format: newFormatId });
                    this.showFormatMenu = false;
                    await this.loadDatasetIndexAndEntry();
                    await store.showAlert("Успех", "Формат датасета успешно конвертирован!");
                } else {
                    await store.showAlert("Ошибка", r.error);
                }
            }
        },

        async nextEntry() {
            if (this.currentEntryIndex < this.totalEntries - 1) {
                if (await this.saveCurrentEntry()) { this.currentEntryIndex++; await this.loadEntry(this.currentEntryIndex); }
            }
        },
        async prevEntry() {
            if (this.currentEntryIndex > 0) {
                if (await this.saveCurrentEntry()) { this.currentEntryIndex--; await this.loadEntry(this.currentEntryIndex); }
            }
        },
        async addNewEntry() {
            if (await this.saveCurrentEntry()) { this.clearFields(); this.totalEntries++; this.currentEntryIndex = this.totalEntries - 1; }
        },
        async goHome() {
            if (await this.saveCurrentEntry()) { 
                store.currentView = 'home'; 
            }
        },

        async handleDatasetSwitch() {
            const files = store.activeProject.dataset_files || [store.activeProject.dataset_file];
            if (files.length <= 1) return;
            if (files.length === 2) {
                const nextIdx = files.indexOf(this.activeDatasetName) === 0 ? 1 : 0;
                await this.selectDataset(files[nextIdx]);
            } else this.showDatasetSelector = !this.showDatasetSelector;
        },
        async selectDataset(filename) {
            if (await this.saveCurrentEntry()) {
                this.activeDatasetName = filename;
                store.activeProject.active_dataset = filename;
                await window.pywebview.api.update_project(store.activeProject.id, { active_dataset: filename });
                this.showDatasetSelector = false;
                await this.loadDatasetIndexAndEntry();
            }
        },
        toggleBlock(blockName) { this.hiddenBlocks[blockName] = !this.hiddenBlocks[blockName]; },
        async toggleHistory(fieldName) {
            if (this.activeHistoryField === fieldName) { this.activeHistoryField = null; return; }
            this.activeHistoryField = fieldName;
            this.historyData = { previous: null, others: [] };
            if (window.pywebview) {
                const r = await window.pywebview.api.get_field_history(this.currentEntryIndex, fieldName);
                if (r.success) this.historyData = { previous: r.previous, others: r.others };
            }
        },
        selectHistoryItem(val) {
            if (this.activeHistoryField === 'system') this.systemPrompt = val;
            else store.currentEntryData[this.activeHistoryField] = val;
            this.activeHistoryField = null;
        },
        async testHfConnection() {
            this.hfConnectionStatus = { success: null, message: "Проверка..." };
            if (!window.pywebview) return;
            const r = await window.pywebview.api.test_hf_connection();
            if (r.success) {
                this.hfConnectionStatus = { success: true, message: `Связь ок! Авторизован как: ${r.username}` };
                this.hfRepoId = `${r.username}/${store.activeProject.name.toLowerCase().replace(/\s+/g, '-')}`;
            } else {
                this.hfConnectionStatus = { success: false, message: r.error || "Ошибка." };
            }
        },
        async uploadToHf() {
            if (!this.hfRepoId.trim()) return;
            this.isUploading = true;
            await this.saveCurrentEntry();
            const r = await window.pywebview.api.upload_dataset_to_hf(this.hfRepoId.trim(), this.activeDatasetName, this.hfPrivate);
            this.isUploading = false;
            if (r.success) { await store.showAlert("Успех", `Датасет выгружен:\n${r.url}`); this.showHfModal = false; } 
            else await store.showAlert("Ошибка", r.error);
        }
    },
    template: `
        <div class="editor-layout" @click.self="showDatasetSelector = false; showHfModal = false; showFormatMenu = false; activeHistoryField = null">
            <div class="dataset-stats" style="display: flex; align-items: center; gap: 12px; margin-bottom: 5px; position: relative;">
                <button class="icon-btn" @click="goHome" style="background: transparent; border: none; padding: 0;">
                    <img src="assets/icons/Forward.svg" alt="Back" style="transform: scaleX(-1); height: 20px;">
                </button>
                
                <span style="font-size: 15px; color: #A0A0A0; font-style: italic; display: flex; align-items: center; gap: 8px; position: relative;">
                    {{ store.t('entry_label', 'Запись') }} #{{ currentEntryIndex + 1 }} ({{ activeDatasetName }})
                    
                    <!-- БЕДЖ АКТИВНОГО ФОРМАТА С ПОПОВЕРОМ КОНВЕРТАЦИИ -->
                    <span @click.stop="showFormatMenu = !showFormatMenu" 
                          class="cp-default-btn" 
                          style="padding: 2px 8px; font-size: 11px; cursor: pointer; color: #4E6DB2; border-color: #4E6DB2; font-style: normal; font-weight: bold;"
                          :data-tooltip="store.t('tooltip_change_format', 'Сменить разметку датасета')">
                        [{{ activeFormatLabel }}]
                    </span>

                    <!-- ПОПОВЕР ВЫБОРА ФОРМАТА -->
                    <div v-if="showFormatMenu" class="ds-selector-popover" style="left: 120px; top: 30px; width: 260px; padding: 8px 0; z-index: 2500;">
                        <div style="font-size: 11px; color: #808080; padding: 4px 12px; font-weight: bold; text-transform: uppercase;">
                            {{ store.t('format_label', 'Разметка датасета:') }}
                        </div>
                        <div v-for="fmt in availableFormats" 
                             :key="fmt.id" 
                             class="ds-selector-item" 
                             @click="changeFormat(fmt.id)">
                            <span :style="{ fontWeight: fmt.id === currentFormat ? 'bold' : 'normal', color: fmt.id === currentFormat ? '#4D986D' : '#A0A0A0' }">
                                {{ fmt.name }}
                            </span>
                        </div>
                    </div>

                    <img v-if="(store.activeProject.dataset_files || []).length > 1" src="assets/icons/change_dataset.svg" @click="handleDatasetSwitch" class="action-icon" style="width: 18px; height: 18px; opacity: 0.8;" :data-tooltip="store.t('tooltip_change_dataset', 'Сменить датасет')">
                    
                    <img src="assets/icons/huggingface.svg" @click="showHfModal = !showHfModal" class="action-icon" style="width: 18px; height: 18px; opacity: 0.8;" data-tooltip="Выгрузить на Hugging Face">

                    <!-- ДИНАМИЧЕСКИЕ КНОПКИ ПЛАГИНОВ -->
                    <img v-for="btn in store.editor_buttons" :key="btn.id" :src="btn.icon" class="action-icon" @click="btn.action" :data-tooltip="btn.title" style="width: 18px; height: 18px; opacity: 0.8;">
                </span>

                <component v-if="store.active_overlay" :is="store.active_overlay" @close="store.active_overlay = null"></component>

                <!-- ОКНО HUGGING FACE -->
                <div v-if="showHfModal" class="cp-popover" style="left: 20px; top: 35px; width: 320px; gap: 12px; padding: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: bold; color: white; font-size: 13px;">Hugging Face Dataset Push</span>
                        <div class="cm-red-dot" @click="showHfModal = false" style="width: 14px; height: 14px; margin-top: 0;" data-tooltip="Закрыть"></div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 5px;">
                        <span style="font-size: 11px; color: #A0A0A0;">Repository ID:</span>
                        <input type="text" v-model="hfRepoId" placeholder="username/my-dataset" class="cm-hex-input-box" style="width: 100%; text-align: left; text-transform: none; font-size: 12px;">
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; margin: 5px 0;">
                        <span>Приватный репозиторий</span>
                        <label class="toggle-switch"><input type="checkbox" v-model="hfPrivate"><span class="toggle-slider"></span></label>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <button class="cp-default-btn" @click="testHfConnection" style="padding: 6px; font-size: 12px;">Проверить подключение</button>
                        <span v-if="hfConnectionStatus.message" :style="{ color: hfConnectionStatus.success ? '#4D986D' : '#D34646', fontSize: '11px', textAlign: 'center' }">{{ hfConnectionStatus.message }}</span>
                    </div>
                    <button class="btn-primary" @click="uploadToHf" style="width: 100%; padding: 8px; font-size: 13px; font-weight: bold;" :disabled="isUploading">{{ isUploading ? 'Загрузка...' : 'Выгрузить' }}</button>
                </div>

                <div v-if="showDatasetSelector" class="ds-selector-popover">
                    <div v-for="ds in (store.activeProject.dataset_files || [])" :key="ds" class="ds-selector-item" @click="selectDataset(ds)">
                        <img src="assets/icons/dataset_icon.svg" width="16">
                        <span :style="{ fontWeight: ds === activeDatasetName ? 'bold' : 'normal', color: ds === activeDatasetName ? 'white' : '#A0A0A0' }">{{ ds }}</span>
                    </div>
                </div>
            </div>

            <!-- Системный промпт -->
            <div class="message-block system">
                <div class="role-header">
                    <img src="assets/icons/dataset_icon.svg" width="18"> {{ store.t('role_system', 'Системный промпт') }} 
                    <span v-if="store.activeProject.use_single_prompt" style="color: #4D986D; font-size: 12px; margin-left: 10px;">{{ store.t('role_system_global', '[Единый]') }}</span>
                    <div class="role-actions" style="position: relative;">
                        <img :src="hiddenBlocks.system ? 'assets/icons/close_eye.svg' : 'assets/icons/Eye.svg'" class="action-icon" @click="toggleBlock('system')">
                        <img src="assets/icons/history.svg" class="action-icon" @click="toggleHistory('system')">
                        <div v-if="activeHistoryField === 'system'" class="history-popover">
                            <div class="hp-header">История <div class="cm-red-dot" @click="activeHistoryField = null" style="width: 10px; height: 10px; margin-top: 0;"></div></div>
                            <div class="hp-list">
                                <div v-if="historyData.previous" class="hp-item previous" @click="selectHistoryItem(historyData.previous)"><span class="hp-badge">Предыдущий</span><p>{{ historyData.previous }}</p></div>
                                <div v-if="historyData.previous && historyData.others.length > 0" class="hp-divider"></div>
                                <div v-for="(val, idx) in historyData.others" :key="idx" class="hp-item" @click="selectHistoryItem(val)"><p>{{ val }}</p></div>
                                <div v-if="!historyData.previous && historyData.others.length === 0" class="hp-empty">История пуста</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="collapse-wrapper" :class="{ 'collapsed': hiddenBlocks.system }"><div class="collapse-inner"><textarea class="message-textarea" v-model="systemPrompt"></textarea></div></div>
            </div>

            <!-- Пользователь -->
            <div class="message-block user">
                <div class="role-header">
                    <img src="assets/icons/user_query.svg" width="18"> {{ store.t('role_user', 'Сообщение пользователя') }}
                    <div class="role-actions" style="position: relative;">
                        <img :src="hiddenBlocks.user ? 'assets/icons/close_eye.svg' : 'assets/icons/Eye.svg'" class="action-icon" @click="toggleBlock('user')">
                        <img src="assets/icons/history.svg" class="action-icon" @click="toggleHistory('user')">
                        <div v-if="activeHistoryField === 'user'" class="history-popover">
                            <div class="hp-header">История <div class="cm-red-dot" @click="activeHistoryField = null" style="width: 10px; height: 10px; margin-top: 0;"></div></div>
                            <div class="hp-list">
                                <div v-if="historyData.previous" class="hp-item previous" @click="selectHistoryItem(historyData.previous)"><span class="hp-badge">Предыдущий</span><p>{{ historyData.previous }}</p></div>
                                <div v-if="historyData.previous && historyData.others.length > 0" class="hp-divider"></div>
                                <div v-for="(val, idx) in historyData.others" :key="idx" class="hp-item" @click="selectHistoryItem(val)"><p>{{ val }}</p></div>
                                <div v-if="!historyData.previous && historyData.others.length === 0" class="hp-empty">История пуста</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="collapse-wrapper" :class="{ 'collapsed': hiddenBlocks.user }"><div class="collapse-inner"><textarea class="message-textarea" v-model="store.currentEntryData.user"></textarea></div></div>
            </div>

            <!-- Процесс размышления -->
            <div class="message-block thought" v-if="store.activeProject.use_thinking">
                <div class="role-header">
                    <img src="assets/icons/think.svg" width="18"> {{ store.t('role_thought', 'Процесс размышления') }}
                    <div class="role-actions" style="position: relative;">
                        <img :src="hiddenBlocks.thought ? 'assets/icons/close_eye.svg' : 'assets/icons/Eye.svg'" class="action-icon" @click="toggleBlock('thought')">
                        <img src="assets/icons/history.svg" class="action-icon" @click="toggleHistory('thought')">
                        <div v-if="activeHistoryField === 'thought'" class="history-popover">
                            <div class="hp-header">История <div class="cm-red-dot" @click="activeHistoryField = null" style="width: 10px; height: 10px; margin-top: 0;"></div></div>
                            <div class="hp-list">
                                <div v-if="historyData.previous" class="hp-item previous" @click="selectHistoryItem(historyData.previous)"><span class="hp-badge">Предыдущий</span><p>{{ historyData.previous }}</p></div>
                                <div v-if="historyData.previous && historyData.others.length > 0" class="hp-divider"></div>
                                <div v-for="(val, idx) in historyData.others" :key="idx" class="hp-item" @click="selectHistoryItem(val)"><p>{{ val }}</p></div>
                                <div v-if="!historyData.previous && historyData.others.length === 0" class="hp-empty">История пуста</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="collapse-wrapper" :class="{ 'collapsed': hiddenBlocks.thought }"><div class="collapse-inner"><textarea class="message-textarea" v-model="store.currentEntryData.thought"></textarea></div></div>
            </div>

            <!-- Ответ LLM -->
            <div class="message-block assistant">
                <div class="role-header">
                    <img src="assets/icons/LLM_response.svg" width="18"> {{ store.t('role_assistant', 'Ответ LLM') }}
                    <div class="role-actions" style="position: relative;">
                        <img :src="hiddenBlocks.assistant ? 'assets/icons/close_eye.svg' : 'assets/icons/Eye.svg'" class="action-icon" @click="toggleBlock('assistant')">
                        <img src="assets/icons/history.svg" class="action-icon" @click="toggleHistory('assistant')">
                        <div v-if="activeHistoryField === 'assistant'" class="history-popover">
                            <div class="hp-header">История <div class="cm-red-dot" @click="activeHistoryField = null" style="width: 10px; height: 10px; margin-top: 0;"></div></div>
                            <div class="hp-list">
                                <div v-if="historyData.previous" class="hp-item previous" @click="selectHistoryItem(historyData.previous)"><span class="hp-badge">Предыдущий</span><p>{{ historyData.previous }}</p></div>
                                <div v-if="historyData.previous && historyData.others.length > 0" class="hp-divider"></div>
                                <div v-for="(val, idx) in historyData.others" :key="idx" class="hp-item" @click="selectHistoryItem(val)"><p>{{ val }}</p></div>
                                <div v-if="!historyData.previous && historyData.others.length === 0" class="hp-empty">История пуста</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="collapse-wrapper" :class="{ 'collapsed': hiddenBlocks.assistant }"><div class="collapse-inner"><textarea class="message-textarea" v-model="store.currentEntryData.assistant"></textarea></div></div>
            </div>

            <!-- Пагинация -->
            <div class="pagination-controls">
                <button class="nav-btn" @click="prevEntry" :disabled="currentEntryIndex === 0">
                    <img src="assets/icons/Forward.svg" style="transform: scaleX(-1);">
                </button>
                <button class="nav-btn add-btn" @click="addNewEntry">
                    <img src="assets/icons/+.svg" style="width: 32px; height: 32px;">
                </button>
                <button class="nav-btn" @click="nextEntry" :disabled="currentEntryIndex >= totalEntries - 1">
                    <img src="assets/icons/Forward.svg">
                </button>
            </div>
        </div>
    `
};