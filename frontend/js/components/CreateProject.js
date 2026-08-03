import { store } from '../store.js';

export default {
    name: 'CreateProject',
    setup() { return { store }; },
    data() {
        return {
            formData: {
                name: "", desc: "", color: "#D9D9D9",
                logo_base64: null, use_single_prompt: false, use_thinking: false,
                dataset_format: "standard",
                datasets: [
                    { name: "Dataset.jsonl", source_path: null, edited: false }
                ]
            },
            availableFormats: [],
            showFormatDropdown: false,
            showColorPicker: false
        };
    },
    async mounted() {
        // ЗАЩИЩЕННЫЙ ВЫЗОВ (Защита от TypeError)
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_available_formats === 'function') {
            try {
                this.availableFormats = await window.pywebview.api.get_available_formats();
            } catch (e) {
                console.error("Ошибка загрузки форматов:", e);
            }
        }
        
        // Резервный фоллбэк форматов, если бэкенд временно не ответил
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

        removeDataset(idx) {
            this.formData.datasets.splice(idx, 1);
        },

        async submit() {
            if (!window.pywebview) return;
            if (!this.formData.name.trim()) { 
                await store.showAlert("Ошибка", "Введите название проекта!"); 
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
                this.formData.dataset_format
            );
            
            if (r.success) {
                store.visibleProjects.unshift(r.project);
                store.activeProject = r.project;
                store.currentView = 'editor';
            } else {
                await store.showAlert("Ошибка", `Ошибка создания: ${r.error}`);
            }
        }
    },
    template: `
        <div class="create-modal" @click.self="showColorPicker = false; showFormatDropdown = false;">
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

            <!-- ВЫБОР ФОРМАТА РАЗМЕТКИ ДАТАСЕТА -->
            <div class="cm-datasets-box" style="gap: 8px;">
                <h3>{{ store.t('format_label', 'Разметка датасета:') }}</h3>
                <div style="position: relative; width: 100%;">
                    <div class="custom-select-trigger" @click="showFormatDropdown = !showFormatDropdown" style="padding: 10px 14px; font-weight: bold; background: #161616;">
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
                
                <div style="display: flex; gap: 10px; margin-top: 5px; width: 100%;">
                    <button @click="addEmptyDataset" style="padding: 6px 12px; font-size: 12px; background: #161616;">{{ store.t('btn_add_empty', '+ Пустой') }}</button>
                    <button @click="importDataset" style="padding: 6px 12px; font-size: 12px; background: #161616;">{{ store.t('btn_import', '+ Импорт') }}</button>
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
        </div>
    `
};