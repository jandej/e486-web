/**
 * Retro486 Main Application Bootstrapper
 * Coordinates the 100% Pure-JS Intel 80486DX2 CPU with Integrated FPU, System Bus,
 * SeaBIOS + VGA BIOS execution, Modular Adapter Cards, CRT Monitor,
 * Interactive Motherboard View, Storage Bay, Custom Card Studio,
 * and Browser Persistence (localStorage + IndexedDB).
 */

import { RetroBus } from './retro_bus.js';
import { Cpu486 } from './cpu_486.js';
import { BiosRom } from './bios_rom.js';
import { AudioEngine } from './audio_engine.js';
import { CrtRenderer } from './crt_renderer.js';
import { StorageCache } from './storage_cache.js';

import { CgaCard } from './cards/cga_card.js';
import { EgaCard } from './cards/ega_card.js';
import { VgaCard } from './cards/vga_card.js';
import { SoundBlasterCard } from './cards/soundblaster_card.js';
import { PcSpeakerCard } from './cards/pcspeaker_card.js';
import { MultiIOCard } from './cards/multio_card.js';
import { PostDiagnosticCard } from './cards/post_card.js';
import { Mpu401Card } from './cards/mpu401_card.js';
import { Ne2000Card } from './cards/ne2000_card.js';
import { GameportCard } from './cards/gameport_card.js';
import { SaveStateManager } from './save_state_manager.js';

import { MonitorView } from './ui/monitor_view.js';
import { MotherboardView } from './ui/motherboard_view.js';
import { StorageView } from './ui/storage_view.js';
import { CardStudioView } from './ui/card_studio_view.js';
import { SystemView } from './ui/system_view.js';

export class Retro486App {
    constructor() {
        this.storageCache = new StorageCache();
        this.bus = new RetroBus(16); // 16 MB SIMM RAM
        this.cpu = new Cpu486(this.bus);
        this.bios = new BiosRom(this.bus, this.cpu);
        this.audioEngine = new AudioEngine();

        const screenCanvas = document.getElementById('screen');
        this.crtRenderer = new CrtRenderer(screenCanvas);

        this.customCardsCatalog = [];
        this.activeVideoCard = null;
        this.paused = true; // Unpaused once BIOS & boot images finish loading

        this.saveStateManager = new SaveStateManager(this);
        this.cyclesPerFrame = 120000;

        this.installDefaultMotherboardCards();

        // Initialize UI Views
        this.monitorView = new MonitorView(this);
        this.motherboardView = new MotherboardView(this);
        this.storageView = new StorageView(this);
        this.cardStudioView = new CardStudioView(this);
        this.systemView = new SystemView(this);

        this.initTabs();
        this.initTopToolbar();

        // Restore saved configuration (CRT settings, CPU speed, motherboard slots/jumpers)
        const savedCfg = this.restoreSetupFromLocalStorage();

        // Load real SeaBIOS + VGA BIOS + cached/default disk images and boot the 486 CPU
        this.initHardwareBoot(savedCfg);

        // Start 60 FPS Emulation & Render Loop
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        requestAnimationFrame(() => this.mainLoop());
    }

    installDefaultMotherboardCards() {
        // Slot 1: VGA Adapter (VESA Local Bus)
        const vga = new VgaCard();
        vga.cardTypeId = 'vga';
        this.bus.installCard(1, vga);
        this.activeVideoCard = vga;

        // Slot 2: Creative SoundBlaster 16 (ISA-16)
        const sb16 = new SoundBlasterCard();
        sb16.cardTypeId = 'sb16';
        this.bus.installCard(2, sb16);

        // Slot 3: GoldStar Multi-I/O IDE & Floppy Controller (ISA-16)
        const mio = new MultiIOCard();
        mio.cardTypeId = 'multio';
        this.bus.installCard(3, mio);

        // Slot 4: Dual 7-Segment POST Diagnostic Card (ISA-8)
        const post = new PostDiagnosticCard();
        post.cardTypeId = 'post';
        this.bus.installCard(4, post);

        // Slot 5: IBM PC Internal Speaker Module (ISA-8)
        const spk = new PcSpeakerCard();
        spk.cardTypeId = 'pcspeaker';
        this.bus.installCard(5, spk);

        // Slot 6: Novell NE2000 16-bit ISA Ethernet Adapter Card
        const nic = new Ne2000Card();
        nic.cardTypeId = 'ne2000';
        this.bus.installCard(6, nic);
    }

    getAvailableCardCatalog() {
        const builtIn = [
            { typeId: 'vga', name: 'IBM VGA / Tseng ET4000 (256KB)', slotType: 'VLB', category: 'Video' },
            { typeId: 'ega', name: 'IBM Enhanced Graphics Adapter (EGA 256KB)', slotType: 'ISA-8', category: 'Video' },
            { typeId: 'cga', name: 'IBM Color Graphics Adapter (CGA 16KB)', slotType: 'ISA-8', category: 'Video' },
            { typeId: 'sb16', name: 'Creative SoundBlaster 16 (DSP + OPL3)', slotType: 'ISA-16', category: 'Audio' },
            { typeId: 'mpu401', name: 'Roland MPU-401 MIDI Interface + SC-55 Synth', slotType: 'ISA-8', category: 'Audio' },
            { typeId: 'pcspeaker', name: 'IBM PC Internal Speaker Module', slotType: 'ISA-8', category: 'Audio' },
            { typeId: 'gameport', name: 'CH Products / Gravis ISA Gameport (Port 0x201)', slotType: 'ISA-8', category: 'Input' },
            { typeId: 'multio', name: 'GoldStar Prime 2C Multi-I/O (IDE/Floppy)', slotType: 'ISA-16', category: 'Storage' },
            { typeId: 'ne2000', name: 'Novell NE2000 Ethernet Adapter (10BASE-T)', slotType: 'ISA-16', category: 'Network' },
            { typeId: 'post', name: 'ISA Dual 7-Segment POST Diagnostic Card', slotType: 'ISA-8', category: 'Diagnostic' }
        ];

        const custom = this.customCardsCatalog.map((c, idx) => ({
            typeId: `custom_${idx}`,
            name: `🛠️ ${c.name}`,
            slotType: c.slotType,
            category: c.category
        }));

        return [...builtIn, ...custom];
    }

    installCardByType(slotNum, typeId, skipSave = false) {
        let card = null;
        switch (typeId) {
            case 'vga': card = new VgaCard(); break;
            case 'ega': card = new EgaCard(); break;
            case 'cga': card = new CgaCard(); break;
            case 'sb16': card = new SoundBlasterCard(); break;
            case 'mpu401': card = new Mpu401Card(); break;
            case 'pcspeaker': card = new PcSpeakerCard(); break;
            case 'gameport': card = new GameportCard(); break;
            case 'multio': card = new MultiIOCard(); break;
            case 'ne2000': card = new Ne2000Card(); break;
            case 'post': card = new PostDiagnosticCard(); break;
            default:
                if (typeId.startsWith('custom_')) {
                    const idx = parseInt(typeId.split('_')[1], 10);
                    card = this.customCardsCatalog[idx];
                }
                break;
        }

        if (card) {
            card.cardTypeId = typeId;
            this.bus.installCard(slotNum, card);
            this.updateActiveVideoCard();
            if (this.storageView) this.storageView.refreshDriveStatus();
            if (!skipSave) this.saveSetupToLocalStorage();
        }
    }

    registerCustomCard(card) {
        this.customCardsCatalog.push(card);
    }

    updateActiveVideoCard() {
        for (let s = 1; s <= 6; s++) {
            const c = this.bus.getCard(s);
            if (c && c.category === 'Video') {
                this.activeVideoCard = c;
                const badge = document.getElementById('active-video-badge');
                if (badge) badge.textContent = c.shortName;
                return;
            }
        }
        this.activeVideoCard = null;
        const badge = document.getElementById('active-video-badge');
        if (badge) badge.textContent = 'NO VIDEO CARD';
    }

    getStorageCard() {
        for (let s = 1; s <= 6; s++) {
            const c = this.bus.getCard(s);
            if (c && c.category === 'Storage') return c;
        }
        return null;
    }

    /* ======================================================================
     * LOCALSTORAGE SETUP PERSISTENCE
     * ====================================================================== */

    saveSetupToLocalStorage() {
        if (!this.storageCache) return;

        const slots = [];
        for (let s = 1; s <= 6; s++) {
            const c = this.bus.getCard(s);
            if (c) {
                slots.push({
                    slot: s,
                    typeId: c.cardTypeId || 'vga',
                    jumpers: { ...(c.jumpers || {}) }
                });
            } else {
                slots.push({ slot: s, typeId: null });
            }
        }

        const storage = this.getStorageCard();
        const drives = storage ? {
            fddA: { mounted: storage.drives.fddA.mounted, name: storage.drives.fddA.name },
            fddB: { mounted: storage.drives.fddB.mounted, name: storage.drives.fddB.name },
            hddC: { mounted: storage.drives.hddC.mounted, name: storage.drives.hddC.name }
        } : {};

        const pcbThemeSelect = document.getElementById('mb-pcb-theme');

        this.storageCache.saveConfig({
            version: 1,
            crt: {
                mode: this.crtRenderer.mode,
                brightness: this.crtRenderer.brightness,
                contrast: this.crtRenderer.contrast
            },
            cpu: {
                cyclesPerFrame: this.cyclesPerFrame
            },
            audioMuted: this.audioEngine.isMuted,
            pcbTheme: pcbThemeSelect ? pcbThemeSelect.value : 'green',
            slots,
            drives
        });
    }

    restoreSetupFromLocalStorage() {
        if (!this.storageCache) return null;
        const cfg = this.storageCache.loadConfig();
        if (!cfg) return null;

        // Restore CRT settings
        if (cfg.crt) {
            if (cfg.crt.mode) {
                this.crtRenderer.setMode(cfg.crt.mode);
                const selFilter = document.getElementById('crt-mode-select');
                if (selFilter) selFilter.value = cfg.crt.mode;
            }
            if (typeof cfg.crt.brightness === 'number') {
                this.crtRenderer.brightness = cfg.crt.brightness;
                const sliderBright = document.getElementById('crt-brightness');
                if (sliderBright) sliderBright.value = String(cfg.crt.brightness);
            }
            if (typeof cfg.crt.contrast === 'number') {
                this.crtRenderer.contrast = cfg.crt.contrast;
                const sliderContrast = document.getElementById('crt-contrast');
                if (sliderContrast) sliderContrast.value = String(cfg.crt.contrast);
            }
        }

        // Restore CPU Speed
        if (cfg.cpu && typeof cfg.cpu.cyclesPerFrame === 'number') {
            this.cyclesPerFrame = cfg.cpu.cyclesPerFrame;
            const selSpeed = document.getElementById('sys-cpu-speed');
            if (selSpeed) selSpeed.value = String(cfg.cpu.cyclesPerFrame);
        }

        // Restore Audio Mute
        if (typeof cfg.audioMuted === 'boolean') {
            const muted = this.audioEngine.setMuted(cfg.audioMuted);
            const btnMute = document.getElementById('btn-audio-mute');
            if (btnMute) btnMute.textContent = muted ? '🔇 Audio Muted' : '🔊 Audio On';
        }

        // Restore PCB Theme
        if (cfg.pcbTheme) {
            const pcbThemeSelect = document.getElementById('mb-pcb-theme');
            if (pcbThemeSelect) pcbThemeSelect.value = cfg.pcbTheme;
            const board = document.getElementById('motherboard-pcb');
            if (board) board.className = 'motherboard-pcb theme-' + cfg.pcbTheme;
        }

        // Restore Expansion Slots 1-6 (ensuring Video and MultiIO remain present)
        if (Array.isArray(cfg.slots) && cfg.slots.length === 6) {
            for (const entry of cfg.slots) {
                if (!entry.typeId) {
                    this.bus.removeCard(entry.slot);
                } else if (!entry.typeId.startsWith('custom_')) {
                    this.installCardByType(entry.slot, entry.typeId, true);
                    const c = this.bus.getCard(entry.slot);
                    if (c && entry.jumpers) {
                        Object.assign(c.jumpers, entry.jumpers);
                        c.applyJumpers();
                    }
                }
            }
            this.updateActiveVideoCard();
            if (this.motherboardView) this.motherboardView.renderSlots();
        }

        return cfg;
    }

    /* ======================================================================
     * REAL x86 SEABIOS + VGA BIOS + FREEDOS BOOTSTRAP (WITH CACHE)
     * ====================================================================== */

    async fetchBinaryAsset(relPath) {
        const cacheKey = `asset:${relPath}`;
        if (this.storageCache) {
            const cached = await this.storageCache.getImage(cacheKey);
            if (cached && cached.byteLength > 0) {
                return cached;
            }
        }

        const candidates = [relPath, '../' + relPath];
        for (const url of candidates) {
            try {
                const resp = await fetch(url);
                if (resp.ok) {
                    const buf = await resp.arrayBuffer();
                    if (this.storageCache && buf.byteLength > 0) {
                        await this.storageCache.putImage(cacheKey, buf, { path: relPath });
                    }
                    return buf;
                }
            } catch (_) {
                // Try next candidate
            }
        }
        return null;
    }

    async initHardwareBoot(savedCfg = null) {
        const [biosBuf, vgaBiosBuf, dosBuf] = await Promise.all([
            this.fetchBinaryAsset('data/bios.bin'),
            this.fetchBinaryAsset('data/vgabios.bin'),
            this.fetchBinaryAsset('data/dos.img')
        ]);

        if (biosBuf && vgaBiosBuf) {
            this.bios.loadRealBios(biosBuf, vgaBiosBuf);
        } else {
            this.bios.install();
        }

        const storage = this.getStorageCard();
        if (storage) {
            // Check if cached drive images exist from previous session
            const [cachedFddA, cachedFddB, cachedHddC] = await Promise.all([
                this.storageCache ? this.storageCache.getImage('drive:fddA') : null,
                this.storageCache ? this.storageCache.getImage('drive:fddB') : null,
                this.storageCache ? this.storageCache.getImage('drive:hddC') : null
            ]);

            if (cachedHddC && cachedHddC.byteLength > 0) {
                const cName = savedCfg?.drives?.hddC?.name || 'MSDOS_C_20MB.IMG';
                storage.mountHardDisk(0, cachedHddC, cName);
            } else {
                this.storageView.createBlankHardDisk(0, 20, 'MSDOS_C_20MB.IMG', true);
            }

            if (cachedFddA && cachedFddA.byteLength > 0) {
                const aName = savedCfg?.drives?.fddA?.name || 'DOS13_BOOT.IMG';
                storage.mountFloppy(0, cachedFddA, aName);
            } else if (dosBuf && (!savedCfg?.drives?.fddA || savedCfg.drives.fddA.mounted !== false)) {
                storage.mountFloppy(0, dosBuf, 'DOS13_BOOT.IMG');
                this.storageView.persistMountedDrive('fddA', dosBuf, 'DOS13_BOOT.IMG');
            }

            if (cachedFddB && cachedFddB.byteLength > 0) {
                const bName = savedCfg?.drives?.fddB?.name || 'FLOPPY_B.IMG';
                storage.mountFloppy(1, cachedFddB, bName);
            }

            this.storageView.refreshDriveStatus();
        }

        this.rebootSystem();
    }

    flushDirtyDrivesToCache() {
        const storage = this.getStorageCard();
        if (!storage || !this.storageCache) return;

        for (const key of ['fddA', 'fddB', 'hddC']) {
            const drv = storage.drives[key];
            if (drv && drv.mounted && drv.dirty && drv.data) {
                drv.dirty = false;
                this.storageCache.putImage(`drive:${key}`, drv.data, { filename: drv.name });
                if (this.storageView) this.storageView.refreshDriveStatus();
            }
        }
    }

    typeDosText(str) {
        const charMap = {
            'a': [0x1E, false], 'b': [0x30, false], 'c': [0x2E, false], 'd': [0x20, false],
            'e': [0x12, false], 'f': [0x21, false], 'g': [0x22, false], 'h': [0x23, false],
            'i': [0x17, false], 'j': [0x24, false], 'k': [0x25, false], 'l': [0x26, false],
            'm': [0x32, false], 'n': [0x31, false], 'o': [0x18, false], 'p': [0x19, false],
            'q': [0x10, false], 'r': [0x13, false], 's': [0x1F, false], 't': [0x14, false],
            'u': [0x16, false], 'v': [0x2F, false], 'w': [0x11, false], 'x': [0x2D, false],
            'y': [0x15, false], 'z': [0x2C, false],
            '1': [0x02, false], '2': [0x03, false], '3': [0x04, false], '4': [0x05, false],
            '5': [0x06, false], '6': [0x07, false], '7': [0x08, false], '8': [0x09, false],
            '9': [0x0A, false], '0': [0x0B, false],
            ' ': [0x39, false], '\n': [0x1C, false], '.': [0x34, false], '\\': [0x2B, false],
            '/': [0x35, false], '-': [0x0C, false], ':': [0x27, true]
        };

        let delay = 0;
        for (const ch of str.toLowerCase()) {
            const entry = charMap[ch];
            if (!entry) continue;
            const [sc, shift] = entry;
            setTimeout(() => {
                if (shift) this.bus.ps2PutKeycode(true, 0x2A);
                this.bus.ps2PutKeycode(true, sc);
            }, delay);
            setTimeout(() => {
                this.bus.ps2PutKeycode(false, sc);
                if (shift) this.bus.ps2PutKeycode(false, 0x2A);
            }, delay + 25);
            delay += 55;
        }
    }

    rebootSystem() {
        this.paused = false;
        const pauseBtn = document.getElementById('btn-sys-pause');
        if (pauseBtn) pauseBtn.textContent = '⏸️ Pause CPU';

        if (this.crtRenderer) {
            this.crtRenderer.powerTransition = 0.12;
        }

        this.audioEngine.playFloppySeekSound();
        this.audioEngine.playPostBeep();

        // Clear conventional & upper memory below ROMs so cold reset starts clean
        this.bus.ram.fill(0, 0, 0xc0000);

        // Reset motherboard chipset, PIC, PIT, KBC, and expansion cards
        this.bus.onHardwareReset();

        // Restore pristine SeaBIOS (0xE0000-0xFFFFF) and VGA BIOS (0xC0000) into physical RAM
        this.bios.install();

        // Sync CMOS NVRAM drive geometry with currently mounted floppies & hard disks
        const storage = this.getStorageCard();
        if (storage && storage.syncCmos) {
            storage.syncCmos();
        }

        // Reset 80486 CPU to F000:FFF0 (Real Mode)
        this.cpu.reset();

        if (this.motherboardView) {
            this.motherboardView.updateLiveBusIndicators();
            this.motherboardView.renderSlots();
        }
        if (this.systemView) {
            this.systemView.updateDiagnostics();
            this.systemView.renderMemoryDump();
        }
    }

    /* ======================================================================
     * NAVIGATION TABS & TOP TOOLBAR
     * ====================================================================== */

    initTabs() {
        document.querySelectorAll('.nav-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.tab;
                this.switchTab(targetId);
            });
        });
    }

    switchTab(tabId) {
        document.querySelectorAll('.nav-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === tabId);
        });

        if (tabId === 'tab-motherboard') {
            this.motherboardView.renderSlots();
        } else if (tabId === 'tab-storage') {
            this.storageView.refreshDriveStatus();
        } else if (tabId === 'tab-system') {
            this.systemView.updateDiagnostics();
            this.systemView.renderMemoryDump();
        }
    }

    initTopToolbar() {
        const btnReset = document.getElementById('btn-reboot');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                this.audioEngine.playSwitchClick();
                this.rebootSystem();
            });
        }

        const btnMute = document.getElementById('btn-audio-mute');
        if (btnMute) {
            btnMute.addEventListener('click', () => {
                const muted = this.audioEngine.setMuted(!this.audioEngine.isMuted);
                btnMute.textContent = muted ? '🔇 Audio Muted' : '🔊 Audio On';
                this.saveSetupToLocalStorage();
            });
        }
    }

    /* ======================================================================
     * MAIN 60 FPS EMULATION & RENDER LOOP
     * ====================================================================== */

    mainLoop() {
        if (!this.paused) {
            this.cpu.runBatch(this.cyclesPerFrame);

            // Connect audio for installed audio cards if context is ready
            if (this.audioEngine.ctx) {
                for (let s = 1; s <= 6; s++) {
                    const card = this.bus.getCard(s);
                    if (card) {
                        if (card.initAudio && !card.audioCtx) {
                            card.initAudio(this.audioEngine.ctx, this.audioEngine.masterGain);
                        }
                        card.tick(this.cyclesPerFrame);
                    }
                }
            }
        }

        // Render active video card onto Period-Correct CRT Monitor
        this.crtRenderer.render(this.activeVideoCard);

        // Update live Motherboard Bus LEDs & Card Activity
        this.motherboardView.updateLiveBusIndicators();
        this.bus.decayActivityLeds();

        // Decay individual card LEDs
        const now = performance.now();
        for (let s = 1; s <= 6; s++) {
            const c = this.bus.getCard(s);
            if (c && c.activityLed && (now - c.lastActivityTime > 120)) {
                c.activityLed = false;
            }
        }

        // Update Header Status Bar & flush modified disks once per second
        this.frameCount++;
        if (now - this.lastFrameTime >= 1000) {
            const fpsEl = document.getElementById('fps-display');
            if (fpsEl) fpsEl.textContent = `${this.frameCount} FPS`;
            this.frameCount = 0;
            this.lastFrameTime = now;

            // Update POST badge in top bar
            const topPost = document.getElementById('top-post-code');
            if (topPost) {
                topPost.textContent = this.bus.busActivity.postCode.toString(16).toUpperCase().padStart(2, '0');
            }

            // Persist any disk sectors written by DOS to browser storage
            this.flushDirtyDrivesToCache();
        }

        requestAnimationFrame(() => this.mainLoop());
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.retro486App = new Retro486App();
});
