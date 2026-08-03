const { reactive } = Vue;

export const store = reactive({
    currentView: 'home',
    settings: { 
        language: 'ru', 
        use_accent_colors: true, 
        disable_animations: false, 
        disable_accents: false,
        font_size: 14,
        active_plugins: ["openrouter_plugin", "chinese_translation_plugin"],
        skip_openrouter_disclaimer: false
    },
    localeData: {},
    hasApiKey: false,
    hasHfToken: false,
    hfUsername: "",
    visibleProjects: [],
    activeProject: null,

    // РЕЕСТРЫ ПЛАГИНОВ
    editor_buttons: [],     
    active_overlay: null,   
    
    // КАСТОМНАЯ ДИАЛОГОВАЯ СИСТЕМА (Замена native alert/confirm)
    dialog: null, // { title, message, type: 'alert'|'confirm', resolve }

    showAlert(title, message) {
        return new Promise((resolve) => {
            this.dialog = {
                title: title || 'Уведомление',
                message: message || '',
                type: 'alert',
                resolve
            };
        });
    },

    showConfirm(title, message) {
        return new Promise((resolve) => {
            this.dialog = {
                title: title || 'Подтверждение',
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