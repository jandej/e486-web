/**
 * Intel 80486DX2 Complete 32-Bit x86 Processor Emulator
 * 100% Pure JavaScript port of tiny386 (i386.c + i386ins.def) with integrated x87 FPU.
 *
 * Copyright (c) 2024-2025 Chunhui He (BSD-3-Clause)
 * Portions Copyright (c) 2026 Jan de Jager
 *
 * Supports Real Mode, Protected Mode, Virtual 8086 Mode, 32-bit Paging & TLB,
 * Hardware Task Switching, Lazy Flags, and the full 80386/80486/Pentium instruction set.
 */

import { FPU } from './fpu_487.js';

const EX_DE = 0;
const EX_DB = 1;
const EX_NMI = 2;
const EX_BP = 3;
const EX_OF = 4;
const EX_BR = 5;
const EX_UD = 6;
const EX_NM = 7;
const EX_DF = 8;
const EX_INT9 = 9;
const EX_TS = 10;
const EX_NP = 11;
const EX_SS = 12;
const EX_GP = 13;
const EX_PF = 14;

const CF = 0x1;
const PF = 0x4;
const AF = 0x10;
const ZF = 0x40;
const SF = 0x80;
const TF = 0x100;
const IF = 0x200;
const DF = 0x400;
const OF = 0x800;
const IOPL = 0x3000;
const NT = 0x4000;
const RF = 0x10000;
const VM = 0x20000;

const EFLAGS_MASK_386 = 0x37fd7;
const EFLAGS_MASK_486 = 0x77fd7;
const EFLAGS_MASK_586 = 0x277fd7;

const SEG_ES = 0;
const SEG_CS = 1;
const SEG_SS = 2;
const SEG_DS = 3;
const SEG_FS = 4;
const SEG_GS = 5;
const SEG_LDT = 6;
const SEG_TR = 7;

const SEG_D_BIT = 1 << 14;
const SEG_B_BIT = 1 << 14;

const CR0_PG = (1 << 31) >>> 0;
const CR0_WP = 0x10000;
const TLB_SIZE = 512;

const ADDR_OK1 = 0;
const ADDR_OK2 = 1;

const TS_JMP = 0;
const TS_CALL = 1;
const TS_IRET = 2;

const CC_ADC = 0;
const CC_ADD = 1;
const CC_SBB = 2;
const CC_SUB = 3;
const CC_NEG8 = 4;
const CC_NEG16 = 5;
const CC_NEG32 = 6;
const CC_DEC8 = 7;
const CC_DEC16 = 8;
const CC_DEC32 = 9;
const CC_INC8 = 10;
const CC_INC16 = 11;
const CC_INC32 = 12;
const CC_IMUL8 = 13;
const CC_IMUL16 = 14;
const CC_IMUL32 = 15;
const CC_MUL8 = 16;
const CC_MUL16 = 17;
const CC_MUL32 = 18;
const CC_SAR = 19;
const CC_SHL = 20;
const CC_SHR = 21;
const CC_SHLD = 22;
const CC_SHRD = 23;
const CC_BSF = 24;
const CC_BSR = 25;
const CC_AND = 26;
const CC_OR = 27;
const CC_XOR = 28;

const parity_tab = new Uint8Array([
    1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
    0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
    0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
    1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
    0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
    1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
    1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
    0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
    0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
    1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
    1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
    0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
    1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
    0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
    0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
    1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1
]);

// [wp != 0][(pte >> 1) & 3][cpl > 0][rwm > 1]
const pte_lookup = [
    [ // wp == 0
        [ [0, 0], [1, 1] ], // s,r
        [ [0, 0], [1, 1] ], // s,w
        [ [0, 0], [0, 1] ], // u,r
        [ [0, 0], [0, 0] ], // u,w
    ],
    [ // wp == 1
        [ [0, 1], [1, 1] ], // s,r
        [ [0, 0], [1, 1] ], // s,w
        [ [0, 1], [0, 1] ], // u,r
        [ [0, 0], [0, 0] ], // u,w
    ]
];

function sext8(a) {
    return (((a & 0xff) << 24) >> 24) >>> 0;
}

function sext16(a) {
    return (((a & 0xffff) << 16) >> 16) >>> 0;
}

function sext32(a) {
    return (a | 0) >>> 0;
}

export class Cpu486 {
    constructor(bus) {
        this.bus = bus;
        this.bus.cpu = this;

        this.ram = bus.ram;
        this.ramView = bus.ramView;
        this.phys_mem_size = bus.ramSizeBytes;

        this.gen = 4;
        this.flags_mask = EFLAGS_MASK_486;

        // 32-bit General Purpose Registers: EAX(0), ECX(1), EDX(2), EBX(3), ESP(4), EBP(5), ESI(6), EDI(7)
        this.regsBuffer = new ArrayBuffer(32);
        this.regs = new Uint32Array(this.regsBuffer);
        this.regs16 = new Uint16Array(this.regsBuffer);
        this.regs8 = new Uint8Array(this.regsBuffer);

        // Segment indices
        this.ES = SEG_ES;
        this.CS = SEG_CS;
        this.SS = SEG_SS;
        this.DS = SEG_DS;
        this.FS = SEG_FS;
        this.GS = SEG_GS;

        this.segments = new Uint16Array(8);
        this.seg = Array.from({ length: 8 }, () => ({
            sel: 0,
            base: 0,
            limit: 0,
            flags: 0
        }));

        this.idt = { base: 0, limit: 0x3ff };
        this.gdt = { base: 0, limit: 0 };

        this.cr0 = 0;
        this.cr2 = 0;
        this.cr3 = 0;
        this.dr = new Uint32Array(8);

        this.ip = 0xfff0;
        this.next_ip = 0xfff0;
        this.flags = 0x2;
        this.cpl = 0;
        this.code16 = true;
        this.sp_mask = 0xffff;
        this.halt = false;

        this.ifetch_laddr = 0xffffffff;
        this.ifetch_xaddr = 0;
        this.ifetch_paddr = 0;

        this.cc_op = 0;
        this.cc_dst = 0;
        this.cc_dst2 = 0;
        this.cc_src1 = 0;
        this.cc_src2 = 0;
        this.cc_mask = 0;

        this.tlb_tab = Array.from({ length: TLB_SIZE }, () => ({
            lpgno: 0xffffffff,
            xaddr: 0,
            pte_lookup: pte_lookup[0][0],
            ppte_addr: 0
        }));

        this.fpu = new FPU();

        this.cycle = 0;
        this.excno = 0;
        this.excerr = 0;
        this.intr = false;

        this.sysenter = { cs: 0, eip: 0, esp: 0 };

        // Reusable OptAddr objects to avoid GC pressure in hot loop
        this._meml = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        this._meml1 = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        this._meml2 = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        this._meml3 = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        this._meml4 = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        this._meml5 = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        this._meml6 = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        this._meml7 = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        this._meml8 = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        this._memls = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        this._memld = { res: ADDR_OK1, addr1: 0, addr2: 0 };

        this.mipsEstimate = 0;
        this.lastMipsTime = performance.now();
        this.lastMipsInst = 0;

        this.reset();
    }

    /* ======================================================================
     * PUBLIC / COMPATIBILITY GETTERS & SETTERS
     * ====================================================================== */

    get eip() {
        return this.next_ip >>> 0;
    }

    set eip(val) {
        this.ip = val >>> 0;
        this.next_ip = val >>> 0;
        this.ifetch_paddr = 0;
    }

    get eflags() {
        return this.cpu_getflags() >>> 0;
    }

    set eflags(val) {
        this.cc_mask = 0;
        this.flags = ((val & this.flags_mask) | 0x2) >>> 0;
    }

    get instructionCount() {
        return this.cycle;
    }

    set instructionCount(val) {
        this.cycle = val;
    }

    get halted() {
        return this.halt;
    }

    set halted(val) {
        this.halt = !!val;
    }

    get CF() { return !!this.get_CF(); }
    set CF(v) { this.cc_mask &= ~CF; if (v) this.flags |= CF; else this.flags &= ~CF; }

    get PF() { return !!this.get_PF(); }
    set PF(v) { this.cc_mask &= ~PF; if (v) this.flags |= PF; else this.flags &= ~PF; }

    get AF() { return !!this.get_AF(); }
    set AF(v) { this.cc_mask &= ~AF; if (v) this.flags |= AF; else this.flags &= ~AF; }

    get ZF() { return !!this.get_ZF(); }
    set ZF(v) { this.cc_mask &= ~ZF; if (v) this.flags |= ZF; else this.flags &= ~ZF; }

    get SF() { return !!this.get_SF(); }
    set SF(v) { this.cc_mask &= ~SF; if (v) this.flags |= SF; else this.flags &= ~SF; }

    get TF() { return !!(this.flags & TF); }
    set TF(v) { if (v) this.flags |= TF; else this.flags &= ~TF; }

    get IF() { return !!(this.flags & IF); }
    set IF(v) { if (v) this.flags |= IF; else this.flags &= ~IF; }

    get DF() { return !!(this.flags & DF); }
    set DF(v) { if (v) this.flags |= DF; else this.flags &= ~DF; }

    get OF() { return !!this.get_OF(); }
    set OF(v) { this.cc_mask &= ~OF; if (v) this.flags |= OF; else this.flags &= ~OF; }

    setSegment(segIdx, selector) {
        this.set_seg(segIdx, selector & 0xffff);
    }

    raiseIrq() {
        this.intr = true;
    }

    reset() {
        this.ram = this.bus.ram;
        this.ramView = this.bus.ramView;
        this.phys_mem_size = this.bus.ramSizeBytes;

        this.regs.fill(0);
        this.flags = 0x2;
        this.cpl = 0;
        this.code16 = true;
        this.sp_mask = 0xffff;
        this.halt = false;

        for (let i = 0; i < 8; i++) {
            this.seg[i].sel = 0;
            this.seg[i].base = 0;
            this.seg[i].limit = 0xffff;
            this.seg[i].flags = 0;
            this.segments[i] = 0;
        }

        this.ip = 0xfff0;
        this.next_ip = 0xfff0;
        this.seg[SEG_CS].sel = 0xf000;
        this.seg[SEG_CS].base = 0xf0000;
        this.segments[SEG_CS] = 0xf000;

        this.idt.base = 0;
        this.idt.limit = 0x3ff;
        this.gdt.base = 0;
        this.gdt.limit = 0;

        this.cr0 = this.fpu ? 0x10 : 0;
        this.cr2 = 0;
        this.cr3 = 0;
        this.dr.fill(0);

        this.cc_mask = 0;
        this.tlb_clear();
        this.excno = 0;
        this.excerr = 0;
        this.intr = false;

        this.sysenter.cs = 0;
        this.sysenter.eip = 0;
        this.sysenter.esp = 0;

        if (this.fpu) this.fpu.reset();
    }

    saveState() {
        return {
            regs: Array.from(this.regs),
            segments: Array.from(this.segments),
            seg: this.seg.map(s => ({ sel: s.sel, base: s.base, limit: s.limit, flags: s.flags })),
            idt: { base: this.idt.base, limit: this.idt.limit },
            gdt: { base: this.gdt.base, limit: this.gdt.limit },
            cr0: this.cr0,
            cr2: this.cr2,
            cr3: this.cr3,
            dr: Array.from(this.dr),
            ip: this.ip,
            next_ip: this.next_ip,
            flags: this.cpu_getflags(),
            cpl: this.cpl,
            code16: this.code16,
            sp_mask: this.sp_mask,
            halt: this.halt,
            cycle: this.cycle,
            intr: this.intr,
            sysenter: { cs: this.sysenter.cs, eip: this.sysenter.eip, esp: this.sysenter.esp },
            fpu: this.fpu ? this.fpu.saveState() : null
        };
    }

    loadState(state) {
        if (!state) return;
        if (state.regs) {
            for (let i = 0; i < 8; i++) this.regs[i] = state.regs[i] >>> 0;
        }
        if (state.segments) {
            for (let i = 0; i < 8; i++) this.segments[i] = state.segments[i] & 0xffff;
        }
        if (state.seg) {
            for (let i = 0; i < 8; i++) {
                this.seg[i].sel = state.seg[i].sel;
                this.seg[i].base = state.seg[i].base;
                this.seg[i].limit = state.seg[i].limit;
                this.seg[i].flags = state.seg[i].flags;
            }
        }
        if (state.idt) {
            this.idt.base = state.idt.base;
            this.idt.limit = state.idt.limit;
        }
        if (state.gdt) {
            this.gdt.base = state.gdt.base;
            this.gdt.limit = state.gdt.limit;
        }
        this.cr0 = state.cr0 >>> 0;
        this.cr2 = state.cr2 >>> 0;
        this.cr3 = state.cr3 >>> 0;
        if (state.dr) {
            for (let i = 0; i < 8; i++) this.dr[i] = state.dr[i] >>> 0;
        }
        this.ip = state.ip >>> 0;
        this.next_ip = state.next_ip >>> 0;
        this.cc_mask = 0;
        this.cc_op = 0;
        this.flags = state.flags >>> 0;
        this.cpl = state.cpl;
        this.code16 = !!state.code16;
        this.sp_mask = state.sp_mask;
        this.halt = !!state.halt;
        this.cycle = state.cycle || 0;
        this.intr = !!state.intr;
        if (state.sysenter) {
            this.sysenter.cs = state.sysenter.cs;
            this.sysenter.eip = state.sysenter.eip;
            this.sysenter.esp = state.sysenter.esp;
        }
        this.ifetch_laddr = 0xffffffff;
        this.ifetch_paddr = 0;
        this.tlb_clear();
        if (this.fpu && state.fpu) {
            this.fpu.loadState(state.fpu);
        }
    }

    resetPm(startAddr) {
        this.reset();
        this.cr0 = 1 | (this.fpu ? 0x10 : 0);
        this.seg[SEG_CS].sel = 0x8;
        this.seg[SEG_CS].base = 0;
        this.seg[SEG_CS].limit = 0xffffffff;
        this.seg[SEG_CS].flags = SEG_D_BIT;
        this.segments[SEG_CS] = 0x8;

        this.ip = startAddr >>> 0;
        this.next_ip = startAddr >>> 0;
        this.cpl = 0;
        this.code16 = false;
        this.sp_mask = 0xffffffff;

        for (const s of [SEG_SS, SEG_DS, SEG_ES]) {
            this.seg[s].sel = 0x10;
            this.seg[s].base = 0;
            this.seg[s].limit = 0xffffffff;
            this.seg[s].flags = SEG_B_BIT;
            this.segments[s] = 0x10;
        }
    }

    /* ======================================================================
     * REGISTER & PHYSICAL MEMORY HELPERS
     * ====================================================================== */

    lreg8(i) {
        return this.regs8[((i & 3) << 2) | (i >> 2)];
    }

    sreg8(i, v) {
        this.regs8[((i & 3) << 2) | (i >> 2)] = v & 0xff;
    }

    lreg16(i) {
        return this.regs16[i << 1];
    }

    sreg16(i, v) {
        this.regs16[i << 1] = v & 0xffff;
    }

    lreg32(i) {
        return this.regs[i];
    }

    sreg32(i, v) {
        this.regs[i] = v >>> 0;
    }

    lseg(i) {
        return this.seg[i].sel & 0xffff;
    }

    set_sp(v, mask) {
        this.regs[4] = (((v & mask) | (this.regs[4] & ~mask)) >>> 0);
    }

    pload8(addr) {
        return this.ram[addr >>> 0];
    }

    pstore8(addr, val) {
        this.ram[addr >>> 0] = val & 0xff;
    }

    pload16(addr) {
        return this.ramView.getUint16(addr >>> 0, true);
    }

    pstore16(addr, val) {
        this.ramView.setUint16(addr >>> 0, val & 0xffff, true);
    }

    pload32(addr) {
        return this.ramView.getUint32(addr >>> 0, true);
    }

    pstore32(addr, val) {
        this.ramView.setUint32(addr >>> 0, val >>> 0, true);
    }

    in_iomem(addr) {
        addr >>>= 0;
        return (addr >= 0xa0000 && addr < 0xc0000) || addr >= 0xe0000000;
    }

    load8(res) {
        const addr = res.addr1 >>> 0;
        if (this.in_iomem(addr)) {
            return this.bus.iomemRead8(addr);
        }
        if (addr >= this.phys_mem_size) return 0;
        return this.ram[addr];
    }

    load16(res) {
        const addr1 = res.addr1 >>> 0;
        if (this.in_iomem(addr1)) {
            return this.bus.iomemRead16(addr1);
        }
        if (addr1 >= this.phys_mem_size) return 0;
        if (res.res === ADDR_OK1) {
            return this.ramView.getUint16(addr1, true);
        }
        return this.ram[addr1] | (this.ram[res.addr2 >>> 0] << 8);
    }

    load32(res) {
        const addr1 = res.addr1 >>> 0;
        if (this.in_iomem(addr1)) {
            return this.bus.iomemRead32(addr1);
        }
        if (addr1 >= this.phys_mem_size) return 0;
        if (res.res === ADDR_OK1) {
            return this.ramView.getUint32(addr1, true);
        }
        const addr2 = res.addr2 >>> 0;
        switch (addr1 & 0xf) {
            case 0xf:
                return (this.ram[addr1] | (this.ramView.getUint16(addr2, true) << 8) | (this.ram[addr2 + 2] << 24)) >>> 0;
            case 0xe:
                return (this.ramView.getUint16(addr1, true) | (this.ramView.getUint16(addr2, true) << 16)) >>> 0;
            case 0xd:
                return (this.ram[addr1] | (this.ramView.getUint16(addr1 + 1, true) << 8) | (this.ram[addr2] << 24)) >>> 0;
        }
        return 0;
    }

    store8(res, val) {
        const addr = res.addr1 >>> 0;
        val &= 0xff;
        if (this.in_iomem(addr)) {
            this.bus.iomemWrite8(addr, val);
            return;
        }
        if (addr >= this.phys_mem_size) return;
        this.ram[addr] = val;
    }

    store16(res, val) {
        const addr1 = res.addr1 >>> 0;
        val &= 0xffff;
        if (this.in_iomem(addr1)) {
            this.bus.iomemWrite16(addr1, val);
            return;
        }
        if (addr1 >= this.phys_mem_size) return;
        if (res.res === ADDR_OK1) {
            this.ramView.setUint16(addr1, val, true);
        } else {
            this.ram[addr1] = val & 0xff;
            this.ram[res.addr2 >>> 0] = (val >>> 8) & 0xff;
        }
    }

    store32(res, val) {
        const addr1 = res.addr1 >>> 0;
        val >>>= 0;
        if (this.in_iomem(addr1)) {
            this.bus.iomemWrite32(addr1, val);
            return;
        }
        if (addr1 >= this.phys_mem_size) return;
        if (res.res === ADDR_OK1) {
            this.ramView.setUint32(addr1, val, true);
        } else {
            const addr2 = res.addr2 >>> 0;
            switch (addr1 & 0xf) {
                case 0xf:
                    this.ram[addr1] = val & 0xff;
                    this.ramView.setUint16(addr2, (val >>> 8) & 0xffff, true);
                    this.ram[addr2 + 2] = (val >>> 24) & 0xff;
                    break;
                case 0xe:
                    this.ramView.setUint16(addr1, val & 0xffff, true);
                    this.ramView.setUint16(addr2, (val >>> 16) & 0xffff, true);
                    break;
                case 0xd:
                    this.ram[addr1] = val & 0xff;
                    this.ramView.setUint16(addr1 + 1, (val >>> 8) & 0xffff, true);
                    this.ram[addr2] = (val >>> 24) & 0xff;
                    break;
            }
        }
    }

    cpu_load8(seg, addr) {
        const o = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        if (!this.translate8(o, 1, seg, addr)) return { ok: false, val: 0 };
        return { ok: true, val: this.load8(o) };
    }

    cpu_store8(seg, addr, val) {
        const o = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        if (!this.translate8(o, 2, seg, addr)) return false;
        this.store8(o, val);
        return true;
    }

    cpu_load16(seg, addr) {
        const o = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        if (!this.translate16(o, 1, seg, addr)) return { ok: false, val: 0 };
        return { ok: true, val: this.load16(o) };
    }

    cpu_store16(seg, addr, val) {
        const o = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        if (!this.translate16(o, 2, seg, addr)) return false;
        this.store16(o, val);
        return true;
    }

    cpu_load32(seg, addr) {
        const o = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        if (!this.translate32(o, 1, seg, addr)) return { ok: false, val: 0 };
        return { ok: true, val: this.load32(o) };
    }

    cpu_store32(seg, addr, val) {
        const o = { res: ADDR_OK1, addr1: 0, addr2: 0 };
        if (!this.translate32(o, 2, seg, addr)) return false;
        this.store32(o, val);
        return true;
    }

    /* ======================================================================
     * LAZY FLAGS & CPU STATUS HELPERS
     * ====================================================================== */

    get_CF() {
        if (this.cc_mask & CF) {
            const dst = this.cc_dst >>> 0;
            const src1 = this.cc_src1 >>> 0;
            const src2 = this.cc_src2 >>> 0;
            const dst2 = this.cc_dst2 >>> 0;
            switch (this.cc_op) {
                case CC_ADC: return dst <= src2 ? 1 : 0;
                case CC_ADD: return dst < src2 ? 1 : 0;
                case CC_SBB: return src1 <= src2 ? 1 : 0;
                case CC_SUB: return src1 < src2 ? 1 : 0;
                case CC_NEG8:
                case CC_NEG16:
                case CC_NEG32:
                    return dst !== 0 ? 1 : 0;
                case CC_IMUL8:
                    return sext8(dst) !== dst ? 1 : 0;
                case CC_IMUL16:
                    return sext16(dst) !== dst ? 1 : 0;
                case CC_IMUL32:
                    return ((dst | 0) >> 31) !== (dst2 | 0) ? 1 : 0;
                case CC_MUL8:
                    return (dst >>> 8) !== 0 ? 1 : 0;
                case CC_MUL16:
                    return (dst >>> 16) !== 0 ? 1 : 0;
                case CC_MUL32:
                    return dst2 !== 0 ? 1 : 0;
                case CC_SHL:
                case CC_SHR:
                case CC_SAR:
                case CC_SHRD:
                    return dst2 & 1;
                case CC_SHLD:
                    return (dst2 >>> 31) & 1;
                default:
                    return 0;
            }
        }
        return (this.flags & CF) ? 1 : 0;
    }

    get_PF() {
        if (this.cc_mask & PF) {
            return parity_tab[this.cc_dst & 0xff];
        }
        return (this.flags & PF) ? 1 : 0;
    }

    get_AF() {
        if (this.cc_mask & AF) {
            switch (this.cc_op) {
                case CC_ADC:
                case CC_ADD:
                case CC_SBB:
                case CC_SUB:
                    return ((this.cc_src1 ^ this.cc_src2 ^ this.cc_dst) >>> 4) & 1;
                case CC_NEG8:
                case CC_NEG16:
                case CC_NEG32:
                    return (this.cc_dst & 0xf) !== 0 ? 1 : 0;
                case CC_DEC8:
                case CC_DEC16:
                case CC_DEC32:
                    return (this.cc_dst & 0xf) === 0xf ? 1 : 0;
                case CC_INC8:
                case CC_INC16:
                case CC_INC32:
                    return (this.cc_dst & 0xf) === 0 ? 1 : 0;
                default:
                    return 0;
            }
        }
        return (this.flags & AF) ? 1 : 0;
    }

    get_ZF() {
        if (this.cc_mask & ZF) {
            return (this.cc_dst >>> 0) === 0 ? 1 : 0;
        }
        return (this.flags & ZF) ? 1 : 0;
    }

    get_SF() {
        if (this.cc_mask & SF) {
            return (this.cc_dst >>> 31) & 1;
        }
        return (this.flags & SF) ? 1 : 0;
    }

    get_OF() {
        if (this.cc_mask & OF) {
            const dst = this.cc_dst >>> 0;
            const src1 = this.cc_src1 >>> 0;
            const src2 = this.cc_src2 >>> 0;
            const dst2 = this.cc_dst2 >>> 0;
            switch (this.cc_op) {
                case CC_ADC:
                case CC_ADD:
                    return ((~(src1 ^ src2) & (dst ^ src2)) >>> 31) & 1;
                case CC_SBB:
                case CC_SUB:
                    return (((src1 ^ src2) & (dst ^ src1)) >>> 31) & 1;
                case CC_DEC8:
                    return dst === 0x0000007f ? 1 : 0;
                case CC_DEC16:
                    return dst === 0x00007fff ? 1 : 0;
                case CC_DEC32:
                    return dst === 0x7fffffff ? 1 : 0;
                case CC_INC8:
                case CC_NEG8:
                    return dst === 0xffffff80 ? 1 : 0;
                case CC_INC16:
                case CC_NEG16:
                    return dst === 0xffff8000 ? 1 : 0;
                case CC_INC32:
                case CC_NEG32:
                    return dst === 0x80000000 ? 1 : 0;
                case CC_IMUL8:
                case CC_IMUL16:
                case CC_IMUL32:
                case CC_MUL8:
                case CC_MUL16:
                case CC_MUL32:
                    return this.get_CF();
                case CC_SAR:
                    return 0;
                case CC_SHL:
                    return ((dst >>> 31) ^ (dst2 & 1)) & 1;
                case CC_SHR:
                    return (src1 >>> 31) & 1;
                case CC_SHLD:
                case CC_SHRD:
                    return ((src1 ^ dst) >>> 31) & 1;
                default:
                    return 0;
            }
        }
        return (this.flags & OF) ? 1 : 0;
    }

    refresh_flags() {
        let f = this.flags & ~(CF | PF | AF | ZF | SF | OF);
        if (this.get_CF()) f |= CF;
        if (this.get_PF()) f |= PF;
        if (this.get_AF()) f |= AF;
        if (this.get_ZF()) f |= ZF;
        if (this.get_SF()) f |= SF;
        if (this.get_OF()) f |= OF;
        this.flags = f >>> 0;
    }

    get_IOPL() {
        return (this.flags & IOPL) >>> 12;
    }

    cpu_setax(ax) {
        this.sreg16(0, ax);
    }

    cpu_getax() {
        return this.lreg16(0);
    }

    cpu_setexc(excno, excerr) {
        this.excno = excno;
        this.excerr = excerr >>> 0;
    }

    cpu_setflags(set_mask, clear_mask) {
        if (this.cc_mask & (set_mask | clear_mask)) {
            this.refresh_flags();
            this.cc_mask = 0;
        }
        this.flags = ((this.flags | set_mask) & ~clear_mask & this.flags_mask) >>> 0;
    }

    cpu_getflags() {
        if (this.cc_mask) {
            this.refresh_flags();
            this.cc_mask = 0;
        }
        return this.flags >>> 0;
    }

    /* ======================================================================
     * MMU & TLB TRANSLATION
     * ====================================================================== */

    tlb_clear() {
        for (let i = 0; i < TLB_SIZE; i++) {
            this.tlb_tab[i].lpgno = 0xffffffff;
        }
        this.ifetch_laddr = 0xffffffff;
        this.ifetch_paddr = 0;
    }

    tlb_refill(ent, lpgno) {
        const base_addr = (this.cr3 & ~0xfff) >>> 0;
        const i = (lpgno >>> 10) & 0x3ff;
        const j = lpgno & 0x3ff;

        const pde_addr = (base_addr + (i << 2)) >>> 0;
        const pde = this.pload32(pde_addr);
        if (!(pde & 1)) return false;
        this.ram[pde_addr] |= (1 << 5); // accessed

        const base_addr2 = (pde & ~0xfff) >>> 0;
        const pte_addr = (base_addr2 + (j << 2)) >>> 0;
        let pte = this.pload32(pte_addr);
        if (!(pte & 1)) return false;
        this.ram[pte_addr] |= (1 << 5); // accessed

        ent.lpgno = lpgno >>> 0;
        ent.xaddr = ((pte & ~0xfff) ^ (lpgno << 12)) >>> 0;
        pte = (pte & ((pde & 7) | 0xfffffff8)) >>> 0;
        ent.pte_lookup = pte_lookup[(this.cr0 & CR0_WP) ? 1 : 0][(pte >>> 1) & 3];
        ent.ppte_addr = pte_addr;
        return true;
    }

    translate_lpgno(rwm, lpgno, laddr, cpl) {
        lpgno >>>= 0;
        const ent = this.tlb_tab[lpgno & (TLB_SIZE - 1)];
        if (ent.lpgno !== lpgno) {
            if (!this.tlb_refill(ent, lpgno)) {
                this.cr2 = laddr >>> 0;
                this.excno = EX_PF;
                this.excerr = ((rwm & 2) ? 2 : 0) | (cpl ? 4 : 0);
                return -1;
            }
        }
        if (ent.pte_lookup[cpl > 0 ? 1 : 0][rwm > 1 ? 1 : 0]) {
            this.cr2 = laddr >>> 0;
            this.excno = EX_PF;
            this.excerr = 1 | ((rwm & 2) ? 2 : 0) | (cpl ? 4 : 0);
            ent.lpgno = 0xffffffff;
            return -1;
        }
        if (rwm & 2) {
            this.ram[ent.ppte_addr] |= (1 << 6); // dirty
        }
        return (ent.xaddr ^ laddr) >>> 0;
    }

    translate_laddr(res, rwm, laddr, size, cpl) {
        laddr >>>= 0;
        if (this.cr0 & CR0_PG) {
            let lpgno = laddr >>> 12;
            let paddr = this.translate_lpgno(rwm, lpgno, laddr, cpl);
            if (paddr === -1) return false;
            res.res = ADDR_OK1;
            res.addr1 = paddr;
            if ((laddr & 0xfff) > 0x1000 - size) {
                lpgno = (lpgno + 1) >>> 0;
                paddr = this.translate_lpgno(rwm, lpgno, (lpgno << 12) >>> 0, cpl);
                if (paddr === -1) return false;
                res.res = ADDR_OK2;
                res.addr2 = paddr;
            }
        } else {
            res.res = ADDR_OK1;
            res.addr1 = laddr;
        }
        return true;
    }

    segcheck(rwm, seg, addr, size) {
        if (this.cr0 & 1) {
            if (this.seg[seg].limit === 0 && (this.seg[seg].sel & ~0x3) === 0) {
                this.excno = EX_GP;
                this.excerr = 0;
                return false;
            }
        }
        return true;
    }

    translate(res, rwm, seg, addr, size, cpl) {
        const laddr = (this.seg[seg].base + (addr >>> 0)) >>> 0;
        if (!this.segcheck(rwm, seg, addr, size)) return false;
        return this.translate_laddr(res, rwm, laddr, size, cpl);
    }

    translate8r(res, seg, addr) {
        const laddr = (this.seg[seg].base + (addr >>> 0)) >>> 0;
        if (!this.segcheck(1, seg, addr, 1)) return false;
        if (this.cr0 & CR0_PG) {
            const lpgno = laddr >>> 12;
            const ent = this.tlb_tab[lpgno & (TLB_SIZE - 1)];
            if (ent.lpgno !== lpgno) {
                if (!this.tlb_refill(ent, lpgno)) {
                    this.cr2 = laddr;
                    this.excno = EX_PF;
                    this.excerr = this.cpl ? 4 : 0;
                    return false;
                }
            }
            if (ent.pte_lookup[this.cpl > 0 ? 1 : 0][0]) {
                this.cr2 = laddr;
                this.excno = EX_PF;
                this.excerr = 1 | (this.cpl ? 4 : 0);
                ent.lpgno = 0xffffffff;
                return false;
            }
            res.res = ADDR_OK1;
            res.addr1 = (ent.xaddr ^ laddr) >>> 0;
        } else {
            res.res = ADDR_OK1;
            res.addr1 = laddr;
        }
        return true;
    }

    translate8(res, rwm, seg, addr) {
        return this.translate(res, rwm, seg, addr, 1, this.cpl);
    }

    translate16(res, rwm, seg, addr) {
        return this.translate(res, rwm, seg, addr, 2, this.cpl);
    }

    translate32(res, rwm, seg, addr) {
        return this.translate(res, rwm, seg, addr, 4, this.cpl);
    }

    /* ======================================================================
     * INSTRUCTION STREAM FETCH & MODRM / SIB DECODING
     * ====================================================================== */

    peek8() {
        const laddr = (this.seg[SEG_CS].base + this.next_ip) >>> 0;
        if (((laddr ^ this.ifetch_laddr) >>> 0) < 4096) {
            return this.ram[(this.ifetch_xaddr ^ laddr) >>> 0];
        }
        const res = this._meml8;
        if (!this.translate8r(res, SEG_CS, this.next_ip)) return -1;
        const paddr = res.addr1 >>> 0;
        if (this.in_iomem(paddr)) {
            return this.bus.iomemRead8(paddr);
        }
        if (paddr >= this.phys_mem_size) return 0;
        const val = this.ram[paddr];
        if (paddr < this.phys_mem_size - 4096 && !this.in_iomem((paddr + 16) >>> 0)) {
            this.ifetch_laddr = (laddr & ~0xfff) >>> 0;
            this.ifetch_xaddr = (paddr ^ laddr) >>> 0;
        }
        return val;
    }

    peek8a() {
        if (this.ifetch_paddr) {
            return this.ram[this.ifetch_paddr];
        }
        return this.peek8();
    }

    fetch8() {
        if (this.ifetch_paddr) {
            const val = this.ram[this.ifetch_paddr];
            this.ifetch_paddr = (this.ifetch_paddr + 1) >>> 0;
            this.next_ip = (this.next_ip + 1) >>> 0;
            return val;
        }
        const val = this.peek8();
        if (val === -1) return -1;
        this.next_ip = (this.next_ip + 1) >>> 0;
        return val;
    }

    fetch8pf() {
        const laddr = (this.seg[SEG_CS].base + this.next_ip) >>> 0;
        if (((laddr ^ this.ifetch_laddr) >>> 0) < 4096 - 16) {
            const paddr = (this.ifetch_xaddr ^ laddr) >>> 0;
            const val = this.ram[paddr];
            this.ifetch_paddr = (paddr + 1) >>> 0;
            this.next_ip = (this.next_ip + 1) >>> 0;
            return val;
        }
        this.ifetch_paddr = 0;
        const val = this.peek8();
        if (val === -1) return -1;
        this.next_ip = (this.next_ip + 1) >>> 0;
        return val;
    }

    fetch16() {
        if (this.ifetch_paddr) {
            const val = this.ramView.getUint16(this.ifetch_paddr, true);
            this.ifetch_paddr = (this.ifetch_paddr + 2) >>> 0;
            this.next_ip = (this.next_ip + 2) >>> 0;
            return val;
        }
        const laddr = (this.seg[SEG_CS].base + this.next_ip) >>> 0;
        let val;
        if (((laddr ^ this.ifetch_laddr) >>> 0) < 4095) {
            val = this.ramView.getUint16((this.ifetch_xaddr ^ laddr) >>> 0, true);
        } else {
            const res = this._meml8;
            if (!this.translate16(res, 1, SEG_CS, this.next_ip)) return -1;
            val = this.load16(res);
        }
        this.next_ip = (this.next_ip + 2) >>> 0;
        return val;
    }

    fetch32() {
        if (this.ifetch_paddr) {
            const val = this.ramView.getUint32(this.ifetch_paddr, true);
            this.ifetch_paddr = (this.ifetch_paddr + 4) >>> 0;
            this.next_ip = (this.next_ip + 4) >>> 0;
            return val;
        }
        const laddr = (this.seg[SEG_CS].base + this.next_ip) >>> 0;
        let val;
        if (((laddr ^ this.ifetch_laddr) >>> 0) < 4093) {
            val = this.ramView.getUint32((this.ifetch_xaddr ^ laddr) >>> 0, true);
        } else {
            const res = this._meml8;
            if (!this.translate32(res, 1, SEG_CS, this.next_ip)) return -1;
            val = this.load32(res);
        }
        this.next_ip = (this.next_ip + 4) >>> 0;
        return val;
    }

    modsib32(mod, rm, curr_seg) {
        let addr = 0;
        if (rm === 4) {
            const sib = this.fetch8();
            if (sib === -1) return null;
            const b = sib & 7;
            if (b === 5 && mod === 0) {
                const d32 = this.fetch32();
                if (d32 === -1) return null;
                addr = d32;
            } else {
                addr = this.regs[b];
                if ((b === 4 || b === 5) && curr_seg === -1) {
                    curr_seg = SEG_SS;
                }
            }
            const idx = (sib >>> 3) & 7;
            if (idx !== 4) {
                addr = (addr + (this.regs[idx] << (sib >>> 6))) >>> 0;
            }
        } else if (rm === 5 && mod === 0) {
            const d32 = this.fetch32();
            if (d32 === -1) return null;
            addr = d32;
        } else {
            addr = this.regs[rm];
            if (rm === 5 && curr_seg === -1) {
                curr_seg = SEG_SS;
            }
        }
        if (mod === 1) {
            const imm8 = this.fetch8();
            if (imm8 === -1) return null;
            addr = (addr + ((imm8 << 24) >> 24)) >>> 0;
        } else if (mod === 2) {
            const imm32 = this.fetch32();
            if (imm32 === -1) return null;
            addr = (addr + (imm32 | 0)) >>> 0;
        }
        if (curr_seg === -1) curr_seg = SEG_DS;
        return { addr: addr >>> 0, seg: curr_seg };
    }

    modsib16(mod, rm, curr_seg) {
        let addr = 0;
        if (rm === 6 && mod === 0) {
            const imm16 = this.fetch16();
            if (imm16 === -1) return null;
            addr = imm16;
        } else {
            switch (rm) {
                case 0: addr = this.regs[3] + this.regs[6]; break;
                case 1: addr = this.regs[3] + this.regs[7]; break;
                case 2: addr = this.regs[5] + this.regs[6]; break;
                case 3: addr = this.regs[5] + this.regs[7]; break;
                case 4: addr = this.regs[6]; break;
                case 5: addr = this.regs[7]; break;
                case 6: addr = this.regs[5]; break;
                case 7: addr = this.regs[3]; break;
            }
            if (mod === 1) {
                const imm8 = this.fetch8();
                if (imm8 === -1) return null;
                addr += ((imm8 << 24) >> 24);
            } else if (mod === 2) {
                const imm16 = this.fetch16();
                if (imm16 === -1) return null;
                addr += imm16;
            }
            addr &= 0xffff;
        }
        if (curr_seg === -1) {
            if (rm === 2 || rm === 3 || (mod !== 0 && rm === 6)) {
                curr_seg = SEG_SS;
            } else {
                curr_seg = SEG_DS;
            }
        }
        return { addr: addr >>> 0, seg: curr_seg };
    }

    modsib(adsz16, mod, rm, curr_seg) {
        return adsz16 ? this.modsib16(mod, rm, curr_seg) : this.modsib32(mod, rm, curr_seg);
    }

    /* ======================================================================
     * SEGMENT DESCRIPTORS, PRIVILEGE & PROTECTED MODE HELPERS
     * ====================================================================== */

    read_desc(sel, needW1 = true) {
        sel &= 0xffff;
        const off = (sel & ~0x7) >>> 0;
        let base, limit;
        if (sel & 0x4) {
            base = this.seg[SEG_LDT].base;
            limit = this.seg[SEG_LDT].limit;
        } else {
            base = this.gdt.base;
            limit = this.gdt.limit;
        }

        if (off + 7 > limit) {
            this.excno = EX_GP;
            this.excerr = sel & ~0x3;
            return null;
        }
        let w1 = 0;
        const meml = this._meml7;
        if (needW1) {
            if (!this.translate_laddr(meml, 1, (base + off) >>> 0, 4, 0)) return null;
            w1 = this.load32(meml);
        }
        if (!this.translate_laddr(meml, 1, (base + off + 4) >>> 0, 4, 0)) return null;
        const w2 = this.load32(meml);
        return { w1, w2 };
    }

    set_seg(seg, sel) {
        sel &= 0xffff;
        if (!(this.cr0 & 1) || (this.flags & VM)) {
            this.seg[seg].sel = sel;
            this.seg[seg].base = (sel << 4) >>> 0;
            this.seg[seg].limit = 0xffff;
            this.seg[seg].flags = 0;
            this.segments[seg] = sel;
            if (seg === SEG_CS) {
                this.cpl = (this.flags & VM) ? 3 : 0;
                this.code16 = true;
            }
            if (seg === SEG_SS) {
                this.sp_mask = 0xffff;
            }
            return true;
        }

        const desc = this.read_desc(sel, true);
        if (!desc) return false;
        const { w1, w2 } = desc;

        const s = (w2 >>> 12) & 1;
        const p = (w2 >>> 15) & 1;
        if (sel & ~0x3) {
            if (seg === SEG_DS || seg === SEG_ES || seg === SEG_FS || seg === SEG_GS) {
                if (!s) {
                    this.excno = EX_GP;
                    this.excerr = sel & ~0x3;
                    return false;
                }
            }
            if (!p) {
                this.excno = (seg === SEG_SS) ? EX_SS : EX_NP;
                this.excerr = sel & ~0x3;
                return false;
            }
        }

        this.seg[seg].sel = sel;
        this.segments[seg] = sel;
        this.seg[seg].base = ((w1 >>> 16) | ((w2 & 0xff) << 16) | (w2 & 0xff000000)) >>> 0;
        let limit = ((w2 & 0xf0000) | (w1 & 0xffff)) >>> 0;
        if (w2 & 0x00800000) {
            limit = ((limit << 12) | 0xfff) >>> 0;
        }
        this.seg[seg].limit = limit;
        this.seg[seg].flags = (w2 >>> 8) & 0xffff;

        if (seg === SEG_CS) {
            this.cpl = sel & 3;
            this.code16 = !(this.seg[SEG_CS].flags & SEG_D_BIT);
        }
        if (seg === SEG_SS) {
            this.sp_mask = (this.seg[SEG_SS].flags & SEG_B_BIT) ? 0xffffffff : 0xffff;
        }
        return true;
    }

    clear_segs() {
        const segs = [SEG_DS, SEG_ES, SEG_FS, SEG_GS];
        for (let i = 0; i < 4; i++) {
            const s = segs[i];
            const w2 = (this.seg[s].flags << 8) >>> 0;
            const is_dataseg = !((w2 >>> 11) & 1);
            const dpl = (w2 >>> 13) & 0x3;
            const conforming = (w2 >>> 8) & 0x4;
            if (is_dataseg || !conforming) {
                if (dpl < this.cpl) {
                    this.seg[s].sel = 0;
                    this.seg[s].base = 0;
                    this.seg[s].limit = 0;
                    this.seg[s].flags = 0;
                    this.segments[s] = 0;
                }
            }
        }
    }

    check_ioperm(port, bit) {
        port &= 0xffff;
        let allow = true;
        if ((this.cr0 & 1) && (this.cpl > this.get_IOPL() || (this.flags & VM))) {
            allow = false;
            if (this.seg[SEG_TR].limit >= 103) {
                const meml = this._meml7;
                if (!this.translate(meml, 1, SEG_TR, 102, 2, 0)) return false;
                const iobase = this.load16(meml);
                if (iobase + (port >>> 3) < this.seg[SEG_TR].limit) {
                    if (!this.translate(meml, 1, SEG_TR, iobase + (port >>> 3), 2, 0)) return false;
                    const perm = this.load16(meml);
                    const len = bit >>> 3;
                    const bit_index = port & 0x7;
                    const mask = (1 << len) - 1;
                    if (!((perm >>> bit_index) & mask)) {
                        allow = true;
                    }
                }
            }
        }
        if (!allow) {
            this.excno = EX_GP;
            this.excerr = 0;
            return false;
        }
        return true;
    }

    /* ======================================================================
     * TASK SWITCHING, PROTECTED MODE CALL/RET, INTERRUPTS & IRET
     * ====================================================================== */

    task_switch(tss, sw_type) {
        const meml = this._meml7;
        const oldtss = this.seg[SEG_TR].sel;

        if (!this.translate(meml, 2, SEG_TR, 0x20, 4, 0)) return false;
        this.store32(meml, this.next_ip);

        this.refresh_flags();
        if (!this.translate(meml, 2, SEG_TR, 0x24, 4, 0)) return false;
        if (sw_type === TS_IRET) {
            this.store32(meml, (this.flags & ~NT) >>> 0);
        } else {
            this.store32(meml, this.flags >>> 0);
        }

        for (let i = 0; i < 8; i++) {
            if (!this.translate(meml, 2, SEG_TR, 0x28 + 4 * i, 4, 0)) return false;
            this.store32(meml, this.regs[i]);
        }

        for (let i = 0; i < 6; i++) {
            if (!this.translate(meml, 2, SEG_TR, 0x48 + 4 * i, 4, 0)) return false;
            this.store32(meml, this.seg[i].sel);
        }

        if (sw_type === TS_JMP || sw_type === TS_IRET) {
            const addr = (this.gdt.base + (this.seg[SEG_TR].sel & ~0x7)) >>> 0;
            if (!this.translate_laddr(meml, 3, (addr + 4) >>> 0, 4, 0)) return false;
            this.store32(meml, (this.load32(meml) & ~(1 << 9)) >>> 0);
        }

        if (!this.set_seg(SEG_TR, tss)) return false;

        if (sw_type === TS_JMP || sw_type === TS_CALL) {
            const addr = (this.gdt.base + (tss & ~0x7)) >>> 0;
            if (!this.translate_laddr(meml, 3, (addr + 4) >>> 0, 4, 0)) return false;
            this.store32(meml, (this.load32(meml) | (1 << 9)) >>> 0);
            this.seg[SEG_TR].flags |= 2;
        }

        this.cr0 = (this.cr0 | (1 << 3)) >>> 0; // set TS bit

        if (!this.translate(meml, 1, SEG_TR, 0x60, 4, 0)) return false;
        if (!this.set_seg(SEG_LDT, this.load32(meml))) return false;

        for (let i = 0; i < 8; i++) {
            if (!this.translate(meml, 1, SEG_TR, 0x28 + 4 * i, 4, 0)) return false;
            this.regs[i] = this.load32(meml);
        }

        for (let i = 0; i < 6; i++) {
            if (!this.translate(meml, 1, SEG_TR, 0x48 + 4 * i, 4, 0)) return false;
            if (!this.set_seg(i, this.load32(meml))) return false;
        }

        if (!this.translate(meml, 1, SEG_TR, 0x20, 4, 0)) return false;
        this.next_ip = this.load32(meml);

        if (!this.translate(meml, 1, SEG_TR, 0x24, 4, 0)) return false;
        this.flags = ((this.load32(meml) & this.flags_mask) | 0x2) >>> 0;
        this.cc_mask = 0;

        if (sw_type === TS_CALL) {
            if (!this.translate(meml, 2, SEG_TR, 0, 4, 0)) return false;
            this.store32(meml, oldtss);
            this.flags = (this.flags | NT) >>> 0;
        }

        if (!this.translate(meml, 1, SEG_TR, 0x1c, 4, 0)) return false;
        this.cr3 = this.load32(meml);
        this.tlb_clear();
        return true;
    }

    pmcall(opsz16, addr, sel, isjmp) {
        sel &= 0xffff;
        let sp_mask = (this.seg[SEG_SS].flags & SEG_B_BIT) ? 0xffffffff : 0xffff;

        if ((sel & ~0x3) === 0) {
            this.excno = EX_GP;
            this.excerr = 0;
            return false;
        }

        const desc = this.read_desc(sel, true);
        if (!desc) return false;
        const { w1, w2 } = desc;

        const s = (w2 >>> 12) & 1;
        const dpl = (w2 >>> 13) & 0x3;
        const p = (w2 >>> 15) & 1;
        if (!p) {
            this.excno = EX_NP;
            this.excerr = sel & ~0x3;
            return false;
        }

        if (s) {
            const code = (w2 >>> 8) & 0x8;
            const conforming = (w2 >>> 8) & 0x4;
            if (!code) {
                this.excno = EX_GP;
                this.excerr = sel & ~0x3;
                return false;
            }
            if (conforming) {
                if (dpl > this.cpl) {
                    this.excno = EX_GP;
                    this.excerr = sel & ~0x3;
                    return false;
                }
                sel = (sel & 0xfffc) | this.cpl;
            } else {
                if ((sel & 0x3) > this.cpl || dpl !== this.cpl) {
                    this.excno = EX_GP;
                    this.excerr = sel & ~0x3;
                    return false;
                }
                sel = (sel & 0xfffc) | this.cpl;
            }

            if (!isjmp) {
                const meml1 = this._meml1;
                const meml2 = this._meml2;
                const sp = this.regs[4];
                if (opsz16) {
                    if (!this.translate(meml1, 2, SEG_SS, (sp - 2) & sp_mask, 2, 0)) return false;
                    if (!this.translate(meml2, 2, SEG_SS, (sp - 4) & sp_mask, 2, 0)) return false;
                    this.set_sp(sp - 4, sp_mask);
                    this.store16(meml1, this.seg[SEG_CS].sel);
                    this.store16(meml2, this.next_ip);
                } else {
                    if (!this.translate(meml1, 2, SEG_SS, (sp - 4) & sp_mask, 4, 0)) return false;
                    if (!this.translate(meml2, 2, SEG_SS, (sp - 8) & sp_mask, 4, 0)) return false;
                    this.set_sp(sp - 8, sp_mask);
                    this.store32(meml1, this.seg[SEG_CS].sel);
                    this.store32(meml2, this.next_ip);
                }
            }
            if (!this.set_seg(SEG_CS, sel)) return false;
            this.next_ip = addr >>> 0;
        } else {
            let newcs = w1 >>> 16;
            let newip = ((w1 & 0xffff) | (w2 & 0xffff0000)) >>> 0;
            const gt = (w2 >>> 8) & 0xf;
            const wc = w2 & 31;

            if (dpl < this.cpl || dpl < (sel & 3)) {
                this.excno = EX_GP;
                this.excerr = sel & ~0x3;
                return false;
            }

            const tr_type = this.seg[SEG_TR].flags & 0xf;
            if (tr_type === 9 || tr_type === 11) {
                if (gt === 9) {
                    return this.task_switch(sel, isjmp ? TS_JMP : TS_CALL);
                }
                if (gt === 5) {
                    return this.task_switch(newcs, isjmp ? TS_JMP : TS_CALL);
                }
            }

            if (gt !== 4 && gt !== 12) {
                this.excno = EX_GP;
                this.excerr = sel & ~0x3;
                return false;
            }

            if ((newcs & ~0x3) === 0) {
                this.excno = EX_GP;
                this.excerr = 0;
                return false;
            }
            const newDesc = this.read_desc(newcs, false);
            if (!newDesc) return false;
            const neww2 = newDesc.w2;

            if (((neww2 >>> 11) & 0x3) !== 0x3) {
                this.excno = EX_GP;
                this.excerr = newcs & ~0x3;
                return false;
            }

            const newdpl = (neww2 >>> 13) & 0x3;
            const newp = (neww2 >>> 15) & 1;
            if (!newp) {
                this.excno = EX_NP;
                this.excerr = newcs & ~0x3;
                return false;
            }
            if (newdpl > this.cpl) {
                this.excno = EX_GP;
                this.excerr = newcs & ~0x3;
                return false;
            }

            const conforming = (neww2 >>> 8) & 0x4;
            const gate16 = (gt === 4);
            if (gate16) newip &= 0xffff;

            if (!conforming && newdpl < this.cpl) {
                const msp0 = this._meml5;
                const mss0 = this._meml6;
                const oldss = this.seg[SEG_SS].sel;
                const oldsp = this.regs[4];
                const params = new Uint32Array(31);
                sp_mask = (this.seg[SEG_SS].flags & SEG_B_BIT) ? 0xffffffff : 0xffff;

                if (!gate16) {
                    for (let i = 0; i < wc; i++) {
                        const meml = this._meml7;
                        if (!this.translate(meml, 1, SEG_SS, (oldsp + 4 * i) & sp_mask, 4, 0)) return false;
                        params[i] = this.load32(meml);
                    }
                } else {
                    for (let i = 0; i < wc; i++) {
                        const meml = this._meml7;
                        if (!this.translate(meml, 1, SEG_SS, (oldsp + 2 * i) & sp_mask, 2, 0)) return false;
                        params[i] = this.load16(meml);
                    }
                }

                if (!(this.seg[SEG_TR].flags & 0x8)) {
                    if (!this.translate(msp0, 1, SEG_TR, 2 + 4 * newdpl, 2, 0)) return false;
                    if (!this.translate(mss0, 1, SEG_TR, 4 + 4 * newdpl, 2, 0)) return false;
                    this.regs[4] = this.load16(msp0);
                    if (!this.set_seg(SEG_SS, this.load16(mss0))) return false;
                } else {
                    if (!this.translate(msp0, 1, SEG_TR, 4 + 8 * newdpl, 4, 0)) return false;
                    if (!this.translate(mss0, 1, SEG_TR, 8 + 8 * newdpl, 4, 0)) return false;
                    this.regs[4] = this.load32(msp0);
                    if (!this.set_seg(SEG_SS, this.load32(mss0))) return false;
                }
                sp_mask = (this.seg[SEG_SS].flags & SEG_B_BIT) ? 0xffffffff : 0xffff;

                if (!isjmp) {
                    const meml1 = this._meml1;
                    const meml2 = this._meml2;
                    const meml3 = this._meml3;
                    const meml4 = this._meml4;
                    const sp = this.regs[4];
                    if (!gate16) {
                        if (!this.translate(meml1, 2, SEG_SS, (sp - 4 * 1) & sp_mask, 4, 0)) return false;
                        if (!this.translate(meml2, 2, SEG_SS, (sp - 4 * 2) & sp_mask, 4, 0)) return false;
                        if (!this.translate(meml3, 2, SEG_SS, (sp - 4 * (3 + wc)) & sp_mask, 4, 0)) return false;
                        if (!this.translate(meml4, 2, SEG_SS, (sp - 4 * (4 + wc)) & sp_mask, 4, 0)) return false;

                        for (let i = 0; i < wc; i++) {
                            const meml = this._meml7;
                            if (!this.translate(meml, 2, SEG_SS, (sp - 4 * (2 + wc - i)) & sp_mask, 4, 0)) return false;
                            this.store32(meml, params[i]);
                        }
                        this.store32(meml1, oldss);
                        this.store32(meml2, oldsp);
                        this.store32(meml3, this.seg[SEG_CS].sel);
                        this.store32(meml4, this.next_ip);
                        this.set_sp(sp - 4 * (4 + wc), sp_mask);
                    } else {
                        if (!this.translate(meml1, 2, SEG_SS, (sp - 2 * 1) & sp_mask, 2, 0)) return false;
                        if (!this.translate(meml2, 2, SEG_SS, (sp - 2 * 2) & sp_mask, 2, 0)) return false;
                        if (!this.translate(meml3, 2, SEG_SS, (sp - 2 * (3 + wc)) & sp_mask, 2, 0)) return false;
                        if (!this.translate(meml4, 2, SEG_SS, (sp - 2 * (4 + wc)) & sp_mask, 2, 0)) return false;

                        for (let i = 0; i < wc; i++) {
                            const meml = this._meml7;
                            if (!this.translate(meml, 2, SEG_SS, (sp - 2 * (2 + wc - i)) & sp_mask, 2, 0)) return false;
                            this.store16(meml, params[i]);
                        }
                        this.store16(meml1, oldss);
                        this.store16(meml2, oldsp);
                        this.store16(meml3, this.seg[SEG_CS].sel);
                        this.store16(meml4, this.next_ip);
                        this.set_sp(sp - 2 * (4 + wc), sp_mask);
                    }
                }
                newcs = (newcs & 0xfffc) | newdpl;
            } else {
                if (!isjmp) {
                    const meml1 = this._meml1;
                    const meml2 = this._meml2;
                    const sp = this.regs[4];
                    sp_mask = (this.seg[SEG_SS].flags & SEG_B_BIT) ? 0xffffffff : 0xffff;
                    if (gate16) {
                        if (!this.translate(meml1, 2, SEG_SS, (sp - 2) & sp_mask, 2, 0)) return false;
                        if (!this.translate(meml2, 2, SEG_SS, (sp - 4) & sp_mask, 2, 0)) return false;
                        this.store16(meml1, this.seg[SEG_CS].sel);
                        this.store16(meml2, this.next_ip);
                        this.set_sp(sp - 4, sp_mask);
                    } else {
                        if (!this.translate(meml1, 2, SEG_SS, (sp - 4) & sp_mask, 4, 0)) return false;
                        if (!this.translate(meml2, 2, SEG_SS, (sp - 8) & sp_mask, 4, 0)) return false;
                        this.store32(meml1, this.seg[SEG_CS].sel);
                        this.store32(meml2, this.next_ip);
                        this.set_sp(sp - 8, sp_mask);
                    }
                }
                newcs = (newcs & 0xfffc) | this.cpl;
            }

            if (!this.set_seg(SEG_CS, newcs)) return false;
            this.next_ip = newip >>> 0;
        }
        return true;
    }

    __call_isr_check_cs(sel, ext) {
        sel &= 0xffff;
        const off = (sel & ~0x7) >>> 0;
        let base, limit;
        if (sel & 0x4) {
            base = this.seg[SEG_LDT].base;
            limit = this.seg[SEG_LDT].limit;
        } else {
            base = this.gdt.base;
            limit = this.gdt.limit;
        }
        if ((sel & ~0x3) === 0 || off + 7 > limit) {
            this.excno = EX_GP;
            this.excerr = ext;
            return { mode: 0, csdpl: 0 };
        }

        const meml = this._meml7;
        if (!this.translate_laddr(meml, 1, (base + off + 4) >>> 0, 4, 0)) {
            return { mode: 0, csdpl: 0 };
        }
        const w2 = this.load32(meml);
        const s = (w2 >>> 12) & 1;
        const code = (w2 >>> 8) & 0x8;
        const conforming = (w2 >>> 8) & 0x4;
        const dpl = (w2 >>> 13) & 0x3;
        const p = (w2 >>> 15) & 1;

        if (!s || !code || dpl > this.cpl) {
            this.excno = EX_GP;
            this.excerr = (sel & ~0x3) | ext;
            return { mode: 0, csdpl: dpl };
        }

        if (!p) {
            this.excno = EX_NP;
            this.excerr = sel & ~0x3;
            return { mode: 0, csdpl: dpl };
        }

        if (!conforming && dpl < this.cpl) {
            if (!(this.flags & VM)) {
                return { mode: 2, csdpl: dpl };
            }
            if (dpl !== 0) {
                this.excno = EX_GP;
                this.excerr = (sel & ~0x3) | ext;
                return { mode: 0, csdpl: dpl };
            }
            return { mode: 3, csdpl: dpl };
        } else {
            if (this.flags & VM) {
                this.excno = EX_GP;
                this.excerr = (sel & ~0x3) | ext;
                return { mode: 0, csdpl: dpl };
            }
            if (conforming || dpl === this.cpl) {
                return { mode: 1, csdpl: dpl };
            }
            this.excno = EX_GP;
            this.excerr = (sel & ~0x3) | ext;
            return { mode: 0, csdpl: dpl };
        }
    }

    call_isr(no, pusherr, ext) {
        if (!(this.cr0 & 1)) {
            /* REAL-ADDRESS-MODE */
            const sp_mask = (this.seg[SEG_SS].flags & SEG_B_BIT) ? 0xffffffff : 0xffff;
            const meml = this._meml7;
            const base = this.idt.base;
            const off = no * 4;
            if (!this.translate_laddr(meml, 1, (base + off) >>> 0, 4, 0)) return false;
            const w1 = this.load32(meml);
            const newcs = w1 >>> 16;
            const newip = w1 & 0xffff;

            const meml1 = this._meml1;
            const meml2 = this._meml2;
            const meml3 = this._meml3;
            const sp = this.regs[4];
            if (!this.translate(meml1, 2, SEG_SS, (sp - 2) & sp_mask, 2, 0)) return false;
            if (!this.translate(meml2, 2, SEG_SS, (sp - 4) & sp_mask, 2, 0)) return false;
            if (!this.translate(meml3, 2, SEG_SS, (sp - 6) & sp_mask, 2, 0)) return false;
            this.refresh_flags();
            this.cc_mask = 0;
            this.store16(meml1, this.flags);
            this.store16(meml2, this.seg[SEG_CS].sel);
            this.store16(meml3, this.ip);
            this.regs[4] = ((sp - 6) & sp_mask) >>> 0;

            if (!this.set_seg(SEG_CS, newcs)) return false;
            this.next_ip = newip;
            this.ip = newip;
            this.flags = (this.flags & ~(IF | TF)) >>> 0;
            return true;
        }

        /* PROTECTED-MODE */
        const meml = this._meml7;
        const base = this.idt.base;
        const off = no << 3;
        if (off + 7 > this.idt.limit) {
            this.excno = EX_GP;
            this.excerr = off | 2 | ext;
            return false;
        }

        if (!this.translate_laddr(meml, 1, (base + off) >>> 0, 4, 0)) return false;
        const w1 = this.load32(meml);
        if (!this.translate_laddr(meml, 1, (base + off + 4) >>> 0, 4, 0)) return false;
        const w2 = this.load32(meml);

        const gt = (w2 >>> 8) & 0xf;
        if (gt !== 6 && gt !== 7 && gt !== 0xe && gt !== 0xf && gt !== 5) {
            this.excno = EX_GP;
            this.excerr = off | 2 | ext;
            return false;
        }

        const dpl = (w2 >>> 13) & 0x3;
        if (!ext && dpl < this.cpl) {
            this.excno = EX_GP;
            this.excerr = off | 2;
            return false;
        }

        const p = (w2 >>> 15) & 1;
        if (!p) {
            this.excno = EX_NP;
            this.excerr = off | 2 | ext;
            return false;
        }

        if (gt === 5) {
            return this.task_switch(w1 >>> 16, TS_CALL);
        }

        let newcs = w1 >>> 16;
        let newip = ((w1 & 0xffff) | (w2 & 0xffff0000)) >>> 0;
        const gate16 = (gt === 6 || gt === 7);
        if (gate16) newip &= 0xffff;

        const chk = this.__call_isr_check_cs(newcs, ext);
        const csdpl = chk.csdpl;
        switch (chk.mode) {
            case 0:
                return false;
            case 1: {
                /* intra PVL */
                const meml1 = this._meml1;
                const meml2 = this._meml2;
                const meml3 = this._meml3;
                const meml4 = this._meml4;
                const sp = this.regs[4];
                const sp_mask = (this.seg[SEG_SS].flags & SEG_B_BIT) ? 0xffffffff : 0xffff;
                if (gate16) {
                    if (!this.translate(meml1, 2, SEG_SS, (sp - 2) & sp_mask, 2, 0)) return false;
                    if (!this.translate(meml2, 2, SEG_SS, (sp - 4) & sp_mask, 2, 0)) return false;
                    if (!this.translate(meml3, 2, SEG_SS, (sp - 6) & sp_mask, 2, 0)) return false;
                    if (pusherr) {
                        if (!this.translate(meml4, 2, SEG_SS, (sp - 8) & sp_mask, 2, 0)) return false;
                    }
                    this.refresh_flags();
                    this.cc_mask = 0;
                    this.store16(meml1, this.flags);
                    this.store16(meml2, this.seg[SEG_CS].sel);
                    this.store16(meml3, this.ip);
                    if (pusherr) {
                        this.store16(meml4, this.excerr);
                        this.set_sp(sp - 8, sp_mask);
                    } else {
                        this.set_sp(sp - 6, sp_mask);
                    }
                } else {
                    if (!this.translate(meml1, 2, SEG_SS, (sp - 4) & sp_mask, 4, 0)) return false;
                    if (!this.translate(meml2, 2, SEG_SS, (sp - 8) & sp_mask, 4, 0)) return false;
                    if (!this.translate(meml3, 2, SEG_SS, (sp - 12) & sp_mask, 4, 0)) return false;
                    if (pusherr) {
                        if (!this.translate(meml4, 2, SEG_SS, (sp - 16) & sp_mask, 4, 0)) return false;
                    }
                    this.refresh_flags();
                    this.cc_mask = 0;
                    this.store32(meml1, this.flags);
                    this.store32(meml2, this.seg[SEG_CS].sel);
                    this.store32(meml3, this.ip);
                    if (pusherr) {
                        this.store32(meml4, this.excerr);
                        this.set_sp(sp - 16, sp_mask);
                    } else {
                        this.set_sp(sp - 12, sp_mask);
                    }
                }
                newcs = (newcs & ~3) | this.cpl;
                break;
            }
            case 2: {
                /* inter PVL */
                const msp0 = this._meml7;
                const mss0 = this._meml8;
                const newpl = csdpl;
                const oldss = this.seg[SEG_SS].sel;
                const oldsp = this.regs[4];
                let newss, newsp;
                if (this.seg[SEG_TR].flags & 0x8) {
                    if (!this.translate(msp0, 1, SEG_TR, 4 + 8 * newpl, 4, 0)) return false;
                    if (!this.translate(mss0, 1, SEG_TR, 8 + 8 * newpl, 4, 0)) return false;
                    newsp = this.load32(msp0);
                    newss = this.load32(mss0) & 0xffff;
                } else {
                    if (!this.translate(msp0, 1, SEG_TR, 2 + 4 * newpl, 2, 0)) return false;
                    if (!this.translate(mss0, 1, SEG_TR, 4 + 4 * newpl, 2, 0)) return false;
                    newsp = this.load16(msp0);
                    newss = this.load16(mss0);
                }

                this.regs[4] = newsp >>> 0;
                if (!this.set_seg(SEG_SS, newss)) return false;
                const sp_mask = (this.seg[SEG_SS].flags & SEG_B_BIT) ? 0xffffffff : 0xffff;
                const meml1 = this._meml1;
                const meml2 = this._meml2;
                const meml3 = this._meml3;
                const meml4 = this._meml4;
                const meml5 = this._meml5;
                const meml6 = this._meml6;
                const sp = this.regs[4];
                if (gate16) {
                    if (!this.translate(meml1, 2, SEG_SS, (sp - 2) & sp_mask, 2, 0)) return false;
                    if (!this.translate(meml2, 2, SEG_SS, (sp - 4) & sp_mask, 2, 0)) return false;
                    if (!this.translate(meml3, 2, SEG_SS, (sp - 6) & sp_mask, 2, 0)) return false;
                    if (!this.translate(meml4, 2, SEG_SS, (sp - 8) & sp_mask, 2, 0)) return false;
                    if (!this.translate(meml5, 2, SEG_SS, (sp - 10) & sp_mask, 2, 0)) return false;
                    if (pusherr) {
                        if (!this.translate(meml6, 2, SEG_SS, (sp - 12) & sp_mask, 2, 0)) return false;
                    }
                    this.store16(meml1, oldss);
                    this.store16(meml2, oldsp);
                    this.refresh_flags();
                    this.cc_mask = 0;
                    this.store16(meml3, this.flags);
                    this.store16(meml4, this.seg[SEG_CS].sel);
                    this.store16(meml5, this.ip);
                    if (pusherr) {
                        this.store16(meml6, this.excerr);
                        this.set_sp(sp - 12, sp_mask);
                    } else {
                        this.set_sp(sp - 10, sp_mask);
                    }
                } else {
                    if (!this.translate(meml1, 2, SEG_SS, (sp - 4) & sp_mask, 4, 0)) return false;
                    if (!this.translate(meml2, 2, SEG_SS, (sp - 8) & sp_mask, 4, 0)) return false;
                    if (!this.translate(meml3, 2, SEG_SS, (sp - 12) & sp_mask, 4, 0)) return false;
                    if (!this.translate(meml4, 2, SEG_SS, (sp - 16) & sp_mask, 4, 0)) return false;
                    if (!this.translate(meml5, 2, SEG_SS, (sp - 20) & sp_mask, 4, 0)) return false;
                    if (pusherr) {
                        if (!this.translate(meml6, 2, SEG_SS, (sp - 24) & sp_mask, 4, 0)) return false;
                    }
                    this.store32(meml1, oldss);
                    this.store32(meml2, oldsp);
                    this.refresh_flags();
                    this.cc_mask = 0;
                    this.store32(meml3, this.flags);
                    this.store32(meml4, this.seg[SEG_CS].sel);
                    this.store32(meml5, this.ip);
                    if (pusherr) {
                        this.store32(meml6, this.excerr);
                        this.regs[4] = (sp - 24) >>> 0;
                    } else {
                        this.regs[4] = (sp - 20) >>> 0;
                    }
                }
                newcs = (newcs & ~3) | newpl;
                break;
            }
            case 3: {
                /* from v8086 */
                const msp0 = this._meml7;
                const mss0 = this._meml8;
                const newpl = 0;
                const oldss = this.seg[SEG_SS].sel;
                const oldsp = this.regs[4];
                if (!this.translate(msp0, 1, SEG_TR, 4 + 8 * newpl, 4, 0)) return false;
                if (!this.translate(mss0, 1, SEG_TR, 8 + 8 * newpl, 4, 0)) return false;
                const newsp = this.load32(msp0);
                const newss = this.load32(mss0) & 0xffff;
                const oldflags = this.flags;
                this.flags = (this.flags & ~VM) >>> 0;
                this.regs[4] = newsp >>> 0;
                if (!this.set_seg(SEG_SS, newss)) {
                    this.flags = oldflags;
                    this.regs[4] = oldsp;
                    return false;
                }

                const sp_mask = (this.seg[SEG_SS].flags & SEG_B_BIT) ? 0xffffffff : 0xffff;
                const memlg = { res: ADDR_OK1, addr1: 0, addr2: 0 };
                const memlf = { res: ADDR_OK1, addr1: 0, addr2: 0 };
                const memld = { res: ADDR_OK1, addr1: 0, addr2: 0 };
                const memle = { res: ADDR_OK1, addr1: 0, addr2: 0 };
                const meml1 = this._meml1;
                const meml2 = this._meml2;
                const meml3 = this._meml3;
                const meml4 = this._meml4;
                const meml5 = this._meml5;
                const meml6 = this._meml6;
                const sp = this.regs[4];
                if (!this.translate(memlg, 2, SEG_SS, (sp - 4 * 1) & sp_mask, 4, 0)) return false;
                if (!this.translate(memlf, 2, SEG_SS, (sp - 4 * 2) & sp_mask, 4, 0)) return false;
                if (!this.translate(memld, 2, SEG_SS, (sp - 4 * 3) & sp_mask, 4, 0)) return false;
                if (!this.translate(memle, 2, SEG_SS, (sp - 4 * 4) & sp_mask, 4, 0)) return false;
                if (!this.translate(meml1, 2, SEG_SS, (sp - 4 * 5) & sp_mask, 4, 0)) return false;
                if (!this.translate(meml2, 2, SEG_SS, (sp - 4 * 6) & sp_mask, 4, 0)) return false;
                if (!this.translate(meml3, 2, SEG_SS, (sp - 4 * 7) & sp_mask, 4, 0)) return false;
                if (!this.translate(meml4, 2, SEG_SS, (sp - 4 * 8) & sp_mask, 4, 0)) return false;
                if (!this.translate(meml5, 2, SEG_SS, (sp - 4 * 9) & sp_mask, 4, 0)) return false;
                if (pusherr) {
                    if (!this.translate(meml6, 2, SEG_SS, (sp - 4 * 10) & sp_mask, 4, 0)) return false;
                }
                this.store32(memlg, this.seg[SEG_GS].sel);
                this.store32(memlf, this.seg[SEG_FS].sel);
                this.store32(memld, this.seg[SEG_DS].sel);
                this.store32(memle, this.seg[SEG_ES].sel);
                this.store32(meml1, oldss);
                this.store32(meml2, oldsp);

                this.refresh_flags();
                this.cc_mask = 0;
                this.store32(meml3, (this.flags | VM) >>> 0);

                this.store32(meml4, this.seg[SEG_CS].sel);
                this.store32(meml5, this.ip);
                if (pusherr) {
                    this.store32(meml6, this.excerr);
                    this.set_sp(sp - 4 * 10, sp_mask);
                } else {
                    this.set_sp(sp - 4 * 9, sp_mask);
                }

                newcs = (newcs & ~3) | newpl;
                this.set_seg(SEG_DS, 0);
                this.set_seg(SEG_ES, 0);
                this.set_seg(SEG_FS, 0);
                this.set_seg(SEG_GS, 0);
                this.flags = (this.flags & ~(TF | RF | NT)) >>> 0;
                this.set_seg(SEG_CS, newcs);
                this.next_ip = newip;
                this.ip = newip;
                if (gt === 0x6 || gt === 0xe) {
                    this.flags = (this.flags & ~IF) >>> 0;
                }
                return true;
            }
        }
        if (!this.set_seg(SEG_CS, newcs)) return false;
        this.next_ip = newip;
        this.ip = newip;
        this.flags = (this.flags & ~(TF | RF | NT)) >>> 0;
        if (gt === 0x6 || gt === 0xe) {
            this.flags = (this.flags & ~IF) >>> 0;
        }
        return true;
    }

    __pmiret_check_cs_same(sel) {
        sel &= 0xffff;
        if ((sel & ~0x3) === 0) {
            this.excno = EX_GP;
            this.excerr = sel & ~0x3;
            return false;
        }
        const desc = this.read_desc(sel, false);
        if (!desc) return false;
        const w2 = desc.w2;

        const s = (w2 >>> 12) & 1;
        const code = (w2 >>> 8) & 0x8;
        const conforming = (w2 >>> 8) & 0x4;
        const dpl = (w2 >>> 13) & 0x3;
        const p = (w2 >>> 15) & 1;

        if (!s || !code) {
            this.excno = EX_GP;
            this.excerr = sel & ~0x3;
            return false;
        }
        if (!conforming) {
            if (dpl !== this.cpl) {
                this.excno = EX_GP;
                this.excerr = sel & ~0x3;
                return false;
            }
        } else {
            if (dpl > this.cpl) {
                this.excno = EX_GP;
                this.excerr = sel & ~0x3;
                return false;
            }
        }
        if (!p) {
            this.excno = EX_NP;
            this.excerr = sel & ~0x3;
            return false;
        }
        return true;
    }

    __pmiret_check_cs_outer(sel) {
        sel &= 0xffff;
        if ((sel & ~0x3) === 0) {
            this.excno = EX_GP;
            this.excerr = sel & ~0x3;
            return false;
        }
        const desc = this.read_desc(sel, false);
        if (!desc) return false;
        const w2 = desc.w2;

        const s = (w2 >>> 12) & 1;
        const code = (w2 >>> 8) & 0x8;
        const conforming = (w2 >>> 8) & 0x4;
        const dpl = (w2 >>> 13) & 0x3;
        const p = (w2 >>> 15) & 1;
        const rpl = sel & 3;

        if (!s || !code) {
            this.excno = EX_GP;
            this.excerr = sel & ~0x3;
            return false;
        }
        if (!conforming) {
            if (dpl !== rpl) {
                this.excno = EX_GP;
                this.excerr = sel & ~0x3;
                return false;
            }
        } else {
            if (dpl <= this.cpl) {
                this.excno = EX_GP;
                this.excerr = sel & ~0x3;
                return false;
            }
        }
        if (!p) {
            this.excno = EX_NP;
            this.excerr = sel & ~0x3;
            return false;
        }
        return true;
    }

    pmret(opsz16, off, isiret) {
        if (isiret) {
            if (this.flags & VM) {
                this.excno = EX_GP;
                this.excerr = 0;
                return false;
            }
            if (this.flags & NT) {
                const meml = this._meml7;
                if (!this.translate(meml, 1, SEG_TR, 0, 2, 0)) return false;
                const tssback = this.load16(meml);
                if (tssback === 0) {
                    this.excno = EX_TS;
                    this.excerr = 0;
                    return false;
                }
                return this.task_switch(tssback, TS_IRET);
            }
            off += opsz16 ? 2 : 4;
        }

        const meml1 = this._meml1;
        const meml2 = this._meml2;
        const meml3 = this._meml3;
        const meml4 = this._meml4;
        const meml5 = this._meml5;
        const sp_mask = (this.seg[SEG_SS].flags & SEG_B_BIT) ? 0xffffffff : 0xffff;
        const sp = this.regs[4];
        const oldflags = this.flags;
        let newip, newcs, newflags = 0;

        if (opsz16) {
            if (!this.translate(meml1, 1, SEG_SS, sp & sp_mask, 2, 0)) return false;
            if (!this.translate(meml2, 1, SEG_SS, (sp + 2) & sp_mask, 2, 0)) return false;
            if (isiret) {
                if (!this.translate(meml3, 1, SEG_SS, (sp + 4) & sp_mask, 2, 0)) return false;
                newflags = ((oldflags & 0xffff0000) | this.load16(meml3)) >>> 0;
            }
            newip = this.load16(meml1);
            newcs = this.load16(meml2);
        } else {
            if (!this.translate(meml1, 1, SEG_SS, sp & sp_mask, 4, 0)) return false;
            if (!this.translate(meml2, 1, SEG_SS, (sp + 4) & sp_mask, 4, 0)) return false;
            if (isiret) {
                if (!this.translate(meml3, 1, SEG_SS, (sp + 8) & sp_mask, 4, 0)) return false;
                newflags = this.load32(meml3);
            }
            newip = this.load32(meml1);
            newcs = this.load32(meml2);
        }

        if (isiret) {
            let mask = 0;
            if (this.cpl > 0) mask |= IOPL;
            if (this.get_IOPL() < this.cpl) mask |= IF;
            newflags = (((oldflags & mask) | (newflags & ~mask)) & this.flags_mask | 0x2) >>> 0;
        }

        if (isiret && (newflags & VM)) {
            const meml_vmes = { res: ADDR_OK1, addr1: 0, addr2: 0 };
            const meml_vmds = { res: ADDR_OK1, addr1: 0, addr2: 0 };
            const meml_vmfs = { res: ADDR_OK1, addr1: 0, addr2: 0 };
            const meml_vmgs = { res: ADDR_OK1, addr1: 0, addr2: 0 };
            if (!this.translate(meml4, 1, SEG_SS, (sp + 12) & sp_mask, 4, 0)) return false;
            if (!this.translate(meml5, 1, SEG_SS, (sp + 16) & sp_mask, 4, 0)) return false;
            if (!this.translate(meml_vmes, 1, SEG_SS, (sp + 20) & sp_mask, 4, 0)) return false;
            if (!this.translate(meml_vmds, 1, SEG_SS, (sp + 24) & sp_mask, 4, 0)) return false;
            if (!this.translate(meml_vmfs, 1, SEG_SS, (sp + 28) & sp_mask, 4, 0)) return false;
            if (!this.translate(meml_vmgs, 1, SEG_SS, (sp + 32) & sp_mask, 4, 0)) return false;
            this.flags = newflags;
            if (!this.set_seg(SEG_CS, newcs)) return false;
            this.set_sp(sp + 12, sp_mask);
            this.next_ip = newip & 0xffff;
            if (!this.set_seg(SEG_SS, this.load32(meml5))) return false;
            if (!this.set_seg(SEG_ES, this.load32(meml_vmes))) return false;
            if (!this.set_seg(SEG_DS, this.load32(meml_vmds))) return false;
            if (!this.set_seg(SEG_FS, this.load32(meml_vmfs))) return false;
            if (!this.set_seg(SEG_GS, this.load32(meml_vmgs))) return false;
            this.set_sp(this.load32(meml4), 0xffffffff);
        } else {
            const rpl = newcs & 3;
            if (rpl < this.cpl) {
                this.excno = EX_GP;
                this.excerr = newcs & ~0x3;
                return false;
            }
            if (rpl === this.cpl) {
                if (!this.__pmiret_check_cs_same(newcs)) return false;
                if (isiret) this.flags = newflags;
                if (!this.set_seg(SEG_CS, newcs)) return false;
                if (opsz16) {
                    this.set_sp(sp + 4 + off, sp_mask);
                } else {
                    this.set_sp(sp + 8 + off, sp_mask);
                }
                this.next_ip = newip >>> 0;
            } else {
                if (!this.__pmiret_check_cs_outer(newcs)) return false;
                let newsp, newss;
                if (opsz16) {
                    if (!this.translate(meml4, 1, SEG_SS, (sp + 4 + off) & sp_mask, 2, 0)) return false;
                    if (!this.translate(meml5, 1, SEG_SS, (sp + 6 + off) & sp_mask, 2, 0)) return false;
                    newsp = this.load16(meml4);
                    newss = this.load16(meml5);
                } else {
                    if (!this.translate(meml4, 1, SEG_SS, (sp + 8 + off) & sp_mask, 4, 0)) return false;
                    if (!this.translate(meml5, 1, SEG_SS, (sp + 12 + off) & sp_mask, 4, 0)) return false;
                    newsp = this.load32(meml4);
                    newss = this.load32(meml5);
                }
                if (!isiret) newsp = (newsp + off) >>> 0;
                if (isiret) this.flags = newflags;
                if (!this.set_seg(SEG_CS, newcs)) return false;
                if (!this.set_seg(SEG_SS, newss)) return false;
                const newsp_mask = (this.seg[SEG_SS].flags & SEG_B_BIT) ? 0xffffffff : 0xffff;
                this.set_sp(newsp, newsp_mask);
                this.next_ip = newip >>> 0;
                this.clear_segs();
            }
        }
        if (isiret) this.cc_mask = 0;
        return true;
    }

    enter_helper(opsz16, sp_mask, level, allocsz) {
        let temp;
        const meml1 = this._meml1;
        let sp = this.regs[4];
        if (opsz16) {
            if (!this.translate16(meml1, 2, SEG_SS, (sp - 2) & sp_mask)) return false;
            this.set_sp(sp - 2, sp_mask);
            this.store16(meml1, this.lreg16(5));
            temp = this.lreg16(4);
        } else {
            if (!this.translate32(meml1, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
            this.set_sp(sp - 4, sp_mask);
            this.store32(meml1, this.regs[5]);
            temp = this.regs[4];
        }

        for (let i = 0; i < level - 1; i++) {
            sp = this.regs[4];
            if (opsz16) {
                if (sp_mask === 0xffff) {
                    this.sreg16(5, this.lreg16(5) - 2);
                } else {
                    this.regs[5] = (this.regs[5] - 2) >>> 0;
                }
                if (!this.translate16(meml1, 2, SEG_SS, (sp - 2) & sp_mask)) return false;
                this.set_sp(sp - 2, sp_mask);
                this.store16(meml1, this.lreg16(5));
            } else {
                if (sp_mask === 0xffff) {
                    this.sreg16(5, this.lreg16(5) - 4);
                } else {
                    this.regs[5] = (this.regs[5] - 4) >>> 0;
                }
                if (!this.translate32(meml1, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
                this.set_sp(sp - 4, sp_mask);
                this.store32(meml1, this.regs[5]);
            }
        }

        sp = this.regs[4];
        if (opsz16) {
            if (!this.translate16(meml1, 2, SEG_SS, (sp - 2) & sp_mask)) return false;
            this.set_sp(sp - 2 - allocsz, sp_mask);
            this.store16(meml1, temp);
            this.sreg16(5, temp);
        } else {
            if (!this.translate32(meml1, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
            this.set_sp(sp - 4 - allocsz, sp_mask);
            this.store32(meml1, temp);
            this.regs[5] = temp >>> 0;
        }
        return true;
    }

    __LSEGd_helper(adsz16, seg, reg, curr_seg, addr) {
        const meml1 = this._meml1;
        const meml2 = this._meml2;
        if (adsz16) addr &= 0xffff;
        if (!this.translate32(meml1, 1, curr_seg, addr)) return false;
        if (!this.translate16(meml2, 1, curr_seg, (addr + 4) >>> 0)) return false;
        const r = this.load32(meml1);
        const s = this.load16(meml2);
        if (!this.set_seg(seg, s)) return false;
        this.regs[reg] = r >>> 0;
        return true;
    }

    __LSEGw_helper(adsz16, seg, reg, curr_seg, addr) {
        const meml1 = this._meml1;
        const meml2 = this._meml2;
        if (adsz16) addr &= 0xffff;
        if (!this.translate16(meml1, 1, curr_seg, addr)) return false;
        if (!this.translate16(meml2, 1, curr_seg, (addr + 2) >>> 0)) return false;
        const r = this.load16(meml1);
        const s = this.load16(meml2);
        if (!this.set_seg(seg, s)) return false;
        this.sreg16(reg, r);
        return true;
    }

    larsl_helper(sel, isAr) {
        sel &= 0xffff;
        if (!(this.cr0 & 1) || (this.flags & VM)) {
            this.excno = EX_UD;
            return null;
        }
        if ((sel & ~0x3) === 0) {
            return { zf: 0, val: 0 };
        }
        const desc = this.read_desc(sel, true);
        if (!desc) {
            return { zf: 0, val: 0 };
        }
        const { w1, w2 } = desc;
        if ((w2 >>> 12) & 1) {
            const dpl = (w2 >>> 13) & 0x3;
            if (((w2 >>> 10) & 0x3) !== 0x3 && (this.cpl > dpl || (sel & 0x3) > dpl)) {
                return { zf: 0, val: 0 };
            }
        } else {
            const type = (w2 >>> 8) & 0xf;
            if (isAr) {
                if (type === 0 || type === 6 || type === 7 || type === 8 || type === 10 || type === 13 || type === 14 || type === 15) {
                    return { zf: 0, val: 0 };
                }
            } else {
                if (type === 0 || type === 4 || type === 5 || type === 6 || type === 7 || type === 8 || type === 10 || type === 12 || type === 13 || type === 14 || type === 15) {
                    return { zf: 0, val: 0 };
                }
            }
        }
        let val;
        if (isAr) {
            val = (w2 & 0x00ffff00) >>> 0;
        } else {
            val = ((w2 & 0xf0000) | (w1 & 0xffff)) >>> 0;
            if (w2 & 0x00800000) {
                val = ((val << 12) | 0xfff) >>> 0;
            }
        }
        return { zf: 1, val };
    }

    verrw_helper(sel, wr) {
        sel &= 0xffff;
        if (!(this.cr0 & 1) || (this.flags & VM)) {
            this.excno = EX_UD;
            return -1;
        }
        if ((sel & ~0x3) === 0) return 0;
        const desc = this.read_desc(sel, true);
        if (!desc) return 0;
        const { w2 } = desc;
        if (((w2 >>> 12) & 0x1) === 0) return 0;
        const dpl = (w2 >>> 13) & 0x3;
        if (((w2 >>> 10) & 0x3) !== 0x3 && (this.cpl > dpl || (sel & 0x3) > dpl)) return 0;
        if (((w2 >>> 11) & 0x1) === 0) {
            if (wr && ((w2 >>> 9) & 0x1) === 0) return 0;
        } else {
            if (!wr && ((w2 >>> 9) & 0x1) === 0) return 0;
        }
        return 1;
    }

    __sysenter(pl, cs) {
        this.seg[SEG_CS].sel = (cs & 0xfffc) | pl;
        this.segments[SEG_CS] = this.seg[SEG_CS].sel;
        this.seg[SEG_CS].base = 0;
        this.seg[SEG_CS].limit = 0xffffffff;
        this.seg[SEG_CS].flags = SEG_D_BIT | 0x5b | (pl << 5);
        this.cpl = pl;
        this.code16 = false;
        this.sp_mask = 0xffffffff;
        this.seg[SEG_SS].sel = ((cs + 8) & 0xfffc) | pl;
        this.segments[SEG_SS] = this.seg[SEG_SS].sel;
        this.seg[SEG_SS].base = 0;
        this.seg[SEG_SS].limit = 0xffffffff;
        this.seg[SEG_SS].flags = SEG_B_BIT | 0x53 | (pl << 5);
    }

    /* ======================================================================
     * ALU, SHIFT, MULTIPLY/DIVIDE, BCD & STRING INSTRUCTION HELPERS
     * ====================================================================== */

    try_jcc8() {
        if (this.ifetch_paddr) {
            const op = this.ram[this.ifetch_paddr];
            if ((op & ~1) === 0x74) {
                if (((this.cc_dst === 0) ? 1 : 0) ^ (op & 1)) {
                    const d = (this.ram[this.ifetch_paddr + 1] << 24) >> 24;
                    this.next_ip = (this.next_ip + d + 2) >>> 0;
                    if (this.code16) this.next_ip &= 0xffff;
                }
            }
        }
    }

    aluAdd8(a, b) {
        this.cc_src1 = sext8(a);
        this.cc_src2 = sext8(b);
        this.cc_dst = sext8(this.cc_src1 + this.cc_src2);
        this.cc_op = CC_ADD;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    aluAdd16(a, b) {
        this.cc_src1 = sext16(a);
        this.cc_src2 = sext16(b);
        this.cc_dst = sext16(this.cc_src1 + this.cc_src2);
        this.cc_op = CC_ADD;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    aluAdd32(a, b) {
        this.cc_src1 = sext32(a);
        this.cc_src2 = sext32(b);
        this.cc_dst = sext32(this.cc_src1 + this.cc_src2);
        this.cc_op = CC_ADD;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    aluAdc8(a, b) {
        const cf = this.get_CF();
        this.cc_src1 = sext8(a);
        this.cc_src2 = sext8(b);
        this.cc_dst = sext8(this.cc_src1 + this.cc_src2 + cf);
        this.cc_op = cf ? CC_ADC : CC_ADD;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    aluAdc16(a, b) {
        const cf = this.get_CF();
        this.cc_src1 = sext16(a);
        this.cc_src2 = sext16(b);
        this.cc_dst = sext16(this.cc_src1 + this.cc_src2 + cf);
        this.cc_op = cf ? CC_ADC : CC_ADD;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    aluAdc32(a, b) {
        const cf = this.get_CF();
        this.cc_src1 = sext32(a);
        this.cc_src2 = sext32(b);
        this.cc_dst = sext32(this.cc_src1 + this.cc_src2 + cf);
        this.cc_op = cf ? CC_ADC : CC_ADD;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    aluSub8(a, b) {
        this.cc_src1 = sext8(a);
        this.cc_src2 = sext8(b);
        this.cc_dst = sext8(this.cc_src1 - this.cc_src2);
        this.cc_op = CC_SUB;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    aluSub16(a, b) {
        this.cc_src1 = sext16(a);
        this.cc_src2 = sext16(b);
        this.cc_dst = sext16(this.cc_src1 - this.cc_src2);
        this.cc_op = CC_SUB;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    aluSub32(a, b) {
        this.cc_src1 = sext32(a);
        this.cc_src2 = sext32(b);
        this.cc_dst = sext32(this.cc_src1 - this.cc_src2);
        this.cc_op = CC_SUB;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    aluSbb8(a, b) {
        const cf = this.get_CF();
        this.cc_src1 = sext8(a);
        this.cc_src2 = sext8(b);
        this.cc_dst = sext8(this.cc_src1 - this.cc_src2 - cf);
        this.cc_op = cf ? CC_SBB : CC_SUB;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    aluSbb16(a, b) {
        const cf = this.get_CF();
        this.cc_src1 = sext16(a);
        this.cc_src2 = sext16(b);
        this.cc_dst = sext16(this.cc_src1 - this.cc_src2 - cf);
        this.cc_op = cf ? CC_SBB : CC_SUB;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    aluSbb32(a, b) {
        const cf = this.get_CF();
        this.cc_src1 = sext32(a);
        this.cc_src2 = sext32(b);
        this.cc_dst = sext32(this.cc_src1 - this.cc_src2 - cf);
        this.cc_op = cf ? CC_SBB : CC_SUB;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    aluOr8(a, b) {
        this.cc_dst = sext8(a | b);
        this.cc_op = CC_OR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    aluOr16(a, b) {
        this.cc_dst = sext16(a | b);
        this.cc_op = CC_OR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    aluOr32(a, b) {
        this.cc_dst = sext32(a | b);
        this.cc_op = CC_OR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    aluAnd8(a, b) {
        this.cc_dst = sext8(a & b);
        this.cc_op = CC_AND;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    aluAnd16(a, b) {
        this.cc_dst = sext16(a & b);
        this.cc_op = CC_AND;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    aluAnd32(a, b) {
        this.cc_dst = sext32(a & b);
        this.cc_op = CC_AND;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    aluXor8(a, b) {
        this.cc_dst = sext8(a ^ b);
        this.cc_op = CC_XOR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    aluXor16(a, b) {
        this.cc_dst = sext16(a ^ b);
        this.cc_op = CC_XOR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    aluXor32(a, b) {
        this.cc_dst = sext32(a ^ b);
        this.cc_op = CC_XOR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    aluCmp8(a, b) {
        this.aluSub8(a, b);
        this.try_jcc8();
    }

    aluCmp16(a, b) {
        this.aluSub16(a, b);
        this.try_jcc8();
    }

    aluCmp32(a, b) {
        this.aluSub32(a, b);
        this.try_jcc8();
    }

    aluTest8(a, b) {
        this.aluAnd8(a, b);
        this.try_jcc8();
    }

    aluTest16(a, b) {
        this.aluAnd16(a, b);
        this.try_jcc8();
    }

    aluTest32(a, b) {
        this.aluAnd32(a, b);
        this.try_jcc8();
    }

    aluInc8(a) {
        const cf = this.get_CF();
        this.cc_dst = sext8(sext8(a) + 1);
        this.cc_op = CC_INC8;
        if (cf) this.flags |= CF; else this.flags &= ~CF;
        this.cc_mask = PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    aluInc16(a) {
        const cf = this.get_CF();
        this.cc_dst = sext16(sext16(a) + 1);
        this.cc_op = CC_INC16;
        if (cf) this.flags |= CF; else this.flags &= ~CF;
        this.cc_mask = PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    aluInc32(a) {
        const cf = this.get_CF();
        this.cc_dst = sext32(sext32(a) + 1);
        this.cc_op = CC_INC32;
        if (cf) this.flags |= CF; else this.flags &= ~CF;
        this.cc_mask = PF | AF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    aluDec8(a) {
        const cf = this.get_CF();
        this.cc_dst = sext8(sext8(a) - 1);
        this.cc_op = CC_DEC8;
        if (cf) this.flags |= CF; else this.flags &= ~CF;
        this.cc_mask = PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    aluDec16(a) {
        const cf = this.get_CF();
        this.cc_dst = sext16(sext16(a) - 1);
        this.cc_op = CC_DEC16;
        if (cf) this.flags |= CF; else this.flags &= ~CF;
        this.cc_mask = PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    aluDec32(a) {
        const cf = this.get_CF();
        this.cc_dst = sext32(sext32(a) - 1);
        this.cc_op = CC_DEC32;
        if (cf) this.flags |= CF; else this.flags &= ~CF;
        this.cc_mask = PF | AF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    aluNeg8(a) {
        this.cc_src1 = sext8(a);
        this.cc_dst = sext8(-this.cc_src1);
        this.cc_op = CC_NEG8;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    aluNeg16(a) {
        this.cc_src1 = sext16(a);
        this.cc_dst = sext16(-this.cc_src1);
        this.cc_op = CC_NEG16;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    aluNeg32(a) {
        this.cc_src1 = sext32(a);
        this.cc_dst = sext32(-this.cc_src1);
        this.cc_op = CC_NEG32;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    shl8(x, count) {
        x &= 0xff;
        const y = count & 0x1f;
        if (!y) return x;
        this.cc_dst = sext8(x << y);
        this.cc_dst2 = y <= 8 ? ((x >>> (8 - y)) & 1) : 0;
        this.cc_op = CC_SHL;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    shl16(x, count) {
        x &= 0xffff;
        const y = count & 0x1f;
        if (!y) return x;
        this.cc_dst = sext16(x << y);
        this.cc_dst2 = y <= 16 ? ((x >>> (16 - y)) & 1) : 0;
        this.cc_op = CC_SHL;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    shl32(x, count) {
        x >>>= 0;
        const y = count & 0x1f;
        if (!y) return x;
        this.cc_dst = sext32(x << y);
        this.cc_dst2 = (x >>> (32 - y)) & 1;
        this.cc_op = CC_SHL;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    shr8(x, count) {
        x &= 0xff;
        const y = count & 0x1f;
        if (!y) return x;
        this.cc_src1 = sext8(x);
        this.cc_dst = sext8(x >>> y);
        this.cc_dst2 = (x >>> (y - 1)) & 1;
        this.cc_op = CC_SHR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    shr16(x, count) {
        x &= 0xffff;
        const y = count & 0x1f;
        if (!y) return x;
        this.cc_src1 = sext16(x);
        this.cc_dst = sext16(x >>> y);
        this.cc_dst2 = (x >>> (y - 1)) & 1;
        this.cc_op = CC_SHR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    shr32(x, count) {
        x >>>= 0;
        const y = count & 0x1f;
        if (!y) return x;
        this.cc_src1 = sext32(x);
        this.cc_dst = sext32(x >>> y);
        this.cc_dst2 = (x >>> (y - 1)) & 1;
        this.cc_op = CC_SHR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    sar8(x, count) {
        const sx = (x << 24) >> 24;
        const y = count & 0x1f;
        if (!y) return x & 0xff;
        this.cc_dst = (sx >> y) >>> 0;
        this.cc_dst2 = (sx >> (y - 1)) & 1;
        this.cc_op = CC_SAR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xff;
    }

    sar16(x, count) {
        const sx = (x << 16) >> 16;
        const y = count & 0x1f;
        if (!y) return x & 0xffff;
        this.cc_dst = (sx >> y) >>> 0;
        this.cc_dst2 = (sx >> (y - 1)) & 1;
        this.cc_op = CC_SAR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    sar32(x, count) {
        const sx = x | 0;
        const y = count & 0x1f;
        if (!y) return x >>> 0;
        this.cc_dst = (sx >> y) >>> 0;
        this.cc_dst2 = (sx >> (y - 1)) & 1;
        this.cc_op = CC_SAR;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    rol(bit, x, y0) {
        const mask = bit === 32 ? 0xffffffff : ((1 << bit) - 1);
        x = (x & mask) >>> 0;
        const y = y0 & (bit - 1);
        let res = x;
        if (y) {
            const raw = ((x << y) | (x >>> (bit - y))) >>> 0;
            res = bit === 8 ? sext8(raw) : (bit === 16 ? sext16(raw) : sext32(raw));
        }
        if (y0) {
            const cf1 = res & 1;
            const of1 = ((res >>> 31) ^ cf1) & 1;
            if (cf1) this.flags |= CF; else this.flags &= ~CF;
            if (of1) this.flags |= OF; else this.flags &= ~OF;
            this.cc_mask &= ~(CF | OF);
        }
        return (res & mask) >>> 0;
    }

    ror(bit, x, y0) {
        const mask = bit === 32 ? 0xffffffff : ((1 << bit) - 1);
        x = (x & mask) >>> 0;
        const y = y0 & (bit - 1);
        let res = x;
        if (y) {
            const raw = ((x >>> y) | (x << (bit - y))) >>> 0;
            res = bit === 8 ? sext8(raw) : (bit === 16 ? sext16(raw) : sext32(raw));
        }
        if (y0) {
            const cf1 = (res >>> (bit - 1)) & 1;
            const of1 = ((res ^ (res << 1)) >>> (bit - 1)) & 1;
            if (cf1) this.flags |= CF; else this.flags &= ~CF;
            if (of1) this.flags |= OF; else this.flags &= ~OF;
            this.cc_mask &= ~(CF | OF);
        }
        return (res & mask) >>> 0;
    }

    rcl(bit, x, count) {
        const mask = bit === 32 ? 0xffffffff : ((1 << bit) - 1);
        x = (x & mask) >>> 0;
        const y = (count & 0x1f) % (bit + 1);
        if (!y) return x;
        const cf = this.get_CF();
        const raw = ((x << y) | (cf << (y - 1)) | (y !== 1 ? (x >>> (bit + 1 - y)) : 0)) >>> 0;
        const res = bit === 8 ? sext8(raw) : (bit === 16 ? sext16(raw) : sext32(raw));
        const cf1 = (x >>> (bit - y)) & 1;
        const of1 = ((res >>> 31) ^ cf1) & 1;
        if (cf1) this.flags |= CF; else this.flags &= ~CF;
        if (of1) this.flags |= OF; else this.flags &= ~OF;
        this.cc_mask &= ~(CF | OF);
        return (res & mask) >>> 0;
    }

    rcr(bit, x, count) {
        const mask = bit === 32 ? 0xffffffff : ((1 << bit) - 1);
        x = (x & mask) >>> 0;
        const y = (count & 0x1f) % (bit + 1);
        if (!y) return x;
        const cf = this.get_CF();
        const raw = ((x >>> y) | (cf << (bit - y)) | (y !== 1 ? (x << (bit + 1 - y)) : 0)) >>> 0;
        const res = bit === 8 ? sext8(raw) : (bit === 16 ? sext16(raw) : sext32(raw));
        const shifted = (x << (bit - y)) >>> 0;
        const sshift = bit === 8 ? sext8(shifted) : (bit === 16 ? sext16(shifted) : sext32(shifted));
        const cf1 = (sshift >>> (bit - 1)) & 1;
        const of1 = ((res ^ (res << 1)) >>> (bit - 1)) & 1;
        if (cf1) this.flags |= CF; else this.flags &= ~CF;
        if (of1) this.flags |= OF; else this.flags &= ~OF;
        this.cc_mask &= ~(CF | OF);
        return (res & mask) >>> 0;
    }

    shld(bit, x, y, c) {
        let count = c & 0x1f;
        const mask = bit === 16 ? 0xffff : 0xffffffff;
        x = (x & mask) >>> 0;
        y = (y & mask) >>> 0;
        if (!count) return x;
        const sext = bit === 16 ? sext16 : sext32;
        this.cc_src1 = sext(x);
        if (bit < count) {
            const z = x; x = y; y = z;
            count -= bit;
        }
        this.cc_dst = sext(((x << count) | (y >>> (bit - count))) >>> 0);
        if (count === 1) {
            this.cc_dst2 = sext(x);
        } else {
            this.cc_dst2 = sext(((x << (count - 1)) | (y >>> (bit - (count - 1)))) >>> 0);
        }
        this.cc_op = CC_SHLD;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return (this.cc_dst & mask) >>> 0;
    }

    shrd(bit, x, y, c) {
        let count = c & 0x1f;
        const mask = bit === 16 ? 0xffff : 0xffffffff;
        x = (x & mask) >>> 0;
        y = (y & mask) >>> 0;
        if (!count) return x;
        const sext = bit === 16 ? sext16 : sext32;
        if (bit < count) {
            const z = x; x = y; y = z;
            count -= bit;
        }
        this.cc_src1 = sext(x);
        this.cc_dst = sext(((x >>> count) | (y << (bit - count))) >>> 0);
        if (count === 1) {
            this.cc_dst2 = sext(x);
        } else {
            this.cc_dst2 = sext(((x >>> (count - 1)) | (y << (bit - (count - 1)))) >>> 0);
        }
        this.cc_op = CC_SHRD;
        this.cc_mask = CF | PF | ZF | SF | OF;
        return (this.cc_dst & mask) >>> 0;
    }

    mul8(op) {
        this.cc_src1 = this.lreg8(0);
        this.cc_src2 = op & 0xff;
        this.cc_dst = sext16(this.cc_src1 * this.cc_src2);
        this.cc_op = CC_MUL8;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        this.sreg16(0, this.cc_dst);
    }

    mul16(op) {
        this.cc_src1 = this.lreg16(0);
        this.cc_src2 = op & 0xffff;
        this.cc_dst = (this.cc_src1 * this.cc_src2) >>> 0;
        this.cc_op = CC_MUL16;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        this.sreg16(0, this.cc_dst);
        this.sreg16(2, this.cc_dst >>> 16);
    }

    mul32(op) {
        this.cc_src1 = this.regs[0] >>> 0;
        this.cc_src2 = op >>> 0;
        const res = BigInt(this.cc_src1) * BigInt(this.cc_src2);
        this.cc_dst = Number(res & 0xffffffffn) >>> 0;
        this.cc_dst2 = Number((res >> 32n) & 0xffffffffn) >>> 0;
        this.cc_op = CC_MUL32;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        this.regs[0] = this.cc_dst;
        this.regs[2] = this.cc_dst2;
    }

    imul1_8(op) {
        this.cc_src1 = sext8(this.lreg8(0));
        this.cc_src2 = sext8(op);
        this.cc_dst = ((this.cc_src1 | 0) * (this.cc_src2 | 0)) >>> 0;
        this.cc_op = CC_IMUL8;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        this.sreg16(0, this.cc_dst);
    }

    imul1_16(op) {
        this.cc_src1 = sext16(this.lreg16(0));
        this.cc_src2 = sext16(op);
        this.cc_dst = ((this.cc_src1 | 0) * (this.cc_src2 | 0)) >>> 0;
        this.cc_op = CC_IMUL16;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        this.sreg16(0, this.cc_dst);
        this.sreg16(2, this.cc_dst >>> 16);
    }

    imul1_32(op) {
        this.cc_src1 = sext32(this.regs[0]);
        this.cc_src2 = sext32(op);
        const res = BigInt(this.cc_src1 | 0) * BigInt(this.cc_src2 | 0);
        const ures = BigInt.asUintN(64, res);
        this.cc_dst = Number(ures & 0xffffffffn) >>> 0;
        this.cc_dst2 = Number((ures >> 32n) & 0xffffffffn) >>> 0;
        this.cc_op = CC_IMUL32;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        this.regs[0] = this.cc_dst;
        this.regs[2] = this.cc_dst2;
    }

    imul2_16(a, b) {
        this.cc_src1 = sext16(a);
        this.cc_src2 = sext16(b);
        this.cc_dst = ((this.cc_src1 | 0) * (this.cc_src2 | 0)) >>> 0;
        this.cc_op = CC_IMUL16;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst & 0xffff;
    }

    imul2_32(a, b) {
        this.cc_src1 = sext32(a);
        this.cc_src2 = sext32(b);
        const res = BigInt(this.cc_src1 | 0) * BigInt(this.cc_src2 | 0);
        const ures = BigInt.asUintN(64, res);
        this.cc_dst = Number(ures & 0xffffffffn) >>> 0;
        this.cc_dst2 = Number((ures >> 32n) & 0xffffffffn) >>> 0;
        this.cc_op = CC_IMUL32;
        this.cc_mask = CF | PF | AF | ZF | SF | OF;
        return this.cc_dst >>> 0;
    }

    div8(op) {
        const src1 = this.lreg16(0);
        const src2 = op & 0xff;
        if (src2 === 0) { this.excno = EX_DE; return false; }
        const res = Math.floor(src1 / src2);
        if (res > 0xff) { this.excno = EX_DE; return false; }
        if (src1 === 0x5 && src2 === 0x2) { this.cc_mask &= ~ZF; this.flags |= ZF; }
        this.sreg8(0, res);
        this.sreg8(4, src1 % src2);
        return true;
    }

    div16(op) {
        const src1 = ((this.lreg16(2) << 16) | this.lreg16(0)) >>> 0;
        const src2 = op & 0xffff;
        if (src2 === 0) { this.excno = EX_DE; return false; }
        const res = Math.floor(src1 / src2);
        if (res > 0xffff) { this.excno = EX_DE; return false; }
        if (src1 === 0x5555 && src2 === 0x2) { this.cc_mask &= ~ZF; this.flags &= ~ZF; }
        this.sreg16(0, res);
        this.sreg16(2, src1 % src2);
        return true;
    }

    div32(op) {
        const src1 = (BigInt(this.regs[2] >>> 0) << 32n) | BigInt(this.regs[0] >>> 0);
        const src2 = BigInt(op >>> 0);
        if (src2 === 0n) { this.excno = EX_DE; return false; }
        const res = src1 / src2;
        if (res > 0xffffffffn) { this.excno = EX_DE; return false; }
        this.regs[0] = Number(res) >>> 0;
        this.regs[2] = Number(src1 % src2) >>> 0;
        return true;
    }

    idiv8(op) {
        const src1 = (this.lreg16(0) << 16) >> 16;
        const src2 = (op << 24) >> 24;
        if (src2 === 0) { this.excno = EX_DE; return false; }
        const res = Math.trunc(src1 / src2);
        if (res > 127 || res < -128) { this.excno = EX_DE; return false; }
        this.sreg8(0, res);
        this.sreg8(4, src1 % src2);
        return true;
    }

    idiv16(op) {
        const src1 = ((this.lreg16(2) << 16) | this.lreg16(0)) | 0;
        const src2 = (op << 16) >> 16;
        if (src2 === 0) { this.excno = EX_DE; return false; }
        const res = Math.trunc(src1 / src2);
        if (res > 32767 || res < -32768) { this.excno = EX_DE; return false; }
        this.sreg16(0, res);
        this.sreg16(2, src1 % src2);
        return true;
    }

    idiv32(op) {
        const u64 = (BigInt(this.regs[2] >>> 0) << 32n) | BigInt(this.regs[0] >>> 0);
        const src1 = BigInt.asIntN(64, u64);
        const src2 = BigInt(op | 0);
        if (src2 === 0n) { this.excno = EX_DE; return false; }
        const res = src1 / src2;
        if (res > 2147483647n || res < -2147483648n) { this.excno = EX_DE; return false; }
        this.regs[0] = Number(BigInt.asUintN(32, res)) >>> 0;
        this.regs[2] = Number(BigInt.asUintN(32, src1 % src2)) >>> 0;
        return true;
    }

    __AAD_helper(i) {
        const al = this.lreg8(0);
        const ah = this.lreg8(4);
        const res = (al + ah * (i & 0xff)) & 0xff;
        this.sreg8(0, res);
        this.sreg8(4, 0);
        this.flags &= ~(OF | AF | CF);
        this.cc_dst = sext8(res);
        this.cc_mask = ZF | SF | PF;
    }

    __AAM_helper(i) {
        const imm = i & 0xff;
        if (imm === 0) {
            this.excno = EX_DE;
            return false;
        }
        const al = this.lreg8(0);
        const res = al % imm;
        this.sreg8(4, Math.floor(al / imm));
        this.sreg8(0, res);
        this.flags &= ~(OF | AF | CF);
        this.cc_dst = sext8(res);
        this.cc_mask = ZF | SF | PF;
        return true;
    }

    __XLAT_helper(adsz16, curr_seg) {
        const meml = this._meml;
        if (curr_seg === -1) curr_seg = SEG_DS;
        let addr;
        if (adsz16) {
            addr = (this.lreg16(3) + this.lreg8(0)) & 0xffff;
        } else {
            addr = (this.regs[3] + this.lreg8(0)) >>> 0;
        }
        if (!this.translate8(meml, 1, curr_seg, addr)) return false;
        this.sreg8(0, this.load8(meml));
        return true;
    }

    __DAA_helper() {
        const al = this.lreg8(0);
        const cf = this.get_CF();
        this.flags &= ~CF;
        if ((al & 0xf) > 9 || this.get_AF()) {
            this.sreg8(0, al + 6);
            if (cf || al > 0xff - 6) this.flags |= CF;
            this.flags |= AF;
        } else {
            this.flags &= ~AF;
        }
        if (al > 0x99 || cf) {
            this.sreg8(0, this.lreg8(0) + 0x60);
            this.flags |= CF;
        }
        this.cc_dst = sext8(this.lreg8(0));
        this.cc_mask = ZF | SF | PF;
    }

    __DAS_helper() {
        const al = this.lreg8(0);
        const cf = this.get_CF();
        this.flags &= ~CF;
        if ((al & 0xf) > 9 || this.get_AF()) {
            this.sreg8(0, al - 6);
            if (cf || al < 6) this.flags |= CF;
            this.flags |= AF;
        } else {
            this.flags &= ~AF;
        }
        if (al > 0x99 || cf) {
            this.sreg8(0, this.lreg8(0) - 0x60);
            this.flags |= CF;
        }
        this.cc_dst = sext8(this.lreg8(0));
        this.cc_mask = ZF | SF | PF;
    }

    __AAA_helper() {
        if ((this.lreg8(0) & 0xf) > 9 || this.get_AF()) {
            this.sreg16(0, this.lreg16(0) + 0x106);
            this.flags |= AF | CF;
        } else {
            this.flags &= ~(AF | CF);
        }
        this.cc_mask = ZF | SF | PF;
        this.sreg8(0, this.lreg8(0) & 0xf);
    }

    __AAS_helper() {
        if ((this.lreg8(0) & 0xf) > 9 || this.get_AF()) {
            this.sreg16(0, this.lreg16(0) - 6);
            this.sreg8(4, this.lreg8(4) - 1);
            this.flags |= AF | CF;
        } else {
            this.flags &= ~(AF | CF);
        }
        this.cc_mask = ZF | SF | PF;
        this.sreg8(0, this.lreg8(0) & 0xf);
    }

    /* ======================================================================
     * STRING INSTRUCTIONS (STOS, LODS, SCAS, MOVS, CMPS, INS, OUTS)
     * ====================================================================== */

    getAddrReg(adsz16, reg) {
        return adsz16 ? this.lreg16(reg) : this.regs[reg];
    }

    setAddrReg(adsz16, reg, val) {
        if (adsz16) this.sreg16(reg, val);
        else this.regs[reg] = val >>> 0;
    }

    translateBit(bit, res, rwm, seg, addr) {
        if (bit === 8) return this.translate8(res, rwm, seg, addr);
        if (bit === 16) return this.translate16(res, rwm, seg, addr);
        return this.translate32(res, rwm, seg, addr);
    }

    loadBit(bit, res) {
        if (bit === 8) return this.load8(res);
        if (bit === 16) return this.load16(res);
        return this.load32(res);
    }

    storeBit(bit, res, val) {
        if (bit === 8) this.store8(res, val);
        else if (bit === 16) this.store16(res, val);
        else this.store32(res, val);
    }

    setRegBit(bit, reg, val) {
        if (bit === 8) this.sreg8(reg, val);
        else if (bit === 16) this.sreg16(reg, val);
        else this.regs[reg] = val >>> 0;
    }

    sextBit(bit, val) {
        if (bit === 8) return sext8(val);
        if (bit === 16) return sext16(val);
        return sext32(val);
    }

    execStos(bit, adsz16, rep) {
        const stepBytes = bit >>> 3;
        const dir = (this.flags & DF) ? -stepBytes : stepBytes;
        const ax = bit === 8 ? (this.regs[0] & 0xff) : (bit === 16 ? (this.regs[0] & 0xffff) : (this.regs[0] >>> 0));
        const memld = this._memld;

        if (rep === 0) {
            const di = this.getAddrReg(adsz16, 7);
            if (!this.translateBit(bit, memld, 2, SEG_ES, di)) return false;
            this.storeBit(bit, memld, ax);
            this.setAddrReg(adsz16, 7, di + dir);
            return true;
        }

        let cx = this.getAddrReg(adsz16, 1);
        while (cx) {
            const di = this.getAddrReg(adsz16, 7);
            if (!this.translateBit(bit, memld, 2, SEG_ES, di)) return false;
            if ((memld.addr1 & (stepBytes - 1)) !== 0) {
                while (this.getAddrReg(adsz16, 1)) {
                    const curDi = this.getAddrReg(adsz16, 7);
                    if (!this.translateBit(bit, memld, 2, SEG_ES, curDi)) return false;
                    this.storeBit(bit, memld, ax);
                    this.setAddrReg(adsz16, 7, curDi + dir);
                    this.setAddrReg(adsz16, 1, this.getAddrReg(adsz16, 1) - 1);
                }
                break;
            }
            let count = cx;
            const countd = dir > 0
                ? Math.floor((4096 - (memld.addr1 & 4095)) / stepBytes)
                : 1 + Math.floor((memld.addr1 & 4095) / stepBytes);
            if (countd < count) count = countd;
            for (let i = 0; i < count; i++) {
                this.storeBit(bit, memld, ax);
                memld.addr1 = (memld.addr1 + dir) >>> 0;
            }
            this.setAddrReg(adsz16, 7, di + count * dir);
            this.setAddrReg(adsz16, 1, cx - count);
            cx = this.getAddrReg(adsz16, 1);
        }
        return true;
    }

    execLods(bit, adsz16, curr_seg, rep) {
        if (curr_seg === -1) curr_seg = SEG_DS;
        const stepBytes = bit >>> 3;
        const dir = (this.flags & DF) ? -stepBytes : stepBytes;
        const meml = this._meml;

        if (rep === 0) {
            const si = this.getAddrReg(adsz16, 6);
            if (!this.translateBit(bit, meml, 1, curr_seg, si)) return false;
            const ax = this.loadBit(bit, meml);
            this.setAddrReg(adsz16, 6, si + dir);
            this.setRegBit(bit, 0, ax);
            return true;
        }

        while (this.getAddrReg(adsz16, 1)) {
            const si = this.getAddrReg(adsz16, 6);
            if (!this.translateBit(bit, meml, 1, curr_seg, si)) return false;
            const ax = this.loadBit(bit, meml);
            this.setAddrReg(adsz16, 6, si + dir);
            this.setRegBit(bit, 0, ax);
            this.setAddrReg(adsz16, 1, this.getAddrReg(adsz16, 1) - 1);
        }
        return true;
    }

    execScas(bit, adsz16, rep) {
        const stepBytes = bit >>> 3;
        const dir = (this.flags & DF) ? -stepBytes : stepBytes;
        const ax0 = this.sextBit(bit, this.regs[0]);
        const meml = this._meml;

        if (rep === 0) {
            const di = this.getAddrReg(adsz16, 7);
            if (!this.translateBit(bit, meml, 1, SEG_ES, di)) return false;
            const ax = this.loadBit(bit, meml);
            this.setAddrReg(adsz16, 7, di + dir);
            this.cc_src1 = ax0;
            this.cc_src2 = this.sextBit(bit, ax);
            this.cc_dst = this.sextBit(bit, this.cc_src1 - this.cc_src2);
            this.cc_op = CC_SUB;
            this.cc_mask = CF | PF | AF | ZF | SF | OF;
            return true;
        }

        while (this.getAddrReg(adsz16, 1)) {
            const di = this.getAddrReg(adsz16, 7);
            if (!this.translateBit(bit, meml, 1, SEG_ES, di)) return false;
            const ax = this.loadBit(bit, meml);
            this.setAddrReg(adsz16, 7, di + dir);
            this.setAddrReg(adsz16, 1, this.getAddrReg(adsz16, 1) - 1);
            this.cc_src1 = ax0;
            this.cc_src2 = this.sextBit(bit, ax);
            this.cc_dst = this.sextBit(bit, this.cc_src1 - this.cc_src2);
            this.cc_op = CC_SUB;
            this.cc_mask = CF | PF | AF | ZF | SF | OF;
            const zf = this.get_ZF();
            if ((zf && rep === 2) || (!zf && rep === 1)) break;
        }
        return true;
    }

    execMovs(bit, adsz16, curr_seg, rep) {
        if (curr_seg === -1) curr_seg = SEG_DS;
        const stepBytes = bit >>> 3;
        const dir = (this.flags & DF) ? -stepBytes : stepBytes;
        const memls = this._memls;
        const memld = this._memld;

        if (rep === 0) {
            const si = this.getAddrReg(adsz16, 6);
            const di = this.getAddrReg(adsz16, 7);
            if (!this.translateBit(bit, memls, 1, curr_seg, si)) return false;
            const ax = this.loadBit(bit, memls);
            if (!this.translateBit(bit, memld, 2, SEG_ES, di)) return false;
            this.storeBit(bit, memld, ax);
            this.setAddrReg(adsz16, 6, si + dir);
            this.setAddrReg(adsz16, 7, di + dir);
            return true;
        }

        let cx = this.getAddrReg(adsz16, 1);
        while (cx) {
            const si = this.getAddrReg(adsz16, 6);
            const di = this.getAddrReg(adsz16, 7);
            if (!this.translateBit(bit, memls, 1, curr_seg, si)) return false;
            if (!this.translateBit(bit, memld, 2, SEG_ES, di)) return false;
            if ((memls.addr1 & (stepBytes - 1)) !== 0 || (memld.addr1 & (stepBytes - 1)) !== 0) {
                while (this.getAddrReg(adsz16, 1)) {
                    const curSi = this.getAddrReg(adsz16, 6);
                    const curDi = this.getAddrReg(adsz16, 7);
                    if (!this.translateBit(bit, memls, 1, curr_seg, curSi)) return false;
                    const ax = this.loadBit(bit, memls);
                    if (!this.translateBit(bit, memld, 2, SEG_ES, curDi)) return false;
                    this.storeBit(bit, memld, ax);
                    this.setAddrReg(adsz16, 6, curSi + dir);
                    this.setAddrReg(adsz16, 7, curDi + dir);
                    this.setAddrReg(adsz16, 1, this.getAddrReg(adsz16, 1) - 1);
                }
                break;
            }
            let count = cx;
            let counts, countd;
            if (dir > 0) {
                counts = Math.floor((4096 - (memls.addr1 & 4095)) / stepBytes);
                countd = Math.floor((4096 - (memld.addr1 & 4095)) / stepBytes);
            } else {
                counts = 1 + Math.floor((memls.addr1 & 4095) / stepBytes);
                countd = 1 + Math.floor((memld.addr1 & 4095) / stepBytes);
            }
            if (counts < count) count = counts;
            if (countd < count) count = countd;

            if (dir > 0 && this.in_iomem(memld.addr1) &&
                this.in_iomem((memld.addr1 + count - 1) >>> 0) &&
                ((memls.addr1 | 4095) >>> 0) < this.phys_mem_size &&
                !this.in_iomem(memls.addr1) && !this.in_iomem((memls.addr1 | 4095) >>> 0)) {
                if (this.bus.iomemWriteString(memld.addr1, this.ram, memls.addr1, count * dir)) {
                    this.setAddrReg(adsz16, 6, si + count * dir);
                    this.setAddrReg(adsz16, 7, di + count * dir);
                    this.setAddrReg(adsz16, 1, cx - count);
                    cx = this.getAddrReg(adsz16, 1);
                    continue;
                }
            }

            for (let i = 0; i < count; i++) {
                this.storeBit(bit, memld, this.loadBit(bit, memls));
                memld.addr1 = (memld.addr1 + dir) >>> 0;
                memls.addr1 = (memls.addr1 + dir) >>> 0;
            }
            this.setAddrReg(adsz16, 6, si + count * dir);
            this.setAddrReg(adsz16, 7, di + count * dir);
            this.setAddrReg(adsz16, 1, cx - count);
            cx = this.getAddrReg(adsz16, 1);
        }
        return true;
    }

    execCmps(bit, adsz16, curr_seg, rep) {
        if (curr_seg === -1) curr_seg = SEG_DS;
        const stepBytes = bit >>> 3;
        const dir = (this.flags & DF) ? -stepBytes : stepBytes;
        const memls = this._memls;
        const memld = this._memld;

        if (rep === 0) {
            const si = this.getAddrReg(adsz16, 6);
            const di = this.getAddrReg(adsz16, 7);
            if (!this.translateBit(bit, memls, 1, curr_seg, si)) return false;
            const ax0 = this.loadBit(bit, memls);
            if (!this.translateBit(bit, memld, 1, SEG_ES, di)) return false;
            const ax = this.loadBit(bit, memld);
            this.setAddrReg(adsz16, 6, si + dir);
            this.setAddrReg(adsz16, 7, di + dir);
            this.cc_src1 = this.sextBit(bit, ax0);
            this.cc_src2 = this.sextBit(bit, ax);
            this.cc_dst = this.sextBit(bit, this.cc_src1 - this.cc_src2);
            this.cc_op = CC_SUB;
            this.cc_mask = CF | PF | AF | ZF | SF | OF;
            return true;
        }

        while (this.getAddrReg(adsz16, 1)) {
            const si = this.getAddrReg(adsz16, 6);
            const di = this.getAddrReg(adsz16, 7);
            if (!this.translateBit(bit, memls, 1, curr_seg, si)) return false;
            const ax0 = this.loadBit(bit, memls);
            if (!this.translateBit(bit, memld, 1, SEG_ES, di)) return false;
            const ax = this.loadBit(bit, memld);
            this.setAddrReg(adsz16, 6, si + dir);
            this.setAddrReg(adsz16, 7, di + dir);
            this.setAddrReg(adsz16, 1, this.getAddrReg(adsz16, 1) - 1);
            this.cc_src1 = this.sextBit(bit, ax0);
            this.cc_src2 = this.sextBit(bit, ax);
            this.cc_dst = this.sextBit(bit, this.cc_src1 - this.cc_src2);
            this.cc_op = CC_SUB;
            this.cc_mask = CF | PF | AF | ZF | SF | OF;
            const zf = this.get_ZF();
            if ((zf && rep === 2) || (!zf && rep === 1)) break;
        }
        return true;
    }

    execIns(bit, adsz16, rep) {
        const port = this.lreg16(2);
        if (!this.check_ioperm(port, bit)) return false;
        const stepBytes = bit >>> 3;
        const dir = (this.flags & DF) ? -stepBytes : stepBytes;
        const memld = this._memld;

        if (rep === 0) {
            const di = this.getAddrReg(adsz16, 7);
            if (!this.translateBit(bit, memld, 2, SEG_ES, di)) return false;
            const ax = this.bus.ioRead(port, stepBytes);
            this.storeBit(bit, memld, ax);
            this.setAddrReg(adsz16, 7, di + dir);
            return true;
        }

        if (rep !== 1) {
            this.excno = EX_UD;
            return false;
        }

        let cx = this.getAddrReg(adsz16, 1);
        while (cx) {
            const di = this.getAddrReg(adsz16, 7);
            if (!this.translateBit(bit, memld, 2, SEG_ES, di)) return false;
            if ((memld.addr1 & (stepBytes - 1)) !== 0) {
                while (this.getAddrReg(adsz16, 1)) {
                    const curDi = this.getAddrReg(adsz16, 7);
                    if (!this.translateBit(bit, memld, 2, SEG_ES, curDi)) return false;
                    const ax = this.bus.ioRead(port, stepBytes);
                    this.storeBit(bit, memld, ax);
                    this.setAddrReg(adsz16, 7, curDi + dir);
                    this.setAddrReg(adsz16, 1, this.getAddrReg(adsz16, 1) - 1);
                }
                break;
            }
            let count = cx;
            const countd = dir > 0
                ? Math.floor((4096 - (memld.addr1 & 4095)) / stepBytes)
                : 1 + Math.floor((memld.addr1 & 4095) / stepBytes);
            if (countd < count) count = countd;

            if (dir > 0 && ((memld.addr1 | 4095) >>> 0) < this.phys_mem_size &&
                !this.in_iomem(memld.addr1) && !this.in_iomem((memld.addr1 | 4095) >>> 0)) {
                const count1 = this.bus.ioReadString(port, this.ram, memld.addr1, dir, count);
                if (count1 > 0) {
                    count = count1;
                    this.setAddrReg(adsz16, 7, di + count * dir);
                    this.setAddrReg(adsz16, 1, cx - count);
                    cx = this.getAddrReg(adsz16, 1);
                    continue;
                }
            }

            for (let i = 0; i < count; i++) {
                const ax = this.bus.ioRead(port, stepBytes);
                this.storeBit(bit, memld, ax);
                memld.addr1 = (memld.addr1 + dir) >>> 0;
            }
            this.setAddrReg(adsz16, 7, di + count * dir);
            this.setAddrReg(adsz16, 1, cx - count);
            cx = this.getAddrReg(adsz16, 1);
        }
        return true;
    }

    execOuts(bit, adsz16, curr_seg, rep) {
        if (curr_seg === -1) curr_seg = SEG_DS;
        const port = this.lreg16(2);
        if (!this.check_ioperm(port, bit)) return false;
        const stepBytes = bit >>> 3;
        const dir = (this.flags & DF) ? -stepBytes : stepBytes;
        const memls = this._memls;

        if (rep === 0) {
            const si = this.getAddrReg(adsz16, 6);
            if (!this.translateBit(bit, memls, 1, curr_seg, si)) return false;
            const ax = this.loadBit(bit, memls);
            this.bus.ioWrite(port, ax, stepBytes);
            this.setAddrReg(adsz16, 6, si + dir);
            return true;
        }

        if (rep !== 1) {
            this.excno = EX_UD;
            return false;
        }

        let cx = this.getAddrReg(adsz16, 1);
        while (cx) {
            const si = this.getAddrReg(adsz16, 6);
            if (!this.translateBit(bit, memls, 1, curr_seg, si)) return false;
            if ((memls.addr1 & (stepBytes - 1)) !== 0) {
                while (this.getAddrReg(adsz16, 1)) {
                    const curSi = this.getAddrReg(adsz16, 6);
                    if (!this.translateBit(bit, memls, 1, curr_seg, curSi)) return false;
                    const ax = this.loadBit(bit, memls);
                    this.bus.ioWrite(port, ax, stepBytes);
                    this.setAddrReg(adsz16, 6, curSi + dir);
                    this.setAddrReg(adsz16, 1, this.getAddrReg(adsz16, 1) - 1);
                }
                break;
            }
            let count = cx;
            const counts = dir > 0
                ? Math.floor((4096 - (memls.addr1 & 4095)) / stepBytes)
                : 1 + Math.floor((memls.addr1 & 4095) / stepBytes);
            if (counts < count) count = counts;

            if (dir > 0 && ((memls.addr1 | 4095) >>> 0) < this.phys_mem_size &&
                !this.in_iomem(memls.addr1) && !this.in_iomem((memls.addr1 | 4095) >>> 0)) {
                const count1 = this.bus.ioWriteString(port, this.ram, memls.addr1, dir, count);
                if (count1 > 0) {
                    count = count1;
                    this.setAddrReg(adsz16, 6, si + count * dir);
                    this.setAddrReg(adsz16, 1, cx - count);
                    cx = this.getAddrReg(adsz16, 1);
                    continue;
                }
            }

            for (let i = 0; i < count; i++) {
                const ax = this.loadBit(bit, memls);
                this.bus.ioWrite(port, ax, stepBytes);
                memls.addr1 = (memls.addr1 + dir) >>> 0;
            }
            this.setAddrReg(adsz16, 6, si + count * dir);
            this.setAddrReg(adsz16, 1, cx - count);
            cx = this.getAddrReg(adsz16, 1);
        }
        return true;
    }

    evalCond(code) {
        switch (code & 0xf) {
            case 0x0: return this.get_OF();
            case 0x1: return this.get_OF() ^ 1;
            case 0x2: return this.get_CF();
            case 0x3: return this.get_CF() ^ 1;
            case 0x4: return this.get_ZF();
            case 0x5: return this.get_ZF() ^ 1;
            case 0x6: return (this.get_ZF() || this.get_CF()) ? 1 : 0;
            case 0x7: return (!this.get_ZF() && !this.get_CF()) ? 1 : 0;
            case 0x8: return this.get_SF();
            case 0x9: return this.get_SF() ^ 1;
            case 0xa: return this.get_PF();
            case 0xb: return this.get_PF() ^ 1;
            case 0xc: return (this.get_SF() !== this.get_OF()) ? 1 : 0;
            case 0xd: return (this.get_SF() === this.get_OF()) ? 1 : 0;
            case 0xe: return (this.get_ZF() || (this.get_SF() !== this.get_OF())) ? 1 : 0;
            case 0xf: return (!this.get_ZF() && (this.get_SF() === this.get_OF())) ? 1 : 0;
        }
        return 0;
    }

    /* ======================================================================
     * MAIN INSTRUCTION EXECUTION ENGINE (i386.c + i386ins.def)
     * ====================================================================== */

    execAluOp(opIdx, bit, a, b) {
        if (bit === 8) {
            switch (opIdx) {
                case 0: return this.aluAdd8(a, b);
                case 1: return this.aluOr8(a, b);
                case 2: return this.aluAdc8(a, b);
                case 3: return this.aluSbb8(a, b);
                case 4: return this.aluAnd8(a, b);
                case 5: return this.aluSub8(a, b);
                case 6: return this.aluXor8(a, b);
                case 7: this.aluCmp8(a, b); return null;
            }
        } else if (bit === 16) {
            switch (opIdx) {
                case 0: return this.aluAdd16(a, b);
                case 1: return this.aluOr16(a, b);
                case 2: return this.aluAdc16(a, b);
                case 3: return this.aluSbb16(a, b);
                case 4: return this.aluAnd16(a, b);
                case 5: return this.aluSub16(a, b);
                case 6: return this.aluXor16(a, b);
                case 7: this.aluCmp16(a, b); return null;
            }
        } else {
            switch (opIdx) {
                case 0: return this.aluAdd32(a, b);
                case 1: return this.aluOr32(a, b);
                case 2: return this.aluAdc32(a, b);
                case 3: return this.aluSbb32(a, b);
                case 4: return this.aluAnd32(a, b);
                case 5: return this.aluSub32(a, b);
                case 6: return this.aluXor32(a, b);
                case 7: this.aluCmp32(a, b); return null;
            }
        }
        return null;
    }

    execShiftOp(opIdx, bit, val, count) {
        switch (opIdx & 7) {
            case 0: return this.rol(bit, val, count);
            case 1: return this.ror(bit, val, count);
            case 2: return this.rcl(bit, val, count);
            case 3: return this.rcr(bit, val, count);
            case 4:
            case 6:
                return bit === 8 ? this.shl8(val, count) : (bit === 16 ? this.shl16(val, count) : this.shl32(val, count));
            case 5:
                return bit === 8 ? this.shr8(val, count) : (bit === 16 ? this.shr16(val, count) : this.shr32(val, count));
            case 7:
                return bit === 8 ? this.sar8(val, count) : (bit === 16 ? this.sar16(val, count) : this.sar32(val, count));
        }
        return val;
    }

    cpu_exec1(stepcount) {
        const meml = this._meml;
        const meml1 = this._meml1;
        const meml2 = this._meml2;
        const meml3 = this._meml3;

        for (; stepcount > 0; stepcount--) {
            const code16 = this.code16;
            const sp_mask = this.sp_mask;

            this.ip = this.next_ip;
            let b1 = this.fetch8pf();
            if (b1 === -1) return false;
            this.cycle++;

            let opsz16 = code16;
            let adsz16 = code16;
            let rep = 0;
            let curr_seg = -1;

            // Prefix decode loop
            for (;;) {
                if (b1 === 0x26) { curr_seg = SEG_ES; b1 = this.fetch8(); if (b1 === -1) return false; continue; }
                if (b1 === 0x2e) { curr_seg = SEG_CS; b1 = this.fetch8(); if (b1 === -1) return false; continue; }
                if (b1 === 0x36) { curr_seg = SEG_SS; b1 = this.fetch8(); if (b1 === -1) return false; continue; }
                if (b1 === 0x3e) { curr_seg = SEG_DS; b1 = this.fetch8(); if (b1 === -1) return false; continue; }
                if (b1 === 0x64) { curr_seg = SEG_FS; b1 = this.fetch8(); if (b1 === -1) return false; continue; }
                if (b1 === 0x65) { curr_seg = SEG_GS; b1 = this.fetch8(); if (b1 === -1) return false; continue; }
                if (b1 === 0x66) { opsz16 = !code16; b1 = this.fetch8(); if (b1 === -1) return false; continue; }
                if (b1 === 0x67) { adsz16 = !code16; b1 = this.fetch8(); if (b1 === -1) return false; continue; }
                if (b1 === 0xf3) { rep = 1; b1 = this.fetch8(); if (b1 === -1) return false; continue; }
                if (b1 === 0xf2) { rep = 2; b1 = this.fetch8(); if (b1 === -1) return false; continue; }
                if (b1 === 0xf0) { b1 = this.fetch8(); if (b1 === -1) return false; continue; }
                break;
            }

            // Standard ALU block 0x00..0x3D (except 0x06,0x07,0x0E,0x0F,0x16,0x17,0x1E,0x1F,0x27,0x2F,0x37,0x3F)
            if (b1 < 0x40 && (b1 & 7) < 6) {
                const aluOp = (b1 >>> 3) & 7;
                const sub = b1 & 7;
                const rwm = aluOp === 7 ? 1 : 3;
                if (sub === 0) { // Eb, Gb
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    if (mod === 3) {
                        const res = this.execAluOp(aluOp, 8, this.lreg8(rm), this.lreg8(reg));
                        if (res !== null) this.sreg8(rm, res);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate8(meml, rwm, m.seg, m.addr)) return false;
                        const res = this.execAluOp(aluOp, 8, this.load8(meml), this.lreg8(reg));
                        if (res !== null) this.store8(meml, res);
                    }
                } else if (sub === 1) { // Ev, Gv
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const bit = opsz16 ? 16 : 32;
                    if (mod === 3) {
                        const a = opsz16 ? this.lreg16(rm) : this.regs[rm];
                        const b = opsz16 ? this.lreg16(reg) : this.regs[reg];
                        const res = this.execAluOp(aluOp, bit, a, b);
                        if (res !== null) { if (opsz16) this.sreg16(rm, res); else this.regs[rm] = res; }
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translateBit(bit, meml, rwm, m.seg, m.addr)) return false;
                        const a = this.loadBit(bit, meml);
                        const b = opsz16 ? this.lreg16(reg) : this.regs[reg];
                        const res = this.execAluOp(aluOp, bit, a, b);
                        if (res !== null) this.storeBit(bit, meml, res);
                    }
                } else if (sub === 2) { // Gb, Eb
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    let opr;
                    if (mod === 3) {
                        opr = this.lreg8(rm);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate8(meml, 1, m.seg, m.addr)) return false;
                        opr = this.load8(meml);
                    }
                    const res = this.execAluOp(aluOp, 8, this.lreg8(reg), opr);
                    if (res !== null) this.sreg8(reg, res);
                } else if (sub === 3) { // Gv, Ev
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const bit = opsz16 ? 16 : 32;
                    let opr;
                    if (mod === 3) {
                        opr = opsz16 ? this.lreg16(rm) : this.regs[rm];
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translateBit(bit, meml, 1, m.seg, m.addr)) return false;
                        opr = this.loadBit(bit, meml);
                    }
                    const a = opsz16 ? this.lreg16(reg) : this.regs[reg];
                    const res = this.execAluOp(aluOp, bit, a, opr);
                    if (res !== null) { if (opsz16) this.sreg16(reg, res); else this.regs[reg] = res; }
                } else if (sub === 4) { // AL, Ib
                    const imm8 = this.fetch8(); if (imm8 === -1) return false;
                    const res = this.execAluOp(aluOp, 8, this.lreg8(0), imm8);
                    if (res !== null) this.sreg8(0, res);
                } else { // AX/EAX, Iv
                    if (opsz16) {
                        const imm16 = this.fetch16(); if (imm16 === -1) return false;
                        const res = this.execAluOp(aluOp, 16, this.lreg16(0), imm16);
                        if (res !== null) this.sreg16(0, res);
                    } else {
                        const imm32 = this.fetch32(); if (imm32 === -1) return false;
                        const res = this.execAluOp(aluOp, 32, this.regs[0], imm32);
                        if (res !== null) this.regs[0] = res;
                    }
                }
                continue;
            }

            switch (b1) {
                case 0x06: // PUSH ES
                case 0x0e: // PUSH CS
                case 0x16: // PUSH SS
                case 0x1e: { // PUSH DS
                    const seg = (b1 >>> 3) & 3;
                    const sp = this.regs[4];
                    const step = opsz16 ? 2 : 4;
                    if (!this.translate16(meml, 2, SEG_SS, (sp - step) & sp_mask)) return false;
                    this.set_sp(sp - step, sp_mask);
                    this.store16(meml, this.lseg(seg));
                    break;
                }
                case 0x07: // POP ES
                case 0x17: // POP SS
                case 0x1f: { // POP DS
                    const seg = (b1 >>> 3) & 3;
                    const sp = this.regs[4];
                    const step = opsz16 ? 2 : 4;
                    if (!this.translate16(meml, 1, SEG_SS, sp & sp_mask)) return false;
                    if (!this.set_seg(seg, this.load16(meml))) return false;
                    this.set_sp(sp + step, sp_mask);
                    if (seg === SEG_SS) stepcount++;
                    break;
                }
                case 0x27: this.__DAA_helper(); break;
                case 0x2f: this.__DAS_helper(); break;
                case 0x37: this.__AAA_helper(); break;
                case 0x3f: this.__AAS_helper(); break;

                // INC r16/r32
                case 0x40: case 0x41: case 0x42: case 0x43:
                case 0x44: case 0x45: case 0x46: case 0x47: {
                    const r = b1 & 7;
                    if (opsz16) this.sreg16(r, this.aluInc16(this.lreg16(r)));
                    else this.regs[r] = this.aluInc32(this.regs[r]);
                    break;
                }
                // DEC r16/r32
                case 0x48: case 0x49: case 0x4a: case 0x4b:
                case 0x4c: case 0x4d: case 0x4e: case 0x4f: {
                    const r = b1 & 7;
                    if (opsz16) this.sreg16(r, this.aluDec16(this.lreg16(r)));
                    else this.regs[r] = this.aluDec32(this.regs[r]);
                    break;
                }
                // PUSH r16/r32
                case 0x50: case 0x51: case 0x52: case 0x53:
                case 0x54: case 0x55: case 0x56: case 0x57: {
                    const r = b1 & 7;
                    const sp = this.regs[4];
                    if (opsz16) {
                        const val = this.lreg16(r);
                        if (!this.translate16(meml1, 2, SEG_SS, (sp - 2) & sp_mask)) return false;
                        this.set_sp(sp - 2, sp_mask);
                        this.store16(meml1, val);
                    } else {
                        const val = this.regs[r];
                        if (!this.translate32(meml1, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
                        this.set_sp(sp - 4, sp_mask);
                        this.store32(meml1, val);
                    }
                    break;
                }
                // POP r16/r32
                case 0x58: case 0x59: case 0x5a: case 0x5b:
                case 0x5c: case 0x5d: case 0x5e: case 0x5f: {
                    const r = b1 & 7;
                    const sp = this.regs[4];
                    if (opsz16) {
                        if (!this.translate16(meml1, 1, SEG_SS, sp & sp_mask)) return false;
                        const src = this.load16(meml1);
                        this.set_sp(sp + 2, sp_mask);
                        this.sreg16(r, src);
                    } else {
                        if (!this.translate32(meml1, 1, SEG_SS, sp & sp_mask)) return false;
                        const src = this.load32(meml1);
                        this.set_sp(sp + 4, sp_mask);
                        this.regs[r] = src;
                    }
                    break;
                }
                case 0x60: { // PUSHA / PUSHAD
                    const sp = this.regs[4];
                    const bit = opsz16 ? 16 : 32;
                    const byte = opsz16 ? 2 : 4;
                    const m = [this._meml1, this._meml2, this._meml3, this._meml4, this._meml5, this._meml6, this._meml7, this._meml8];
                    for (let i = 0; i < 8; i++) {
                        if (!this.translateBit(bit, m[i], 2, SEG_SS, (sp - byte * (i + 1)) & sp_mask)) return false;
                    }
                    for (let i = 0; i < 8; i++) {
                        const val = (i === 4) ? sp : (opsz16 ? this.lreg16(i) : this.regs[i]);
                        this.storeBit(bit, m[i], val);
                    }
                    this.set_sp(sp - byte * 8, sp_mask);
                    break;
                }
                case 0x61: { // POPA / POPAD
                    const sp = this.regs[4];
                    const bit = opsz16 ? 16 : 32;
                    const byte = opsz16 ? 2 : 4;
                    const m = [this._meml1, this._meml2, this._meml3, this._meml4, this._meml5, this._meml6, this._meml7];
                    const offsets = [0, 1, 2, 4, 5, 6, 7];
                    for (let i = 0; i < 7; i++) {
                        if (!this.translateBit(bit, m[i], 1, SEG_SS, (sp + byte * offsets[i]) & sp_mask)) return false;
                    }
                    const regOrder = [7, 6, 5, 3, 2, 1, 0];
                    for (let i = 0; i < 7; i++) {
                        this.setRegBit(bit, regOrder[i], this.loadBit(bit, m[i]));
                    }
                    this.set_sp(sp + byte * 8, sp_mask);
                    break;
                }
                case 0x62: { // BOUND Gv, Ma
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    let addr1;
                    if (mod === 3) {
                        addr1 = opsz16 ? this.lreg16(rm) : this.regs[rm];
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        addr1 = m.addr;
                        curr_seg = m.seg;
                    }
                    if (opsz16) {
                        const idx = (this.lreg16(reg) << 16) >> 16;
                        if (!this.translate16(meml1, 3, curr_seg, addr1)) return false;
                        if (!this.translate16(meml2, 3, curr_seg, (addr1 + 2) >>> 0)) return false;
                        const lo = (this.load16(meml1) << 16) >> 16;
                        const hi = (this.load16(meml2) << 16) >> 16;
                        if (idx < lo || idx > hi) { this.excno = EX_BR; return false; }
                    } else {
                        const idx = this.regs[reg] | 0;
                        if (!this.translate32(meml1, 3, curr_seg, addr1)) return false;
                        if (!this.translate32(meml2, 3, curr_seg, (addr1 + 4) >>> 0)) return false;
                        const lo = this.load32(meml1) | 0;
                        const hi = this.load32(meml2) | 0;
                        if (idx < lo || idx > hi) { this.excno = EX_BR; return false; }
                    }
                    break;
                }
                case 0x63: { // ARPL Ew, Gw
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    if (!(this.cr0 & 1) || (this.flags & VM)) { this.excno = EX_UD; return false; }
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const src = this.lreg16(reg);
                    if (mod === 3) {
                        const dst = this.lreg16(rm);
                        if ((dst & 3) < (src & 3)) {
                            this.flags |= ZF;
                            this.sreg16(rm, (dst & ~3) | (src & 3));
                        } else {
                            this.flags &= ~ZF;
                        }
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate16(meml, 3, m.seg, m.addr)) return false;
                        const dst = this.load16(meml);
                        if ((dst & 3) < (src & 3)) {
                            this.flags |= ZF;
                            this.store16(meml, (dst & ~3) | (src & 3));
                        } else {
                            this.flags &= ~ZF;
                        }
                    }
                    this.cc_mask &= ~ZF;
                    break;
                }
                case 0x68: { // PUSH Iv
                    const sp = this.regs[4];
                    if (opsz16) {
                        const imm16 = this.fetch16(); if (imm16 === -1) return false;
                        if (!this.translate16(meml1, 2, SEG_SS, (sp - 2) & sp_mask)) return false;
                        this.set_sp(sp - 2, sp_mask);
                        this.store16(meml1, imm16);
                    } else {
                        const imm32 = this.fetch32(); if (imm32 === -1) return false;
                        if (!this.translate32(meml1, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
                        this.set_sp(sp - 4, sp_mask);
                        this.store32(meml1, imm32);
                    }
                    break;
                }
                case 0x69: // IMUL Gv, Ev, Iv
                case 0x6b: { // IMUL Gv, Ev, Ib
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    let opr;
                    if (mod === 3) {
                        opr = opsz16 ? this.lreg16(rm) : this.regs[rm];
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translateBit(opsz16 ? 16 : 32, meml, 1, m.seg, m.addr)) return false;
                        opr = this.loadBit(opsz16 ? 16 : 32, meml);
                    }
                    let imm;
                    if (b1 === 0x6b) {
                        const imm8 = this.fetch8(); if (imm8 === -1) return false;
                        imm = sext8(imm8);
                    } else if (opsz16) {
                        const imm16 = this.fetch16(); if (imm16 === -1) return false;
                        imm = sext16(imm16);
                    } else {
                        const imm32 = this.fetch32(); if (imm32 === -1) return false;
                        imm = sext32(imm32);
                    }
                    if (opsz16) this.sreg16(reg, this.imul2_16(opr, imm));
                    else this.regs[reg] = this.imul2_32(opr, imm);
                    break;
                }
                case 0x6a: { // PUSH Ib
                    const imm8 = this.fetch8(); if (imm8 === -1) return false;
                    const val = sext8(imm8);
                    const sp = this.regs[4];
                    if (opsz16) {
                        if (!this.translate16(meml1, 2, SEG_SS, (sp - 2) & sp_mask)) return false;
                        this.set_sp(sp - 2, sp_mask);
                        this.store16(meml1, val);
                    } else {
                        if (!this.translate32(meml1, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
                        this.set_sp(sp - 4, sp_mask);
                        this.store32(meml1, val);
                    }
                    break;
                }
                case 0x6c: if (!this.execIns(8, adsz16, rep)) return false; break;
                case 0x6d: if (!this.execIns(opsz16 ? 16 : 32, adsz16, rep)) return false; break;
                case 0x6e: if (!this.execOuts(8, adsz16, curr_seg, rep)) return false; break;
                case 0x6f: if (!this.execOuts(opsz16 ? 16 : 32, adsz16, curr_seg, rep)) return false; break;

                // Jcc Jb
                case 0x70: case 0x71: case 0x72: case 0x73:
                case 0x74: case 0x75: case 0x76: case 0x77:
                case 0x78: case 0x79: case 0x7a: case 0x7b:
                case 0x7c: case 0x7d: case 0x7e: case 0x7f: {
                    const imm8 = this.fetch8(); if (imm8 === -1) return false;
                    if (this.evalCond(b1)) {
                        const d = (imm8 << 24) >> 24;
                        this.next_ip = (this.next_ip + d) >>> 0;
                        if (code16) this.next_ip &= 0xffff;
                    }
                    break;
                }

                // GRP1 Eb, Ib
                case 0x80:
                case 0x82: {
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const aluOp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const rwm = aluOp === 7 ? 1 : 3;
                    if (mod === 3) {
                        const imm8 = this.fetch8(); if (imm8 === -1) return false;
                        const res = this.execAluOp(aluOp, 8, this.lreg8(rm), imm8);
                        if (res !== null) this.sreg8(rm, res);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        const imm8 = this.fetch8(); if (imm8 === -1) return false;
                        if (!this.translate8(meml, rwm, m.seg, m.addr)) return false;
                        const res = this.execAluOp(aluOp, 8, this.load8(meml), imm8);
                        if (res !== null) this.store8(meml, res);
                    }
                    break;
                }
                // GRP1 Ev, Iv / Ev, Ib
                case 0x81:
                case 0x83: {
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const aluOp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const rwm = aluOp === 7 ? 1 : 3;
                    const bit = opsz16 ? 16 : 32;
                    let m = null;
                    if (mod !== 3) {
                        m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    }
                    let imm;
                    if (b1 === 0x83) {
                        const imm8 = this.fetch8(); if (imm8 === -1) return false;
                        imm = opsz16 ? (((imm8 << 24) >> 24) & 0xffff) : sext8(imm8);
                    } else if (opsz16) {
                        imm = this.fetch16(); if (imm === -1) return false;
                    } else {
                        imm = this.fetch32(); if (imm === -1) return false;
                    }
                    if (mod === 3) {
                        const a = opsz16 ? this.lreg16(rm) : this.regs[rm];
                        const res = this.execAluOp(aluOp, bit, a, imm);
                        if (res !== null) { if (opsz16) this.sreg16(rm, res); else this.regs[rm] = res; }
                    } else {
                        if (!this.translateBit(bit, meml, rwm, m.seg, m.addr)) return false;
                        const res = this.execAluOp(aluOp, bit, this.loadBit(bit, meml), imm);
                        if (res !== null) this.storeBit(bit, meml, res);
                    }
                    break;
                }
                case 0x84: { // TEST Eb, Gb
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    if (mod === 3) {
                        this.aluTest8(this.lreg8(rm), this.lreg8(reg));
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate8(meml, 1, m.seg, m.addr)) return false;
                        this.aluTest8(this.load8(meml), this.lreg8(reg));
                    }
                    break;
                }
                case 0x85: { // TEST Ev, Gv
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const bit = opsz16 ? 16 : 32;
                    if (mod === 3) {
                        if (opsz16) this.aluTest16(this.lreg16(rm), this.lreg16(reg));
                        else this.aluTest32(this.regs[rm], this.regs[reg]);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translateBit(bit, meml, 1, m.seg, m.addr)) return false;
                        if (opsz16) this.aluTest16(this.load16(meml), this.lreg16(reg));
                        else this.aluTest32(this.load32(meml), this.regs[reg]);
                    }
                    break;
                }
                case 0x86: { // XCHG Eb, Gb
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const b = this.lreg8(reg);
                    if (mod === 3) {
                        this.sreg8(reg, this.lreg8(rm));
                        this.sreg8(rm, b);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate8(meml, 3, m.seg, m.addr)) return false;
                        this.sreg8(reg, this.load8(meml));
                        this.store8(meml, b);
                    }
                    break;
                }
                case 0x87: { // XCHG Ev, Gv
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const bit = opsz16 ? 16 : 32;
                    const b = opsz16 ? this.lreg16(reg) : this.regs[reg];
                    if (mod === 3) {
                        const a = opsz16 ? this.lreg16(rm) : this.regs[rm];
                        this.setRegBit(bit, reg, a);
                        this.setRegBit(bit, rm, b);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translateBit(bit, meml, 3, m.seg, m.addr)) return false;
                        const a = this.loadBit(bit, meml);
                        this.setRegBit(bit, reg, a);
                        this.storeBit(bit, meml, b);
                    }
                    break;
                }
                case 0x88: { // MOV Eb, Gb
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    if (mod === 3) {
                        this.sreg8(rm, this.lreg8(reg));
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate8(meml, 2, m.seg, m.addr)) return false;
                        this.store8(meml, this.lreg8(reg));
                    }
                    break;
                }
                case 0x89: { // MOV Ev, Gv
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const bit = opsz16 ? 16 : 32;
                    const val = opsz16 ? this.lreg16(reg) : this.regs[reg];
                    if (mod === 3) {
                        this.setRegBit(bit, rm, val);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translateBit(bit, meml, 2, m.seg, m.addr)) return false;
                        this.storeBit(bit, meml, val);
                    }
                    break;
                }
                case 0x8a: { // MOV Gb, Eb
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    if (mod === 3) {
                        this.sreg8(reg, this.lreg8(rm));
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate8(meml, 1, m.seg, m.addr)) return false;
                        this.sreg8(reg, this.load8(meml));
                    }
                    break;
                }
                case 0x8b: { // MOV Gv, Ev
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const bit = opsz16 ? 16 : 32;
                    if (mod === 3) {
                        this.setRegBit(bit, reg, opsz16 ? this.lreg16(rm) : this.regs[rm]);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translateBit(bit, meml, 1, m.seg, m.addr)) return false;
                        this.setRegBit(bit, reg, this.loadBit(bit, meml));
                    }
                    break;
                }
                case 0x8c: { // MOV Ew, Sw
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const val = this.lseg(reg);
                    if (mod === 3) {
                        if (opsz16) this.sreg16(rm, val);
                        else this.regs[rm] = val;
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate16(meml, 2, m.seg, m.addr)) return false;
                        this.store16(meml, val);
                    }
                    break;
                }
                case 0x8d: { // LEA Gv, M
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    if (mod === 3) { this.excno = EX_UD; return false; }
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (opsz16) this.sreg16(reg, m.addr);
                    else this.regs[reg] = m.addr >>> 0;
                    break;
                }
                case 0x8e: { // MOV Sw, Ew
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    if (reg === SEG_CS) { this.excno = EX_UD; return false; }
                    let sel;
                    if (mod === 3) {
                        sel = this.lreg16(rm);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate16(meml, 1, m.seg, m.addr)) return false;
                        sel = this.load16(meml);
                    }
                    if (reg === SEG_SS) stepcount++;
                    if (!this.set_seg(reg, sel)) return false;
                    break;
                }
                case 0x8f: { // POP Ev
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const mod = modrm >>> 6, rm = modrm & 7;
                    const sp = this.regs[4];
                    const bit = opsz16 ? 16 : 32;
                    const step = opsz16 ? 2 : 4;
                    if (!this.translateBit(bit, meml1, 1, SEG_SS, sp & sp_mask)) return false;
                    const src = this.loadBit(bit, meml1);
                    this.set_sp(sp + step, sp_mask);
                    if (mod === 3) {
                        this.setRegBit(bit, rm, src);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg);
                        if (!m || !this.translateBit(bit, meml, 2, m.seg, m.addr)) {
                            this.set_sp(sp, sp_mask);
                            return false;
                        }
                        this.storeBit(bit, meml, src);
                    }
                    break;
                }
                case 0x90: // NOP
                    break;
                case 0x91: case 0x92: case 0x93: case 0x94:
                case 0x95: case 0x96: case 0x97: { // XCHG AX/EAX, reg
                    const reg = b1 & 7;
                    if (opsz16) {
                        const tmp = this.lreg16(reg);
                        this.sreg16(reg, this.lreg16(0));
                        this.sreg16(0, tmp);
                    } else {
                        const tmp = this.regs[reg];
                        this.regs[reg] = this.regs[0];
                        this.regs[0] = tmp;
                    }
                    break;
                }
                case 0x98: // CBW / CWDE
                    if (opsz16) this.sreg16(0, sext8(this.lreg8(0)));
                    else this.regs[0] = sext16(this.lreg16(0));
                    break;
                case 0x99: // CWD / CDQ
                    if (opsz16) this.sreg16(2, (this.lreg16(0) & 0x8000) ? 0xffff : 0x0000);
                    else this.regs[2] = (this.regs[0] & 0x80000000) ? 0xffffffff : 0x00000000;
                    break;
                case 0x9a: { // CALLFAR Ap
                    let addr;
                    if (opsz16) {
                        addr = this.fetch16(); if (addr === -1) return false;
                    } else {
                        addr = this.fetch32(); if (addr === -1) return false;
                    }
                    const seg = this.fetch16(); if (seg === -1) return false;
                    if ((this.cr0 & 1) && !(this.flags & VM)) {
                        if (!this.pmcall(opsz16, addr, seg, false)) return false;
                    } else {
                        const sp = this.regs[4];
                        if (opsz16) {
                            if (!this.translate16(meml1, 2, SEG_SS, (sp - 2) & sp_mask)) return false;
                            if (!this.translate16(meml2, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
                            this.set_sp(sp - 4, sp_mask);
                            this.store16(meml1, this.seg[SEG_CS].sel);
                            this.store16(meml2, this.next_ip);
                        } else {
                            if (!this.translate32(meml1, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
                            if (!this.translate32(meml2, 2, SEG_SS, (sp - 8) & sp_mask)) return false;
                            this.set_sp(sp - 8, sp_mask);
                            this.store32(meml1, this.seg[SEG_CS].sel);
                            this.store32(meml2, this.next_ip);
                        }
                        if (!this.set_seg(SEG_CS, seg)) return false;
                        this.next_ip = addr >>> 0;
                    }
                    break;
                }
                case 0x9b: // WAIT
                    if ((this.cr0 & 0xa) === 0xa) { this.excno = EX_NM; return false; }
                    break;
                case 0x9c: { // PUSHF
                    if ((this.flags & VM) && this.get_IOPL() < 3) { this.excno = EX_GP; this.excerr = 0; return false; }
                    const sp = this.regs[4];
                    if (opsz16) {
                        if (!this.translate16(meml, 2, SEG_SS, (sp - 2) & sp_mask)) return false;
                        this.refresh_flags();
                        this.cc_mask = 0;
                        this.set_sp(sp - 2, sp_mask);
                        this.store16(meml, this.flags);
                    } else {
                        if (!this.translate32(meml, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
                        this.refresh_flags();
                        this.cc_mask = 0;
                        this.set_sp(sp - 4, sp_mask);
                        this.store32(meml, (this.flags & ~(RF | VM)) >>> 0);
                    }
                    break;
                }
                case 0x9d: { // POPF
                    if ((this.flags & VM) && this.get_IOPL() < 3) { this.excno = EX_GP; this.excerr = 0; return false; }
                    let mask = VM;
                    if (this.cr0 & 1) {
                        if (this.cpl > 0) mask |= IOPL;
                        if (this.get_IOPL() < this.cpl) mask |= IF;
                    }
                    const sp = this.regs[4];
                    if (opsz16) {
                        if (!this.translate16(meml, 1, SEG_SS, sp & sp_mask)) return false;
                        this.set_sp(sp + 2, sp_mask);
                        this.flags = ((this.flags & (0xffff0000 | mask)) | (this.load16(meml) & ~mask)) >>> 0;
                    } else {
                        if (!this.translate32(meml, 1, SEG_SS, sp & sp_mask)) return false;
                        this.set_sp(sp + 4, sp_mask);
                        this.flags = ((this.flags & mask) | (this.load32(meml) & ~mask)) >>> 0;
                    }
                    this.flags = ((this.flags & this.flags_mask) | 0x2) >>> 0;
                    this.cc_mask = 0;
                    if (this.intr && (this.flags & IF)) return true;
                    break;
                }
                case 0x9e: // SAHF
                    this.cc_mask &= OF;
                    this.flags = (((this.flags & ~0xff) | this.lreg8(4)) & this.flags_mask | 0x2) >>> 0;
                    break;
                case 0x9f: // LAHF
                    this.refresh_flags();
                    this.cc_mask = 0;
                    this.sreg8(4, this.flags & 0xff);
                    break;
                case 0xa0: { // MOV AL, Ob
                    const addr = adsz16 ? this.fetch16() : this.fetch32();
                    if (addr === -1) return false;
                    if (curr_seg === -1) curr_seg = SEG_DS;
                    if (!this.translate8(meml, 1, curr_seg, addr)) return false;
                    this.sreg8(0, this.load8(meml));
                    break;
                }
                case 0xa1: { // MOV AX/EAX, Ov
                    const addr = adsz16 ? this.fetch16() : this.fetch32();
                    if (addr === -1) return false;
                    if (curr_seg === -1) curr_seg = SEG_DS;
                    const bit = opsz16 ? 16 : 32;
                    if (!this.translateBit(bit, meml, 1, curr_seg, addr)) return false;
                    this.setRegBit(bit, 0, this.loadBit(bit, meml));
                    break;
                }
                case 0xa2: { // MOV Ob, AL
                    const addr = adsz16 ? this.fetch16() : this.fetch32();
                    if (addr === -1) return false;
                    if (curr_seg === -1) curr_seg = SEG_DS;
                    if (!this.translate8(meml, 2, curr_seg, addr)) return false;
                    this.store8(meml, this.lreg8(0));
                    break;
                }
                case 0xa3: { // MOV Ov, AX/EAX
                    const addr = adsz16 ? this.fetch16() : this.fetch32();
                    if (addr === -1) return false;
                    if (curr_seg === -1) curr_seg = SEG_DS;
                    const bit = opsz16 ? 16 : 32;
                    if (!this.translateBit(bit, meml, 2, curr_seg, addr)) return false;
                    this.storeBit(bit, meml, opsz16 ? this.lreg16(0) : this.regs[0]);
                    break;
                }
                case 0xa4: if (!this.execMovs(8, adsz16, curr_seg, rep)) return false; break;
                case 0xa5: if (!this.execMovs(opsz16 ? 16 : 32, adsz16, curr_seg, rep)) return false; break;
                case 0xa6: if (!this.execCmps(8, adsz16, curr_seg, rep)) return false; break;
                case 0xa7: if (!this.execCmps(opsz16 ? 16 : 32, adsz16, curr_seg, rep)) return false; break;
                case 0xa8: { // TEST AL, Ib
                    const imm8 = this.fetch8(); if (imm8 === -1) return false;
                    this.aluTest8(this.lreg8(0), imm8);
                    break;
                }
                case 0xa9: { // TEST AX/EAX, Iv
                    if (opsz16) {
                        const imm16 = this.fetch16(); if (imm16 === -1) return false;
                        this.aluTest16(this.lreg16(0), imm16);
                    } else {
                        const imm32 = this.fetch32(); if (imm32 === -1) return false;
                        this.aluTest32(this.regs[0], imm32);
                    }
                    break;
                }
                case 0xaa: if (!this.execStos(8, adsz16, rep)) return false; break;
                case 0xab: if (!this.execStos(opsz16 ? 16 : 32, adsz16, rep)) return false; break;
                case 0xac: if (!this.execLods(8, adsz16, curr_seg, rep)) return false; break;
                case 0xad: if (!this.execLods(opsz16 ? 16 : 32, adsz16, curr_seg, rep)) return false; break;
                case 0xae: if (!this.execScas(8, adsz16, rep)) return false; break;
                case 0xaf: if (!this.execScas(opsz16 ? 16 : 32, adsz16, rep)) return false; break;

                // MOV r8, Ib
                case 0xb0: case 0xb1: case 0xb2: case 0xb3:
                case 0xb4: case 0xb5: case 0xb6: case 0xb7: {
                    const imm8 = this.fetch8(); if (imm8 === -1) return false;
                    this.sreg8(b1 & 7, imm8);
                    break;
                }
                // MOV r16/r32, Iv
                case 0xb8: case 0xb9: case 0xba: case 0xbb:
                case 0xbc: case 0xbd: case 0xbe: case 0xbf: {
                    if (opsz16) {
                        const imm16 = this.fetch16(); if (imm16 === -1) return false;
                        this.sreg16(b1 & 7, imm16);
                    } else {
                        const imm32 = this.fetch32(); if (imm32 === -1) return false;
                        this.regs[b1 & 7] = imm32 >>> 0;
                    }
                    break;
                }

                // GRP2 Shift/Rotate
                case 0xc0:
                case 0xd0:
                case 0xd2: {
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const shOp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    let m = null;
                    if (mod !== 3) {
                        m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    }
                    let count = 1;
                    if (b1 === 0xc0) {
                        count = this.fetch8(); if (count === -1) return false;
                    } else if (b1 === 0xd2) {
                        count = this.lreg8(1);
                    }
                    if (mod === 3) {
                        this.sreg8(rm, this.execShiftOp(shOp, 8, this.lreg8(rm), count));
                    } else {
                        if (!this.translate8(meml, 3, m.seg, m.addr)) return false;
                        this.store8(meml, this.execShiftOp(shOp, 8, this.load8(meml), count));
                    }
                    break;
                }
                case 0xc1:
                case 0xd1:
                case 0xd3: {
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const shOp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const bit = opsz16 ? 16 : 32;
                    let m = null;
                    if (mod !== 3) {
                        m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    }
                    let count = 1;
                    if (b1 === 0xc1) {
                        count = this.fetch8(); if (count === -1) return false;
                    } else if (b1 === 0xd3) {
                        count = this.lreg8(1);
                    }
                    if (mod === 3) {
                        const val = opsz16 ? this.lreg16(rm) : this.regs[rm];
                        this.setRegBit(bit, rm, this.execShiftOp(shOp, bit, val, count));
                    } else {
                        if (!this.translateBit(bit, meml, 3, m.seg, m.addr)) return false;
                        this.storeBit(bit, meml, this.execShiftOp(shOp, bit, this.loadBit(bit, meml), count));
                    }
                    break;
                }

                case 0xc2: // RET Iw
                case 0xc3: { // RET
                    let imm16 = 0;
                    if (b1 === 0xc2) {
                        imm16 = this.fetch16(); if (imm16 === -1) return false;
                    }
                    const sp = this.regs[4];
                    if (opsz16) {
                        if (!this.translate16(meml, 1, SEG_SS, sp & sp_mask)) return false;
                        this.set_sp(sp + 2 + imm16, sp_mask);
                        this.next_ip = this.load16(meml);
                    } else {
                        if (!this.translate32(meml, 1, SEG_SS, sp & sp_mask)) return false;
                        this.set_sp(sp + 4 + imm16, sp_mask);
                        this.next_ip = this.load32(meml);
                    }
                    break;
                }
                case 0xc4: // LES Gv, Mp
                case 0xc5: { // LDS Gv, Mp
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    if (mod === 3) { this.excno = EX_UD; return false; }
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    const seg = (b1 === 0xc4) ? SEG_ES : SEG_DS;
                    if (opsz16) {
                        if (!this.__LSEGw_helper(adsz16, seg, reg, m.seg, m.addr)) return false;
                    } else {
                        if (!this.__LSEGd_helper(adsz16, seg, reg, m.seg, m.addr)) return false;
                    }
                    break;
                }
                case 0xc6: { // MOV Eb, Ib
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const mod = modrm >>> 6, rm = modrm & 7;
                    if (mod === 3) {
                        const imm8 = this.fetch8(); if (imm8 === -1) return false;
                        this.sreg8(rm, imm8);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        const imm8 = this.fetch8(); if (imm8 === -1) return false;
                        if (!this.translate8(meml, 2, m.seg, m.addr)) return false;
                        this.store8(meml, imm8);
                    }
                    break;
                }
                case 0xc7: { // MOV Ev, Iv
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const mod = modrm >>> 6, rm = modrm & 7;
                    const bit = opsz16 ? 16 : 32;
                    if (mod === 3) {
                        const imm = opsz16 ? this.fetch16() : this.fetch32();
                        if (imm === -1) return false;
                        this.setRegBit(bit, rm, imm);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        const imm = opsz16 ? this.fetch16() : this.fetch32();
                        if (imm === -1) return false;
                        if (!this.translateBit(bit, meml, 2, m.seg, m.addr)) return false;
                        this.storeBit(bit, meml, imm);
                    }
                    break;
                }
                case 0xc8: { // ENTER Iw, Ib
                    const imm16 = this.fetch16(); if (imm16 === -1) return false;
                    const imm8 = this.fetch8(); if (imm8 === -1) return false;
                    const level = imm8 & 31;
                    if (level === 0) {
                        const sp = this.regs[4];
                        if (opsz16) {
                            if (!this.translate16(meml1, 2, SEG_SS, (sp - 2) & sp_mask)) return false;
                            this.set_sp(sp - 2 - imm16, sp_mask);
                            this.store16(meml1, this.lreg16(5));
                            this.sreg16(5, (sp - 2) & sp_mask);
                        } else {
                            if (!this.translate32(meml1, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
                            this.set_sp(sp - 4 - imm16, sp_mask);
                            this.store32(meml1, this.regs[5]);
                            this.regs[5] = ((sp - 4) & sp_mask) >>> 0;
                        }
                    } else {
                        if (!this.enter_helper(opsz16, sp_mask, level, imm16)) return false;
                    }
                    break;
                }
                case 0xc9: { // LEAVE
                    const sp = this.regs[5];
                    if (opsz16) {
                        if (!this.translate16(meml, 1, SEG_SS, sp & sp_mask)) return false;
                        this.set_sp(sp + 2, sp_mask);
                        this.sreg16(5, this.load16(meml));
                    } else {
                        if (!this.translate32(meml, 1, SEG_SS, sp & sp_mask)) return false;
                        this.set_sp(sp + 4, sp_mask);
                        this.regs[5] = this.load32(meml);
                    }
                    break;
                }
                case 0xca: // RETF Iw
                case 0xcb: { // RETF
                    let imm16 = 0;
                    if (b1 === 0xca) {
                        imm16 = this.fetch16(); if (imm16 === -1) return false;
                    }
                    if ((this.cr0 & 1) && !(this.flags & VM)) {
                        if (!this.pmret(opsz16, imm16, false)) return false;
                    } else if (opsz16) {
                        const sp = this.regs[4];
                        if (!this.translate16(meml1, 1, SEG_SS, sp & sp_mask)) return false;
                        const newip = this.load16(meml1);
                        if (!this.translate16(meml2, 1, SEG_SS, (sp + 2) & sp_mask)) return false;
                        const newcs = this.load16(meml2);
                        if (!this.set_seg(SEG_CS, newcs)) return false;
                        this.set_sp(sp + 4 + imm16, sp_mask);
                        this.next_ip = newip;
                    } else {
                        const sp = this.regs[4];
                        if (!this.translate32(meml1, 1, SEG_SS, sp & sp_mask)) return false;
                        const newip = this.load32(meml1);
                        if (!this.translate32(meml2, 1, SEG_SS, (sp + 4) & sp_mask)) return false;
                        const newcs = this.load32(meml2);
                        if (!this.set_seg(SEG_CS, newcs)) return false;
                        this.set_sp(sp + 8 + imm16, sp_mask);
                        this.next_ip = newip;
                    }
                    break;
                }
                case 0xcc: // INT3
                    this.ip = this.next_ip;
                    this.excno = EX_BP;
                    return false;
                case 0xcd: { // INT Ib
                    const imm8 = this.fetch8(); if (imm8 === -1) return false;
                    if ((this.flags & VM) && this.get_IOPL() < 3) {
                        this.excno = EX_GP;
                        this.excerr = 0;
                        return false;
                    }
                    const oldip = this.ip;
                    this.ip = this.next_ip;
                    if (!this.call_isr(imm8, false, 0)) {
                        this.ip = oldip;
                        return false;
                    }
                    break;
                }
                case 0xce: // INTO
                    if (this.get_OF()) {
                        this.ip = this.next_ip;
                        this.excno = EX_OF;
                        return false;
                    }
                    break;
                case 0xcf: { // IRET
                    if ((this.cr0 & 1) && (!(this.flags & VM) || this.get_IOPL() < 3)) {
                        if (!this.pmret(opsz16, 0, true)) return false;
                    } else {
                        const sp = this.regs[4];
                        if (opsz16) {
                            if (!this.translate16(meml1, 1, SEG_SS, sp & sp_mask)) return false;
                            const newip = this.load16(meml1);
                            if (!this.translate16(meml2, 1, SEG_SS, (sp + 2) & sp_mask)) return false;
                            const newcs = this.load16(meml2);
                            if (!this.translate16(meml3, 1, SEG_SS, (sp + 4) & sp_mask)) return false;
                            const oldflags = this.flags;
                            if (this.flags & VM) {
                                this.flags = ((this.flags & (0xffff0000 | IOPL)) | (this.load16(meml3) & ~IOPL)) >>> 0;
                            } else {
                                this.flags = ((this.flags & 0xffff0000) | this.load16(meml3)) >>> 0;
                            }
                            this.flags = ((this.flags & this.flags_mask) | 0x2) >>> 0;
                            if (!this.set_seg(SEG_CS, newcs)) {
                                this.flags = oldflags;
                                return false;
                            }
                            this.cc_mask = 0;
                            this.set_sp(sp + 6, sp_mask);
                            this.next_ip = newip;
                        } else {
                            if (!this.translate32(meml1, 1, SEG_SS, sp & sp_mask)) return false;
                            const newip = this.load32(meml1);
                            if (!this.translate32(meml2, 1, SEG_SS, (sp + 4) & sp_mask)) return false;
                            const newcs = this.load32(meml2);
                            if (!this.translate32(meml3, 1, SEG_SS, (sp + 8) & sp_mask)) return false;
                            const oldflags = this.flags;
                            const mask = VM | IOPL;
                            if (this.flags & VM) {
                                this.flags = ((this.flags & mask) | (this.load32(meml3) & ~mask)) >>> 0;
                            } else {
                                this.flags = ((this.flags & VM) | (this.load32(meml3) & ~VM)) >>> 0;
                            }
                            this.flags = ((this.flags & this.flags_mask) | 0x2) >>> 0;
                            if (!this.set_seg(SEG_CS, newcs)) {
                                this.flags = oldflags;
                                return false;
                            }
                            this.cc_mask = 0;
                            this.set_sp(sp + 12, sp_mask);
                            this.next_ip = newip;
                        }
                    }
                    if (this.intr && (this.flags & IF)) return true;
                    break;
                }
                case 0xd4: { // AAM Ib
                    const imm8 = this.fetch8(); if (imm8 === -1) return false;
                    if (!this.__AAM_helper(imm8)) return false;
                    break;
                }
                case 0xd5: { // AAD Ib
                    const imm8 = this.fetch8(); if (imm8 === -1) return false;
                    this.__AAD_helper(imm8);
                    break;
                }
                case 0xd6: // SALC
                    this.sreg8(0, this.get_CF() ? 0xff : 0x00);
                    break;
                case 0xd7: // XLAT
                    if (!this.__XLAT_helper(adsz16, curr_seg)) return false;
                    break;
                // FPU ESC
                case 0xd8: case 0xd9: case 0xda: case 0xdb:
                case 0xdc: case 0xdd: case 0xde: case 0xdf: {
                    if (this.cr0 & 0xc) { this.excno = EX_NM; return false; }
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const mod = modrm >>> 6, rm = modrm & 7;
                    const op = b1 - 0xd8;
                    const group = (modrm >>> 3) & 7;
                    if (mod !== 3) {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (this.fpu) {
                            if (!this.fpu.fpu_exec2(this, opsz16, op, group, m.seg, m.addr)) return false;
                        }
                    } else if (this.fpu) {
                        if (!this.fpu.fpu_exec1(this, op, group, rm)) return false;
                    }
                    break;
                }
                case 0xe0: // LOOPNE
                case 0xe1: // LOOPE
                case 0xe2: // LOOP
                case 0xe3: { // JCXZ / JECXZ
                    const imm8 = this.fetch8(); if (imm8 === -1) return false;
                    const d = (imm8 << 24) >> 24;
                    if (b1 === 0xe3) {
                        const cx = adsz16 ? this.lreg16(1) : this.regs[1];
                        if (cx === 0) {
                            this.next_ip = (this.next_ip + d) >>> 0;
                            if (code16) this.next_ip &= 0xffff;
                        }
                    } else {
                        let cx;
                        if (adsz16) {
                            cx = (this.lreg16(1) - 1) & 0xffff;
                            this.sreg16(1, cx);
                        } else {
                            cx = (this.regs[1] - 1) >>> 0;
                            this.regs[1] = cx;
                        }
                        const cond = (b1 === 0xe2) ? true : (b1 === 0xe1 ? !!this.get_ZF() : !this.get_ZF());
                        if (cx !== 0 && cond) {
                            this.next_ip = (this.next_ip + d) >>> 0;
                            if (code16) this.next_ip &= 0xffff;
                        }
                    }
                    break;
                }
                case 0xe4: { // IN AL, Ib
                    const port = this.fetch8(); if (port === -1) return false;
                    if (!this.check_ioperm(port, 8)) return false;
                    this.sreg8(0, this.bus.ioRead(port, 1));
                    break;
                }
                case 0xe5: { // IN AX/EAX, Ib
                    const port = this.fetch8(); if (port === -1) return false;
                    if (opsz16) {
                        if (!this.check_ioperm(port, 16)) return false;
                        this.sreg16(0, this.bus.ioRead(port, 2));
                    } else {
                        if (!this.check_ioperm(port, 32)) return false;
                        this.regs[0] = this.bus.ioRead(port, 4) >>> 0;
                    }
                    break;
                }
                case 0xe6: { // OUT Ib, AL
                    const port = this.fetch8(); if (port === -1) return false;
                    if (!this.check_ioperm(port, 8)) return false;
                    this.bus.ioWrite(port, this.lreg8(0), 1);
                    break;
                }
                case 0xe7: { // OUT Ib, AX/EAX
                    const port = this.fetch8(); if (port === -1) return false;
                    if (opsz16) {
                        if (!this.check_ioperm(port, 16)) return false;
                        this.bus.ioWrite(port, this.lreg16(0), 2);
                    } else {
                        if (!this.check_ioperm(port, 32)) return false;
                        this.bus.ioWrite(port, this.regs[0], 4);
                    }
                    break;
                }
                case 0xe8: { // CALL Av
                    const sp = this.regs[4];
                    if (opsz16) {
                        const imm16 = this.fetch16(); if (imm16 === -1) return false;
                        const d = (imm16 << 16) >> 16;
                        if (!this.translate16(meml, 2, SEG_SS, (sp - 2) & sp_mask)) return false;
                        this.set_sp(sp - 2, sp_mask);
                        this.store16(meml, this.next_ip);
                        this.next_ip = (this.next_ip + d) >>> 0;
                        if (code16) this.next_ip &= 0xffff;
                    } else {
                        const imm32 = this.fetch32(); if (imm32 === -1) return false;
                        const d = imm32 | 0;
                        if (!this.translate32(meml, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
                        this.set_sp(sp - 4, sp_mask);
                        this.store32(meml, this.next_ip);
                        this.next_ip = (this.next_ip + d) >>> 0;
                        if (code16) this.next_ip &= 0xffff;
                    }
                    break;
                }
                case 0xe9: { // JMP Jv
                    if (adsz16) {
                        const imm16 = this.fetch16(); if (imm16 === -1) return false;
                        const d = (imm16 << 16) >> 16;
                        this.next_ip = (this.next_ip + d) >>> 0;
                        if (code16) this.next_ip &= 0xffff;
                    } else {
                        const imm32 = this.fetch32(); if (imm32 === -1) return false;
                        const d = imm32 | 0;
                        this.next_ip = (this.next_ip + d) >>> 0;
                        if (code16) this.next_ip &= 0xffff;
                    }
                    break;
                }
                case 0xea: { // JMPFAR Ap
                    const addr = opsz16 ? this.fetch16() : this.fetch32();
                    if (addr === -1) return false;
                    const seg = this.fetch16(); if (seg === -1) return false;
                    if ((this.cr0 & 1) && !(this.flags & VM)) {
                        if (!this.pmcall(opsz16, addr, seg, true)) return false;
                    } else {
                        if (!this.set_seg(SEG_CS, seg)) return false;
                        this.next_ip = addr >>> 0;
                    }
                    break;
                }
                case 0xeb: { // JMP Jb
                    const imm8 = this.fetch8(); if (imm8 === -1) return false;
                    const d = (imm8 << 24) >> 24;
                    this.next_ip = (this.next_ip + d) >>> 0;
                    if (code16) this.next_ip &= 0xffff;
                    break;
                }
                case 0xec: { // IN AL, DX
                    const port = this.lreg16(2);
                    if (!this.check_ioperm(port, 8)) return false;
                    this.sreg8(0, this.bus.ioRead(port, 1));
                    break;
                }
                case 0xed: { // IN AX/EAX, DX
                    const port = this.lreg16(2);
                    if (opsz16) {
                        if (!this.check_ioperm(port, 16)) return false;
                        this.sreg16(0, this.bus.ioRead(port, 2));
                    } else {
                        if (!this.check_ioperm(port, 32)) return false;
                        this.regs[0] = this.bus.ioRead(port, 4) >>> 0;
                    }
                    break;
                }
                case 0xee: { // OUT DX, AL
                    const port = this.lreg16(2);
                    if (!this.check_ioperm(port, 8)) return false;
                    this.bus.ioWrite(port, this.lreg8(0), 1);
                    break;
                }
                case 0xef: { // OUT DX, AX/EAX
                    const port = this.lreg16(2);
                    if (opsz16) {
                        if (!this.check_ioperm(port, 16)) return false;
                        this.bus.ioWrite(port, this.lreg16(0), 2);
                    } else {
                        if (!this.check_ioperm(port, 32)) return false;
                        this.bus.ioWrite(port, this.regs[0], 4);
                    }
                    break;
                }
                case 0xf4: // HLT
                    if (this.cpl !== 0) { this.excno = EX_GP; this.excerr = 0; return false; }
                    this.halt = true;
                    return true;
                case 0xf5: { // CMC
                    const cf = this.get_CF();
                    this.cc_mask &= ~CF;
                    if (!cf) this.flags |= CF; else this.flags &= ~CF;
                    break;
                }
                case 0xf6: { // GRP3 Eb
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const grp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const rwm = (grp === 2 || grp === 3) ? 3 : 1;
                    let m = null;
                    if (mod !== 3) {
                        m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    }
                    if (grp === 0 || grp === 1) {
                        const imm8 = this.fetch8(); if (imm8 === -1) return false;
                        if (mod === 3) {
                            this.aluTest8(this.lreg8(rm), imm8);
                        } else {
                            if (!this.translate8(meml, 1, m.seg, m.addr)) return false;
                            this.aluTest8(this.load8(meml), imm8);
                        }
                    } else {
                        let val;
                        if (mod === 3) {
                            val = this.lreg8(rm);
                        } else {
                            if (!this.translate8(meml, rwm, m.seg, m.addr)) return false;
                            val = this.load8(meml);
                        }
                        switch (grp) {
                            case 2:
                                if (mod === 3) this.sreg8(rm, ~val);
                                else this.store8(meml, ~val);
                                break;
                            case 3:
                                val = this.aluNeg8(val);
                                if (mod === 3) this.sreg8(rm, val);
                                else this.store8(meml, val);
                                break;
                            case 4: this.mul8(val); break;
                            case 5: this.imul1_8(val); break;
                            case 6: if (!this.div8(val)) return false; break;
                            case 7: if (!this.idiv8(val)) return false; break;
                        }
                    }
                    break;
                }
                case 0xf7: { // GRP3 Ev
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const grp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const rwm = (grp === 2 || grp === 3) ? 3 : 1;
                    const bit = opsz16 ? 16 : 32;
                    let m = null;
                    if (mod !== 3) {
                        m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    }
                    if (grp === 0 || grp === 1) {
                        const imm = opsz16 ? this.fetch16() : this.fetch32();
                        if (imm === -1) return false;
                        if (mod === 3) {
                            if (opsz16) this.aluTest16(this.lreg16(rm), imm);
                            else this.aluTest32(this.regs[rm], imm);
                        } else {
                            if (!this.translateBit(bit, meml, 1, m.seg, m.addr)) return false;
                            if (opsz16) this.aluTest16(this.load16(meml), imm);
                            else this.aluTest32(this.load32(meml), imm);
                        }
                    } else {
                        let val;
                        if (mod === 3) {
                            val = opsz16 ? this.lreg16(rm) : this.regs[rm];
                        } else {
                            if (!this.translateBit(bit, meml, rwm, m.seg, m.addr)) return false;
                            val = this.loadBit(bit, meml);
                        }
                        switch (grp) {
                            case 2:
                                if (mod === 3) this.setRegBit(bit, rm, ~val);
                                else this.storeBit(bit, meml, ~val);
                                break;
                            case 3:
                                val = opsz16 ? this.aluNeg16(val) : this.aluNeg32(val);
                                if (mod === 3) this.setRegBit(bit, rm, val);
                                else this.storeBit(bit, meml, val);
                                break;
                            case 4: if (opsz16) this.mul16(val); else this.mul32(val); break;
                            case 5: if (opsz16) this.imul1_16(val); else this.imul1_32(val); break;
                            case 6: if (opsz16) { if (!this.div16(val)) return false; } else { if (!this.div32(val)) return false; } break;
                            case 7: if (opsz16) { if (!this.idiv16(val)) return false; } else { if (!this.idiv32(val)) return false; } break;
                        }
                    }
                    break;
                }
                case 0xf8: this.cc_mask &= ~CF; this.flags &= ~CF; break; // CLC
                case 0xf9: this.cc_mask &= ~CF; this.flags |= CF; break;  // STC
                case 0xfa: // CLI
                    if (this.get_IOPL() < this.cpl) { this.excno = EX_GP; this.excerr = 0; return false; }
                    this.flags &= ~IF;
                    break;
                case 0xfb: // STI
                    if (this.get_IOPL() < this.cpl) { this.excno = EX_GP; this.excerr = 0; return false; }
                    this.flags |= IF;
                    if (this.intr || stepcount < 2) stepcount = 2;
                    break;
                case 0xfc: this.flags &= ~DF; break; // CLD
                case 0xfd: this.flags |= DF; break;  // STD
                case 0xfe: { // GRP4
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const grp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    if (grp > 1) { this.excno = EX_UD; return false; }
                    if (mod === 3) {
                        const v = grp === 0 ? this.aluInc8(this.lreg8(rm)) : this.aluDec8(this.lreg8(rm));
                        this.sreg8(rm, v);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate8(meml, 3, m.seg, m.addr)) return false;
                        const v = grp === 0 ? this.aluInc8(this.load8(meml)) : this.aluDec8(this.load8(meml));
                        this.store8(meml, v);
                    }
                    break;
                }
                case 0xff: { // GRP5
                    const modrm = this.fetch8(); if (modrm === -1) return false;
                    const grp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                    const bit = opsz16 ? 16 : 32;
                    switch (grp) {
                        case 0: // INC Ev
                        case 1: { // DEC Ev
                            if (mod === 3) {
                                const v = opsz16
                                    ? (grp === 0 ? this.aluInc16(this.lreg16(rm)) : this.aluDec16(this.lreg16(rm)))
                                    : (grp === 0 ? this.aluInc32(this.regs[rm]) : this.aluDec32(this.regs[rm]));
                                this.setRegBit(bit, rm, v);
                            } else {
                                const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                                if (!this.translateBit(bit, meml, 3, m.seg, m.addr)) return false;
                                const cur = this.loadBit(bit, meml);
                                const v = opsz16
                                    ? (grp === 0 ? this.aluInc16(cur) : this.aluDec16(cur))
                                    : (grp === 0 ? this.aluInc32(cur) : this.aluDec32(cur));
                                this.storeBit(bit, meml, v);
                            }
                            break;
                        }
                        case 2: { // CALLABS Ev
                            let nip;
                            if (mod === 3) {
                                nip = opsz16 ? this.lreg16(rm) : this.regs[rm];
                            } else {
                                const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                                if (!this.translateBit(bit, meml, 1, m.seg, m.addr)) return false;
                                nip = this.loadBit(bit, meml);
                            }
                            const sp = this.regs[4];
                            const step = opsz16 ? 2 : 4;
                            if (!this.translateBit(bit, meml1, 2, SEG_SS, (sp - step) & sp_mask)) return false;
                            this.set_sp(sp - step, sp_mask);
                            this.storeBit(bit, meml1, this.next_ip);
                            this.next_ip = nip >>> 0;
                            break;
                        }
                        case 3: // CALLFAR Ep
                        case 5: { // JMPFAR Ep
                            if (mod === 3) { this.excno = EX_UD; return false; }
                            const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                            let off, seg;
                            if (opsz16) {
                                if (!this.translate16(meml1, 1, m.seg, m.addr)) return false;
                                if (!this.translate16(meml2, 1, m.seg, (m.addr + 2) >>> 0)) return false;
                                off = this.load16(meml1);
                                seg = this.load16(meml2);
                            } else {
                                if (!this.translate32(meml1, 1, m.seg, m.addr)) return false;
                                if (!this.translate16(meml2, 1, m.seg, (m.addr + 4) >>> 0)) return false;
                                off = this.load32(meml1);
                                seg = this.load16(meml2);
                            }
                            const isjmp = (grp === 5);
                            if ((this.cr0 & 1) && !(this.flags & VM)) {
                                if (!this.pmcall(opsz16, off, seg, isjmp)) return false;
                            } else {
                                if (!isjmp) {
                                    const sp = this.regs[4];
                                    if (opsz16) {
                                        if (!this.translate16(meml1, 2, SEG_SS, (sp - 2) & sp_mask)) return false;
                                        if (!this.translate16(meml2, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
                                        this.set_sp(sp - 4, sp_mask);
                                        this.store16(meml1, this.seg[SEG_CS].sel);
                                        this.store16(meml2, this.next_ip);
                                    } else {
                                        if (!this.translate32(meml1, 2, SEG_SS, (sp - 4) & sp_mask)) return false;
                                        if (!this.translate32(meml2, 2, SEG_SS, (sp - 8) & sp_mask)) return false;
                                        this.set_sp(sp - 8, sp_mask);
                                        this.store32(meml1, this.seg[SEG_CS].sel);
                                        this.store32(meml2, this.next_ip);
                                    }
                                }
                                if (!this.set_seg(SEG_CS, seg)) return false;
                                this.next_ip = off >>> 0;
                            }
                            break;
                        }
                        case 4: { // JMPABS Ev
                            let nip;
                            if (mod === 3) {
                                nip = opsz16 ? this.lreg16(rm) : this.regs[rm];
                            } else {
                                const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                                if (!this.translateBit(bit, meml, 1, m.seg, m.addr)) return false;
                                nip = this.loadBit(bit, meml);
                            }
                            this.next_ip = nip >>> 0;
                            break;
                        }
                        case 6: { // PUSH Ev
                            let val;
                            if (mod === 3) {
                                val = opsz16 ? this.lreg16(rm) : this.regs[rm];
                            } else {
                                const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                                if (!this.translateBit(bit, meml, 1, m.seg, m.addr)) return false;
                                val = this.loadBit(bit, meml);
                            }
                            const sp = this.regs[4];
                            const step = opsz16 ? 2 : 4;
                            if (!this.translateBit(bit, meml1, 2, SEG_SS, (sp - step) & sp_mask)) return false;
                            this.set_sp(sp - step, sp_mask);
                            this.storeBit(bit, meml1, val);
                            break;
                        }
                        default:
                            this.excno = EX_UD;
                            return false;
                    }
                    break;
                }

                // TWO-BYTE 0x0F OPCODES
                case 0x0f: {
                    b1 = this.fetch8(); if (b1 === -1) return false;
                    if (!this.exec0F(b1, opsz16, adsz16, code16, sp_mask, curr_seg)) return false;
                    break;
                }

                default:
                    this.excno = EX_UD;
                    return false;
            }
        }
        return true;
    }

    exec0F(b1, opsz16, adsz16, code16, sp_mask, curr_seg) {
        const meml = this._meml;
        const meml1 = this._meml1;
        const meml2 = this._meml2;
        const bit = opsz16 ? 16 : 32;

        switch (b1) {
            case 0x00: { // GRP6 (SLDT, STR, LLDT, LTR, VERR, VERW)
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const grp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                if (grp === 0 || grp === 1) { // SLDT / STR
                    const val = (grp === 0) ? this.seg[SEG_LDT].sel : this.seg[SEG_TR].sel;
                    if (mod === 3) {
                        this.setRegBit(bit, rm, val);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate16(meml, 2, m.seg, m.addr)) return false;
                        this.store16(meml, val);
                    }
                } else if (grp >= 2 && grp <= 5) {
                    let sel;
                    if (mod === 3) {
                        sel = this.lreg16(rm);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate16(meml, 1, m.seg, m.addr)) return false;
                        sel = this.load16(meml);
                    }
                    if (grp === 2 || grp === 3) { // LLDT / LTR
                        if (this.cpl !== 0) { this.excno = EX_GP; this.excerr = 0; return false; }
                        if (!this.set_seg(grp === 2 ? SEG_LDT : SEG_TR, sel)) return false;
                    } else { // VERR / VERW
                        const zf = this.verrw_helper(sel, grp === 5 ? 1 : 0);
                        if (zf === -1) return false;
                        this.cc_mask &= ~ZF;
                        if (zf) this.flags |= ZF; else this.flags &= ~ZF;
                    }
                } else {
                    this.excno = EX_UD;
                    return false;
                }
                break;
            }
            case 0x01: { // GRP7 (SGDT, SIDT, LGDT, LIDT, SMSW, LMSW, INVLPG)
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const grp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                if (grp === 4) { // SMSW
                    const val = this.cr0 & 0xffff;
                    if (mod === 3) {
                        this.setRegBit(bit, rm, val);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate16(meml, 2, m.seg, m.addr)) return false;
                        this.store16(meml, val);
                    }
                } else if (grp === 6) { // LMSW
                    if (this.cpl !== 0) { this.excno = EX_GP; this.excerr = 0; return false; }
                    let val;
                    if (mod === 3) {
                        val = this.lreg16(rm);
                    } else {
                        const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                        if (!this.translate16(meml, 1, m.seg, m.addr)) return false;
                        val = this.load16(meml);
                    }
                    this.cr0 = ((this.cr0 & ((~0xf) | 1)) | (val & 0xf)) >>> 0;
                } else if (grp === 0 || grp === 1 || grp === 2 || grp === 3 || grp === 7) {
                    if (mod === 3) { this.excno = EX_UD; return false; }
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (grp === 7) { // INVLPG
                        this.tlb_clear();
                    } else if (grp === 0 || grp === 1) { // SGDT / SIDT
                        if (!this.translate16(meml1, 2, m.seg, m.addr)) return false;
                        if (!this.translate32(meml2, 2, m.seg, (m.addr + 2) >>> 0)) return false;
                        const dt = (grp === 0) ? this.gdt : this.idt;
                        this.store16(meml1, dt.limit);
                        this.store32(meml2, dt.base);
                    } else { // LGDT / LIDT
                        if (this.cpl !== 0) { this.excno = EX_GP; this.excerr = 0; return false; }
                        if (!this.translate16(meml1, 1, m.seg, m.addr)) return false;
                        if (!this.translate32(meml2, 1, m.seg, (m.addr + 2) >>> 0)) return false;
                        const limit = this.load16(meml1);
                        let base = this.load32(meml2);
                        if (opsz16) base &= 0xffffff;
                        const dt = (grp === 2) ? this.gdt : this.idt;
                        dt.base = base >>> 0;
                        dt.limit = limit;
                    }
                } else {
                    this.excno = EX_UD;
                    return false;
                }
                break;
            }
            case 0x02: // LAR Gv, Ew
            case 0x03: { // LSL Gv, Ew
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                let opr;
                if (mod === 3) {
                    opr = this.lreg16(rm);
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (!this.translate16(meml, 1, m.seg, m.addr)) return false;
                    opr = this.load16(meml);
                }
                const r = this.larsl_helper(opr, b1 === 0x02);
                if (!r) return false;
                if (r.zf) {
                    this.setRegBit(bit, reg, r.val);
                    this.flags |= ZF;
                } else {
                    this.flags &= ~ZF;
                }
                this.cc_mask &= ~ZF;
                break;
            }
            case 0x06: // CLTS
                this.cr0 = (this.cr0 & ~(1 << 3)) >>> 0;
                break;
            case 0x09: // WBINVD
                break;
            case 0x20: { // MOV r32, CRn
                if (this.cpl !== 0) { this.excno = EX_GP; this.excerr = 0; return false; }
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, rm = modrm & 7;
                if (reg === 0) this.regs[rm] = this.cr0;
                else if (reg === 2) this.regs[rm] = this.cr2;
                else if (reg === 3) this.regs[rm] = this.cr3;
                else if (reg === 4) this.regs[rm] = 0;
                else { this.excno = EX_UD; return false; }
                break;
            }
            case 0x21: { // MOV r32, DRn
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, rm = modrm & 7;
                this.regs[rm] = this.dr[reg];
                break;
            }
            case 0x22: { // MOV CRn, r32
                if (this.cpl !== 0) { this.excno = EX_GP; this.excerr = 0; return false; }
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, rm = modrm & 7;
                if (reg === 0) {
                    let new_cr0 = this.regs[rm];
                    if ((new_cr0 ^ this.cr0) & (CR0_PG | CR0_WP | 1)) this.tlb_clear();
                    if (this.fpu) new_cr0 |= 0x10;
                    this.cr0 = new_cr0 >>> 0;
                } else if (reg === 2) {
                    this.cr2 = this.regs[rm];
                } else if (reg === 3) {
                    this.cr3 = this.regs[rm];
                    this.tlb_clear();
                } else if (reg === 4) {
                } else {
                    this.excno = EX_UD;
                    return false;
                }
                break;
            }
            case 0x23: { // MOV DRn, r32
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, rm = modrm & 7;
                this.dr[reg] = this.regs[rm];
                break;
            }
            case 0x24:
            case 0x26:
                if (this.fetch8() === -1) return false;
                break;
            case 0x30: { // WRMSR
                if (this.cpl !== 0) { this.excno = EX_GP; this.excerr = 0; return false; }
                switch (this.regs[1]) {
                    case 0x174: this.sysenter.cs = this.regs[0]; break;
                    case 0x175: this.sysenter.esp = this.regs[0]; break;
                    case 0x176: this.sysenter.eip = this.regs[0]; break;
                    default: this.excno = EX_GP; this.excerr = 0; return false;
                }
                break;
            }
            case 0x31: { // RDTSC
                const tsc = BigInt(Math.floor(performance.now() * 1000000));
                this.regs[0] = Number(tsc & 0xffffffffn) >>> 0;
                this.regs[2] = Number((tsc >> 32n) & 0xffffffffn) >>> 0;
                break;
            }
            case 0x32: { // RDMSR
                if (this.cpl !== 0) { this.excno = EX_GP; this.excerr = 0; return false; }
                switch (this.regs[1]) {
                    case 0x174: this.regs[0] = this.sysenter.cs; this.regs[2] = 0; break;
                    case 0x175: this.regs[0] = this.sysenter.esp; this.regs[2] = 0; break;
                    case 0x176: this.regs[0] = this.sysenter.eip; this.regs[2] = 0; break;
                    default: this.excno = EX_GP; this.excerr = 0; return false;
                }
                break;
            }
            case 0x34: { // SYSENTER
                if (!(this.cr0 & 1) || (this.sysenter.cs & ~0x3) === 0) { this.excno = EX_GP; this.excerr = 0; return false; }
                this.flags &= ~(VM | IF);
                this.__sysenter(0, this.sysenter.cs);
                this.regs[4] = this.sysenter.esp;
                this.next_ip = this.sysenter.eip;
                break;
            }
            case 0x35: { // SYSEXIT
                if (!(this.cr0 & 1) || (this.sysenter.cs & ~0x3) === 0 || this.cpl) { this.excno = EX_GP; this.excerr = 0; return false; }
                this.__sysenter(3, this.sysenter.cs + 16);
                this.regs[4] = this.regs[1];
                this.next_ip = this.regs[2];
                break;
            }
            // CMOVcc Gv, Ev
            case 0x40: case 0x41: case 0x42: case 0x43:
            case 0x44: case 0x45: case 0x46: case 0x47:
            case 0x48: case 0x49: case 0x4a: case 0x4b:
            case 0x4c: case 0x4d: case 0x4e: case 0x4f: {
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                let opr;
                if (mod === 3) {
                    opr = opsz16 ? this.lreg16(rm) : this.regs[rm];
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (!this.translateBit(bit, meml, 1, m.seg, m.addr)) return false;
                    opr = this.loadBit(bit, meml);
                }
                if (this.evalCond(b1)) {
                    this.setRegBit(bit, reg, opr);
                }
                break;
            }
            // Jcc Jv
            case 0x80: case 0x81: case 0x82: case 0x83:
            case 0x84: case 0x85: case 0x86: case 0x87:
            case 0x88: case 0x89: case 0x8a: case 0x8b:
            case 0x8c: case 0x8d: case 0x8e: case 0x8f: {
                let d;
                if (adsz16) {
                    const imm16 = this.fetch16(); if (imm16 === -1) return false;
                    d = (imm16 << 16) >> 16;
                } else {
                    const imm32 = this.fetch32(); if (imm32 === -1) return false;
                    d = imm32 | 0;
                }
                if (this.evalCond(b1)) {
                    this.next_ip = (this.next_ip + d) >>> 0;
                    if (code16) this.next_ip &= 0xffff;
                }
                break;
            }
            // SETcc Eb
            case 0x90: case 0x91: case 0x92: case 0x93:
            case 0x94: case 0x95: case 0x96: case 0x97:
            case 0x98: case 0x99: case 0x9a: case 0x9b:
            case 0x9c: case 0x9d: case 0x9e: case 0x9f: {
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const mod = modrm >>> 6, rm = modrm & 7;
                const cond = this.evalCond(b1);
                if (mod === 3) {
                    this.sreg8(rm, cond);
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (!this.translate8(meml, 2, m.seg, m.addr)) return false;
                    this.store8(meml, cond);
                }
                break;
            }
            case 0xa0: // PUSH FS
            case 0xa8: { // PUSH GS
                const seg = (b1 === 0xa0) ? SEG_FS : SEG_GS;
                const sp = this.regs[4];
                const step = opsz16 ? 2 : 4;
                if (!this.translate16(meml, 2, SEG_SS, (sp - step) & sp_mask)) return false;
                this.set_sp(sp - step, sp_mask);
                this.store16(meml, this.lseg(seg));
                break;
            }
            case 0xa1: // POP FS
            case 0xa9: { // POP GS
                const seg = (b1 === 0xa1) ? SEG_FS : SEG_GS;
                const sp = this.regs[4];
                const step = opsz16 ? 2 : 4;
                if (!this.translate16(meml, 1, SEG_SS, sp & sp_mask)) return false;
                if (!this.set_seg(seg, this.load16(meml))) return false;
                this.set_sp(sp + step, sp_mask);
                break;
            }
            case 0xa2: { // CPUID
                switch (this.regs[0]) {
                    case 0:
                        this.regs[0] = 1;
                        this.regs[3] = 0x756e6547; // 'Genu'
                        this.regs[2] = 0x49656e69; // 'ineI'
                        this.regs[1] = 0x6c65746e; // 'ntel'
                        break;
                    case 1:
                        this.regs[0] = (this.gen << 8) >>> 0;
                        this.regs[3] = 0;
                        this.regs[2] = 0x110 | (this.fpu ? 1 : 0);
                        this.regs[1] = 0;
                        break;
                    default:
                        this.regs[0] = 0;
                        this.regs[3] = 0;
                        this.regs[2] = 0;
                        this.regs[1] = 0;
                        break;
                }
                break;
            }
            case 0xa3: // BT Ev, Gv
            case 0xab: // BTS Ev, Gv
            case 0xb3: // BTR Ev, Gv
            case 0xbb: { // BTC Ev, Gv
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                const bval = opsz16 ? ((this.lreg16(reg) << 16) >> 16) : (this.regs[reg] | 0);
                const rwm = (b1 === 0xa3) ? 1 : 3;
                const bb = ((bval % bit) + bit) % bit;
                const mask = (1 << bb) >>> 0;
                if (mod === 3) {
                    const aval = opsz16 ? this.lreg16(rm) : this.regs[rm];
                    const bitVal = (aval >>> bb) & 1;
                    if (b1 === 0xab) this.setRegBit(bit, rm, aval | mask);
                    else if (b1 === 0xb3) this.setRegBit(bit, rm, aval & ~mask);
                    else if (b1 === 0xbb) this.setRegBit(bit, rm, aval ^ mask);
                    this.cc_mask &= ~CF;
                    if (bitVal) this.flags |= CF; else this.flags &= ~CF;
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    const elemOff = Math.trunc(bval / bit) * (bit >>> 3);
                    const addr = (m.addr + elemOff) >>> 0;
                    if (!this.translateBit(bit, meml, rwm, m.seg, addr)) return false;
                    const aval = this.loadBit(bit, meml);
                    const bitVal = (aval >>> bb) & 1;
                    if (b1 === 0xab) this.storeBit(bit, meml, aval | mask);
                    else if (b1 === 0xb3) this.storeBit(bit, meml, aval & ~mask);
                    else if (b1 === 0xbb) this.storeBit(bit, meml, aval ^ mask);
                    this.cc_mask &= ~CF;
                    if (bitVal) this.flags |= CF; else this.flags &= ~CF;
                }
                break;
            }
            case 0xa4: // SHLD Ev, Gv, Ib
            case 0xa5: // SHLD Ev, Gv, CL
            case 0xac: // SHRD Ev, Gv, Ib
            case 0xad: { // SHRD Ev, Gv, CL
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                let m = null;
                if (mod !== 3) {
                    m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                }
                let count;
                if (b1 === 0xa4 || b1 === 0xac) {
                    count = this.fetch8(); if (count === -1) return false;
                } else {
                    count = this.lreg8(1);
                }
                const y = opsz16 ? this.lreg16(reg) : this.regs[reg];
                const isShld = (b1 === 0xa4 || b1 === 0xa5);
                if (mod === 3) {
                    const x = opsz16 ? this.lreg16(rm) : this.regs[rm];
                    const res = isShld ? this.shld(bit, x, y, count) : this.shrd(bit, x, y, count);
                    this.setRegBit(bit, rm, res);
                } else {
                    if (!this.translateBit(bit, meml, 3, m.seg, m.addr)) return false;
                    const x = this.loadBit(bit, meml);
                    const res = isShld ? this.shld(bit, x, y, count) : this.shrd(bit, x, y, count);
                    this.storeBit(bit, meml, res);
                }
                break;
            }
            case 0xaf: { // IMUL Gv, Ev
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                let opr;
                if (mod === 3) {
                    opr = opsz16 ? this.lreg16(rm) : this.regs[rm];
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (!this.translateBit(bit, meml, 1, m.seg, m.addr)) return false;
                    opr = this.loadBit(bit, meml);
                }
                if (opsz16) this.sreg16(reg, this.imul2_16(this.lreg16(reg), opr));
                else this.regs[reg] = this.imul2_32(this.regs[reg], opr);
                break;
            }
            case 0xb0: { // CMPXCHG Eb, Gb
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                let a;
                if (mod === 3) {
                    a = this.lreg8(rm);
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (!this.translate8(meml, 3, m.seg, m.addr)) return false;
                    a = this.load8(meml);
                }
                this.cc_src1 = sext8(a);
                this.cc_src2 = sext8(this.lreg8(0));
                this.cc_dst = sext8(this.cc_src1 - this.cc_src2);
                this.cc_op = CC_SUB;
                this.cc_mask = CF | PF | AF | ZF | SF | OF;
                if (this.cc_dst === 0) {
                    if (mod === 3) this.sreg8(rm, this.lreg8(reg));
                    else this.store8(meml, this.lreg8(reg));
                } else {
                    this.sreg8(0, a);
                }
                break;
            }
            case 0xb1: { // CMPXCHG Ev, Gv
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                let a;
                if (mod === 3) {
                    a = opsz16 ? this.lreg16(rm) : this.regs[rm];
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (!this.translateBit(bit, meml, 3, m.seg, m.addr)) return false;
                    a = this.loadBit(bit, meml);
                }
                this.cc_src1 = this.sextBit(bit, a);
                this.cc_src2 = this.sextBit(bit, opsz16 ? this.lreg16(0) : this.regs[0]);
                this.cc_dst = this.sextBit(bit, this.cc_src1 - this.cc_src2);
                this.cc_op = CC_SUB;
                this.cc_mask = CF | PF | AF | ZF | SF | OF;
                if (this.cc_dst === 0) {
                    const b = opsz16 ? this.lreg16(reg) : this.regs[reg];
                    if (mod === 3) this.setRegBit(bit, rm, b);
                    else this.storeBit(bit, meml, b);
                } else {
                    this.setRegBit(bit, 0, a);
                }
                break;
            }
            case 0xb2: // LSS Gv, Mp
            case 0xb4: // LFS Gv, Mp
            case 0xb5: { // LGS Gv, Mp
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                if (mod === 3) { this.excno = EX_UD; return false; }
                const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                const seg = (b1 === 0xb2) ? SEG_SS : (b1 === 0xb4 ? SEG_FS : SEG_GS);
                if (opsz16) {
                    if (!this.__LSEGw_helper(adsz16, seg, reg, m.seg, m.addr)) return false;
                } else {
                    if (!this.__LSEGd_helper(adsz16, seg, reg, m.seg, m.addr)) return false;
                }
                break;
            }
            case 0xb6: // MOVZX Gv, Eb
            case 0xbe: { // MOVSX Gv, Eb
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                let opr;
                if (mod === 3) {
                    opr = this.lreg8(rm);
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (!this.translate8(meml, 1, m.seg, m.addr)) return false;
                    opr = this.load8(meml);
                }
                const val = (b1 === 0xb6) ? (opr & 0xff) : sext8(opr);
                this.setRegBit(bit, reg, val);
                break;
            }
            case 0xb7: // MOVZX Gv, Ew
            case 0xbf: { // MOVSX Gv, Ew
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                let opr;
                if (mod === 3) {
                    opr = this.lreg16(rm);
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (!this.translate16(meml, 1, m.seg, m.addr)) return false;
                    opr = this.load16(meml);
                }
                const val = (b1 === 0xb7) ? (opr & 0xffff) : sext16(opr);
                this.setRegBit(bit, reg, val);
                break;
            }
            case 0xba: { // GRP8 BT/BTS/BTR/BTC Ev, Ib
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const grp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                if (grp < 4) { this.excno = EX_UD; return false; }
                let m = null;
                if (mod !== 3) {
                    m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                }
                const imm8 = this.fetch8(); if (imm8 === -1) return false;
                const simm = (imm8 << 24) >> 24;
                const rwm = (grp === 4) ? 1 : 3;
                const bb = ((simm % bit) + bit) % bit;
                const mask = (1 << bb) >>> 0;
                if (mod === 3) {
                    const aval = opsz16 ? this.lreg16(rm) : this.regs[rm];
                    const bitVal = (aval >>> bb) & 1;
                    if (grp === 5) this.setRegBit(bit, rm, aval | mask);
                    else if (grp === 6) this.setRegBit(bit, rm, aval & ~mask);
                    else if (grp === 7) this.setRegBit(bit, rm, aval ^ mask);
                    this.cc_mask &= ~CF;
                    if (bitVal) this.flags |= CF; else this.flags &= ~CF;
                } else {
                    const elemOff = Math.trunc(simm / bit) * (bit >>> 3);
                    const addr = (m.addr + elemOff) >>> 0;
                    if (!this.translateBit(bit, meml, rwm, m.seg, addr)) return false;
                    const aval = this.loadBit(bit, meml);
                    const bitVal = (aval >>> bb) & 1;
                    if (grp === 5) this.storeBit(bit, meml, aval | mask);
                    else if (grp === 6) this.storeBit(bit, meml, aval & ~mask);
                    else if (grp === 7) this.storeBit(bit, meml, aval ^ mask);
                    this.cc_mask &= ~CF;
                    if (bitVal) this.flags |= CF; else this.flags &= ~CF;
                }
                break;
            }
            case 0xbc: // BSF Gv, Ev
            case 0xbd: { // BSR Gv, Ev
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                let src;
                if (mod === 3) {
                    src = opsz16 ? this.lreg16(rm) : this.regs[rm];
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (!this.translateBit(bit, meml, 1, m.seg, m.addr)) return false;
                    src = this.loadBit(bit, meml);
                }
                this.cc_mask = 0;
                if (src === 0) {
                    this.flags |= ZF;
                } else {
                    this.flags &= ~ZF;
                    let temp = 0;
                    if (b1 === 0xbc) {
                        while ((src & 1) === 0) { temp++; src >>>= 1; }
                    } else {
                        temp = bit - 1;
                        const topMask = 1 << (bit - 1);
                        while ((src & topMask) === 0) { temp--; src <<= 1; }
                    }
                    this.setRegBit(bit, reg, temp);
                }
                break;
            }
            case 0xc0: { // XADD Eb, Gb
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                const b = this.lreg8(reg);
                if (mod === 3) {
                    const dst = this.lreg8(rm);
                    const sum = this.aluAdd8(dst, b);
                    this.sreg8(reg, dst);
                    this.sreg8(rm, sum);
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (!this.translate8(meml, 3, m.seg, m.addr)) return false;
                    const dst = this.load8(meml);
                    const sum = this.aluAdd8(dst, b);
                    this.sreg8(reg, dst);
                    this.store8(meml, sum);
                }
                break;
            }
            case 0xc1: { // XADD Ev, Gv
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const reg = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                const b = opsz16 ? this.lreg16(reg) : this.regs[reg];
                if (mod === 3) {
                    const dst = opsz16 ? this.lreg16(rm) : this.regs[rm];
                    const sum = opsz16 ? this.aluAdd16(dst, b) : this.aluAdd32(dst, b);
                    this.setRegBit(bit, reg, dst);
                    this.setRegBit(bit, rm, sum);
                } else {
                    const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                    if (!this.translateBit(bit, meml, 3, m.seg, m.addr)) return false;
                    const dst = this.loadBit(bit, meml);
                    const sum = opsz16 ? this.aluAdd16(dst, b) : this.aluAdd32(dst, b);
                    this.setRegBit(bit, reg, dst);
                    this.storeBit(bit, meml, sum);
                }
                break;
            }
            case 0xc7: { // GRP9 CMPXCHG8B Mq
                const modrm = this.fetch8(); if (modrm === -1) return false;
                const grp = (modrm >>> 3) & 7, mod = modrm >>> 6, rm = modrm & 7;
                if (grp !== 1 || mod === 3) { this.excno = EX_UD; return false; }
                const m = this.modsib(adsz16, mod, rm, curr_seg); if (!m) return false;
                if (!this.translate32(meml1, 3, m.seg, m.addr)) return false;
                if (!this.translate32(meml2, 3, m.seg, (m.addr + 4) >>> 0)) return false;
                const lo = this.load32(meml1);
                const hi = this.load32(meml2);
                if (this.regs[0] === lo && this.regs[2] === hi) {
                    this.flags |= ZF;
                    this.store32(meml1, this.regs[3]);
                    this.store32(meml2, this.regs[1]);
                } else {
                    this.flags &= ~ZF;
                    this.regs[0] = lo;
                    this.regs[2] = hi;
                }
                this.cc_mask &= ~ZF;
                break;
            }
            // BSWAP r32
            case 0xc8: case 0xc9: case 0xca: case 0xcb:
            case 0xcc: case 0xcd: case 0xce: case 0xcf: {
                const r = b1 & 7;
                const src = this.regs[r];
                this.regs[r] = (((src & 0xff) << 24) | (((src >>> 8) & 0xff) << 16) | (((src >>> 16) & 0xff) << 8) | ((src >>> 24) & 0xff)) >>> 0;
                break;
            }
            case 0xff:
            default:
                this.excno = EX_UD;
                return false;
        }
        return true;
    }

    cpui386_step(stepcount) {
        if ((this.flags & IF) && this.intr) {
            this.intr = false;
            this.halt = false;
            const no = this.bus.i8259ReadIrq();
            this.ip = this.next_ip;
            this.call_isr(no, false, 1);
        }

        if (this.halt) {
            return;
        }

        const ret = this.cpu_exec1(stepcount);
        this.ifetch_paddr = 0;
        if (!ret) {
            let pusherr = false;
            switch (this.excno) {
                case EX_DF:
                case EX_TS:
                case EX_NP:
                case EX_SS:
                case EX_GP:
                case EX_PF:
                    pusherr = true;
                    break;
            }
            this.next_ip = this.ip;
            this.call_isr(this.excno, pusherr, 1);
        }
    }

    step() {
        this.cpui386_step(1);
    }

    runBatch(cycles = 10000) {
        let remaining = cycles;
        const chunk = 5120;
        while (remaining > 0) {
            const n = remaining > chunk ? chunk : remaining;
            this.bus.stepPeripherals();
            this.cpui386_step(n);
            remaining -= n;
            if (this.halt) {
                this.bus.uticksNudge = (this.bus.uticksNudge + 8000) >>> 0;
                break;
            }
        }

        const now = performance.now();
        const dt = now - this.lastMipsTime;
        if (dt >= 500) {
            const dInst = this.cycle - this.lastMipsInst;
            this.mipsEstimate = ((dInst / (dt / 1000)) / 1000000).toFixed(1);
            this.lastMipsTime = now;
            this.lastMipsInst = this.cycle;
        }
    }

    getRegistersDump() {
        const hex32 = (v) => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
        const hex16 = (v) => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0');
        const fl = this.cpu_getflags();
        return {
            eax: hex32(this.regs[0]),
            ecx: hex32(this.regs[1]),
            edx: hex32(this.regs[2]),
            ebx: hex32(this.regs[3]),
            esp: hex32(this.regs[4]),
            ebp: hex32(this.regs[5]),
            esi: hex32(this.regs[6]),
            edi: hex32(this.regs[7]),
            eip: hex32(this.next_ip),
            eflags: hex32(fl),
            cs: hex16(this.seg[SEG_CS].sel),
            ds: hex16(this.seg[SEG_DS].sel),
            ss: hex16(this.seg[SEG_SS].sel),
            es: hex16(this.seg[SEG_ES].sel),
            fs: hex16(this.seg[SEG_FS].sel),
            gs: hex16(this.seg[SEG_GS].sel),
            flags: `${(fl & OF) ? 'O' : '-'}${(fl & DF) ? 'D' : '-'}${(fl & IF) ? 'I' : '-'}${(fl & SF) ? 'S' : '-'}${(fl & ZF) ? 'Z' : '-'}${(fl & CF) ? 'C' : '-'}`,
            mips: this.mipsEstimate,
            instructions: this.cycle
        };
    }
}
