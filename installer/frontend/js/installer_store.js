const { reactive } = Vue;

window.installer_store = reactive({
    currentStep: 1,
    currentLang: 'ru',
    installPath: '',
    versionName: 'Prose',
    isUpdateMode: false,
    
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    
    isInstalling: false,
    installFinished: false,
    progressPercent: 0,
    currentExtractFile: '',
    
    activeIssue: null,

    locales: {
        ru: {
            welcome_text: 'Вас приветствует установщик редактора датасетов “Prose”. Программа установит ПО вам на ПК.',
            select_path_label: 'Выберите путь для установки:',
            shortcut_desktop: 'Создать ярлык на Рабочем столе',
            shortcut_start_menu: 'Создать ярлык в меню Пуск',
            btn_install: 'Установить',
            btn_update: 'Обновить',
            btn_installing: 'Установка...',
            btn_updating: 'Обновление...',
            finish_text: 'Спасибо за установку программы! Я был бы рад, если бы вы оставили мне звездочку или донат! :)',
            btn_finish: 'Завершить установку',
            btn_download: 'Скачать',
            btn_close: 'Закрыть'
        },
        en: {
            welcome_text: 'Welcome to the "Prose" Dataset Editor Setup. This wizard will install Prose on your PC.',
            select_path_label: 'Select installation directory:',
            shortcut_desktop: 'Create Desktop shortcut',
            shortcut_start_menu: 'Create Start Menu shortcut',
            btn_install: 'Install',
            btn_update: 'Update',
            btn_installing: 'Installing...',
            btn_updating: 'Updating...',
            finish_text: 'Thank you for installing Prose! I would really appreciate a star on GitHub or a donation! :)',
            btn_finish: 'Finish Setup',
            btn_download: 'Download',
            btn_close: 'Close'
        }
    },

    t(key) {
        return (this.locales[this.currentLang] && this.locales[this.currentLang][key]) || key;
    },

    toggleLanguage() {
        this.currentLang = this.currentLang === 'ru' ? 'en' : 'ru';
    },

    updateProgress(percent, filename) {
        this.progressPercent = percent;
        this.currentExtractFile = filename;
    }
});