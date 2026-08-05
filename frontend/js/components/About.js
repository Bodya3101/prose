import { store } from '../store.js';

export default {
    name: 'About',
    setup() { 
        return { store }; 
    },
    data() {
        return {
            aboutInfo: {},
            imgError: false
        };
    },
    async mounted() {
        if (window.pywebview) {
            this.aboutInfo = await window.pywebview.api.get_about_info();
        } else {
            this.aboutInfo = {
                version: "1.0.3",
                github_username: "Bodya3101",
                github_profile_url: "https://github.com/Bodya3101",
                github_repo_url: "https://github.com/Bodya3101/prose",
                logo_placeholder_path: "assets/images/logo_about.png"
            };
        }
    },
    methods: {
        close() { 
            store.currentView = 'home'; 
        },
        openLink(url) {
            if (window.pywebview) {
                window.pywebview.api.open_external_link(url);
            } else {
                window.open(url, '_blank');
            }
        }
    },
    template: `
        <div class="create-modal">
            <div class="cm-header">
                {{ store.t('about_title', 'О ПРОГРАММЕ PROSE') }}
                <div class="cm-red-dot" @click="close" :data-tooltip="store.t('btn_back', 'Назад')"></div>
            </div>

            <div class="about-container">
                <!-- ОТОБРАЖЕНИЕ ТВОЕЙ КРАСНОЙ PNG ИКОНКИ LOGO_ABOUT.PNG -->
                <div class="about-logo-box">
                    <img v-if="!imgError" 
                         :src="aboutInfo.logo_placeholder_path || 'assets/images/logo_about.png'" 
                         @error="imgError = true" 
                         alt="Prose Logo" 
                         class="about-logo-img">
                    
                    <div v-else class="prose-logo-fallback">
                        Prose
                    </div>
                </div>

                <h2 class="about-app-title">
                    {{ store.t('app_title', 'Prose') }}
                </h2>

                <p class="about-desc-text">
                    {{ store.t('about_desc', 'Профессиональный и легкий редактор датасетов в формате JSONL для обучения ИИ-моделей.') }}
                </p>

                <!-- Блок версии и разработчика -->
                <div class="cm-dataset-file" style="width: 100%; display: flex; flex-direction: column; gap: 10px; padding: 15px;">
                    <div style="display: flex; justify-content: space-between; width: 100%; font-size: 14px;">
                        <span style="color: #808080;">{{ store.t('about_version_label', 'Версия:') }}</span>
                        <span style="font-weight: bold; color: var(--text-main);">{{ aboutInfo.version || '1.0.1' }}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; width: 100%; font-size: 14px;">
                        <span style="color: #808080;">{{ store.t('about_author', 'Разработчик:') }}</span>
                        <span style="font-weight: bold; color: #4E6DB2; cursor: pointer;" @click="openLink(aboutInfo.github_profile_url)">
                            @{{ aboutInfo.github_username || 'Bodya3101' }}
                        </span>
                    </div>
                </div>

                <!-- Кнопки-ссылки -->
                <div class="about-buttons-row">
                    <button class="btn-primary cp-default-btn" @click="openLink(aboutInfo.github_repo_url)" style="flex: 1; padding: 10px;">
                        {{ store.t('about_repo_btn', 'Открыть репозиторий') }}
                    </button>
                    <button class="btn-primary cp-default-btn" @click="openLink(aboutInfo.github_profile_url)" style="flex: 1; padding: 10px;">
                        {{ store.t('about_profile_btn', 'Профиль GitHub') }}
                    </button>
                </div>
            </div>
        </div>
    `
};