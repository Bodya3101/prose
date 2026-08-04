const { createApp, watch } = Vue;

const app = createApp({
    setup() {
        watch(() => window.installer_store.installPath, async (newPath) => {
            if (window.pywebview && window.pywebview.api && newPath) {
                window.installer_store.isUpdateMode = await window.pywebview.api.check_is_update(newPath);
            }
        });

        return { store: window.installer_store };
    },
    async mounted() {
        window.installer_store = installer_store;

        window.addEventListener('pywebviewready', async () => {
            if (window.pywebview && window.pywebview.api) {
                const info = await window.pywebview.api.get_installer_info();
                window.installer_store.installPath = info.default_path;
                window.installer_store.versionName = info.version_name;
                window.installer_store.isUpdateMode = await window.pywebview.api.check_is_update(info.default_path);
            }
        });
    },
    methods: {
        // НААТИВНЫЙ ДРАГ WINDOWS ПРИ КЛИКЕ НА ШАПКУ
        startDrag(e) {
            if (e.target.closest('.no-drag')) return;
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.start_native_drag === 'function') {
                window.pywebview.api.start_native_drag();
            }
        },

        async browseFolder() {
            if (!window.pywebview) return;
            const chosen = await window.pywebview.api.select_folder_dialog();
            if (chosen) {
                window.installer_store.installPath = chosen;
            }
        },

        async goToStep2() {
            if (window.pywebview && window.pywebview.api) {
                const check = await window.pywebview.api.check_system_requirements(window.installer_store.installPath);
                if (!check.success && check.issues.length > 0) {
                    window.installer_store.activeIssue = check.issues[0];
                    return;
                }
            }
            window.installer_store.currentStep = 2;
        },

        async startInstall() {
            if (!window.installer_store.installPath) return;
            window.installer_store.isInstalling = true;

            if (window.pywebview && window.pywebview.api) {
                const res = await window.pywebview.api.start_installation(
                    window.installer_store.installPath,
                    window.installer_store.createDesktopShortcut,
                    window.installer_store.createStartMenuShortcut
                );

                if (res.success) {
                    window.installer_store.isInstalling = false;
                    window.installer_store.installFinished = true;
                    window.installer_store.progressPercent = 100;
                } else if (res.reason !== 'uac_requested') {
                    window.installer_store.isInstalling = false;
                    alert(res.error || 'Ошибка при установке.');
                }
            } else {
                let p = 0;
                const timer = setInterval(() => {
                    p += 5;
                    window.installer_store.updateProgress(p, `extracting_${p}.dll`);
                    if (p >= 100) {
                        clearInterval(timer);
                        window.installer_store.isInstalling = false;
                        window.installer_store.installFinished = true;
                    }
                }, 50);
            }
        },

        openLink(url) {
            if (window.pywebview && window.pywebview.api) {
                window.pywebview.api.open_external_link(url);
            } else {
                window.open(url, '_blank');
            }
        },

        finishAndLaunch() {
            if (window.pywebview && window.pywebview.api) {
                window.pywebview.api.finish_and_launch(window.installer_store.installPath);
            }
        },

        closeInstaller() {
            if (window.pywebview && window.pywebview.api) {
                window.pywebview.api.close_installer();
            }
        }
    }
});

app.mount('#app');