import OpenRouterGenerator from './OpenRouterGenerator.js';

const store = window.app_store;
const { markRaw } = Vue;

store.editor_buttons.push({
    id: 'openrouter_generator',
    // ВСТАВЛЕНА ПАПКА /frontend/ В ПУТЬ К ИКОНКЕ
    icon: '/plugins/openrouter_plugin/frontend/assets/icons/generate_ai.svg', 
    title: 'Сгенерировать с ИИ',
    action() {
        store.active_overlay = markRaw(OpenRouterGenerator);
    }
});