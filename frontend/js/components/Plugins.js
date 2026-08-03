import { store } from '../store.js';

export default {
    name: 'Plugins',
    setup() { return { store }; },
    data() {
        return {
            activeTab: 'list', // 'list' | 'guide'
            discoveredPlugins: [],
            guideHtml: "",
            activePlugins: []
        };
    },
    async mounted() {
        this.activePlugins = [...(store.settings.active_plugins || [])];
        await this.loadPluginsList();
        await this.loadGuide();
    },
    methods: {
        close() { store.currentView = 'home'; },
        
        async loadPluginsList() {
            if (!window.pywebview) return;
            this.discoveredPlugins = await window.pywebview.api.get_discovered_plugins();
        },
        
        async loadGuide() {
            if (!window.pywebview) return;
            const lang = store.settings.language || 'ru';
            const r = await window.pywebview.api.get_plugin_guide(lang);
            if (r.success) {
                this.guideHtml = this.parseMarkdown(r.content);
            }
        },

        // Переключение тумблера активности плагина
        async togglePlugin(pluginId) {
            const idx = this.activePlugins.indexOf(pluginId);
            if (idx > -1) {
                this.activePlugins.splice(idx, 1);
            } else {
                this.activePlugins.push(pluginId);
            }
            
            // Сохраняем новое состояние в настройки бэкенда settings.json
            if (window.pywebview) {
                await window.pywebview.api.update_setting("active_plugins", this.activePlugins);
                store.settings.active_plugins = [...this.activePlugins];
            }
        },

        // Простейший безопасный парсер Markdown без внешних библиотек (Anti-XSS)
        parseMarkdown(md) {
            if (!md) return "";
            return md
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") // Эскейпинг
                .replace(/^### (.*$)/gim, '<h3 style="margin-top:10px; color:white;">$1</h3>')
                .replace(/^## (.*$)/gim, '<h2 style="margin-top:15px; color:white; border-bottom:1px solid #3c3c3c; padding-bottom:5px;">$1</h2>')
                .replace(/^# (.*$)/gim, '<h1 style="color:#D746A2; margin-bottom:15px;">$1</h1>')
                .replace(/^\- (.*$)/gim, '<li style="margin-left:20px; color:#A0A0A0;">$1</li>')
                .replace(/\*\*(.*?)\*\*/g, '<strong style="color:white;">$1</strong>')
                .replace(/`(.*?)`/g, '<code style="background:#161616; padding:2px 6px; border-radius:4px; color:#D746A2; font-family:monospace;">$1</code>')
                .replace(/\n/g, '<br>');
        }
    },
    template: `
        <div class="create-modal" style="max-width: 650px;">
            <div class="cm-header">
                {{ store.t('tooltip_plugins', 'ПЛАГИНЫ') }}
                <div class="cm-red-dot" @click="close" :title="store.t('btn_back', 'Назад')"></div>
            </div>

            <!-- Вкладки (Кастомные табы) -->
            <div style="display: flex; gap: 10px; width: 100%; border-bottom: 1px solid var(--border-main); padding-bottom: 10px; margin-top: 10px;">
                <button :class="activeTab === 'list' ? 'btn-primary' : 'cp-default-btn'" @click="activeTab = 'list'" style="padding: 6px 15px; font-size: 13px;">
                    Установленные
                </button>
                <button :class="activeTab === 'guide' ? 'btn-primary' : 'cp-default-btn'" @click="activeTab = 'guide'" style="padding: 6px 15px; font-size: 13px;">
                    Руководство (dev)
                </button>
            </div>

            <!-- ВКЛАДКА 1: СПИСОК ПЛАГИНОВ -->
            <div v-if="activeTab === 'list'" style="width: 100%; display: flex; flex-direction: column; gap: 12px; max-height: 400px; overflow-y: auto; padding-right: 5px;">
                
                <!-- 👇 ИСПРАВЛЕННЫЙ :key 👇 -->
                <div v-for="plug in discoveredPlugins" :key="plug.id" class="project-card" style="background: #161616; cursor: default;">
                    <!-- Заглушка лого плагина -->
                    <div class="proj-logo-placeholder">PLG</div>
                    
                    <div class="proj-info" style="flex: 1;">
                        <h3 style="color: white; display: flex; align-items: center; gap: 10px;">
                            {{ plug.name }} 
                            <span style="font-size: 11px; color: #808080;">v{{ plug.version }}</span>
                        </h3>
                        <p style="font-size: 12px; color: #808080; margin-top: 4px;">{{ plug.description }}</p>
                    </div>

                    <!-- Тумблер Включения/Выключения плагина -->
                    <label class="toggle-switch" style="margin-left: 15px;">
                        <input type="checkbox" :checked="activePlugins.includes(plug.id)" @change="togglePlugin(plug.id)">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                <div v-if="discoveredPlugins.length === 0" class="hp-empty">Плагины не найдены.</div>
            </div>

            <!-- ВКЛАДКА 2: ГАЙД (Dynamic README Render) -->
            <div v-else-if="activeTab === 'guide'" class="cm-dataset-file" style="width: 100%; max-height: 400px; overflow-y: auto; text-align: left; display: block; line-height: 1.6; font-family: inherit;">
                <div v-html="guideHtml"></div>
            </div>

            <div style="font-size: 11px; color:#808080; text-align: center; width:100%; margin-top: 10px;">
                *Перезапустите приложение, чтобы применить изменения в плагинах Питона
            </div>
        </div>
    `
};