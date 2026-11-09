/**
 * IBM VGA / Super VGA (Bochs VBE) Modular Video Card
 * 100% Pure JavaScript port of tiny386 vga.c
 *
 * Copyright (c) 2003-2017 Fabrice Bellard
 * Portions Copyright (c) 2024-2025 Chunhui He (BSD-3-Clause)
 * Portions Copyright (c) 2026 Jan de Jager
 *
 * Features 256KB planar/chain-4/odd-even VRAM, Attribute/Sequencer/Graphics/CRTC controllers,
 * 256-color RAMDAC (0x3C6-0x3C9), Bochs VBE DISPI (0x1CE-0x1CF), hardware font planes & cursor.
 */

import { AdapterCard } from './adapter_card.js';
import { vgafont16 } from '../vgafont.js';

const MSR_COLOR_EMULATION = 0x01;
const ST01_V_RETRACE = 0x08;
const ST01_DISP_ENABLE = 0x01;

const VBE_DISPI_INDEX_ID = 0x0;
const VBE_DISPI_INDEX_XRES = 0x1;
const VBE_DISPI_INDEX_YRES = 0x2;
const VBE_DISPI_INDEX_BPP = 0x3;
const VBE_DISPI_INDEX_ENABLE = 0x4;
const VBE_DISPI_INDEX_BANK = 0x5;
const VBE_DISPI_INDEX_VIRT_WIDTH = 0x6;
const VBE_DISPI_INDEX_VIRT_HEIGHT = 0x7;
const VBE_DISPI_INDEX_X_OFFSET = 0x8;
const VBE_DISPI_INDEX_Y_OFFSET = 0x9;
const VBE_DISPI_INDEX_VIDEO_MEMORY_64K = 0xa;
const VBE_DISPI_INDEX_NB = 0xb;

const VBE_DISPI_ID0 = 0xB0C0;
const VBE_DISPI_ID5 = 0xB0C5;

const VBE_DISPI_ENABLED = 0x01;
const VBE_DISPI_GETCAPS = 0x02;
const VBE_DISPI_8BIT_DAC = 0x20;
const VBE_DISPI_NOCLEARMEM = 0x80;

const VGA_SEQ_CLOCK_MODE = 0x01;
const VGA_SEQ_PLANE_WRITE = 0x02;
const VGA_SEQ_CHARACTER_MAP = 0x03;
const VGA_SEQ_MEMORY_MODE = 0x04;

const VGA_SR02_ALL_PLANES = 0x0F;
const VGA_SR04_CHN_4M = 0x08;

const VGA_GFX_SR_VALUE = 0x00;
const VGA_GFX_SR_ENABLE = 0x01;
const VGA_GFX_COMPARE_VALUE = 0x02;
const VGA_GFX_DATA_ROTATE = 0x03;
const VGA_GFX_PLANE_READ = 0x04;
const VGA_GFX_MODE = 0x05;
const VGA_GFX_MISC = 0x06;
const VGA_GFX_COMPARE_MASK = 0x07;
const VGA_GFX_BIT_MASK = 0x08;

const VGA_GR06_GRAPHICS_MODE = 0x01;

const VGA_CRTC_H_DISP = 1;
const VGA_CRTC_OVERFLOW = 7;
const VGA_CRTC_MAX_SCAN = 9;
const VGA_CRTC_V_DISP_END = 0x12;
const VGA_CRTC_OFFSET = 0x13;
const VGA_CRTC_MODE = 0x17;
const VGA_CRTC_LINE_COMPARE = 0x18;

const sr_mask = new Uint8Array([0x03, 0x3d, 0x0f, 0x3f, 0x0e, 0x00, 0x00, 0xff]);
const gr_mask = new Uint8Array([
    0x0f, 0x0f, 0x0f, 0x1f, 0x03, 0x7b, 0x0f, 0x0f,
    0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

const mask16 = new Uint32Array([
    0x00000000, 0x000000ff, 0x0000ff00, 0x0000ffff,
    0x00ff0000, 0x00ff00ff, 0x00ffff00, 0x00ffffff,
    0xff000000, 0xff0000ff, 0xff00ff00, 0xff00ffff,
    0xffff0000, 0xffff00ff, 0xffffff00, 0xffffffff
]);

const pal_ega = new Uint8Array([
    0x00,0x00,0x00, 0x00,0x00,0x2a, 0x00,0x2a,0x00, 0x00,0x2a,0x2a,
    0x2a,0x00,0x00, 0x2a,0x00,0x2a, 0x2a,0x2a,0x00, 0x2a,0x2a,0x2a,
    0x00,0x00,0x15, 0x00,0x00,0x3f, 0x00,0x2a,0x15, 0x00,0x2a,0x3f,
    0x2a,0x00,0x15, 0x2a,0x00,0x3f, 0x2a,0x2a,0x15, 0x2a,0x2a,0x3f,
    0x00,0x15,0x00, 0x00,0x15,0x2a, 0x00,0x3f,0x00, 0x00,0x3f,0x2a,
    0x2a,0x15,0x00, 0x2a,0x15,0x2a, 0x2a,0x3f,0x00, 0x2a,0x3f,0x2a,
    0x00,0x15,0x15, 0x00,0x15,0x3f, 0x00,0x3f,0x15, 0x00,0x3f,0x3f,
    0x2a,0x15,0x15, 0x2a,0x15,0x3f, 0x2a,0x3f,0x15, 0x2a,0x3f,0x3f,
    0x15,0x00,0x00, 0x15,0x00,0x2a, 0x15,0x2a,0x00, 0x15,0x2a,0x2a,
    0x3f,0x00,0x00, 0x3f,0x00,0x2a, 0x3f,0x2a,0x00, 0x3f,0x2a,0x2a,
    0x15,0x00,0x15, 0x15,0x00,0x3f, 0x15,0x2a,0x15, 0x15,0x2a,0x3f,
    0x3f,0x00,0x15, 0x3f,0x00,0x3f, 0x3f,0x2a,0x15, 0x3f,0x2a,0x3f,
    0x15,0x15,0x00, 0x15,0x15,0x2a, 0x15,0x3f,0x00, 0x15,0x3f,0x2a,
    0x3f,0x15,0x00, 0x3f,0x15,0x2a, 0x3f,0x3f,0x00, 0x3f,0x3f,0x2a,
    0x15,0x15,0x15, 0x15,0x15,0x3f, 0x15,0x3f,0x15, 0x15,0x3f,0x3f,
    0x3f,0x15,0x15, 0x3f,0x15,0x3f, 0x3f,0x3f,0x15, 0x3f,0x3f,0x3f
]);

const actl = new Uint8Array([
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x14, 0x07,
    0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f,
    0x0c, 0x00, 0x0f, 0x08
]);

const sequ = new Uint8Array([0x00, 0x03, 0x00, 0x02]);
const grdc = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x0e, 0x0f, 0xff]);
const crtc_default = new Uint8Array([
    0x5f, 0x4f, 0x50, 0x82, 0x55, 0x81, 0xbf, 0x1f,
    0x00, 0x4f, 0x0d, 0x0e, 0x00, 0x00, 0x00, 0x00,
    0x9c, 0x8e, 0x8f, 0x28, 0x1f, 0x96, 0xb9, 0xa3,
    0xff
]);

function c6_to_8(v) {
    v &= 0x3f;
    const b = v & 1;
    return (v << 2) | (b << 1) | b;
}

function rgbaFromRgb(r, g, b) {
    return (0xff000000 | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
}

export class VgaCard extends AdapterCard {
    constructor(config = {}) {
        super(Object.assign({
            id: 'vga_card',
            name: 'IBM VGA / ET4000 Video Adapter',
            shortName: 'VGA 256KB',
            slotType: 'VLB',
            category: 'Video',
            description: 'VLB/ISA 256KB VGA Graphics Adapter with 256-color DAC, Planar/Chain-4 modes, and VBE support.',
            pcbColor: '#123d24',
            accentColor: '#e0b034',
            jumpers: {
                busSpeed: '33 MHz (VLB)',
                dacSpeed: '80 MHz'
            }
        }, config));

        this.vga_ram_size = 262144; // 256 KB standard VGA RAM (or up to 4MB for VBE)
        this.vga_ram = new Uint8Array(this.vga_ram_size);
        this.vga_ram32 = new Uint32Array(this.vga_ram.buffer);
        this.vga_ram16 = new Uint16Array(this.vga_ram.buffer);
        // Backwards compatibility alias
        this.vram = this.vga_ram;

        this.sr_index = 0;
        this.sr = new Uint8Array(8);
        this.gr_index = 0;
        this.gr = new Uint8Array(16);
        this.ar_index = 0;
        this.ar = new Uint8Array(21);
        this.ar_flip_flop = 0;
        this.cr_index = 0;
        this.cr = new Uint8Array(256);
        this.msr = 0x67;
        this.fcr = 0;
        this.st00 = 0;
        this.st01 = 0;

        this.dac_state = 0;
        this.dac_sub_index = 0;
        this.dac_read_index = 0;
        this.dac_write_index = 0;
        this.dac_8bit = 0;
        this.dac_cache = new Uint8Array(3);
        this.palette = new Uint8Array(768);
        this.dacPalette = new Uint32Array(256);

        this.bank_offset = 0;
        this.latch = 0;
        this.force_8dm = 1; // Render 80-col text cleanly at 640px width

        this.graphic_mode = 1;
        this.cursor_blink_time = 0;
        this.cursor_visible_phase = 1;
        this.retrace_time = 0;
        this.retrace_phase = 0;

        this.last_palette = new Uint32Array(16);
        this.palette256 = new Uint32Array(256);

        // VBE extension
        this.vbe_index = 0;
        this.vbe_regs = new Uint16Array(VBE_DISPI_INDEX_NB);
        this.vbe_start_addr = 0;
        this.vbe_line_offset = 0;
        this.pciBarAddr = 0xe0000000;

        // Cached ImageData for canvas rendering
        this.cachedImgData = null;
        this.cachedImgW = 0;
        this.cachedImgH = 0;

        this.initMode();
    }

    initMode() {
        this.palette.fill(0);
        for (let i = 0; i < 64 * 3; i++) {
            this.palette[i] = pal_ega[i];
        }
        this.syncDacPalette();

        for (let i = 0; i <= 0x13; i++) {
            this.ar[i] = actl[i];
        }
        this.ar[0x14] = 0;

        this.sr[0] = 0x03;
        for (let i = 0; i < 4; i++) {
            this.sr[i + 1] = sequ[i];
        }

        for (let i = 0; i <= 8; i++) {
            this.gr[i] = grdc[i];
        }

        for (let i = 0; i <= 0x18; i++) {
            this.cr[i] = crtc_default[i];
        }

        this.msr = 0x67;
        this.ar_index = 0x20;
        this.ar_flip_flop = 0;

        this.vbe_regs.fill(0);
        this.vbe_regs[VBE_DISPI_INDEX_ID] = VBE_DISPI_ID5;
        this.vbe_regs[VBE_DISPI_INDEX_VIDEO_MEMORY_64K] = this.vga_ram_size >>> 16;
        this.bank_offset = 0;

        // Clear screen in planar text layout (plane 0 = space 0x20, plane 1 = attr 0x07)
        for (let i = 0; i < (this.vga_ram_size >>> 2); i++) {
            this.vga_ram[i * 4] = 0x20;
            this.vga_ram[i * 4 + 1] = 0x07;
        }

        // Load VGA 8x16 font into Plane 2
        for (let i = 0; i < 256; i++) {
            for (let j = 0; j < 16; j++) {
                this.vga_ram[i * 32 * 4 + j * 4 + 2] = vgafont16[i * 16 + j];
            }
        }
    }

    onReset() {
        this.initMode();
    }

    syncDacPalette() {
        for (let i = 0; i < 256; i++) {
            const v = i * 3;
            const r = this.dac_8bit ? this.palette[v] : c6_to_8(this.palette[v]);
            const g = this.dac_8bit ? this.palette[v + 1] : c6_to_8(this.palette[v + 1]);
            const b = this.dac_8bit ? this.palette[v + 2] : c6_to_8(this.palette[v + 2]);
            this.dacPalette[i] = rgbaFromRgb(r, g, b);
        }
    }

    updatePalette16(paletteOut) {
        let full_update = 0;
        for (let i = 0; i < 16; i++) {
            let v = this.ar[i];
            if (this.ar[0x10] & 0x80) {
                v = ((this.ar[0x14] & 0x0f) << 4) | (v & 0x0f);
            } else {
                v = ((this.ar[0x14] & 0x0c) << 4) | (v & 0x3f);
            }
            v *= 3;
            const col = rgbaFromRgb(
                c6_to_8(this.palette[v]),
                c6_to_8(this.palette[v + 1]),
                c6_to_8(this.palette[v + 2])
            );
            if (col !== paletteOut[i]) {
                full_update = 1;
                paletteOut[i] = col;
            }
        }
        return full_update;
    }

    updatePalette256(paletteOut) {
        let full_update = 0;
        let v = 0;
        for (let i = 0; i < 256; i++) {
            let col;
            if (this.dac_8bit) {
                col = rgbaFromRgb(this.palette[v], this.palette[v + 1], this.palette[v + 2]);
            } else {
                col = rgbaFromRgb(
                    c6_to_8(this.palette[v]),
                    c6_to_8(this.palette[v + 1]),
                    c6_to_8(this.palette[v + 2])
                );
            }
            if (col !== paletteOut[i]) {
                full_update = 1;
                paletteOut[i] = col;
            }
            v += 3;
        }
        return full_update;
    }

    vbeEnabled() {
        return (this.vbe_regs[VBE_DISPI_INDEX_ENABLE] & VBE_DISPI_ENABLED) !== 0;
    }

    vbeFixupRegs() {
        if (!this.vbeEnabled()) return;
        const r = this.vbe_regs;
        let bits = r[VBE_DISPI_INDEX_BPP];
        switch (bits) {
            case 4:
            case 8:
            case 16:
            case 24:
            case 32:
                break;
            case 15:
                bits = 16;
                break;
            default:
                bits = r[VBE_DISPI_INDEX_BPP] = 8;
                break;
        }
        r[VBE_DISPI_INDEX_XRES] &= ~7;
        if (r[VBE_DISPI_INDEX_XRES] === 0) r[VBE_DISPI_INDEX_XRES] = 8;
        r[VBE_DISPI_INDEX_VIRT_WIDTH] &= ~7;
        if (r[VBE_DISPI_INDEX_VIRT_WIDTH] < r[VBE_DISPI_INDEX_XRES]) {
            r[VBE_DISPI_INDEX_VIRT_WIDTH] = r[VBE_DISPI_INDEX_XRES];
        }
        const linelength = (r[VBE_DISPI_INDEX_VIRT_WIDTH] * bits) >>> 3;
        if (r[VBE_DISPI_INDEX_YRES] === 0) r[VBE_DISPI_INDEX_YRES] = 1;
        let offset = (r[VBE_DISPI_INDEX_X_OFFSET] * bits) >>> 3;
        offset += r[VBE_DISPI_INDEX_Y_OFFSET] * linelength;
        this.vbe_line_offset = linelength;
        this.vbe_start_addr = offset >>> 2;
    }

    vbeUpdateVgaRegs() {
        if (!this.vbeEnabled()) return;
        this.gr[VGA_GFX_MISC] = (this.gr[VGA_GFX_MISC] & ~0x0c) | 0x04 | VGA_GR06_GRAPHICS_MODE;
        this.cr[VGA_CRTC_MODE] |= 3;
        this.cr[VGA_CRTC_OFFSET] = (this.vbe_line_offset >>> 3) & 0xff;
        this.cr[VGA_CRTC_H_DISP] = ((this.vbe_regs[VBE_DISPI_INDEX_XRES] >>> 3) - 1) & 0xff;
        const h = this.vbe_regs[VBE_DISPI_INDEX_YRES] - 1;
        this.cr[VGA_CRTC_V_DISP_END] = h & 0xff;
        this.cr[VGA_CRTC_OVERFLOW] = (this.cr[VGA_CRTC_OVERFLOW] & ~0x42) |
            ((h >>> 7) & 0x02) | ((h >>> 3) & 0x40);
        this.cr[VGA_CRTC_LINE_COMPARE] = 0xff;
        this.cr[VGA_CRTC_OVERFLOW] |= 0x10;
        this.cr[VGA_CRTC_MAX_SCAN] |= 0x40;

        let shift_control;
        if (this.vbe_regs[VBE_DISPI_INDEX_BPP] === 4) {
            shift_control = 0;
            this.sr[VGA_SEQ_CLOCK_MODE] &= ~8;
        } else {
            shift_control = 2;
            this.sr[VGA_SEQ_MEMORY_MODE] |= VGA_SR04_CHN_4M;
            this.sr[VGA_SEQ_PLANE_WRITE] |= VGA_SR02_ALL_PLANES;
        }
        this.gr[VGA_GFX_MODE] = (this.gr[VGA_GFX_MODE] & ~0x60) | (shift_control << 5);
        this.cr[VGA_CRTC_MAX_SCAN] &= ~0x9f;
    }

    vbeRead(offset) {
        if (offset === 0) {
            return this.vbe_index;
        }
        if (this.vbe_regs[VBE_DISPI_INDEX_ENABLE] & VBE_DISPI_GETCAPS) {
            switch (this.vbe_index) {
                case VBE_DISPI_INDEX_XRES: return 640;
                case VBE_DISPI_INDEX_YRES: return 480;
                case VBE_DISPI_INDEX_BPP: return 32;
            }
        }
        if (this.vbe_index < VBE_DISPI_INDEX_NB) {
            return this.vbe_regs[this.vbe_index];
        }
        return 0;
    }

    vbeWrite(offset, val) {
        val &= 0xffff;
        if (offset === 0) {
            this.vbe_index = val;
            return;
        }
        switch (this.vbe_index) {
            case VBE_DISPI_INDEX_ID:
                if (val >= VBE_DISPI_ID0 && val <= VBE_DISPI_ID5) {
                    this.vbe_regs[this.vbe_index] = val;
                }
                break;
            case VBE_DISPI_INDEX_ENABLE:
                if ((val & VBE_DISPI_ENABLED) && !(this.vbe_regs[VBE_DISPI_INDEX_ENABLE] & VBE_DISPI_ENABLED)) {
                    this.vbe_regs[VBE_DISPI_INDEX_VIRT_WIDTH] = this.vbe_regs[VBE_DISPI_INDEX_XRES];
                    this.vbe_regs[VBE_DISPI_INDEX_VIRT_HEIGHT] = this.vbe_regs[VBE_DISPI_INDEX_YRES];
                    this.vbe_regs[VBE_DISPI_INDEX_X_OFFSET] = 0;
                    this.vbe_regs[VBE_DISPI_INDEX_Y_OFFSET] = 0;
                } else {
                    this.bank_offset = 0;
                }
                this.dac_8bit = (val & VBE_DISPI_8BIT_DAC) ? 1 : 0;
                this.vbe_regs[this.vbe_index] = val;
                this.vbeFixupRegs();
                this.vbeUpdateVgaRegs();
                if (!(val & VBE_DISPI_NOCLEARMEM)) {
                    const clearLen = Math.min(this.vga_ram_size, this.vbe_regs[VBE_DISPI_INDEX_YRES] * this.vbe_line_offset);
                    this.vga_ram.fill(0, 0, clearLen);
                }
                break;
            case VBE_DISPI_INDEX_XRES:
            case VBE_DISPI_INDEX_YRES:
            case VBE_DISPI_INDEX_BPP:
            case VBE_DISPI_INDEX_VIRT_WIDTH:
            case VBE_DISPI_INDEX_VIRT_HEIGHT:
            case VBE_DISPI_INDEX_X_OFFSET:
            case VBE_DISPI_INDEX_Y_OFFSET:
                this.vbe_regs[this.vbe_index] = val;
                this.vbeFixupRegs();
                this.vbeUpdateVgaRegs();
                break;
            case VBE_DISPI_INDEX_BANK:
                val &= (this.vga_ram_size >>> 16) - 1;
                this.vbe_regs[this.vbe_index] = val;
                this.bank_offset = val << 16;
                break;
        }
    }

    ioportRead(addr) {
        addr &= 0xffff;
        if ((addr >= 0x3b0 && addr <= 0x3bf && (this.msr & MSR_COLOR_EMULATION)) ||
            (addr >= 0x3d0 && addr <= 0x3df && !(this.msr & MSR_COLOR_EMULATION))) {
            return 0xff;
        }
        switch (addr) {
            case 0x3c0:
                return this.ar_flip_flop === 0 ? this.ar_index : 0;
            case 0x3c1: {
                const index = this.ar_index & 0x1f;
                return index < 21 ? this.ar[index] : 0;
            }
            case 0x3c2:
                return this.st00;
            case 0x3c4:
                return this.sr_index;
            case 0x3c5:
                return this.sr[this.sr_index];
            case 0x3c6:
                return 0xff;
            case 0x3c7:
                return this.dac_state;
            case 0x3c8:
                return this.dac_write_index;
            case 0x3c9: {
                const val = this.palette[this.dac_read_index * 3 + this.dac_sub_index];
                if (++this.dac_sub_index === 3) {
                    this.dac_sub_index = 0;
                    this.dac_read_index = (this.dac_read_index + 1) & 0xff;
                }
                return val;
            }
            case 0x3ca:
                return this.fcr;
            case 0x3cc:
                return this.msr;
            case 0x3ce:
                return this.gr_index;
            case 0x3cf:
                return this.gr[this.gr_index];
            case 0x3b4:
            case 0x3d4:
                return this.cr_index;
            case 0x3b5:
            case 0x3d5:
                return this.cr[this.cr_index];
            case 0x3ba:
            case 0x3da: {
                // Toggle retrace bits on read so tight DOS polling loops never hang
                this.st01 ^= (ST01_V_RETRACE | ST01_DISP_ENABLE);
                const val = this.st01;
                this.ar_flip_flop = 0;
                return val;
            }
            default:
                return 0x00;
        }
    }

    ioportWrite(addr, val) {
        addr &= 0xffff;
        val &= 0xff;
        if ((addr >= 0x3b0 && addr <= 0x3bf && (this.msr & MSR_COLOR_EMULATION)) ||
            (addr >= 0x3d0 && addr <= 0x3df && !(this.msr & MSR_COLOR_EMULATION))) {
            return;
        }

        switch (addr) {
            case 0x3c0:
                if (this.ar_flip_flop === 0) {
                    this.ar_index = val & 0x3f;
                } else {
                    const index = this.ar_index & 0x1f;
                    if (index <= 0x0f) {
                        this.ar[index] = val & 0x3f;
                    } else if (index === 0x10) {
                        this.ar[index] = val & ~0x10;
                    } else if (index === 0x11) {
                        this.ar[index] = val;
                    } else if (index === 0x12) {
                        this.ar[index] = val & ~0xc0;
                    } else if (index === 0x13 || index === 0x14) {
                        this.ar[index] = val & ~0xf0;
                    }
                }
                this.ar_flip_flop ^= 1;
                break;
            case 0x3c2:
                this.msr = val & ~0x10;
                break;
            case 0x3c4:
                this.sr_index = val & 7;
                break;
            case 0x3c5:
                this.sr[this.sr_index] = val & sr_mask[this.sr_index];
                break;
            case 0x3c7:
                this.dac_read_index = val;
                this.dac_sub_index = 0;
                this.dac_state = 3;
                break;
            case 0x3c8:
                this.dac_write_index = val;
                this.dac_sub_index = 0;
                this.dac_state = 0;
                break;
            case 0x3c9:
                this.dac_cache[this.dac_sub_index] = val;
                if (++this.dac_sub_index === 3) {
                    const base = this.dac_write_index * 3;
                    this.palette[base] = this.dac_cache[0];
                    this.palette[base + 1] = this.dac_cache[1];
                    this.palette[base + 2] = this.dac_cache[2];
                    const r = this.dac_8bit ? this.dac_cache[0] : c6_to_8(this.dac_cache[0]);
                    const g = this.dac_8bit ? this.dac_cache[1] : c6_to_8(this.dac_cache[1]);
                    const b = this.dac_8bit ? this.dac_cache[2] : c6_to_8(this.dac_cache[2]);
                    this.dacPalette[this.dac_write_index] = rgbaFromRgb(r, g, b);
                    this.dac_sub_index = 0;
                    this.dac_write_index = (this.dac_write_index + 1) & 0xff;
                }
                break;
            case 0x3ce:
                this.gr_index = val & 0x0f;
                break;
            case 0x3cf:
                this.gr[this.gr_index] = val & gr_mask[this.gr_index];
                break;
            case 0x3b4:
            case 0x3d4:
                this.cr_index = val;
                break;
            case 0x3b5:
            case 0x3d5:
                if ((this.cr[0x11] & 0x80) && this.cr_index <= 7) {
                    if (this.cr_index === 7) {
                        this.cr[7] = (this.cr[7] & ~0x10) | (val & 0x10);
                    }
                    return;
                }
                this.cr[this.cr_index] = val;
                break;
            case 0x3ba:
            case 0x3da:
                this.fcr = val & 0x10;
                break;
        }
    }

    /* ======================================================================
     * VGA MEMORY READ / WRITE (0xA0000 - 0xBFFFF & LFB)
     * ====================================================================== */

    vgaMemRead(addr) {
        this.pulseActivity();
        const memory_map_mode = (this.gr[VGA_GFX_MISC] >>> 2) & 3;
        addr &= 0x1ffff;
        switch (memory_map_mode) {
            case 0:
                break;
            case 1:
                if (addr >= 0x10000) return 0xff;
                addr += this.bank_offset;
                break;
            case 2:
                addr -= 0x10000;
                if (addr < 0 || addr >= 0x8000) return 0xff;
                break;
            default:
            case 3:
                addr -= 0x18000;
                if (addr < 0 || addr >= 0x8000) return 0xff;
                break;
        }

        if (this.sr[VGA_SEQ_MEMORY_MODE] & VGA_SR04_CHN_4M) {
            return this.vga_ram[addr];
        } else if (this.gr[VGA_GFX_MODE] & 0x10) {
            const plane = (this.gr[VGA_GFX_PLANE_READ] & 2) | (addr & 1);
            addr = ((addr & ~1) << 1) | plane;
            if (addr >= this.vga_ram_size) return 0xff;
            return this.vga_ram[addr];
        } else {
            if ((addr * 4) >= this.vga_ram_size) return 0xff;
            this.latch = this.vga_ram32[addr];
            if (!(this.gr[VGA_GFX_MODE] & 0x08)) {
                const plane = this.gr[VGA_GFX_PLANE_READ] & 3;
                return (this.latch >>> (plane * 8)) & 0xff;
            } else {
                let ret = (this.latch ^ mask16[this.gr[VGA_GFX_COMPARE_VALUE]]) &
                    mask16[this.gr[VGA_GFX_COMPARE_MASK]];
                ret |= ret >>> 16;
                ret |= ret >>> 8;
                return (~ret) & 0xff;
            }
        }
    }

    vgaMemWrite(addr, val8) {
        this.pulseActivity();
        let val = val8 & 0xff;
        const memory_map_mode = (this.gr[VGA_GFX_MISC] >>> 2) & 3;
        addr &= 0x1ffff;
        switch (memory_map_mode) {
            case 0:
                break;
            case 1:
                if (addr >= 0x10000) return;
                addr += this.bank_offset;
                break;
            case 2:
                addr -= 0x10000;
                if (addr < 0 || addr >= 0x8000) return;
                break;
            default:
            case 3:
                addr -= 0x18000;
                if (addr < 0 || addr >= 0x8000) return;
                break;
        }

        if (this.sr[VGA_SEQ_MEMORY_MODE] & VGA_SR04_CHN_4M) {
            const plane = addr & 3;
            const mask = 1 << plane;
            if (this.sr[VGA_SEQ_PLANE_WRITE] & mask) {
                this.vga_ram[addr] = val;
            }
        } else if (this.gr[VGA_GFX_MODE] & 0x10) {
            const plane = (this.gr[VGA_GFX_PLANE_READ] & 2) | (addr & 1);
            const mask = 1 << plane;
            if (this.sr[VGA_SEQ_PLANE_WRITE] & mask) {
                addr = ((addr & ~1) << 1) | plane;
                if (addr >= this.vga_ram_size) return;
                this.vga_ram[addr] = val;
            }
        } else {
            const write_mode = this.gr[VGA_GFX_MODE] & 3;
            let bit_mask = 0;
            let doWriteDirect = false;

            switch (write_mode) {
                default:
                case 0: {
                    const b = this.gr[VGA_GFX_DATA_ROTATE] & 7;
                    val = ((val >>> b) | (val << (8 - b))) & 0xff;
                    val |= val << 8;
                    val |= val << 16;
                    const set_mask = mask16[this.gr[VGA_GFX_SR_ENABLE]];
                    val = ((val & ~set_mask) | (mask16[this.gr[VGA_GFX_SR_VALUE]] & set_mask)) >>> 0;
                    bit_mask = this.gr[VGA_GFX_BIT_MASK];
                    break;
                }
                case 1:
                    val = this.latch;
                    doWriteDirect = true;
                    break;
                case 2:
                    val = mask16[val & 0x0f];
                    bit_mask = this.gr[VGA_GFX_BIT_MASK];
                    break;
                case 3: {
                    const b = this.gr[VGA_GFX_DATA_ROTATE] & 7;
                    val = ((val >>> b) | (val << (8 - b))) & 0xff;
                    bit_mask = this.gr[VGA_GFX_BIT_MASK] & val;
                    val = mask16[this.gr[VGA_GFX_SR_VALUE]];
                    break;
                }
            }

            if (!doWriteDirect) {
                const func_select = this.gr[VGA_GFX_DATA_ROTATE] >>> 3;
                switch (func_select) {
                    case 1: val &= this.latch; break;
                    case 2: val |= this.latch; break;
                    case 3: val ^= this.latch; break;
                }
                bit_mask |= bit_mask << 8;
                bit_mask |= bit_mask << 16;
                val = ((val & bit_mask) | (this.latch & ~bit_mask)) >>> 0;
            }

            const mask = this.sr[VGA_SEQ_PLANE_WRITE] & 0x0f;
            const write_mask = mask16[mask];
            if ((addr * 4) >= this.vga_ram_size) return;
            this.vga_ram32[addr] = ((this.vga_ram32[addr] & ~write_mask) | (val & write_mask)) >>> 0;
        }
    }

    vgaMemWrite16(addr, val16) {
        if (!(this.sr[VGA_SEQ_MEMORY_MODE] & VGA_SR04_CHN_4M)) {
            this.vgaMemWrite(addr, val16 & 0xff);
            this.vgaMemWrite(addr + 1, (val16 >>> 8) & 0xff);
            return;
        }
        const memory_map_mode = (this.gr[VGA_GFX_MISC] >>> 2) & 3;
        addr &= 0x1ffff;
        switch (memory_map_mode) {
            case 0: break;
            case 1:
                if (addr >= 0x10000) return;
                addr += this.bank_offset;
                break;
            case 2:
                addr -= 0x10000;
                if (addr < 0 || addr >= 0x8000) return;
                break;
            default:
            case 3:
                addr -= 0x18000;
                if (addr < 0 || addr >= 0x8000) return;
                break;
        }
        const plane = addr & 3;
        if (this.sr[VGA_SEQ_PLANE_WRITE] & (1 << plane)) {
            this.vga_ram[addr] = val16 & 0xff;
            this.vga_ram[addr + 1] = (val16 >>> 8) & 0xff;
        }
    }

    vgaMemWrite32(addr, val32) {
        if (!(this.sr[VGA_SEQ_MEMORY_MODE] & VGA_SR04_CHN_4M)) {
            this.vgaMemWrite(addr, val32 & 0xff);
            this.vgaMemWrite(addr + 1, (val32 >>> 8) & 0xff);
            this.vgaMemWrite(addr + 2, (val32 >>> 16) & 0xff);
            this.vgaMemWrite(addr + 3, (val32 >>> 24) & 0xff);
            return;
        }
        const memory_map_mode = (this.gr[VGA_GFX_MISC] >>> 2) & 3;
        addr &= 0x1ffff;
        switch (memory_map_mode) {
            case 0: break;
            case 1:
                if (addr >= 0x10000) return;
                addr += this.bank_offset;
                break;
            case 2:
                addr -= 0x10000;
                if (addr < 0 || addr >= 0x8000) return;
                break;
            default:
            case 3:
                addr -= 0x18000;
                if (addr < 0 || addr >= 0x8000) return;
                break;
        }
        const plane = addr & 3;
        if (this.sr[VGA_SEQ_PLANE_WRITE] & (1 << plane)) {
            this.vga_ram[addr] = val32 & 0xff;
            this.vga_ram[addr + 1] = (val32 >>> 8) & 0xff;
            this.vga_ram[addr + 2] = (val32 >>> 16) & 0xff;
            this.vga_ram[addr + 3] = (val32 >>> 24) & 0xff;
        }
    }

    vgaMemWriteString(addr, srcBuf, srcOffset, len) {
        if (!(this.sr[VGA_SEQ_MEMORY_MODE] & VGA_SR04_CHN_4M)) {
            return false;
        }
        const memory_map_mode = (this.gr[VGA_GFX_MISC] >>> 2) & 3;
        addr &= 0x1ffff;
        switch (memory_map_mode) {
            case 0: break;
            case 1:
                if (addr >= 0x10000) return false;
                addr += this.bank_offset;
                break;
            case 2:
                addr -= 0x10000;
                if (addr < 0 || addr >= 0x8000) return false;
                break;
            default:
            case 3:
                addr -= 0x18000;
                if (addr < 0 || addr >= 0x8000) return false;
                break;
        }
        const plane = addr & 3;
        if (this.sr[VGA_SEQ_PLANE_WRITE] & (1 << plane)) {
            this.vga_ram.set(srcBuf.subarray(srcOffset, srcOffset + len), addr);
            return true;
        }
        return false;
    }

    getIOPortHandlers() {
        const handlers = [];
        // Standard VGA ports 0x3b0..0x3df
        for (let p = 0x3b0; p <= 0x3df; p++) {
            handlers.push({
                port: p,
                read: (addr) => this.ioportRead(addr),
                write: (addr, val) => this.ioportWrite(addr, val)
            });
        }
        return handlers;
    }

    getMemoryWindows() {
        return [
            {
                start: 0xA0000,
                end: 0xBFFFF,
                read: (addr) => this.vgaMemRead(addr - 0xA0000),
                write: (addr, val) => this.vgaMemWrite(addr - 0xA0000, val)
            }
        ];
    }

    /* ======================================================================
     * DISPLAY RENDERING (TEXT & GRAPHICS MODES)
     * ====================================================================== */

    ensureImageData(ctx, w, h) {
        if (!this.cachedImgData || this.cachedImgW !== w || this.cachedImgH !== h) {
            this.cachedImgData = ctx.createImageData(w, h);
            this.cachedImgW = w;
            this.cachedImgH = h;
        }
        return this.cachedImgData;
    }

    renderDisplay(ctx, canvasW, canvasH) {
        // Blink phase every ~250ms
        const now = performance.now();
        this.cursor_visible_phase = ((now / 250) | 0) & 1;

        let mode;
        if (!(this.ar_index & 0x20)) {
            mode = 0; // blank
        } else if (this.gr[0x06] & 1) {
            mode = 2; // graphics
        } else {
            mode = 1; // text
        }
        this.graphic_mode = mode;

        if (mode === 0) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvasW, canvasH);
            return;
        }

        if (mode === 1) {
            this.renderTextMode(ctx, canvasW, canvasH);
        } else {
            this.renderGraphicsMode(ctx, canvasW, canvasH);
        }
    }

    renderTextMode(ctx, canvasW, canvasH) {
        this.updatePalette16(this.last_palette);

        const v = this.sr[0x03];
        const fontBase0 = (((v >>> 4) & 1) | ((v << 1) & 6)) * 8192 * 4 + 2;
        const fontBase1 = (((v >>> 5) & 1) | ((v >> 1) & 6)) * 8192 * 4 + 2;

        const line_offset = (this.cr[0x13] << 3);
        const start_addr = this.cr[0x0d] | (this.cr[0x0c] << 8);
        const cheight = (this.cr[0x09] & 0x1f) + 1;
        const cwidth = 8;

        const cols = (this.cr[0x01] + 1);
        let rows = this.cr[0x12] |
            ((this.cr[0x07] & 0x02) << 7) |
            ((this.cr[0x07] & 0x40) << 3);
        rows = Math.floor((rows + 1) / cheight);

        if (cols <= 0 || rows <= 0 || cols > 132 || rows > 60) return;

        const width1 = cols * cwidth;
        const height1 = rows * cheight;

        const imgData = this.ensureImageData(ctx, width1, height1);
        const fb32 = new Uint32Array(imgData.data.buffer);

        const cursor_pos = (this.cr[0x0e] << 8) | this.cr[0x0f];
        const cursor_addr = cursor_pos * 4;
        const cursor_start = this.cr[0x0a];
        const cursor_end = this.cr[0x0b];
        const showCursor = !(cursor_start & 0x20) && this.cursor_visible_phase;

        let ch_addr1 = start_addr * 4;
        const vram = this.vga_ram;

        for (let cy = 0; cy < rows; cy++) {
            let ch_addr = ch_addr1;
            const baseRowY = cy * cheight;

            for (let cx = 0; cx < cols; cx++) {
                const ramIdx = ch_addr & 0x3fffc;
                const ch = vram[ramIdx];
                const cattr = vram[ramIdx + 1];

                const fontBase = ((cattr >>> 3) & 1) ? fontBase1 : fontBase0;
                let fontPtr = fontBase + 32 * 4 * ch;
                const bgcol = this.last_palette[(cattr >>> 4) & 0x0f];
                const fgcol = this.last_palette[cattr & 0x0f];

                const baseColX = cx * cwidth;
                for (let gh = 0; gh < cheight; gh++) {
                    const fontData = vram[fontPtr & 0x3ffff];
                    const dstOff = (baseRowY + gh) * width1 + baseColX;
                    fb32[dstOff + 0] = (fontData & 0x80) ? fgcol : bgcol;
                    fb32[dstOff + 1] = (fontData & 0x40) ? fgcol : bgcol;
                    fb32[dstOff + 2] = (fontData & 0x20) ? fgcol : bgcol;
                    fb32[dstOff + 3] = (fontData & 0x10) ? fgcol : bgcol;
                    fb32[dstOff + 4] = (fontData & 0x08) ? fgcol : bgcol;
                    fb32[dstOff + 5] = (fontData & 0x04) ? fgcol : bgcol;
                    fb32[dstOff + 6] = (fontData & 0x02) ? fgcol : bgcol;
                    fb32[dstOff + 7] = (fontData & 0x01) ? fgcol : bgcol;
                    fontPtr += 4;
                }

                if (showCursor && ch_addr === cursor_addr) {
                    const line_start = cursor_start & 0x1f;
                    let line_last = cursor_end & 0x1f;
                    if (line_last > cheight - 1) line_last = cheight - 1;
                    if (line_last >= line_start && line_start < cheight) {
                        for (let gh = line_start; gh <= line_last; gh++) {
                            const dstOff = (baseRowY + gh) * width1 + baseColX;
                            for (let gx = 0; gx < 8; gx++) {
                                fb32[dstOff + gx] = fgcol;
                            }
                        }
                    }
                }

                ch_addr += 4;
            }
            ch_addr1 += line_offset;
        }

        if (width1 === canvasW && height1 === canvasH) {
            ctx.putImageData(imgData, 0, 0);
        } else {
            if (!this.tempCanvas || this.tempCanvas.width !== width1 || this.tempCanvas.height !== height1) {
                this.tempCanvas = document.createElement('canvas');
                this.tempCanvas.width = width1;
                this.tempCanvas.height = height1;
                this.tempCtx = this.tempCanvas.getContext('2d');
            }
            this.tempCtx.putImageData(imgData, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(this.tempCanvas, 0, 0, canvasW, canvasH);
        }
    }

    renderGraphicsMode(ctx, canvasW, canvasH) {
        let w = (this.cr[0x01] + 1) * 8;
        let h = (this.cr[0x12] |
            ((this.cr[0x07] & 0x02) << 7) |
            ((this.cr[0x07] & 0x40) << 3)) + 1;

        const shift_control = (this.gr[0x05] >>> 5) & 3;
        const double_scan = (this.cr[0x09] >>> 7) & 1;
        const multi_scan = double_scan ? double_scan : ((((this.cr[0x09] & 0x1f) + 1) << double_scan) - 1);
        let multi_run = multi_scan;

        let start_addr = this.cr[0x0d] | (this.cr[0x0c] << 8);
        let line_offset = this.cr[0x13] << 3;
        let line_compare = this.cr[0x18] |
            ((this.cr[0x07] & 0x10) << 4) |
            ((this.cr[0x09] & 0x40) << 3);
        if (this.vbeEnabled()) {
            line_offset = this.vbe_line_offset;
            start_addr = this.vbe_start_addr;
            line_compare = 65535;
        }

        let addr1 = 4 * start_addr;
        const vram = this.vga_ram;
        const palette = this.palette256;
        let xdiv = 1;
        let bpp = 4;

        if (shift_control === 0 || shift_control === 1) {
            this.updatePalette16(palette);
            if (this.sr[0x01] & 8) {
                xdiv = 2;
                if (w <= 360) w *= 2;
            }
        } else {
            if (!this.vbeEnabled()) {
                this.updatePalette256(palette);
                xdiv = 2;
                bpp = 8;
                if (w <= 360) w *= 2;
            } else {
                bpp = this.vbe_regs[VBE_DISPI_INDEX_BPP];
                if (bpp === 8) this.updatePalette256(palette);
            }
        }

        if (h <= 240 && multi_scan > 0) {
            h *= (multi_scan + 1);
        }

        if (w <= 0 || h <= 0 || w > 1280 || h > 1024) return;

        const imgData = this.ensureImageData(ctx, w, h);
        const fb32 = new Uint32Array(imgData.data.buffer);
        const plane_mask = this.ar[0x12];
        let pel_pan = (shift_control === 0) ? (this.ar[0x13] & 7) : 0;

        let y1 = 0;
        for (let y = 0; y < h; y++) {
            let addr = addr1;
            if (!(this.cr[0x17] & 1)) {
                const shift = 14 + ((this.cr[0x17] >>> 6) & 1);
                addr = (addr & ~(1 << shift)) | ((y1 & 1) << shift);
            }
            if (!(this.cr[0x17] & 2)) {
                addr = (addr & ~0x8000) | ((y1 & 2) << 14);
            }

            const rowOff = y * w;
            for (let x = 0; x < w; x++) {
                const x1 = ((xdiv === 2) ? (x >>> 1) : x) + pel_pan;
                let color = 0xff000000;

                if (shift_control === 0) {
                    const byteOff = (addr + 4 * (x1 >>> 3)) & 0x3ffff;
                    const bitShift = 7 - (x1 & 7);
                    if (plane_mask === 1) {
                        const k = (vram[byteOff] >>> bitShift) & 1;
                        color = palette[k];
                    } else {
                        let k = ((vram[byteOff] >>> bitShift) & 1);
                        k |= ((vram[byteOff + 1] >>> bitShift) & 1) << 1;
                        k |= ((vram[byteOff + 2] >>> bitShift) & 1) << 2;
                        k |= ((vram[byteOff + 3] >>> bitShift) & 1) << 3;
                        color = palette[k];
                    }
                } else if (shift_control === 1) {
                    const byteOff = (addr + 4 * (x1 >>> 3) + ((x1 & 4) >>> 2)) & 0x3ffff;
                    const k = (vram[byteOff] >>> (6 - 2 * (x1 & 3))) & 3;
                    color = palette[k];
                } else {
                    if (bpp === 8) {
                        const k = vram[(addr + x1) & 0x3ffff];
                        color = palette[k];
                    } else if (bpp === 16) {
                        const off = (addr + 2 * x1) & 0x3ffff;
                        const k = vram[off] | (vram[off + 1] << 8);
                        const b = (k & 0x1f) << 3;
                        const g = ((k >>> 5) & 0x3f) << 2;
                        const r = ((k >>> 11) & 0x1f) << 3;
                        color = rgbaFromRgb(r, g, b);
                    } else if (bpp === 32) {
                        const off = (addr + 4 * x1) & 0x3ffff;
                        color = rgbaFromRgb(vram[off + 2], vram[off + 1], vram[off]);
                    }
                }

                fb32[rowOff + x] = color;
            }

            if (y === line_compare) {
                addr1 = 0;
                y1 = 0;
                multi_run = multi_scan;
                if (this.ar[0x10] & 0x20) pel_pan = 0;
            } else if (!multi_run) {
                const mask = (this.cr[0x17] & 3) ^ 3;
                if ((y1 & mask) === mask) {
                    addr1 += line_offset;
                }
                y1++;
                multi_run = multi_scan;
            } else {
                multi_run--;
            }
        }

        if (w === canvasW && h === canvasH) {
            ctx.putImageData(imgData, 0, 0);
        } else {
            if (!this.tempCanvas || this.tempCanvas.width !== w || this.tempCanvas.height !== h) {
                this.tempCanvas = document.createElement('canvas');
                this.tempCanvas.width = w;
                this.tempCanvas.height = h;
                this.tempCtx = this.tempCanvas.getContext('2d');
            }
            this.tempCtx.putImageData(imgData, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(this.tempCanvas, 0, 0, canvasW, canvasH);
        }
    }

    getPcbVisualData() {
        return {
            pcbColor: this.pcbColor,
            chips: [
                { name: 'ET4000/W32P', x: 25, y: 15, w: 45, h: 30 },
                { name: 'RAMDAC 80MHz', x: 75, y: 15, w: 25, h: 25 },
                { name: 'VGA BIOS ROM', x: 105, y: 15, w: 25, h: 20 },
                { name: '256K VRAM', x: 135, y: 15, w: 40, h: 20 }
            ],
            leds: [
                { name: 'VLB', active: this.activityLed, color: '#00ff66' }
            ],
            bracketConnectors: ['HD-15 VGA (Analog 15-pin)']
        };
    }
}
