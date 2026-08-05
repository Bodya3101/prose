const { reactive } = Vue;

export const store = reactive({
    currentView: 'home',
    settings: { 
        language: 'en', // ENGLISH BY DEFAULT
        use_accent_colors: true, 
        disable_animations: false, 
        disable_accents: false,
        font_size: 14,
        dev_mode: false,
        active_plugins: ["openrouter_plugin", "chinese_translation_plugin"],
        skip_openrouter_disclaimer: false
    },
    localeData: {},
    hasApiKey: false,
    hasHfToken: false,
    hfUsername: "",
    visibleProjects: [],
    activeProject: null,

    editor_buttons: [],     
    active_overlay: null,   
    
    dialog: null, 

    tokenizers: {
        llama3: { id: "llama3", name: "Llama 3 / 3.3 / 4", tag: "Llama 3", cyrillic: 0.82, latin: 0.25, special: 0.35 },
        qwen2: { id: "qwen2", name: "Qwen 2.5 / 3", tag: "Qwen 3", cyrillic: 0.88, latin: 0.24, special: 0.32 },
        deepseek: { id: "deepseek", name: "DeepSeek V3 / R1 / V4", tag: "DeepSeek", cyrillic: 0.85, latin: 0.24, special: 0.33 },
        gemma: { id: "gemma", name: "Gemma 2 / 3 / 4", tag: "Gemma", cyrillic: 0.95, latin: 0.22, special: 0.30 },
        mistral: { id: "mistral", name: "Mistral Large 3", tag: "Mistral", cyrillic: 0.78, latin: 0.25, special: 0.35 },
        gpt4o: { id: "gpt4o", name: "GPT-4o / o3", tag: "GPT-4o", cyrillic: 0.75, latin: 0.24, special: 0.32 },
        claude: { id: "claude", name: "Claude 3.5", tag: "Claude", cyrillic: 0.70, latin: 0.25, special: 0.35 },
        glm5: { id: "glm5", name: "GLM-4 / GLM-5", tag: "GLM-5", cyrillic: 0.86, latin: 0.24, special: 0.33 },
        phi4: { id: "phi4", name: "Phi-3 / Phi-4", tag: "Phi-4", cyrillic: 0.72, latin: 0.25, special: 0.35 },
        command: { id: "command", name: "Command R+", tag: "Cohere", cyrillic: 0.90, latin: 0.23, special: 0.30 },
        standard: { id: "standard", name: "Standard Universal", tag: "Standard", cyrillic: 0.55, latin: 0.25, special: 0.35 }
    },

    registerTokenizer(id, config) {
        if (!id || typeof id !== 'string') return;
        this.tokenizers[id] = {
            id: id,
            name: config.name || id,
            tag: config.tag || id,
            calcFunc: typeof config.calcFunc === 'function' ? config.calcFunc : null,
            cyrillic: config.cyrillic || 0.8,
            latin: config.latin || 0.25,
            special: config.special || 0.35
        };
    },

    showAlert(title, message) {
        return new Promise((resolve) => {
            this.dialog = {
                title: title || 'Notification',
                message: message || '',
                type: 'alert',
                resolve
            };
        });
    },

    showConfirm(title, message) {
        return new Promise((resolve) => {
            this.dialog = {
                title: title || 'Confirmation',
                message: message || '',
                type: 'confirm',
                resolve
            };
        });
    },

    closeDialog(result = false) {
        if (this.dialog && this.dialog.resolve) {
            this.dialog.resolve(result);
        }
        this.dialog = null;
    },
    
    async setLanguage(langCode) {
        if (!window.pywebview) return;
        const targetLang = langCode || 'en';
        this.settings.language = targetLang;
        const r = await window.pywebview.api.get_locale(targetLang);
        if (r && r.success) {
            Object.keys(this.localeData).forEach(k => delete this.localeData[k]);
            Object.assign(this.localeData, r.data);
        }
    },

    currentEntryData: {
        system: "",
        user: "",
        thought: "",
        assistant: ""
    },
    
    t(key, fallback = "") {
        return this.localeData[key] || fallback || key;
    }
});