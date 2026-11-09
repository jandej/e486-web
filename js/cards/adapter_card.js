/**
 * Retro486 Modular Adapter Card Base Class
 * Defines the expansion card interface for ISA 8-bit, ISA 16-bit, and VESA Local Bus (VLB) slots.
 */

export class AdapterCard {
    constructor(config = {}) {
        this.id = config.id || ('card_' + Math.random().toString(36).substring(2, 9));
        this.name = config.name || 'Generic Adapter Card';
        this.shortName = config.shortName || this.name;
        this.slotType = config.slotType || 'ISA-16'; // 'ISA-8', 'ISA-16', 'VLB'
        this.category = config.category || 'Expansion'; // 'Video', 'Audio', 'Storage', 'Diagnostic', 'Custom'
        this.description = config.description || 'Modular expansion card for 486 PC.';
        this.manufacturer = config.manufacturer || 'RetroSystems Inc.';
        this.pcbColor = config.pcbColor || '#1e5f38'; // Classic solder mask green
        this.accentColor = config.accentColor || '#c89e4b'; // Gold contact fingers
        
        // Jumper & DIP switch configurable parameters
        this.jumpers = Object.assign({}, config.jumpers);
        this.dipSwitches = Object.assign({}, config.dipSwitches);
        
        // Live state
        this.bus = null;
        this.installedSlot = null; // 1-based index or null
        this.status = 'uninstalled';
        this.activityLed = false;
        this.lastActivityTime = 0;
    }

    /**
     * Called when the card is plugged into an expansion slot on the motherboard bus.
     */
    onInstall(bus, slotNumber) {
        this.bus = bus;
        this.installedSlot = slotNumber;
        this.status = 'active';
        this.applyJumpers();
    }

    /**
     * Called when the card is removed from an expansion slot.
     */
    onRemove() {
        this.status = 'uninstalled';
        this.installedSlot = null;
        this.bus = null;
    }

    /**
     * Re-apply jumper configuration changes without physically removing card.
     */
    applyJumpers() {
        if (this.bus && this.installedSlot !== null) {
            this.bus.remapCard(this);
        }
    }

    /**
     * System hardware reset (cold boot or reset button).
     */
    onReset() {
        this.activityLed = false;
    }

    /**
     * Clock tick hook invoked during CPU instruction cycles.
     */
    tick(cycles) {
        // Subclasses can implement timers, FM envelopes, DMA pacing, etc.
    }

    /**
     * Return list of I/O port handlers registered by this card.
     * @returns {Array<{port: number, read: Function, write: Function}>}
     */
    getIOPortHandlers() {
        return [];
    }

    /**
     * Return list of memory windows mapped by this card (e.g. VRAM, Option ROM, EMS).
     * @returns {Array<{start: number, end: number, read: Function, write: Function}>}
     */
    getMemoryWindows() {
        return [];
    }

    /**
     * Return IRQ lines used by this card.
     * @returns {number[]}
     */
    getIRQLines() {
        return [];
    }

    /**
     * Return DMA channels used by this card.
     * @returns {number[]}
     */
    getDMALines() {
        return [];
    }

    /**
     * Pulse activity LED for visual display on card bracket and motherboard.
     */
    pulseActivity() {
        this.activityLed = true;
        this.lastActivityTime = performance.now();
    }

    /**
     * Audio node hook for Web Audio API integration.
     */
    getAudioNode(audioCtx) {
        return null;
    }

    /**
     * Video display hook for Video adapter cards (CGA, EGA, VGA).
     */
    renderDisplay(ctx, width, height) {
        // Implemented by video cards
    }

    /**
     * Metadata describing visual components for motherboard rendering.
     */
    getPcbVisualData() {
        return {
            pcbColor: this.pcbColor,
            chips: [
                { name: this.shortName, x: 20, y: 15, w: 40, h: 25 },
                { name: 'ROM', x: 70, y: 15, w: 25, h: 20 }
            ],
            leds: [
                { name: 'ACT', active: this.activityLed, color: '#ffcc00' }
            ],
            bracketConnectors: ['DB-9', 'RCA Audio']
        };
    }

    /**
     * Snapshot card state for emulator save states.
     */
    saveState() {
        return {
            id: this.id,
            jumpers: Object.assign({}, this.jumpers),
            dipSwitches: Object.assign({}, this.dipSwitches)
        };
    }

    /**
     * Restore card state from snapshot.
     */
    loadState(state) {
        if (!state) return;
        if (state.jumpers) {
            Object.assign(this.jumpers, state.jumpers);
            this.applyJumpers();
        }
        if (state.dipSwitches) {
            Object.assign(this.dipSwitches, state.dipSwitches);
        }
    }
}
