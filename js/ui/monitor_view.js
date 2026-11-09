/**
 * Monitor View Controller
 * Manages the period-correct CRT display, bezel controls, degauss button,
 * brightness/contrast dials, keyboard scancode mapping, and mouse pointer lock.
 */

export class MonitorView {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('tab-monitor');
        this.canvas = document.getElementById('screen');
        this.crtRenderer = app.crtRenderer;

        this.initControls();
        this.initKeyMapping();
    }

    initControls() {
        // Degauss button
        const btnDegauss = document.getElementById('btn-degauss');
        if (btnDegauss) {
            btnDegauss.addEventListener('click', () => {
                this.crtRenderer.triggerDegauss();
                this.app.audioEngine.playDegaussSound();
            });
        }

        // CRT Power switch
        const btnPower = document.getElementById('btn-crt-power');
        if (btnPower) {
            btnPower.addEventListener('click', () => {
                const nowOn = !this.crtRenderer.powerOn;
                this.crtRenderer.setPower(nowOn);
                this.app.audioEngine.playSwitchClick();
                btnPower.classList.toggle('active', nowOn);
                const powerLed = document.getElementById('crt-power-led');
                if (powerLed) powerLed.classList.toggle('active', nowOn);
            });
        }

        // Phosphor / Display mode selector
        const selFilter = document.getElementById('crt-mode-select');
        if (selFilter) {
            selFilter.addEventListener('change', (e) => {
                this.crtRenderer.setMode(e.target.value);
                if (this.app.saveSetupToLocalStorage) this.app.saveSetupToLocalStorage();
            });
        }

        // Brightness & Contrast sliders
        const sliderBright = document.getElementById('crt-brightness');
        if (sliderBright) {
            sliderBright.addEventListener('input', (e) => {
                this.crtRenderer.brightness = parseFloat(e.target.value);
                if (this.app.saveSetupToLocalStorage) this.app.saveSetupToLocalStorage();
            });
        }
        const sliderContrast = document.getElementById('crt-contrast');
        if (sliderContrast) {
            sliderContrast.addEventListener('input', (e) => {
                this.crtRenderer.contrast = parseFloat(e.target.value);
                if (this.app.saveSetupToLocalStorage) this.app.saveSetupToLocalStorage();
            });
        }

        // Click monitor to resume audio context (no mouse pointer lock)
        this.canvas.addEventListener('click', () => {
            this.app.audioEngine.ensureContext();
        });

        // Fullscreen
        const btnFullscreen = document.getElementById('btn-fullscreen');
        if (btnFullscreen) {
            btnFullscreen.addEventListener('click', () => {
                const bezel = document.getElementById('monitor-bezel');
                if (bezel.requestFullscreen) bezel.requestFullscreen();
            });
        }

        // Instant Save States Controls
        const slotSelect = document.getElementById('select-savestate-slot');
        const btnQuickSave = document.getElementById('btn-quicksave');
        if (btnQuickSave) {
            btnQuickSave.addEventListener('click', () => {
                const slot = parseInt(slotSelect ? slotSelect.value : 1, 10);
                this.app.saveStateManager.saveQuickSlot(slot);
            });
        }

        const btnQuickLoad = document.getElementById('btn-quickload');
        if (btnQuickLoad) {
            btnQuickLoad.addEventListener('click', () => {
                const slot = parseInt(slotSelect ? slotSelect.value : 1, 10);
                this.app.saveStateManager.loadQuickSlot(slot);
            });
        }

        const btnExport = document.getElementById('btn-export-state');
        if (btnExport) {
            btnExport.addEventListener('click', () => {
                const slot = parseInt(slotSelect ? slotSelect.value : 1, 10);
                this.app.saveStateManager.exportSnapshotToFile(slot);
            });
        }

        const btnImport = document.getElementById('btn-import-state');
        const fileInput = document.getElementById('input-import-state');
        if (btnImport && fileInput) {
            btnImport.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    this.app.saveStateManager.importSnapshotFromFile(e.target.files[0]);
                    fileInput.value = '';
                }
            });
        }

        window.addEventListener('retro486-savestates-updated', (ev) => {
            if (!slotSelect) return;
            const slots = ev.detail.slots;
            for (let i = 0; i < 5; i++) {
                const opt = slotSelect.options[i];
                if (opt) {
                    const s = slots[i];
                    opt.textContent = s ? `Slot ${i + 1} (${s.dateStr})` : `Slot ${i + 1} (Empty)`;
                }
            }
        });
    }

    initKeyMapping() {
        // Complete IBM PC/AT PS/2 Scancode Set 1 lookup table (including 0xE0 extended keys)
        this.keyMap = {
            'Escape': 0x01, 'Digit1': 0x02, 'Digit2': 0x03, 'Digit3': 0x04,
            'Digit4': 0x05, 'Digit5': 0x06, 'Digit6': 0x07, 'Digit7': 0x08,
            'Digit8': 0x09, 'Digit9': 0x0A, 'Digit0': 0x0B, 'Minus': 0x0C,
            'Equal': 0x0D, 'Backspace': 0x0E, 'Tab': 0x0F, 'KeyQ': 0x10,
            'KeyW': 0x11, 'KeyE': 0x12, 'KeyR': 0x13, 'KeyT': 0x14,
            'KeyY': 0x15, 'KeyU': 0x16, 'KeyI': 0x17, 'KeyO': 0x18,
            'KeyP': 0x19, 'BracketLeft': 0x1A, 'BracketRight': 0x1B, 'Enter': 0x1C,
            'ControlLeft': 0x1D, 'KeyA': 0x1E, 'KeyS': 0x1F, 'KeyD': 0x20,
            'KeyF': 0x21, 'KeyG': 0x22, 'KeyH': 0x23, 'KeyJ': 0x24,
            'KeyK': 0x25, 'KeyL': 0x26, 'Semicolon': 0x27, 'Quote': 0x28,
            'Backquote': 0x29, 'ShiftLeft': 0x2A, 'Backslash': 0x2B, 'KeyZ': 0x2C,
            'KeyX': 0x2D, 'KeyC': 0x2E, 'KeyV': 0x2F, 'KeyB': 0x30,
            'KeyN': 0x31, 'KeyM': 0x32, 'Comma': 0x33, 'Period': 0x34,
            'Slash': 0x35, 'ShiftRight': 0x36, 'NumpadMultiply': 0x37, 'AltLeft': 0x38,
            'Space': 0x39, 'CapsLock': 0x3A, 'F1': 0x3B, 'F2': 0x3C,
            'F3': 0x3D, 'F4': 0x3E, 'F5': 0x3F, 'F6': 0x40,
            'F7': 0x41, 'F8': 0x42, 'F9': 0x43, 'F10': 0x44,
            'NumLock': 0x45, 'ScrollLock': 0x46,
            'Numpad7': 0x47, 'Numpad8': 0x48, 'Numpad9': 0x49, 'NumpadSubtract': 0x4A,
            'Numpad4': 0x4B, 'Numpad5': 0x4C, 'Numpad6': 0x4D, 'NumpadAdd': 0x4E,
            'Numpad1': 0x4F, 'Numpad2': 0x50, 'Numpad3': 0x51, 'Numpad0': 0x52,
            'NumpadDecimal': 0x53, 'F11': 0x57, 'F12': 0x58,
            // Extended 0xE0 scancodes
            'NumpadEnter': 0xE01C, 'ControlRight': 0xE01D, 'NumpadDivide': 0xE035,
            'AltRight': 0xE038, 'Home': 0xE047, 'ArrowUp': 0xE048,
            'PageUp': 0xE049, 'ArrowLeft': 0xE04B, 'ArrowRight': 0xE04D,
            'End': 0xE04F, 'ArrowDown': 0xE050, 'PageDown': 0xE051,
            'Insert': 0xE052, 'Delete': 0xE053
        };

        window.addEventListener('keydown', (e) => {
            const monitorTab = document.getElementById('tab-monitor');
            if (monitorTab && !monitorTab.classList.contains('active')) return;
            if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

            // Instant Save State Hotkeys: Shift+F6 (Save), Shift+F9 (Load)
            if ((e.code === 'F6' && (e.shiftKey || e.ctrlKey))) {
                e.preventDefault();
                const slotSelect = document.getElementById('select-savestate-slot');
                const slot = parseInt(slotSelect ? slotSelect.value : 1, 10);
                this.app.saveStateManager.saveQuickSlot(slot);
                return;
            }
            if ((e.code === 'F9' && (e.shiftKey || e.ctrlKey))) {
                e.preventDefault();
                const slotSelect = document.getElementById('select-savestate-slot');
                const slot = parseInt(slotSelect ? slotSelect.value : 1, 10);
                this.app.saveStateManager.loadQuickSlot(slot);
                return;
            }

            const sc = this.keyMap[e.code];
            if (sc !== undefined) {
                this.app.bus.ps2PutKeycode(true, sc);
                e.preventDefault();
            }
        });

        window.addEventListener('keyup', (e) => {
            const monitorTab = document.getElementById('tab-monitor');
            if (monitorTab && !monitorTab.classList.contains('active')) return;
            if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

            const sc = this.keyMap[e.code];
            if (sc !== undefined) {
                this.app.bus.ps2PutKeycode(false, sc);
                e.preventDefault();
            }
        });
    }

    sendQuickKey(code) {
        const sc = this.keyMap ? this.keyMap[code] : undefined;
        if (sc !== undefined) {
            this.app.bus.ps2PutKeycode(true, sc);
            setTimeout(() => this.app.bus.ps2PutKeycode(false, sc), 50);
        }
    }
}
