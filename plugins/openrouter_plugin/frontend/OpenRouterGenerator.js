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

            queueEnabled: true,
            parallelEnabled: true,
            maxConcurrency: 3,
            targetCount: 1000,
            autoRetry: true,
            maxRetries: 3,
            autoSaveResume: true,
            qualityCheckEnabled: true,
            duplicateCheckEnabled: true,
            diversityEnabled: true,
            topicPlan: '',
            adaptiveSpeed: true,
            minAssistantWords: 80,
            maxOutputTokens: 8192,
            pendingCheckpoint: null,
            progressCompleted: 0,
            progressTotal: 1000,
            rejectedCount: 0,
            failedChunks: 0,
            cancelRequested: false,
            saveQueue: Promise.resolve(),

            genMode: 'single',
            batchSize: 10,
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
        this.loadSavedGenerationModes();
        this.loadPendingCheckpoint();

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
        close() {
            if (this.isGenerating) {
                this.cancelRequested = true;
                this.statusMessage = this.store.t('or_cancel_wait', 'Stopping after current requests finish...');
                return;
            }
            this.$emit('close');
        },
        modeKeys() {
            return [
                'queueEnabled', 'parallelEnabled', 'maxConcurrency', 'targetCount', 'batchSize',
                'autoRetry', 'maxRetries', 'autoSaveResume', 'qualityCheckEnabled',
                'duplicateCheckEnabled', 'diversityEnabled', 'topicPlan', 'adaptiveSpeed',
                'minAssistantWords', 'maxOutputTokens'
            ];
        },
        buildGenerationOptions() {
            return {
                diversity_enabled: this.diversityEnabled,
                min_assistant_words: Number(this.minAssistantWords) || 0,
                max_output_tokens: Number(this.maxOutputTokens) || 8192,
                topic_plan: this.topicPlan || ''
            };
        },
        async saveGenerationModes() {
            if (!window.pywebview) return;
            const saved = {};
            for (const key of this.modeKeys()) saved[key] = this[key];
            await window.pywebview.api.update_setting('plugin_openrouter_generation_options', saved);
            this.store.settings.plugin_openrouter_generation_options = saved;
            this.providerStatus = this.store.t('or_modes_saved', 'Generation modes saved.');
        },
        projectDatasetIdentity() {
            const project = this.store.activeProject || {};
            const files = project.dataset_files || [];
            const datasetName = project.active_dataset || files[0] || project.dataset_file || '';
            return {
                projectId: String(project.id || ''),
                projectName: String(project.name || ''),
                datasetName: String(datasetName)
            };
        },
        loadSavedGenerationModes() {
            const saved = this.store.settings.plugin_openrouter_generation_options;
            if (!saved || typeof saved !== 'object') return;
            for (const key of this.modeKeys()) {
                if (Object.prototype.hasOwnProperty.call(saved, key)) this[key] = saved[key];
            }
        },
        loadPendingCheckpoint() {
            const checkpoint = this.store.settings.plugin_openrouter_checkpoint;
            if (!checkpoint || typeof checkpoint !== 'object' || checkpoint.status === 'completed') return;
            const identity = this.projectDatasetIdentity();
            if (checkpoint.project_id === identity.projectId &&
                checkpoint.dataset_name === identity.datasetName &&
                checkpoint.auto_save_resume === true) {
                this.pendingCheckpoint = checkpoint;
            }
        },
        async resumePreviousGeneration() {
            const checkpoint = this.pendingCheckpoint;
            if (!checkpoint) return;
            this.pendingCheckpoint = null;
            if (checkpoint.generation_modes && typeof checkpoint.generation_modes === 'object') {
                for (const key of this.modeKeys()) {
                    if (Object.prototype.hasOwnProperty.call(checkpoint.generation_modes, key)) this[key] = checkpoint.generation_modes[key];
                }
            }
            this.provider = checkpoint.provider || this.provider;
            this.customBaseUrl = checkpoint.custom_base_url || this.customBaseUrl;
            this.rpm = checkpoint.rpm || this.rpm;
            this.selectedModel = checkpoint.model || this.selectedModel;
            this.generatorPrompt = checkpoint.generator_prompt || this.generatorPrompt;
            this.batchSize = checkpoint.batch_size || this.batchSize;
            this.targetCount = checkpoint.target_count || this.targetCount;
            this.hardcodeFields = Object.assign({}, this.hardcodeFields, checkpoint.hardcode_fields || {});
            await this.startGeneration(checkpoint);
        },
        async persistCheckpoint(state, status) {
            if (!state.autoSaveResume || !state.queueEnabled || !window.pywebview) return;
            const checkpoint = Object.assign({}, state.checkpoint, {
                completed: state.completed,
                status,
                updated_at: new Date().toISOString(),
                auto_save_resume: true
            });
            await window.pywebview.api.update_setting('plugin_openrouter_checkpoint', checkpoint);
            this.store.settings.plugin_openrouter_checkpoint = checkpoint;
            if (status === 'completed') this.pendingCheckpoint = null;
        },
        async acquireRequestSlot(state) {
            while (!this.cancelRequested && state.activeRequests >= state.currentConcurrency) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (this.cancelRequested) throw new Error('cancelled');
            state.activeRequests++;
        },
        async callGenerator(count, context, state) {
            await this.acquireRequestSlot(state);
            try {
                const result = await window.pywebview.api.plugin_openrouter_generate_batch(
                    context.generatorPrompt,
                    context.emptyFields,
                    context.hardcodedContext,
                    count,
                    context.model,
                    context.provider,
                    context.generationOptions
                );
                const errorText = result && result.error ? String(result.error) : '';
                if (state.adaptiveSpeed && /429|rate.?limit|too many requests/i.test(errorText)) {
                    state.currentConcurrency = Math.max(1, Math.floor(state.currentConcurrency / 2));
                    state.successStreak = 0;
                } else if (state.adaptiveSpeed && result && result.success) {
                    state.successStreak++;
                    if (state.successStreak >= 3 && state.currentConcurrency < state.maxConcurrency) {
                        state.currentConcurrency++;
                        state.successStreak = 0;
                    }
                }
                return result;
            } finally {
                state.activeRequests--;
            }
        },
        normalizedPrompt(value) {
            return String(value || '').normalize('NFKC').toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, ' ')
                .replace(/\s+/g, ' ').trim();
        },
        candidateIsValid(entry, context, state) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
            const payload = {
                system: context.hardcodedContext.system ? context.hardcodedContext.system : (entry.system || ''),
                user: context.hardcodedContext.user ? context.hardcodedContext.user : (entry.user || ''),
                assistant: context.hardcodedContext.assistant ? context.hardcodedContext.assistant : (entry.assistant || '')
            };
            if (context.useThinking) {
                payload.thought = context.hardcodedContext.thought ? context.hardcodedContext.thought : (entry.thought || '');
            }

            if (state.qualityCheckEnabled) {
                for (const field of context.emptyFields) {
                    if (typeof entry[field] !== 'string' || !entry[field].trim()) return false;
                }
                if (context.emptyFields.includes('assistant') && state.minAssistantWords > 0) {
                    const words = String(payload.assistant || '').trim().split(/\s+/).filter(Boolean).length;
                    if (words < state.minAssistantWords) return false;
                }
            }

            if (state.duplicateCheckEnabled) {
                const dedupeSource = context.emptyFields.includes('user') ? payload.user : JSON.stringify(payload);
                const normalized = this.normalizedPrompt(dedupeSource);
                if (!normalized) return false;
                if (state.seenPromptSet.has(normalized)) return false;
                const tokens = normalized.split(' ').filter(word => word.length > 2);
                if (tokens.length >= 7) {
                    const tokenSet = new Set(tokens);
                    for (const prior of state.seenPrompts.slice(-200)) {
                        const priorTokens = prior.split(' ').filter(word => word.length > 2);
                        if (priorTokens.length < 7) continue;
                        const priorSet = new Set(priorTokens);
                        let overlap = 0;
                        for (const token of tokenSet) if (priorSet.has(token)) overlap++;
                        const similarity = overlap / Math.max(1, tokenSet.size + priorSet.size - overlap);
                        if (similarity >= 0.92) return false;
                    }
                }
                state.seenPromptSet.add(normalized);
                state.seenPrompts.push(normalized);
            }
            return payload;
        },
        async appendEntries(entries, state) {
            const task = this.saveQueue.then(async () => {
                if (!entries.length || this.cancelRequested) return;
                const indexToSave = this.$parent.totalEntries;
                let saved;
                if (window.pywebview.api.save_dataset_entries) {
                    saved = await window.pywebview.api.save_dataset_entries(indexToSave, entries);
                } else {
                    // Compatibility fallback for older Prose builds.
                    for (let offset = 0; offset < entries.length; offset++) {
                        saved = await window.pywebview.api.save_dataset_entry(indexToSave + offset, entries[offset]);
                        if (!saved || saved.success !== true) throw new Error((saved && saved.error) || 'Could not save dataset entry.');
                    }
                    saved = { success: true, count: entries.length };
                }
                if (!saved || saved.success !== true) throw new Error((saved && saved.error) || 'Could not save dataset batch.');
                this.$parent.totalEntries += entries.length;
                state.completed += entries.length;
                this.progressCompleted = state.completed;
                if (state.autoSaveResume && state.queueEnabled) await this.persistCheckpoint(state, 'running');
            });
            this.saveQueue = task.catch(() => {});
            return task;
        },
        async generateChunk(wantedCount, context, state) {
            let savedCount = 0;
            let retries = 0;
            const retryLimit = state.autoRetry ? state.maxRetries : 0;
            while (savedCount < wantedCount && !this.cancelRequested) {
                const requestCount = wantedCount - savedCount;
                this.statusMessage = this.store.t('or_progress_request', 'Generating batch') +
                    ' ' + (state.completed + 1) + '–' + Math.min(state.targetTotal, state.completed + requestCount) +
                    ' / ' + state.targetTotal + ' (' + state.activeRequests + '/' + state.currentConcurrency + ')';
                let result;
                try {
                    result = await this.callGenerator(requestCount, context, state);
                } catch (error) {
                    if (String(error.message) === 'cancelled') return savedCount;
                    result = { success: false, error: String(error.message || error) };
                }

                if (!result || !result.success || !Array.isArray(result.data)) {
                    state.lastError = result && result.error ? result.error : this.store.t('or_unknown_error', 'Provider returned an invalid response.');
                    if (retries >= retryLimit) {
                        state.failedChunks++;
                        this.failedChunks = state.failedChunks;
                        return savedCount;
                    }
                    const isRateLimit = /429|rate.?limit|too many requests/i.test(state.lastError);
                    const delayMs = isRateLimit ? Math.min(30000, 2500 * (2 ** retries)) : Math.min(15000, 800 * (2 ** retries));
                    retries++;
                    this.statusMessage = this.store.t('or_retry_wait', 'Temporary error; retrying in') + ' ' + Math.ceil(delayMs / 1000) + 's: ' + state.lastError;
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }

                const accepted = [];
                for (const entry of result.data) {
                    const payload = this.candidateIsValid(entry, context, state);
                    if (payload) accepted.push(payload);
                    else state.rejectedCount++;
                }
                this.rejectedCount = state.rejectedCount;
                if (accepted.length) {
                    try {
                        await this.appendEntries(accepted, state);
                    } catch (error) {
                        state.failedChunks++;
                        state.lastError = String(error.message || error);
                        this.failedChunks = state.failedChunks;
                        return savedCount;
                    }
                    savedCount += accepted.length;
                    retries = 0;
                }

                if (savedCount < wantedCount && !this.cancelRequested) {
                    if (retries >= retryLimit) {
                        state.failedChunks++;
                        this.failedChunks = state.failedChunks;
                        return savedCount;
                    }
                    retries++;
                    this.statusMessage = this.store.t('or_retry_quality', 'Replacing short, empty or duplicate examples...') +
                        ' (' + savedCount + '/' + wantedCount + ')';
                    await new Promise(resolve => setTimeout(resolve, state.adaptiveSpeed ? 300 : 0));
                }
            }
            return savedCount;
        },
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
                if (this.modelsList.length && !this.modelsList.includes(this.selectedModel)) this.selectedModel = this.modelsList[0];
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
                if (this.customBaseUrl.trim() && this.customBaseUrl === this.store.settings.plugin_openrouter_custom_base_url) await this.loadModels();
            }
        },
        async persistProviderSettings(refreshModels = true) {
            if (!window.pywebview) return false;
            const result = await window.pywebview.api.plugin_openrouter_save_config(
                this.provider, this.customBaseUrl, this.customApiKey, this.rpm, this.clearCustomKey
            );
            if (!result.success) {
                this.providerStatus = result.error || this.store.t('or_settings_error', 'Could not save provider settings.');
                await this.store.showAlert(this.store.t('alert_error_title', 'Error'), this.providerStatus);
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
        async startGeneration(resumeCheckpoint = null) {
            if (this.isGenerating) return;
            if (!resumeCheckpoint && this.pendingCheckpoint) {
                const shouldResume = await this.store.showConfirm(
                    this.store.t('or_resume_title', 'Resume previous generation?'),
                    this.store.t('or_resume_message', 'An unfinished generation checkpoint exists for this dataset. Resume it instead of starting a new run?')
                );
                if (shouldResume) return this.resumePreviousGeneration();
                this.pendingCheckpoint = null;
            }

            if (!this.generatorPrompt.trim()) {
                await this.store.showAlert(this.store.t('alert_error_title', 'Error'), this.store.t('or_err_no_prompt', 'Please describe the task to the generator!'));
                return;
            }
            if (!this.selectedModel.trim()) {
                await this.store.showAlert(this.store.t('alert_error_title', 'Error'), this.store.t('or_err_no_model', 'Please select or enter a model ID!'));
                return;
            }
            if (!await this.persistProviderSettings(false)) return;

            const identity = this.projectDatasetIdentity();
            const emptyFields = resumeCheckpoint ? (resumeCheckpoint.empty_fields || []) : [];
            const hardcodedContext = resumeCheckpoint ? (resumeCheckpoint.hardcoded_context || {}) : {};
            if (!resumeCheckpoint) {
                if (!this.hardcodeFields.system.trim() && !this.store.activeProject.use_single_prompt) {
                    emptyFields.push('system');
                } else {
                    hardcodedContext.system = this.store.activeProject.use_single_prompt
                        ? (this.store.activeProject.global_system_prompt || '')
                        : this.hardcodeFields.system;
                }
                if (!this.hardcodeFields.user.trim()) emptyFields.push('user');
                else hardcodedContext.user = this.hardcodeFields.user;
                if (this.store.activeProject.use_thinking) {
                    if (!this.hardcodeFields.thought.trim()) emptyFields.push('thought');
                    else hardcodedContext.thought = this.hardcodeFields.thought;
                }
                if (!this.hardcodeFields.assistant.trim()) emptyFields.push('assistant');
                else hardcodedContext.assistant = this.hardcodeFields.assistant;
            }
            if (!emptyFields.length) {
                await this.store.showAlert(this.store.t('alert_warning_title', 'Warning'), this.store.t('or_err_all_hardcoded', 'All fields are fixed! AI has nothing to generate.'));
                return;
            }

            await this.saveGenerationModes();
            const options = resumeCheckpoint && resumeCheckpoint.generation_options
                ? resumeCheckpoint.generation_options : this.buildGenerationOptions();
            const queueMode = resumeCheckpoint ? resumeCheckpoint.queue_enabled === true : this.queueEnabled;
            const autoSave = resumeCheckpoint ? resumeCheckpoint.auto_save_resume === true : this.autoSaveResume;
            const targetTotal = queueMode
                ? Math.max(1, Math.min(10000, Number(resumeCheckpoint ? resumeCheckpoint.target_count : this.targetCount) || 1000))
                : Math.max(1, Math.min(100, Number(this.batchSize) || 1));
            const batchSize = Math.max(1, Math.min(100, Number(resumeCheckpoint ? resumeCheckpoint.batch_size : this.batchSize) || 10));
            const resumeDiskCount = resumeCheckpoint && Number.isFinite(Number(resumeCheckpoint.initial_total))
                ? Math.max(0, Number(this.$parent.totalEntries) - Number(resumeCheckpoint.initial_total)) : 0;
            const completed = resumeCheckpoint
                ? Math.max(0, Number(resumeCheckpoint.completed) || 0, resumeDiskCount) : 0;
            if (completed > targetTotal) {
                await this.store.showAlert(this.store.t('alert_error_title', 'Error'), this.store.t('or_checkpoint_invalid', 'Checkpoint progress exceeds the target. Start a new generation.'));
                return;
            }

            const modes = {};
            for (const key of this.modeKeys()) modes[key] = this[key];
            const checkpointBase = {
                project_id: identity.projectId,
                project_name: identity.projectName,
                dataset_name: identity.datasetName,
                target_count: targetTotal,
                initial_total: resumeCheckpoint && Number.isFinite(Number(resumeCheckpoint.initial_total))
                    ? Number(resumeCheckpoint.initial_total) : Number(this.$parent.totalEntries) - completed,
                batch_size: batchSize,
                generator_prompt: resumeCheckpoint ? resumeCheckpoint.generator_prompt : this.generatorPrompt,
                model: resumeCheckpoint ? resumeCheckpoint.model : this.selectedModel.trim(),
                provider: resumeCheckpoint ? resumeCheckpoint.provider : this.provider,
                custom_base_url: this.customBaseUrl,
                rpm: this.rpm,
                hardcode_fields: Object.assign({}, this.hardcodeFields),
                hardcoded_context: hardcodedContext,
                empty_fields: emptyFields,
                use_thinking: resumeCheckpoint ? resumeCheckpoint.use_thinking === true : this.store.activeProject.use_thinking === true,
                generation_options: options,
                generation_modes: modes,
                queue_enabled: queueMode,
                auto_save_resume: autoSave
            };
            const context = {
                generatorPrompt: checkpointBase.generator_prompt,
                emptyFields,
                hardcodedContext,
                model: checkpointBase.model,
                provider: checkpointBase.provider,
                generationOptions: options,
                useThinking: checkpointBase.use_thinking
            };
            const maxConcurrency = this.parallelEnabled ? Math.max(1, Math.min(10, Number(this.maxConcurrency) || 1)) : 1;
            const state = {
                activeRequests: 0,
                currentConcurrency: maxConcurrency,
                maxConcurrency,
                successStreak: 0,
                adaptiveSpeed: this.adaptiveSpeed,
                autoRetry: this.autoRetry,
                maxRetries: Math.max(0, Math.min(10, Number(this.maxRetries) || 0)),
                autoSaveResume: autoSave,
                queueEnabled: queueMode,
                qualityCheckEnabled: this.qualityCheckEnabled,
                duplicateCheckEnabled: this.duplicateCheckEnabled,
                diversityEnabled: this.diversityEnabled,
                minAssistantWords: Math.max(0, Math.min(2000, Number(options.min_assistant_words) || 0)),
                completed,
                targetTotal,
                rejectedCount: 0,
                failedChunks: 0,
                lastError: '',
                seenPromptSet: new Set(),
                seenPrompts: [],
                checkpoint: checkpointBase
            };

            this.isGenerating = true;
            this.cancelRequested = false;
            this.failedChunks = 0;
            this.rejectedCount = 0;
            this.progressTotal = targetTotal;
            this.progressCompleted = completed;
            this.statusMessage = this.store.t('or_generation_starting', 'Preparing generation queue...');
            this.pendingCheckpoint = null;

            try {
                if (queueMode && autoSave) {
                    await this.persistCheckpoint(state, 'running');
                } else if (window.pywebview) {
                    await window.pywebview.api.update_setting('plugin_openrouter_checkpoint', {});
                    this.store.settings.plugin_openrouter_checkpoint = {};
                }

                const remaining = Math.max(0, targetTotal - completed);
                const chunks = [];
                if (!queueMode) {
                    chunks.push(batchSize);
                } else {
                    for (let count = remaining; count > 0; count -= batchSize) chunks.push(Math.min(batchSize, count));
                }

                let nextChunk = 0;
                const workerCount = queueMode ? (this.parallelEnabled ? maxConcurrency : 1) : 1;
                const worker = async () => {
                    while (!this.cancelRequested) {
                        const chunkIndex = nextChunk++;
                        if (chunkIndex >= chunks.length) return;
                        await this.generateChunk(chunks[chunkIndex], context, state);
                    }
                };
                await Promise.all(Array.from({length: workerCount}, () => worker()));
                await this.saveQueue;

                const complete = state.completed >= targetTotal && !state.failedChunks && !this.cancelRequested;
                if (queueMode && autoSave) await this.persistCheckpoint(state, complete ? 'completed' : 'paused');
                if (this.$parent.totalEntries > 0 && state.completed > completed) {
                    this.$parent.currentEntryIndex = this.$parent.totalEntries - 1;
                    await this.$parent.loadEntry(this.$parent.currentEntryIndex);
                }

                if (this.cancelRequested) {
                    this.statusMessage = this.store.t('or_generation_paused', 'Paused. Saved records are safe; you can resume from the checkpoint.');
                } else if (complete) {
                    this.statusMessage = this.store.t('or_generation_complete', 'Generation complete.') + ' ' +
                        state.completed + ' / ' + targetTotal + '. ' +
                        this.store.t('or_rejected_count', 'Rejected low-quality/duplicate examples:') + ' ' + state.rejectedCount;
                } else {
                    this.statusMessage = this.store.t('or_generation_partial', 'Generation stopped with incomplete batches.') +
                        ' ' + state.completed + ' / ' + targetTotal + '. ' +
                        this.store.t('or_failed_batches', 'Failed batches:') + ' ' + state.failedChunks +
                        (state.lastError ? '. ' + state.lastError : '');
                    if (queueMode && autoSave) this.pendingCheckpoint = this.store.settings.plugin_openrouter_checkpoint;
                }
            } catch (error) {
                this.statusMessage = this.store.t('or_generation_error', 'Generation error:') + ' ' + String(error.message || error);
                if (queueMode && autoSave) {
                    await this.persistCheckpoint(state, 'paused');
                    this.pendingCheckpoint = this.store.settings.plugin_openrouter_checkpoint;
                }
            } finally {
                this.isGenerating = false;
                this.cancelRequested = false;
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

        <div v-else-if="step === 'dashboard'" class="create-modal" style="max-width: 700px; max-height: 90vh; overflow-y: auto; padding: 25px; gap: 15px;">
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
                    <span style="font-size: 12px; color: #A0A0A0;">{{ queueEnabled ? store.t('or_batch_size_label', 'Batch size:') : store.t('or_count_label', 'Count:') }}</span>
                    <input type="number" v-model.number="batchSize" min="1" max="100" class="cm-hex-input-box" style="width: 100%; padding: 8px; font-size: 16px; text-align: center;">
                </div>
            </div>

            <div class="or-modes-panel">
                <div class="or-modes-heading">{{ store.t('or_modes_title', 'GENERATION MODES') }}</div>
                <div class="or-modes-grid">
                    <label class="or-mode-toggle">
                        <input type="checkbox" v-model="queueEnabled">
                        <span>{{ store.t('or_mode_queue', 'Queue and generate until target count') }}</span>
                    </label>
                    <label class="or-mode-toggle">
                        <input type="checkbox" v-model="parallelEnabled" :disabled="!queueEnabled">
                        <span>{{ store.t('or_mode_parallel', 'Parallel requests') }}</span>
                    </label>
                    <label class="or-mode-toggle">
                        <input type="checkbox" v-model="autoRetry">
                        <span>{{ store.t('or_mode_retry', 'Retry temporary failures and replace invalid examples') }}</span>
                    </label>
                    <label class="or-mode-toggle">
                        <input type="checkbox" v-model="autoSaveResume" :disabled="!queueEnabled">
                        <span>{{ store.t('or_mode_resume', 'Autosave progress and resume after restart') }}</span>
                    </label>
                    <label class="or-mode-toggle">
                        <input type="checkbox" v-model="qualityCheckEnabled">
                        <span>{{ store.t('or_mode_quality', 'Check required fields and answer length') }}</span>
                    </label>
                    <label class="or-mode-toggle">
                        <input type="checkbox" v-model="duplicateCheckEnabled">
                        <span>{{ store.t('or_mode_duplicates', 'Skip duplicate and near-duplicate prompts') }}</span>
                    </label>
                    <label class="or-mode-toggle">
                        <input type="checkbox" v-model="diversityEnabled">
                        <span>{{ store.t('or_mode_diversity', 'Request more diverse examples') }}</span>
                    </label>
                    <label class="or-mode-toggle">
                        <input type="checkbox" v-model="adaptiveSpeed" :disabled="!parallelEnabled || !queueEnabled">
                        <span>{{ store.t('or_mode_adaptive', 'Adapt concurrency to rate limits') }}</span>
                    </label>
                </div>

                <div v-if="queueEnabled" class="or-mode-fields">
                    <label class="or-mode-field">
                        <span>{{ store.t('or_target_count', 'Target new records:') }}</span>
                        <input type="number" v-model.number="targetCount" min="1" max="10000" step="1" class="cm-hex-input-box">
                    </label>
                    <label v-if="parallelEnabled" class="or-mode-field">
                        <span>{{ store.t('or_max_concurrency', 'Parallel requests:') }}</span>
                        <input type="number" v-model.number="maxConcurrency" min="1" max="10" step="1" class="cm-hex-input-box">
                    </label>
                    <label v-if="autoRetry" class="or-mode-field">
                        <span>{{ store.t('or_max_retries', 'Retries per batch:') }}</span>
                        <input type="number" v-model.number="maxRetries" min="0" max="10" step="1" class="cm-hex-input-box">
                    </label>
                </div>
                <div v-if="qualityCheckEnabled" class="or-mode-fields">
                    <label class="or-mode-field">
                        <span>{{ store.t('or_min_words', 'Minimum words in generated assistant answer (0 = off):') }}</span>
                        <input type="number" v-model.number="minAssistantWords" min="0" max="2000" step="10" class="cm-hex-input-box">
                    </label>
                    <label class="or-mode-field">
                        <span>{{ store.t('or_output_tokens', 'Maximum output tokens per batch:') }}</span>
                        <input type="number" v-model.number="maxOutputTokens" min="256" max="32768" step="256" class="cm-hex-input-box">
                    </label>
                </div>
                <label v-if="diversityEnabled" class="or-mode-field or-mode-topic">
                    <span>{{ store.t('or_topic_plan', 'Topic distribution / coverage plan (optional):') }}</span>
                    <textarea v-model="topicPlan" rows="2" maxlength="4000" class="message-textarea" :placeholder="store.t('or_topic_plan_ph', 'Example: 25% basics, 35% debugging, 25% coding tasks, 15% architecture')"></textarea>
                </label>
                <div class="or-mode-note">{{ store.t('or_resume_privacy', 'Resume saves prompts and generation settings locally in Prose settings. API keys remain in the OS Keyring.') }}</div>
                <button class="or-btn-secondary" @click="saveGenerationModes">{{ store.t('or_save_modes', 'Save generation modes') }}</button>
            </div>

            <div v-if="pendingCheckpoint && !isGenerating" class="or-resume-panel">
                <div class="or-modes-heading">{{ store.t('or_resume_available', 'UNFINISHED GENERATION FOUND') }}</div>
                <div>{{ store.t('or_resume_progress', 'Saved progress:') }} {{ pendingCheckpoint.completed || 0 }} / {{ pendingCheckpoint.target_count || 0 }}</div>
                <button class="btn-primary" @click="resumePreviousGeneration">{{ store.t('or_resume_button', 'Resume generation') }}</button>
            </div>

            <div v-if="isGenerating" class="or-live-progress">
                <div class="or-progress-text">
                    <span>{{ statusMessage }}</span>
                    <span>{{ progressCompleted }} / {{ progressTotal }}</span>
                </div>
                <div class="or-progress-track">
                    <div class="or-progress-bar-dynamic" :style="{ width: progressTotal ? Math.min(100, progressCompleted / progressTotal * 100) + '%' : '0%' }"></div>
                </div>
                <div class="or-progress-meta">
                    {{ store.t('or_rejected_count', 'Rejected low-quality/duplicate examples:') }} {{ rejectedCount }}
                    · {{ store.t('or_failed_batches', 'Failed batches:') }} {{ failedChunks }}
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

            <button class="btn-primary" @click="startGeneration" :disabled="isGenerating" style="width: 100%; padding: 12px; font-size: 16px;">
                {{ isGenerating ? store.t('or_btn_thinking', 'AI is thinking...') : store.t('or_btn_start', 'Start Generation') }}
            </button>
        </div>
    `
};