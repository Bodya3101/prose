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
            
            currentFormat: "standard",
            availableFormats: [],
            showFormatMenu: false,

            showTgModal: false,
            tgFilePath: "",
            tgParticipants: [],
            tgUserSender: "",
            tgAssistantSender: "",
            tgDatasetName: "",
            tgSystemPrompt: "",
            tgTotalMessages: 0,
            isTgConverting: false,

            showAuditModal: false,
            auditScannedCount: 0,
            auditIssues: [],
            selectedAuditIndices: [],
            isAuditing: false,

            showSplitModal: false,
            splitTrainRatio: 80,
            isSplitting: false,

            isJumpingToEntry: false,
            jumpInputVal: 1,
            jumpHistory: [],
            isFavAnimating: false
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
                if (store.activeProject.use_thinking) {
                    store.currentEntryData.system = val;
                } else if (store.activeProject.use_single_prompt) {
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

        window.addEventListener('keydown', this.handleGlobalKeyDown);
    },
    unmounted() {
        window.removeEventListener('keydown', this.handleGlobalKeyDown);
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

        async addNewEntry() {
            if (!(await this.saveCurrentEntry())) return;
            
            if (this.totalEntries === 0) {
                this.totalEntries = 1;
            }

            const newIndex = this.totalEntries;
            const blankPayload = { system: "", user: "", assistant: "" };
            if (store.activeProject.use_thinking) blankPayload.thought = "";

            if (window.pywebview) {
                const r = await window.pywebview.api.save_dataset_entry(newIndex, blankPayload);
                if (r.success) {
                    this.totalEntries++;
                    this.currentEntryIndex = newIndex;
                    await this.loadEntry(this.currentEntryIndex);
                }
            } else {
                this.clearFields();
                this.totalEntries++;
                this.currentEntryIndex = newIndex;
            }
        },

        isCurrentEntryFavorite() {
            if (!store.activeProject) return false;
            const favsMap = store.activeProject.favorites || {};
            const activeFavs = favsMap[this.activeDatasetName] || [];
            return activeFavs.includes(this.currentEntryIndex);
        },

        async toggleFavoriteCurrentEntry() {
            if (!store.activeProject) return;
            const favsMap = store.activeProject.favorites || {};
            const activeFavs = [...(favsMap[this.activeDatasetName] || [])];
            const idx = activeFavs.indexOf(this.currentEntryIndex);
            
            if (idx > -1) {
                activeFavs.splice(idx, 1);
            } else {
                if (activeFavs.length >= 9) {
                    await store.showAlert(
                        store.t('alert_error_title', 'Error'),
                        store.t('fav_max_limit_err', 'Maximum 9 favorites per dataset allowed!')
                    );
                    return;
                }

                activeFavs.push(this.currentEntryIndex);
                this.isFavAnimating = true;
                setTimeout(() => { this.isFavAnimating = false; }, 600);
            }
            
            favsMap[this.activeDatasetName] = activeFavs;
            store.activeProject.favorites = favsMap;

            if (window.pywebview) {
                await window.pywebview.api.update_project(store.activeProject.id, { favorites: favsMap });
            }
        },

        async jumpToFavoriteByIndex(favIndex) {
            if (!store.activeProject) return;
            const favsMap = store.activeProject.favorites || {};
            const activeFavs = favsMap[this.activeDatasetName] || [];
            
            if (favIndex < activeFavs.length) {
                const targetIdx = activeFavs[favIndex];
                if (targetIdx !== this.currentEntryIndex) {
                    this.jumpHistory.push(this.currentEntryIndex);
                    if (await this.saveCurrentEntry()) {
                        this.currentEntryIndex = targetIdx;
                        await this.loadEntry(this.currentEntryIndex);
                    }
                }
            } else {
                const msg = store.t('fav_not_found_err', 'Favorite entry #{num} not found.').replace('{num}', favIndex + 1);
                await store.showAlert(store.t('alert_warning_title', 'Warning'), msg);
            }
        },

        startJumpToEntry() {
            this.jumpInputVal = this.currentEntryIndex + 1;
            this.isJumpingToEntry = true;
            this.$nextTick(() => {
                if (this.$refs.jumpInput) this.$refs.jumpInput.focus();
            });
        },

        async confirmJumpToEntry() {
            this.isJumpingToEntry = false;
            const target = parseInt(this.jumpInputVal);
            if (isNaN(target) || target < 1 || target > this.totalEntries) return;
            const targetIdx = target - 1;
            if (targetIdx !== this.currentEntryIndex) {
                this.jumpHistory.push(this.currentEntryIndex);
                if (await this.saveCurrentEntry()) {
                    this.currentEntryIndex = targetIdx;
                    await this.loadEntry(this.currentEntryIndex);
                }
            }
        },

        handleGlobalKeyDown(e) {
            const tag = document.activeElement ? document.activeElement.tagName : '';
            const isEditingText = tag === 'TEXTAREA' || (tag === 'INPUT' && document.activeElement.type === 'text');

            if (e.ctrlKey && (e.code === 'NumpadMultiply' || e.key === '*')) {
                e.preventDefault();
                this.toggleFavoriteCurrentEntry();
                return;
            }

            if (e.ctrlKey && e.code.startsWith('Numpad') && e.code !== 'NumpadMultiply') {
                const digit = parseInt(e.code.replace('Numpad', ''));
                if (!isNaN(digit) && digit >= 1 && digit <= 9) {
                    e.preventDefault();
                    this.jumpToFavoriteByIndex(digit - 1);
                    return;
                }
            }

            if (isEditingText) return;

            if (e.ctrlKey && e.code === 'KeyZ') {
                if (this.jumpHistory.length > 0) {
                    e.preventDefault();
                    const prevIdx = this.jumpHistory.pop();
                    this.saveCurrentEntry().then(() => {
                        this.currentEntryIndex = prevIdx;
                        this.loadEntry(this.currentEntryIndex);
                    });
                }
                return;
            }

            if (e.code === 'ArrowRight') {
                e.preventDefault();
                this.nextEntry();
            }
            else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                this.prevEntry();
            }
            else if (e.code === 'ArrowDown') {
                if (this.currentEntryIndex !== 0) {
                    e.preventDefault();
                    this.jumpHistory.push(this.currentEntryIndex);
                    this.saveCurrentEntry().then(() => {
                        this.currentEntryIndex = 0;
                        this.loadEntry(0);
                    });
                }
            }
            else if (e.code === 'ArrowUp') {
                if (this.currentEntryIndex !== this.totalEntries - 1 && this.totalEntries > 0) {
                    e.preventDefault();
                    this.jumpHistory.push(this.currentEntryIndex);
                    this.saveCurrentEntry().then(() => {
                        this.currentEntryIndex = this.totalEntries - 1;
                        this.loadEntry(this.currentEntryIndex);
                    });
                }
            }
        },

        async changeFormat(newFormatId) {
            if (newFormatId === this.currentFormat) {
                this.showFormatMenu = false;
                return;
            }

            const confirmed = await store.showConfirm(
                store.t('format_convert_title', 'Convert Format'),
                store.t('format_convert_msg', `Convert the entire file "${this.activeDatasetName}" to the new format? The file on disk will be rewritten.`)
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
                    await store.showAlert("Success", "Dataset format successfully converted!");
                } else {
                    await store.showAlert("Error", r.error);
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
            this.hfConnectionStatus = { success: null, message: store.t('hf_status_checking', 'Checking...') };
            if (!window.pywebview) return;
            const r = await window.pywebview.api.test_hf_connection();
            if (r.success) {
                this.hfConnectionStatus = { success: true, message: `${store.t('hf_status_ok', 'Connection OK!')} (${r.username})` };
                this.hfRepoId = `${r.username}/${store.activeProject.name.toLowerCase().replace(/\s+/g, '-')}`;
            } else {
                this.hfConnectionStatus = { success: false, message: r.error || "Error." };
            }
        },
        async uploadToHf() {
            if (!this.hfRepoId.trim()) return;
            this.isUploading = true;
            await this.saveCurrentEntry();
            const r = await window.pywebview.api.upload_dataset_to_hf(this.hfRepoId.trim(), this.activeDatasetName, this.hfPrivate);
            this.isUploading = false;
            if (r.success) { await store.showAlert("Success", `Dataset pushed:\n${r.url}`); this.showHfModal = false; } 
            else await store.showAlert("Error", r.error);
        },

        async toggleTgModal() {
            this.showHfModal = false;
            this.showDatasetSelector = false;
            this.showFormatMenu = false;
            this.showAuditModal = false;
            this.showSplitModal = false;
            this.showTgModal = !this.showTgModal;
            if (this.showTgModal && !this.tgFilePath) {
                await this.selectTelegramFile();
            }
        },
        swapTgSenders() {
            const temp = this.tgUserSender;
            this.tgUserSender = this.tgAssistantSender;
            this.tgAssistantSender = temp;
        },
        async selectTelegramFile() {
            if (!window.pywebview) return;
            const r = await window.pywebview.api.select_telegram_export_file();
            if (r && r.success) {
                this.tgFilePath = r.path;
                this.tgParticipants = r.participants || [];
                this.tgTotalMessages = r.total_messages || 0;
                this.tgUserSender = this.tgParticipants[0] || "";
                this.tgAssistantSender = this.tgParticipants[1] || this.tgParticipants[0] || "";
                
                const cleanChatName = (r.chat_name || "chat").replace(/[^\w\s-]/gi, '').trim().replace(/\s+/g, '_');
                const safeName = cleanChatName || "chat";
                this.tgDatasetName = `tg_${safeName}.jsonl`;
            } else if (r && r.error) {
                await store.showAlert(store.t('alert_error_title', 'Error'), r.error);
            }
        },
        async convertTelegramExport() {
            if (!window.pywebview || !this.tgFilePath) return;
            if (this.tgUserSender === this.tgAssistantSender) {
                await store.showAlert(
                    store.t('alert_error_title', 'Error'), 
                    store.t('tg_err_same_person', 'User and Assistant cannot be the same participant!')
                );
                return;
            }

            this.isTgConverting = true;
            await this.saveCurrentEntry();

            const finalSysPrompt = store.activeProject.use_single_prompt ? "" : this.tgSystemPrompt;

            const res = await window.pywebview.api.convert_telegram_export(
                this.tgFilePath,
                this.tgUserSender,
                this.tgAssistantSender,
                this.tgDatasetName,
                this.currentFormat,
                finalSysPrompt
            );
            this.isTgConverting = false;

            if (res && res.success) {
                const currentFiles = store.activeProject.dataset_files || [];
                if (!currentFiles.includes(res.filename)) {
                    currentFiles.push(res.filename);
                    store.activeProject.dataset_files = currentFiles;
                }
                store.activeProject.active_dataset = res.filename;
                
                await window.pywebview.api.update_project(store.activeProject.id, {
                    dataset_files: currentFiles,
                    active_dataset: res.filename
                });

                this.activeDatasetName = res.filename;
                this.showTgModal = false;
                await this.loadDatasetIndexAndEntry();
                await store.showAlert("Success", store.t('tg_success_msg', 'Telegram dataset created and loaded!'));
            } else {
                await store.showAlert(
                    store.t('alert_error_title', 'Error'),
                    (res ? res.error : store.t('tg_err_no_messages', 'Conversion failed.'))
                );
            }
        },

        async runDatasetAudit() {
            this.showHfModal = false;
            this.showDatasetSelector = false;
            this.showFormatMenu = false;
            this.showTgModal = false;
            this.showSplitModal = false;
            
            this.isAuditing = true;
            this.showAuditModal = true;
            
            if (window.pywebview) {
                const res = await window.pywebview.api.audit_dataset(this.activeDatasetName, this.currentFormat);
                this.isAuditing = false;
                if (res && res.success) {
                    this.auditScannedCount = res.total_scanned;
                    this.auditIssues = res.issues || [];
                    this.selectedAuditIndices = this.auditIssues.map(i => i.index);
                } else {
                    await store.showAlert("Error", res ? res.error : "Audit failed.");
                }
            }
        },
        async deleteSelectedAuditIssues() {
            if (this.selectedAuditIndices.length === 0) return;
            const confirmMsg = store.t('audit_confirm_delete', 'Are you sure?')
                .replace('{count}', this.selectedAuditIndices.length);

            const confirmed = await store.showConfirm(store.t('btn_delete', 'Delete'), confirmMsg);
            if (confirmed && window.pywebview) {
                const res = await window.pywebview.api.delete_dataset_entries_bulk(
                    this.activeDatasetName, 
                    this.selectedAuditIndices
                );

                if (res && res.success) {
                    await this.loadDatasetIndexAndEntry();
                    this.showAuditModal = false;
                    await store.showAlert("Success", `Deleted ${res.deleted_count} entries.`);
                } else {
                    await store.showAlert("Error", res ? res.error : "Delete failed.");
                }
            }
        },

        toggleSplitModal() {
            this.showHfModal = false;
            this.showDatasetSelector = false;
            this.showFormatMenu = false;
            this.showTgModal = false;
            this.showAuditModal = false;
            this.showSplitModal = !this.showSplitModal;
        },
        async executeDatasetSplit() {
            if (!window.pywebview) return;
            this.isSplitting = true;
            await this.saveCurrentEntry();

            const ratio = this.splitTrainRatio / 100.0;
            const res = await window.pywebview.api.split_dataset(this.activeDatasetName, ratio);
            this.isSplitting = false;

            if (res && res.success) {
                const currentFiles = store.activeProject.dataset_files || [];
                if (!currentFiles.includes(res.train_file)) currentFiles.push(res.train_file);
                if (!currentFiles.includes(res.val_file)) currentFiles.push(res.val_file);
                
                store.activeProject.dataset_files = currentFiles;
                await window.pywebview.api.update_project(store.activeProject.id, { dataset_files: currentFiles });

                this.showSplitModal = false;
                const msg = store.t('split_success_msg', 'Dataset split!')
                    .replace('{train}', res.train_file)
                    .replace('{val}', res.val_file);
                await store.showAlert("Success", msg);
            } else {
                await store.showAlert("Error", res ? res.error : "Split failed.");
            }
        }
    },
    template: `
        <div class="editor-layout" @click.self="showDatasetSelector = false; showHfModal = false; showFormatMenu = false; showTgModal = false; showAuditModal = false; showSplitModal = false; activeHistoryField = null">
            <div class="dataset-stats" style="display: flex; align-items: center; gap: 12px; margin-bottom: 5px; position: relative;">
                <button class="icon-btn" @click="goHome" style="background: transparent; border: none; padding: 0;" :data-tooltip="store.t('btn_back', 'Back')">
                    <img src="assets/icons/Forward.svg" alt="Back" style="transform: scaleX(-1); height: 20px;">
                </button>
                
                <span style="font-size: 15px; color: #A0A0A0; font-style: italic; display: flex; align-items: center; gap: 8px; position: relative;">
                    
                    <!-- ИНТЕРАКТИВНЫЙ ПЕРЕХОД К НОМЕРУ СТРОКИ -->
                    <span v-if="!isJumpingToEntry" 
                          @click="startJumpToEntry" 
                          style="cursor: pointer;" 
                          :data-tooltip="store.t('tooltip_jump_entry', 'Click to jump to entry')">
                        {{ store.t('entry_label', 'Entry') }} #{{ currentEntryIndex + 1 }}
                    </span>
                    <input v-else 
                           ref="jumpInput" 
                           type="number" 
                           v-model.number="jumpInputVal" 
                           @keyup.enter="confirmJumpToEntry" 
                           @blur="confirmJumpToEntry" 
                           class="cm-hex-input-box" 
                           style="width: 60px; padding: 2px 4px; font-size: 12px; text-align: center;">

                    <!-- ⭐ ИКОНКА ИЗБРАННОГО (#CB3153) С ВРЕМЕННОЙ ВСПЫШКОЙ -->
                    <span :data-tooltip="store.t('tooltip_favorite', 'Favorite (Ctrl+*)')" 
                          @click="toggleFavoriteCurrentEntry" 
                          style="display: inline-flex; cursor: pointer; align-items: center;">
                        <img src="assets/icons/favorite.svg" 
                             class="action-icon" 
                             :class="{ 'fav-flash': isFavAnimating }"
                             :style="{ width: '16px', height: '16px', transition: 'all 0.25s ease', opacity: isCurrentEntryFavorite() ? '1' : '0.3', filter: isCurrentEntryFavorite() ? 'drop-shadow(0 0 3px #CB3153)' : 'grayscale(1)' }">
                    </span>

                    ({{ activeDatasetName }})
                    
                    <span @click.stop="showFormatMenu = !showFormatMenu" 
                          class="cp-default-btn" 
                          style="padding: 2px 8px; font-size: 11px; cursor: pointer; color: #4E6DB2; border-color: #4E6DB2; font-style: normal; font-weight: bold;"
                          :data-tooltip="store.t('tooltip_change_format', 'Change dataset format')">
                        [{{ activeFormatLabel }}]
                    </span>

                    <div v-if="showFormatMenu" class="ds-selector-popover" style="left: 120px; top: 30px; width: 260px; padding: 8px 0; z-index: 2500;">
                        <div style="font-size: 11px; color: #808080; padding: 4px 12px; font-weight: bold; text-transform: uppercase;">
                            {{ store.t('format_label', 'Dataset format:') }}
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

                    <!-- 1. ИКОНКА СМЕНЫ ДАТАСЕТА -->
                    <span v-if="(store.activeProject.dataset_files || []).length > 1" 
                          :data-tooltip="store.t('tooltip_change_dataset', 'Switch active dataset')"
                          @click="handleDatasetSwitch" 
                          style="display: inline-flex; cursor: pointer;">
                        <img src="assets/icons/change_dataset.svg" class="action-icon" style="width: 18px; height: 18px; opacity: 0.8;">
                    </span>
                    
                    <!-- 2. ИКОНКА HUGGING FACE -->
                    <span :data-tooltip="store.t('tooltip_hf_push', 'Push dataset to Hugging Face')"
                          @click="showHfModal = !showHfModal; showTgModal = false; showAuditModal = false; showSplitModal = false;" 
                          style="display: inline-flex; cursor: pointer;">
                        <img src="assets/icons/huggingface.svg" class="action-icon" style="width: 18px; height: 18px; opacity: 0.8;">
                    </span>

                    <!-- 3. ИКОНКА TELEGRAM ИМПОРТА -->
                    <span :data-tooltip="store.t('tooltip_tg_import', 'Import chat from Telegram (.json)')"
                          @click="toggleTgModal" 
                          style="display: inline-flex; cursor: pointer;">
                        <img src="assets/icons/telegram_convertion.svg" class="action-icon" style="width: 18px; height: 18px; opacity: 0.8;">
                    </span>

                    <!-- 4. ИКОНКА АУДИТА (ПРОВЕРКА КАЧЕСТВА) -->
                    <span :data-tooltip="store.t('tooltip_audit_dataset', 'Audit dataset (Quality Check)')"
                          @click="runDatasetAudit" 
                          style="display: inline-flex; cursor: pointer;">
                        <img src="assets/icons/audit.svg" class="action-icon" style="width: 18px; height: 18px; opacity: 0.8;">
                    </span>

                    <!-- 5. ИКОНКА СПЛИТТЕРА (TRAIN / VAL) -->
                    <span :data-tooltip="store.t('tooltip_split_dataset', 'Split dataset into Train and Validation')"
                          @click="toggleSplitModal" 
                          style="display: inline-flex; cursor: pointer;">
                        <img src="assets/icons/split.svg" class="action-icon" style="width: 18px; height: 18px; opacity: 0.8;">
                    </span>

                    <!-- 6. ИКОНКИ ПЛАГИНОВ -->
                    <span v-for="btn in store.editor_buttons" 
                          :key="btn.id" 
                          :data-tooltip="btn.title" 
                          @click="btn.action" 
                          style="display: inline-flex; cursor: pointer;">
                        <img :src="btn.icon" class="action-icon" style="width: 18px; height: 18px; opacity: 0.8;">
                    </span>
                </span>

                <component v-if="store.active_overlay" :is="store.active_overlay" @close="store.active_overlay = null"></component>

                <!-- ✈️ ОКНО ИМПОРТА ИЗ TELEGRAM -->
                <div v-if="showTgModal" class="cp-popover" style="left: 60px; top: 35px; width: 350px; gap: 12px; padding: 15px; z-index: 3000;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-main); padding-bottom: 8px;">
                        <span style="font-weight: bold; color: #52a8e8; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                            <img src="assets/icons/telegram_convertion.svg" style="width: 16px; height: 16px;">
                            {{ store.t('tg_modal_title', 'TELEGRAM IMPORT') }}
                        </span>
                        <div class="cm-red-dot" @click="showTgModal = false" style="width: 14px; height: 14px; margin-top: 0;" :data-tooltip="store.t('btn_cancel', 'Cancel')"></div>
                    </div>

                    <div v-if="!tgFilePath" style="display: flex; flex-direction: column; gap: 10px; align-items: center; padding: 10px 0;">
                        <button class="cp-default-btn" @click="selectTelegramFile" style="width: 100%; padding: 10px; font-size: 12px; background: #1a2733; color: #52a8e8; border: 1px solid #2b4863; font-weight: bold;">
                            📁 {{ store.t('tg_btn_select_file', 'Select result.json file') }}
                        </button>
                    </div>

                    <div v-else style="display: flex; flex-direction: column; gap: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #888;">
                            <span>{{ store.t('tg_found_messages', 'Messages found:') }} <b style="color: #4D986D;">{{ tgTotalMessages }}</b></span>
                            <button @click="selectTelegramFile" style="background: transparent; border: 1px dashed var(--border-main); color: #52a8e8; font-size: 10px; padding: 2px 6px; border-radius: 4px; cursor: pointer;">
                                {{ store.t('tg_btn_reselect', 'Change file') }}
                            </button>
                        </div>

                        <div style="display: flex; gap: 8px; align-items: flex-end;">
                            <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                                <span style="font-size: 10px; color: #A0A0A0;">{{ store.t('tg_select_user', 'Who plays User role:') }}</span>
                                <select v-model="tgUserSender" class="cm-hex-input-box" style="width: 100%; text-align: left; font-size: 11px; padding: 5px;">
                                    <option v-for="p in tgParticipants" :key="'u_'+p" :value="p">{{ p }}</option>
                                </select>
                            </div>

                            <button @click="swapTgSenders" class="cp-default-btn" style="padding: 6px; height: 30px; display: flex; align-items: center; justify-content: center;" :data-tooltip="store.t('tg_swap_tooltip', 'Swap roles')">
                                <img src="assets/icons/change_dataset.svg" style="width: 14px; height: 14px; opacity: 0.9;">
                            </button>

                            <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                                <span style="font-size: 10px; color: #A0A0A0;">{{ store.t('tg_select_assistant', 'Who plays AI (Assistant) role:') }}</span>
                                <select v-model="tgAssistantSender" class="cm-hex-input-box" style="width: 100%; text-align: left; font-size: 11px; padding: 5px;">
                                    <option v-for="p in tgParticipants" :key="'a_'+p" :value="p">{{ p }}</option>
                                </select>
                            </div>
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 11px; color: #A0A0A0;">{{ store.t('tg_system_prompt', 'System Prompt (optional):') }}</span>
                                <span v-if="store.activeProject.use_single_prompt" style="font-size: 10px; color: #4D986D; font-weight: bold;">
                                    {{ store.t('role_system_global', '[Global]') }}
                                </span>
                            </div>
                            <textarea 
                                v-model="tgSystemPrompt" 
                                :disabled="store.activeProject.use_single_prompt" 
                                class="cm-hex-input-box" 
                                :placeholder="store.activeProject.use_single_prompt ? store.t('tg_single_prompt_active', 'Disabled: Controlled by [Global] System Prompt') : store.t('tg_system_prompt_ph', 'Enter system prompt for entries...')" 
                                :style="{ width: '100%', height: '42px', textAlign: 'left', fontSize: '11px', resize: 'none', opacity: store.activeProject.use_single_prompt ? 0.4 : 1, cursor: store.activeProject.use_single_prompt ? 'not-allowed' : 'text' }">
                            </textarea>
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 11px; color: #A0A0A0;">{{ store.t('tg_dataset_name', 'Output dataset name:') }}</span>
                            <input type="text" v-model="tgDatasetName" class="cm-hex-input-box" style="width: 100%; text-align: left; text-transform: none; font-size: 12px;">
                        </div>

                        <button class="btn-primary" @click="convertTelegramExport" style="width: 100%; padding: 8px; font-size: 12px; font-weight: bold; background: #0088cc; border-color: #52a8e8;" :disabled="isTgConverting">
                            {{ isTgConverting ? store.t('tg_btn_converting', 'Converting...') : store.t('tg_btn_convert', 'Convert & Load') }}
                        </button>
                    </div>
                </div>

                <!-- 🔍 МОДАЛЬНОЕ ОКНО АУДИТА ДАТАСЕТА -->
                <div v-if="showAuditModal" class="cp-popover" style="left: 120px; top: 35px; width: 420px; gap: 12px; padding: 15px; z-index: 3100; max-height: 450px; display: flex; flex-direction: column;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-main); padding-bottom: 8px;">
                        <span style="font-weight: bold; color: white; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                            <img src="assets/icons/audit.svg" style="width: 16px; height: 16px; object-fit: contain;">
                            {{ store.t('audit_title', 'DATASET AUDIT') }}
                        </span>
                        <div class="cm-red-dot" @click="showAuditModal = false" style="width: 14px; height: 14px; margin-top: 0;"></div>
                    </div>

                    <div v-if="isAuditing" style="text-align: center; color: #888; padding: 20px 0; font-size: 12px;">
                        Scanning dataset...
                    </div>

                    <div v-else style="display: flex; flex-direction: column; gap: 10px; flex: 1; overflow: hidden;">
                        <div style="font-size: 11px; color: #888;">
                            {{ store.t('audit_scanned_label', 'Scanned entries:') }} <b>{{ auditScannedCount }}</b>
                        </div>

                        <div v-if="auditIssues.length === 0" style="text-align: center; color: #4D986D; padding: 20px 0; font-size: 13px; font-weight: bold;">
                            {{ store.t('audit_no_issues', 'No issues found. Dataset is clean.') }}
                        </div>

                        <div v-else style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 5px;">
                            <div v-for="issue in auditIssues" :key="issue.index" style="background: #161616; border: 1px solid var(--border-main); border-radius: 8px; padding: 8px 10px; display: flex; align-items: center; gap: 10px;">
                                <input type="checkbox" :value="issue.index" v-model="selectedAuditIndices" style="cursor: pointer;">
                                <div style="flex: 1; font-size: 11px; overflow: hidden;">
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                                        <b style="color: #D34646;">#{{ issue.index + 1 }} [{{ issue.type === 'empty' ? store.t('audit_issue_empty', 'Empty') : store.t('audit_issue_duplicate', 'Duplicate') }}]</b>
                                    </div>
                                    <div style="color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                        User: {{ issue.user_preview }}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button v-if="auditIssues.length > 0" class="btn-primary" @click="deleteSelectedAuditIssues" style="width: 100%; padding: 8px; font-size: 12px; background: #D34646; border-color: #e55353;" :disabled="selectedAuditIndices.length === 0">
                            {{ store.t('audit_btn_delete_selected', 'Delete Selected') }} ({{ selectedAuditIndices.length }})
                        </button>
                    </div>
                </div>

                <!-- ✂️ МОДАЛЬНОЕ ОКНО СПЛИТТЕРА TRAIN / VAL -->
                <div v-if="showSplitModal" class="cp-popover" style="left: 180px; top: 35px; width: 320px; gap: 12px; padding: 15px; z-index: 3100;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-main); padding-bottom: 8px;">
                        <span style="font-weight: bold; color: white; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                            <img src="assets/icons/split.svg" style="width: 16px; height: 16px; object-fit: contain;">
                            {{ store.t('split_title', 'TRAIN / VAL SPLIT') }}
                        </span>
                        <div class="cm-red-dot" @click="showSplitModal = false" style="width: 14px; height: 14px; margin-top: 0;"></div>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; justify-content: space-between; font-size: 12px; color: #A0A0A0;">
                            <span>{{ store.t('split_ratio_label', 'Train ratio:') }}</span>
                            <b style="color: #4D986D;">{{ splitTrainRatio }}% / {{ 100 - splitTrainRatio }}%</b>
                        </div>

                        <input type="range" v-model.number="splitTrainRatio" min="50" max="95" step="5" class="custom-range">
                    </div>

                    <button class="btn-primary" @click="executeDatasetSplit" style="width: 100%; padding: 8px; font-size: 12px; font-weight: bold;" :disabled="isSplitting">
                        {{ isSplitting ? 'Splitting...' : store.t('split_btn_execute', 'Split & Add to Project') }}
                    </button>
                </div>

                <!-- ОКНО HUGGING FACE -->
                <div v-if="showHfModal" class="cp-popover" style="left: 20px; top: 35px; width: 320px; gap: 12px; padding: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: bold; color: white; font-size: 13px;">{{ store.t('hf_title', 'Hugging Face Dataset Push') }}</span>
                        <div class="cm-red-dot" @click="showHfModal = false" style="width: 14px; height: 14px; margin-top: 0;" data-tooltip="Закрыть"></div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 5px;">
                        <span style="font-size: 11px; color: #A0A0A0;">{{ store.t('hf_repo_label', 'Repository ID:') }}</span>
                        <input type="text" v-model="hfRepoId" placeholder="username/my-dataset" class="cm-hex-input-box" style="width: 100%; text-align: left; text-transform: none; font-size: 12px;">
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; margin: 5px 0;">
                        <span>{{ store.t('hf_private_label', 'Private repository') }}</span>
                        <label class="toggle-switch"><input type="checkbox" v-model="hfPrivate"><span class="toggle-slider"></span></label>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <button class="cp-default-btn" @click="testHfConnection" style="padding: 6px; font-size: 12px;">{{ store.t('hf_btn_test', 'Test Connection') }}</button>
                        <span v-if="hfConnectionStatus.message" :style="{ color: hfConnectionStatus.success ? '#4D986D' : '#D34646', fontSize: '11px', textAlign: 'center' }">{{ hfConnectionStatus.message }}</span>
                    </div>
                    <button class="btn-primary" @click="uploadToHf" style="width: 100%; padding: 8px; font-size: 13px; font-weight: bold;" :disabled="isUploading">
                        {{ isUploading ? store.t('hf_btn_uploading', 'Uploading...') : store.t('hf_btn_upload', 'Upload') }}
                    </button>
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
                    <img src="assets/icons/dataset_icon.svg" width="18"> {{ store.t('role_system', 'System Prompt') }} 
                    <span v-if="store.activeProject.use_single_prompt" style="color: #4D986D; font-size: 12px; margin-left: 10px;">{{ store.t('role_system_global', '[Global]') }}</span>
                    <div class="role-actions" style="position: relative;">
                        <!-- ГЛАЗИК В ОБЕРТКЕ SPAN -->
                        <span :data-tooltip="hiddenBlocks.system ? store.t('tooltip_show_block', 'Expand field') : store.t('tooltip_hide_block', 'Collapse field')"
                              @click="toggleBlock('system')"
                              style="display: inline-flex; cursor: pointer;">
                            <img :src="hiddenBlocks.system ? 'assets/icons/close_eye.svg' : 'assets/icons/Eye.svg'" class="action-icon">
                        </span>
                        
                        <!-- ИСТОРИЯ В ОБЕРТКЕ SPAN -->
                        <span :data-tooltip="store.t('tooltip_history', 'Value history')"
                              @click="toggleHistory('system')"
                              style="display: inline-flex; cursor: pointer;">
                            <img src="assets/icons/history.svg" class="action-icon">
                        </span>

                        <div v-if="activeHistoryField === 'system'" class="history-popover">
                            <div class="hp-header">{{ store.t('history_title', 'HISTORY') }} <div class="cm-red-dot" @click="activeHistoryField = null" style="width: 10px; height: 10px; margin-top: 0;"></div></div>
                            <div class="hp-list">
                                <div v-if="historyData.previous" class="hp-item previous" @click="selectHistoryItem(historyData.previous)"><span class="hp-badge">{{ store.t('history_previous', 'Previous') }}</span><p>{{ historyData.previous }}</p></div>
                                <div v-if="historyData.previous && historyData.others.length > 0" class="hp-divider"></div>
                                <div v-for="(val, idx) in historyData.others" :key="idx" class="hp-item" @click="selectHistoryItem(val)"><p>{{ val }}</p></div>
                                <div v-if="!historyData.previous && historyData.others.length === 0" class="hp-empty">{{ store.t('history_empty', 'History is empty') }}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="collapse-wrapper" :class="{ 'collapsed': hiddenBlocks.system }"><div class="collapse-inner"><textarea class="message-textarea" v-model="systemPrompt"></textarea></div></div>
            </div>

            <!-- Пользователь -->
            <div class="message-block user">
                <div class="role-header">
                    <img src="assets/icons/user_query.svg" width="18"> {{ store.t('role_user', 'User Message') }}
                    <div class="role-actions" style="position: relative;">
                        <!-- ГЛАЗИК В ОБЕРТКЕ SPAN -->
                        <span :data-tooltip="hiddenBlocks.user ? store.t('tooltip_show_block', 'Expand field') : store.t('tooltip_hide_block', 'Collapse field')"
                              @click="toggleBlock('user')"
                              style="display: inline-flex; cursor: pointer;">
                            <img :src="hiddenBlocks.user ? 'assets/icons/close_eye.svg' : 'assets/icons/Eye.svg'" class="action-icon">
                        </span>
                        
                        <!-- ИСТОРИЯ В ОБЕРТКЕ SPAN -->
                        <span :data-tooltip="store.t('tooltip_history', 'Value history')"
                              @click="toggleHistory('user')"
                              style="display: inline-flex; cursor: pointer;">
                            <img src="assets/icons/history.svg" class="action-icon">
                        </span>

                        <div v-if="activeHistoryField === 'user'" class="history-popover">
                            <div class="hp-header">{{ store.t('history_title', 'HISTORY') }} <div class="cm-red-dot" @click="activeHistoryField = null" style="width: 10px; height: 10px; margin-top: 0;"></div></div>
                            <div class="hp-list">
                                <div v-if="historyData.previous" class="hp-item previous" @click="selectHistoryItem(historyData.previous)"><span class="hp-badge">{{ store.t('history_previous', 'Previous') }}</span><p>{{ historyData.previous }}</p></div>
                                <div v-if="historyData.previous && historyData.others.length > 0" class="hp-divider"></div>
                                <div v-for="(val, idx) in historyData.others" :key="idx" class="hp-item" @click="selectHistoryItem(val)"><p>{{ val }}</p></div>
                                <div v-if="!historyData.previous && historyData.others.length === 0" class="hp-empty">{{ store.t('history_empty', 'History is empty') }}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="collapse-wrapper" :class="{ 'collapsed': hiddenBlocks.user }"><div class="collapse-inner"><textarea class="message-textarea" v-model="store.currentEntryData.user"></textarea></div></div>
            </div>

            <!-- Процесс размышления -->
            <div class="message-block thought" v-if="store.activeProject.use_thinking">
                <div class="role-header">
                    <img src="assets/icons/think.svg" width="18"> {{ store.t('role_thought', 'Chain of Thought') }}
                    <div class="role-actions" style="position: relative;">
                        <!-- ГЛАЗИК В ОБЕРТКЕ SPAN -->
                        <span :data-tooltip="hiddenBlocks.thought ? store.t('tooltip_show_block', 'Expand field') : store.t('tooltip_hide_block', 'Collapse field')"
                              @click="toggleBlock('thought')"
                              style="display: inline-flex; cursor: pointer;">
                            <img :src="hiddenBlocks.thought ? 'assets/icons/close_eye.svg' : 'assets/icons/Eye.svg'" class="action-icon">
                        </span>
                        
                        <!-- ИСТОРИЯ В ОБЕРТКЕ SPAN -->
                        <span :data-tooltip="store.t('tooltip_history', 'Value history')"
                              @click="toggleHistory('thought')"
                              style="display: inline-flex; cursor: pointer;">
                            <img src="assets/icons/history.svg" class="action-icon">
                        </span>

                        <div v-if="activeHistoryField === 'thought'" class="history-popover">
                            <div class="hp-header">{{ store.t('history_title', 'HISTORY') }} <div class="cm-red-dot" @click="activeHistoryField = null" style="width: 10px; height: 10px; margin-top: 0;"></div></div>
                            <div class="hp-list">
                                <div v-if="historyData.previous" class="hp-item previous" @click="selectHistoryItem(historyData.previous)"><span class="hp-badge">{{ store.t('history_previous', 'Previous') }}</span><p>{{ historyData.previous }}</p></div>
                                <div v-if="historyData.previous && historyData.others.length > 0" class="hp-divider"></div>
                                <div v-for="(val, idx) in historyData.others" :key="idx" class="hp-item" @click="selectHistoryItem(val)"><p>{{ val }}</p></div>
                                <div v-if="!historyData.previous && historyData.others.length === 0" class="hp-empty">{{ store.t('history_empty', 'History is empty') }}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="collapse-wrapper" :class="{ 'collapsed': hiddenBlocks.thought }"><div class="collapse-inner"><textarea class="message-textarea" v-model="store.currentEntryData.thought"></textarea></div></div>
            </div>

            <!-- Ответ LLM -->
            <div class="message-block assistant">
                <div class="role-header">
                    <img src="assets/icons/LLM_response.svg" width="18"> {{ store.t('role_assistant', 'LLM Response') }}
                    <div class="role-actions" style="position: relative;">
                        <!-- ГЛАЗИК В ОБЕРТКЕ SPAN -->
                        <span :data-tooltip="hiddenBlocks.assistant ? store.t('tooltip_show_block', 'Expand field') : store.t('tooltip_hide_block', 'Collapse field')"
                              @click="toggleBlock('assistant')"
                              style="display: inline-flex; cursor: pointer;">
                            <img :src="hiddenBlocks.assistant ? 'assets/icons/close_eye.svg' : 'assets/icons/Eye.svg'" class="action-icon">
                        </span>
                        
                        <!-- ИСТОРИЯ В ОБЕРТКЕ SPAN -->
                        <span :data-tooltip="store.t('tooltip_history', 'Value history')"
                              @click="toggleHistory('assistant')"
                              style="display: inline-flex; cursor: pointer;">
                            <img src="assets/icons/history.svg" class="action-icon">
                        </span>

                        <div v-if="activeHistoryField === 'assistant'" class="history-popover">
                            <div class="hp-header">{{ store.t('history_title', 'HISTORY') }} <div class="cm-red-dot" @click="activeHistoryField = null" style="width: 10px; height: 10px; margin-top: 0;"></div></div>
                            <div class="hp-list">
                                <div v-if="historyData.previous" class="hp-item previous" @click="selectHistoryItem(historyData.previous)"><span class="hp-badge">{{ store.t('history_previous', 'Previous') }}</span><p>{{ historyData.previous }}</p></div>
                                <div v-if="historyData.previous && historyData.others.length > 0" class="hp-divider"></div>
                                <div v-for="(val, idx) in historyData.others" :key="idx" class="hp-item" @click="selectHistoryItem(val)"><p>{{ val }}</p></div>
                                <div v-if="!historyData.previous && historyData.others.length === 0" class="hp-empty">{{ store.t('history_empty', 'History is empty') }}</div>
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