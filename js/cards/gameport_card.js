/**
 * Standard IBM PC Game Control Adapter (ISA Gameport Card)
 * Emulates the classic NE558 quad monostable timer joystick interface at I/O port 0x201.
 * Supports dual DB-15 analog joysticks (4 axes + 4 digital buttons), HTML5 Gamepad API,
 * and virtual/keyboard controller fallbacks.
 */

import { AdapterCard } from './adapter_card.js';

export class GameportCard extends AdapterCard {
    constructor(config = {}) {
        super(Object.assign({
            id: 'gameport_card',
            name: 'CH Products / Gravis Standard ISA Gameport',
            shortName: 'ISA Gameport',
            slotType: 'ISA-8',
            category: 'Input',
            description: 'Standard IBM PC Game Control Adapter (Port 0x201) with dual DB-15 ports, supporting 4 analog axes and 4 buttons.',
            pcbColor: '#8a6218', // Classic vintage tan/brown PCB
            accentColor: '#e0c040',
            jumpers: {
                baseAddress: 0x201, // 0x201 (standard), 0x203, 0x205, 0x207
                timingScale: 1.0,
                gamepadIndex: 0
            }
        }, config));

        // 4 Analog Axes resistance values in Ohms (0 to 100,000 Ohms; 50,000 = center)
        // Axis 0: Joy 1 X
        // Axis 1: Joy 1 Y
        // Axis 2: Joy 2 X (or Joy 1 Throttle/Rudder)
        // Axis 3: Joy 2 Y (or Joy 1 Hat)
        this.axisResistance = new Float64Array([50000, 50000, 50000, 50000]);

        // 4 Digital Buttons (true = pressed, false = released)
        // Bit 4: Joy 1 Button 1
        // Bit 5: Joy 1 Button 2
        // Bit 6: Joy 2 Button 1 (Joy 1 Button 3)
        // Bit 7: Joy 2 Button 2 (Joy 1 Button 4)
        this.buttons = [false, false, false, false];

        // NE558 Monostable Multivibrator Timer state
        // When written to 0x201, triggerTime is updated, and each axis timer duration (in µs) is computed:
        // Duration in µs: t = 24.2 + 0.011 * R
        this.triggerTimeUs = -1000000;
        this.axisDurationsUs = new Float64Array([574.2, 574.2, 574.2, 574.2]);

        // Cycle-based fallback for deterministic unit tests
        this.currentCycle = 0;
        this.triggerCycle = -1000000;
        this.axisDurationsCycles = new Float64Array([574, 574, 574, 574]);

        this.hasGamepad = false;
        this.lastGamepadPoll = 0;
    }

    getTimeUs() {
        if (typeof performance !== 'undefined' && performance.now) {
            return performance.now() * 1000.0;
        }
        return Date.now() * 1000.0;
    }

    /**
     * Set normalized axis value (-1.0 to +1.0). Center is 0.0.
     * @param {number} axis 0 to 3
     * @param {number} val -1.0 (min resistance ~0 Ohm) to +1.0 (max resistance ~100k Ohm)
     */
    setAxis(axis, val) {
        if (axis < 0 || axis > 3) return;
        const clamped = Math.max(-1.0, Math.min(1.0, val));
        // Map [-1.0, +1.0] to [0, 100000] Ohms
        this.axisResistance[axis] = (clamped + 1.0) * 50000.0;
    }

    /**
     * Set button pressed state.
     * @param {number} btn 0 to 3
     * @param {boolean} pressed
     */
    setButton(btn, pressed) {
        if (btn < 0 || btn > 3) return;
        this.buttons[btn] = !!pressed;
    }

    /**
     * Poll physical Gamepad via HTML5 Gamepad API if available.
     */
    pollGamepad() {
        if (typeof navigator === 'undefined' || !navigator.getGamepads) return;

        const now = this.getTimeUs();
        if (now - this.lastGamepadPoll < 16000) return; // ~60 Hz polling limit
        this.lastGamepadPoll = now;

        const gamepads = navigator.getGamepads();
        if (!gamepads) return;

        const pad = gamepads[this.jumpers.gamepadIndex] || gamepads[0];
        if (!pad) {
            this.hasGamepad = false;
            return;
        }

        this.hasGamepad = true;

        // Apply 10% deadzone to avoid analog drift
        const applyDeadzone = (val) => {
            return Math.abs(val) < 0.1 ? 0 : val;
        };

        if (pad.axes && pad.axes.length >= 2) {
            this.setAxis(0, applyDeadzone(pad.axes[0]));
            this.setAxis(1, applyDeadzone(pad.axes[1]));

            // If second stick or additional axes present
            if (pad.axes.length >= 4) {
                this.setAxis(2, applyDeadzone(pad.axes[2]));
                this.setAxis(3, applyDeadzone(pad.axes[3]));
            }
        }

        if (pad.buttons && pad.buttons.length >= 2) {
            this.setButton(0, !!(pad.buttons[0] && pad.buttons[0].pressed));
            this.setButton(1, !!(pad.buttons[1] && pad.buttons[1].pressed));
            this.setButton(2, !!(pad.buttons[2] && pad.buttons[2].pressed));
            this.setButton(3, !!(pad.buttons[3] && pad.buttons[3].pressed));
        }
    }

    triggerTimers() {
        this.pulseActivity();
        this.pollGamepad();

        const scale = this.jumpers.timingScale || 1.0;
        this.triggerTimeUs = this.getTimeUs();
        this.triggerCycle = this.currentCycle;

        for (let i = 0; i < 4; i++) {
            // Standard RC formula: t = (24.2 + 0.011 * R) in microseconds
            const durationUs = (24.2 + 0.011 * this.axisResistance[i]) * scale;
            this.axisDurationsUs[i] = durationUs;
            // Assuming 486 clock scale ~33-66 cycles/µs for cycle fallback
            this.axisDurationsCycles[i] = durationUs * 50;
        }
    }

    readPort() {
        this.pulseActivity();
        this.pollGamepad();

        const nowUs = this.getTimeUs();
        const elapsedUs = nowUs - this.triggerTimeUs;
        const elapsedCycles = this.currentCycle - this.triggerCycle;

        let val = 0x00;

        // Bits 0-3: Axis timers (1 = active/timing, 0 = expired/discharged)
        for (let i = 0; i < 4; i++) {
            const isTimingUs = elapsedUs >= 0 && elapsedUs < this.axisDurationsUs[i];
            const isTimingCycle = elapsedCycles >= 0 && elapsedCycles < this.axisDurationsCycles[i];
            if (isTimingUs || isTimingCycle) {
                val |= (1 << i);
            }
        }

        // Bits 4-7: Digital buttons (Active LOW: 0 = pressed, 1 = released)
        if (!this.buttons[0]) val |= 0x10;
        if (!this.buttons[1]) val |= 0x20;
        if (!this.buttons[2]) val |= 0x40;
        if (!this.buttons[3]) val |= 0x80;

        return val & 0xff;
    }

    getIOPortHandlers() {
        const base = this.jumpers.baseAddress || 0x201;
        return [
            {
                port: base,
                read: () => this.readPort(),
                write: (_, val) => this.triggerTimers()
            }
        ];
    }

    tick(cycles) {
        this.currentCycle += cycles;
    }

    getPcbVisualData() {
        return {
            pcbColor: this.pcbColor,
            chips: [
                { name: 'NE558 TIMER', x: 25, y: 15, w: 45, h: 22 },
                { name: '74LS244 BUF', x: 80, y: 15, w: 35, h: 20 },
                { name: '74LS138 DEC', x: 125, y: 15, w: 30, h: 18 }
            ],
            leds: [
                { name: 'PORT 201H', active: this.activityLed, color: '#ffb300' }
            ],
            bracketConnectors: ['DB-15 JOY A', 'DB-15 JOY B']
        };
    }

    saveState() {
        return {
            id: this.id,
            axisResistance: Array.from(this.axisResistance),
            buttons: [...this.buttons],
            jumpers: Object.assign({}, this.jumpers),
            hasGamepad: this.hasGamepad
        };
    }

    loadState(state) {
        if (!state) return;
        if (state.axisResistance) {
            for (let i = 0; i < 4; i++) {
                this.axisResistance[i] = state.axisResistance[i];
            }
        }
        if (state.buttons) {
            for (let i = 0; i < 4; i++) {
                this.buttons[i] = !!state.buttons[i];
            }
        }
        if (state.jumpers) {
            Object.assign(this.jumpers, state.jumpers);
            this.applyJumpers();
        }
    }
}
