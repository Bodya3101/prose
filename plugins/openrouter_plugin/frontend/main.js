import OpenRouterGenerator from './OpenRouterGenerator.js';

const store = window.app_store;
const { markRaw } = Vue;

store.editor_buttons.push({
    id: 'openrouter_generator',
    icon: '/plugins/openrouter_plugin/frontend/assets/icons/generate_ai.svg', 
    get title() {
        return store.t('openrouter_btn_title', 'Сгенерировать с ИИ');
    },
    action() {
        store.active_overlay = markRaw(OpenRouterGenerator);
    }
});