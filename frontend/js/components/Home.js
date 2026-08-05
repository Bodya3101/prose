import { store } from '../store.js';

export default {
    name: 'Home',
    setup() { return { store }; },
    data() {
        return {
            showSortMenu: false,
            sortKey: 'created', // 'name' | 'created' | 'modified'
            sortDir: 'desc'     // 'asc' | 'desc'
        };
    },
    computed: {
        sortedProjects() {
            const projects = [...store.visibleProjects];
            const dir = this.sortDir === 'asc' ? 1 : -1;
            
            projects.sort((a, b) => {
                if (this.sortKey === 'name') {
                    return a.name.localeCompare(b.name) * dir;
                } else if (this.sortKey === 'created') {
                    const tA = parseInt(a.id.replace('proj_', '')) || 0;
                    const tB = parseInt(b.id.replace('proj_', '')) || 0;
                    return (tA - tB) * dir;
                } else if (this.sortKey === 'modified') {
                    const tA = a.modified || parseInt(a.id.replace('proj_', '')) || 0;
                    const tB = b.modified || parseInt(b.id.replace('proj_', '')) || 0;
                    return (tA - tB) * dir;
                }
                return 0;
            });
            return projects;
        }
    },
    methods: {
        openCreateProject() { store.currentView = 'create_project'; },
        async openEditor(project) {
            store.activeProject = project;
            store.currentView = 'editor';
        },
        toggleSortDir() {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        },
        selectSortKey(key) {
            this.sortKey = key;
            this.showSortMenu = false;
        },
        getProjectInitials(name) {
            if (!name) return "??";
            return name.substring(0, 3).toUpperCase();
        },
        
        // 🛡️ ПОЛНОСТЬЮ ЛОКАЛИЗОВАННОЕ УДАЛЕНИЕ ПРОЕКТА
        async deleteProject(proj) {
            const title = store.t('confirm_delete_project_title', 'Delete Project');
            const msgTemplate = store.t(
                'confirm_delete_project_msg',
                'Are you sure you want to delete project "{name}" and all its datasets? This action is irreversible.'
            );
            const msg = msgTemplate.replace('{name}', proj.name);

            const confirmed = await store.showConfirm(title, msg);
            
            if (confirmed) {
                if (window.pywebview) {
                    const r = await window.pywebview.api.delete_project(proj.id);
                    if (r.success) {
                        store.visibleProjects = store.visibleProjects.filter(p => p.id !== proj.id);
                    } else {
                        await store.showAlert(
                            store.t('alert_error_title', 'Error'), 
                            store.t('alert_delete_failed', 'Failed to delete project: ') + r.error
                        );
                    }
                } else {
                    store.visibleProjects = store.visibleProjects.filter(p => p.id !== proj.id);
                }
            }
        }
    },
    template: `
        <div class="projects-layout" @click.self="showSortMenu = false">
            <div class="projects-header" style="display: flex; gap: 10px; align-items: center;">
                
                <!-- КНОПКА НАПРАВЛЕНИЯ СОРТИРОВКИ С КАСТОМНЫМ ТУЛТИПОМ -->
                <button class="icon-btn bg-icon" 
                        @click="toggleSortDir" 
                        :data-tooltip="sortDir === 'asc' ? store.t('tooltip_sort_asc', 'Ascending') : store.t('tooltip_sort_desc', 'Descending')">
                    <img :src="sortDir === 'asc' ? 'assets/icons/sort_asc.svg' : 'assets/icons/sort_desc.svg'">
                </button>

                <!-- ВЫБОР КРИТЕРИЯ СОРТИРОВКИ С КАСТОМНЫМ ТУЛТИПОМ -->
                <div style="position: relative;">
                    <button class="icon-btn bg-icon" 
                            @click="showSortMenu = !showSortMenu" 
                            :data-tooltip="store.t('tooltip_sort_key', 'Sort criterion')">
                        <img src="assets/icons/sort.svg">
                    </button>
                    
                    <!-- Выпадающий список критериев -->
                    <div v-if="showSortMenu" class="cp-popover" style="right: 0; width: 190px;">
                        <div class="cp-row sort-item" @click="selectSortKey('name')">
                            <span>{{ store.t('sort_by_name', 'By name') }}</span>
                            <span v-if="sortKey === 'name'" style="color:#4D986D;">✓</span>
                        </div>
                        <div class="cp-row sort-item" @click="selectSortKey('created')">
                            <span>{{ store.t('sort_by_created', 'Creation date') }}</span>
                            <span v-if="sortKey === 'created'" style="color:#4D986D;">✓</span>
                        </div>
                        <div class="cp-row sort-item" @click="selectSortKey('modified')">
                            <span>{{ store.t('sort_by_modified', 'Modification date') }}</span>
                            <span v-if="sortKey === 'modified'" style="color:#4D986D;">✓</span>
                        </div>
                    </div>
                </div>

                <!-- КНОПКА СОЗДАНИЯ ПРОЕКТА С КАСТОМНЫМ ТУЛТИПОМ -->
                <button class="icon-btn bg-icon" 
                        @click="openCreateProject" 
                        :data-tooltip="store.t('btn_create_project', 'Create Project')">
                    <img src="assets/icons/+.svg" alt="Add Project">
                </button>
            </div>

            <!-- Рендерим отсортированный список -->
            <div class="projects-list">
                <div v-for="proj in sortedProjects" :key="proj.id" class="project-card" @click="openEditor(proj)">
                    <img v-if="proj.logo_base64" :src="proj.logo_base64" alt="logo" class="proj-logo">
                    <div v-else class="proj-logo-placeholder" :data-tooltip="proj.name">
                        {{ getProjectInitials(proj.name) }}
                    </div>
                    
                    <div class="proj-info" style="flex: 1;">
                        <h3 :style="{ color: proj.color }">{{ proj.name }}</h3>
                        <p>{{ store.t('file_label', 'File') }}: {{ proj.dataset_file || (proj.dataset_files ? proj.dataset_files[0] : '') }}</p>
                    </div>
                    
                    <!-- КНОПКА УДАЛЕНИЯ -->
                    <div class="cm-red-dot" 
                         @click.stop="deleteProject(proj)" 
                         :data-tooltip="store.t('btn_delete', 'Delete')" 
                         style="width: 16px; height: 16px; flex-shrink: 0; margin-left: 10px;">
                    </div>
                </div>
            </div>
        </div>
    `
};