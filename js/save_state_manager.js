/**
 * Retro486 Pro Save State & Snapshot Manager
 * Provides instant freeze-frame saving and loading of the full Intel 80486 PC state:
 * - CPU registers, segment descriptors, CR0/CR2/CR3, flags, cycle counters, and x87 FPU
 * - 16MB/64MB physical RAM and A20 gate status
 * - Chipset state: Dual 8259 PICs, 8254 PIT, 8237 DMA, MC146818 CMOS, 8042 KBC, Serial UART
 * - Expansion Cards: VGA/VBE VRAM & registers, SoundBlaster DSP/OPL, MPU-401, Gameport, Multi-I/O
 * - Quick-Save (F6) and Quick-Load (F9) slots 1-5 with CRT thumbnail previews and .r486state file export/import.
 */

export class SaveStateManager {
    constructor(app) {
        this.app = app;
        this.currentSlot = 1;
        this.slots = [null, null, null, null, null]; // Slots 1 to 5
        this.loadStoredSlotsFromCache();
    }

    /**
     * Generate low-res 160x100 preview thumbnail from the CRT canvas.
     */
    captureThumbnail() {
        if (typeof document === 'undefined') return null;
        const screenCanvas = document.getElementById('screen');
        if (!screenCanvas) return null;

        try {
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = 160;
            thumbCanvas.height = 100;
            const ctx = thumbCanvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(screenCanvas, 0, 0, 160, 100);
            return thumbCanvas.toDataURL('image/jpeg', 0.65);
        } catch (_) {
            return null;
        }
    }

    /**
     * Create snapshot object representing complete emulator state.
     */
    createSnapshot(title = '') {
        const bus = this.app.bus;
        const cpu = this.app.cpu;

        // Serialize all installed modular cards
        const cardStates = [];
        for (let s = 1; s <= 6; s++) {
            const card = bus.getCard(s);
            if (card) {
                cardStates.push({
                    slotNumber: s,
                    cardTypeId: card.cardTypeId || card.id,
                    state: typeof card.saveState === 'function' ? card.saveState() : null
                });
            }
        }

        const now = new Date();
        const dateStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        return {
            format: 'retro486_snapshot_v1',
            timestamp: now.getTime(),
            dateStr: dateStr,
            title: title || `Save State (${dateStr})`,
            thumbnail: this.captureThumbnail(),
            cpu: cpu.saveState(),
            bus: bus.saveState(),
            cards: cardStates
        };
    }

    /**
     * Restore snapshot into running emulator.
     */
    restoreSnapshot(snapshot) {
        if (!snapshot || !snapshot.cpu || !snapshot.bus) {
            throw new Error('Invalid snapshot data: missing cpu or bus state.');
        }

        const bus = this.app.bus;
        const cpu = this.app.cpu;

        // 1. Restore Bus & Physical RAM first
        bus.loadState(snapshot.bus);

        // 2. Restore CPU registers & execution state
        cpu.loadState(snapshot.cpu);

        // 3. Restore cards
        if (snapshot.cards && Array.isArray(snapshot.cards)) {
            snapshot.cards.forEach((entry) => {
                const card = bus.getCard(entry.slotNumber);
                if (card && typeof card.loadState === 'function' && entry.state) {
                    card.loadState(entry.state);
                }
            });
        }

        // Re-sync video badge and CRT display
        this.app.updateActiveVideoCard();
        if (this.app.crtRenderer && this.app.activeVideoCard) {
            this.app.crtRenderer.render(this.app.activeVideoCard);
        }
    }

    /**
     * Save to quick slot 1..5.
     */
    async saveQuickSlot(slotIndex = this.currentSlot, title = '') {
        if (slotIndex < 1 || slotIndex > 5) slotIndex = 1;
        this.currentSlot = slotIndex;

        const snapshot = this.createSnapshot(title || `Quick State (Slot ${slotIndex})`);
        this.slots[slotIndex - 1] = snapshot;

        // Persist slot metadata and snapshot in IndexedDB
        if (this.app.storageCache && this.app.storageCache.saveImage) {
            try {
                // To store efficiently, convert Uint8Arrays to serializable form for IDB
                const serializable = this.cloneForStorage(snapshot);
                await this.app.storageCache.saveImage(`retro486_state_slot_${slotIndex}`, serializable);
            } catch (_) {}
        }

        this.showOsdMessage(`💾 Quick State Saved (Slot ${slotIndex})`);
        this.notifyStateChanged();
        return snapshot;
    }

    /**
     * Load from quick slot 1..5.
     */
    async loadQuickSlot(slotIndex = this.currentSlot) {
        if (slotIndex < 1 || slotIndex > 5) slotIndex = 1;
        this.currentSlot = slotIndex;

        let snapshot = this.slots[slotIndex - 1];

        // If not in RAM, try loading from IndexedDB
        if (!snapshot && this.app.storageCache && this.app.storageCache.loadImage) {
            try {
                const cached = await this.app.storageCache.loadImage(`retro486_state_slot_${slotIndex}`);
                if (cached) {
                    snapshot = this.hydrateFromStorage(cached);
                    this.slots[slotIndex - 1] = snapshot;
                }
            } catch (_) {}
        }

        if (!snapshot) {
            this.showOsdMessage(`⚠️ Slot ${slotIndex} is empty!`, '#ff4444');
            return false;
        }

        try {
            this.restoreSnapshot(snapshot);
            this.showOsdMessage(`⚡ Quick State Restored (Slot ${slotIndex})`, '#00ff66');
            return true;
        } catch (err) {
            console.error('Failed to restore state:', err);
            this.showOsdMessage(`❌ Error restoring Slot ${slotIndex}`, '#ff4444');
            return false;
        }
    }

    /**
     * Export snapshot to downloadable .r486state JSON file.
     */
    exportSnapshotToFile(slotIndex = this.currentSlot) {
        const snapshot = this.slots[slotIndex - 1] || this.createSnapshot(`Exported State ${slotIndex}`);
        const exportObj = this.cloneForStorage(snapshot);
        const jsonStr = JSON.stringify(exportObj);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `retro486_state_slot${slotIndex}_${Date.now()}.r486state`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showOsdMessage(`📥 Exported Slot ${slotIndex} to File`);
    }

    /**
     * Import snapshot from uploaded file.
     */
    importSnapshotFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const parsed = JSON.parse(e.target.result);
                    const snapshot = this.hydrateFromStorage(parsed);
                    this.slots[this.currentSlot - 1] = snapshot;
                    this.restoreSnapshot(snapshot);
                    this.showOsdMessage(`📂 State Imported & Loaded (Slot ${this.currentSlot})`);
                    this.notifyStateChanged();
                    resolve(snapshot);
                } catch (err) {
                    console.error('Failed to import state file:', err);
                    this.showOsdMessage('❌ Invalid state file!', '#ff4444');
                    reject(err);
                }
            };
            reader.readAsText(file);
        });
    }

    /**
     * Prepare snapshot for JSON/IndexedDB serialization (convert Uint8Arrays to Array or Base64).
     */
    cloneForStorage(snapshot) {
        const copy = Object.assign({}, snapshot);

        // Convert bus RAM
        if (snapshot.bus && snapshot.bus.ram) {
            const ramBytes = snapshot.bus.ram instanceof Uint8Array ? snapshot.bus.ram : new Uint8Array(snapshot.bus.ram);
            let binary = '';
            const chunk = 0x8000;
            for (let i = 0; i < ramBytes.length; i += chunk) {
                binary += String.fromCharCode.apply(null, ramBytes.subarray(i, i + chunk));
            }
            copy.bus = Object.assign({}, snapshot.bus, { ramB64: btoa(binary), ram: null });
        }

        // Convert VGA RAM
        if (snapshot.cards) {
            copy.cards = snapshot.cards.map((c) => {
                if (c.state && c.state.vga_ram) {
                    const vram = c.state.vga_ram instanceof Uint8Array ? c.state.vga_ram : new Uint8Array(c.state.vga_ram);
                    let binary = '';
                    const chunk = 0x8000;
                    for (let i = 0; i < vram.length; i += chunk) {
                        binary += String.fromCharCode.apply(null, vram.subarray(i, i + chunk));
                    }
                    return Object.assign({}, c, {
                        state: Object.assign({}, c.state, { vga_ram_b64: btoa(binary), vga_ram: null })
                    });
                }
                return c;
            });
        }

        return copy;
    }

    /**
     * Rehydrate snapshot from storage representation.
     */
    hydrateFromStorage(stored) {
        const copy = Object.assign({}, stored);

        // Reconstruct bus RAM from Base64
        if (copy.bus && copy.bus.ramB64) {
            const binary = atob(copy.bus.ramB64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            copy.bus.ram = bytes;
            delete copy.bus.ramB64;
        }

        // Reconstruct VGA RAM
        if (copy.cards) {
            copy.cards = copy.cards.map((c) => {
                if (c.state && c.state.vga_ram_b64) {
                    const binary = atob(c.state.vga_ram_b64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    c.state.vga_ram = bytes;
                    delete c.state.vga_ram_b64;
                }
                return c;
            });
        }

        return copy;
    }

    async loadStoredSlotsFromCache() {
        if (!this.app.storageCache || !this.app.storageCache.loadImage) return;
        for (let s = 1; s <= 5; s++) {
            try {
                const cached = await this.app.storageCache.loadImage(`retro486_state_slot_${s}`);
                if (cached) {
                    this.slots[s - 1] = this.hydrateFromStorage(cached);
                }
            } catch (_) {}
        }
        this.notifyStateChanged();
    }

    /**
     * Display translucent retro OSD banner on CRT monitor.
     */
    showOsdMessage(msg, color = '#33ccff') {
        if (typeof document === 'undefined') return;

        let osd = document.getElementById('crt-osd-banner');
        if (!osd) {
            const inner = document.querySelector('.crt-frame-inner');
            if (inner) {
                osd = document.createElement('div');
                osd.id = 'crt-osd-banner';
                osd.style.cssText = `
                    position: absolute;
                    top: 14px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(10, 16, 26, 0.88);
                    border: 1px solid ${color};
                    border-radius: 6px;
                    padding: 6px 14px;
                    font-family: 'Courier New', monospace;
                    font-size: 13px;
                    font-weight: bold;
                    color: ${color};
                    pointer-events: none;
                    z-index: 100;
                    box-shadow: 0 4px 14px rgba(0,0,0,0.6), 0 0 8px ${color};
                    transition: opacity 0.4s ease;
                `;
                inner.style.position = 'relative';
                inner.appendChild(osd);
            }
        }

        if (osd) {
            osd.style.borderColor = color;
            osd.style.color = color;
            osd.style.boxShadow = `0 4px 14px rgba(0,0,0,0.6), 0 0 8px ${color}`;
            osd.textContent = msg;
            osd.style.opacity = '1';

            if (this.osdTimer) clearTimeout(this.osdTimer);
            this.osdTimer = setTimeout(() => {
                if (osd) osd.style.opacity = '0';
            }, 2200);
        }
    }

    notifyStateChanged() {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('retro486-savestates-updated', { detail: { slots: this.slots } }));
        }
    }
}
