const { createApp } = Vue;
import { store } from './store.js';
import Home from './components/Home.js';
import Editor from './components/Editor.js';
import CreateProject from './components/CreateProject.js';
import SettingsView from './components/Settings.js'; 
import AboutView from './components/About.js';
import PluginsView from './components/Plugins.js';
import ProjectSettingsModal from './components/ProjectSettingsModal.js';

const app = createApp({
    computed: {
        currentEntryCharCount() {
            const data = store.currentEntryData || {};
            const sys = store.activeProject && store.activeProject.use_single_prompt 
                ? (store.activeProject.global_system_prompt || '') 
                : (data.system || '');
            const user = data.user || '';
            const thought = data.thought || '';
            const asst = data.assistant || '';
            return sys.length + user.length + thought.length + asst.length;
        },
        
        currentEntryTokenCount() {
            const data = store.currentEntryData || {};
            const sys = store.activeProject && store.activeProject.use_single_prompt 
                ? (store.activeProject.global_system_prompt || '') 
                : (data.system || '');
            const fullText = sys + (data.user || '') + (data.thought || '') + (data.assistant || '');
            if (!fullText) return 0;

            const presetId = (store.activeProject && store.activeProject.tokenizer_preset) || 'llama3';
            const tokenizer = store.tokenizers[presetId] || store.tokenizers['llama3'];

            if (tokenizer.calcFunc) {
                try {
                    return Math.ceil(tokenizer.calcFunc(fullText));
                } catch (e) {
                    console.error("Plugin tokenizer error:", e);
                }
            }

            let tokens = 0;
            const cyrCoeff = tokenizer.cyrillic || 0.8;
            const latCoeff = tokenizer.latin || 0.25;
            const specCoeff = tokenizer.special || 0.35;

            for (let i = 0; i < fullText.length; i++) {
                const code = fullText.charCodeAt(i);
                if ((code >= 0x0400 && code <= 0x04FF) || (code >= 0x0500 && code <= 0x052F)) {
                    tokens += cyrCoeff;
                } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
                    tokens += latCoeff;
                } else {
                    tokens += specCoeff;
                }
            }
            return Math.ceil(tokens);
        },

        activeTokenizerTag() {
            const presetId = (store.activeProject && store.activeProject.tokenizer_preset) || 'llama3';
            const tokenizer = store.tokenizers[presetId] || store.tokenizers['llama3'];
            return tokenizer.tag || 'Llama 3';
        },

        activeTokenizerName() {
            const presetId = (store.activeProject && store.activeProject.tokenizer_preset) || 'llama3';
            const tokenizer = store.tokenizers[presetId] || store.tokenizers['llama3'];
            return tokenizer.name || 'Llama 3';
        }
    },

    components: {
        Home,
        Editor,
        CreateProject,
        SettingsView,
        AboutView,
        PluginsView
    },
    setup() {
        return { store };
    },
    async mounted() {
        window.addEventListener('pywebviewready', async () => {
            await this.loadSettings();
            await this.loadProjects();
            await this.bootstrapPlugins(); 
        });

        setTimeout(() => {
            if (!window.pywebview) {
                store.visibleProjects = [
                    { id: '1', name: 'SuperGPT-15.0', dataset_files: ['dataset_SuperGPT-15.0.jsonl'], color: '#D746A2' }
                ];
                this.applyTheme();
            }
        }, 800);
    },
    methods: {
        async loadSettings() {
            if (!window.pywebview) return;
            store.settings = await window.pywebview.api.get_settings();
            this.applyTheme();
            await store.setLanguage(store.settings.language || 'ru');
        },
        
        applyTheme() {
            const fontSize = store.settings.font_size || 14;
            document.documentElement.style.setProperty('--font-size', `${fontSize}px`);

            if (store.settings.disable_animations === true) {
                document.body.classList.add('no-animations');
            } else {
                document.body.classList.remove('no-animations');
            }
            
            if (store.settings.disable_accents !== true) {
                document.body.classList.add('theme-accent');
            } else {
                document.body.classList.remove('theme-accent');
            }
        },
        
        async bootstrapPlugins() {
            const activeList = store.settings.active_plugins || [];
            const discovered = await window.pywebview.api.get_discovered_plugins();
            
            store.editor_buttons = [];
            store.active_overlay = null;

            for (const plug of discovered) {
                if (!plug || !plug.id) continue;

                if (activeList.includes(plug.id) && plug.has_frontend) {
                    try {
                        await import(`../../plugins/${plug.id}/frontend/main.js`);
                        
                        const cssLink = document.createElement('link');
                        cssLink.rel = 'stylesheet';
                        cssLink.href = `../plugins/${plug.id}/frontend/style.css`;
                        document.head.appendChild(cssLink);
                        
                        console.log(`Фронтенд и стили плагина ${plug.id} успешно загружены.`);
                    } catch (e) {
                        console.error(`Не удалось загрузить фронтенд для плагина ${plug.id}:`, e);
                    }
                }
            }
        },
        
        async loadProjects() {
            if (!window.pywebview) return;
            const r = await window.pywebview.api.get_projects(0, 50);
            if (r.success) store.visibleProjects = r.items;
        },
        
        openSettings() { store.currentView = 'settings'; },
        openPlugins() { store.currentView = 'plugins'; },
        openAbout() { store.currentView = 'about'; },
        openProjectSettings() { store.active_overlay = 'ProjectSettingsModal'; }
    }
});

app.component('ProjectSettingsModal', ProjectSettingsModal);
app.component('project-settings-modal', ProjectSettingsModal);

window.app = app;
window.app_store = store;
app.mount('#app');