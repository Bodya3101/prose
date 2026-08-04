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