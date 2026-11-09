/**
 * Integrated x87 Floating-Point Unit (FPU)
 * 100% Pure JavaScript port of tiny386 fpu.c (80-bit extended precision float conversion,
 * register stack ST(0)-ST(7), control/status words, BCD, integer, and transcendental ops).
 *
 * Copyright (c) 2024-2025 Chunhui He (BSD-3-Clause)
 * Portions Copyright (c) 2026 Jan de Jager
 */

const BIAS80 = 16383;
const BIAS64 = 1023;

const C0 = 0x0100;
const C1 = 0x0200;
const C2 = 0x0400;
const C3 = 0x4000;

const CF = 0x0001;
const PF = 0x0004;
const AF = 0x0010;
const ZF = 0x0040;
const SF = 0x0080;
const OF = 0x0800;

const PI  = 3.141592653589793238462;
const L2E = 1.4426950408889634073605;
const L2T = 3.3219280948873623478693;
const LN2 = 0.69314718055994530941683;
const LG2 = 0.30102999566398119521379;

const f64Buf = new ArrayBuffer(8);
const f64View = new DataView(f64Buf);

const f32Buf = new ArrayBuffer(4);
const f32View = new DataView(f32Buf);

function ctz64(v) {
    if (v === 0n) return 64;
    let n = 0;
    while ((v & 1n) === 0n) {
        v >>= 1n;
        n++;
    }
    return n;
}

function tof80(val) {
    f64View.setFloat64(0, val, true);
    const lo = BigInt(f64View.getUint32(0, true));
    const hi = BigInt(f64View.getUint32(4, true));
    const v = (hi << 32n) | lo;

    const sign = Number((v >> 63n) & 1n);
    let exp = Number((v >> 52n) & 0x7ffn);
    let mant80 = (v & ((1n << 52n) - 1n)) << 11n;

    if (exp === 0) {
        if (mant80 !== 0n) {
            const ffs = ctz64(mant80) + 1;
            const shift = 64 - ffs;
            mant80 = BigInt.asUintN(64, mant80 << BigInt(shift));
            exp += BIAS80 - BIAS64 + 1 - shift;
        }
    } else if (exp === 0x7ff) {
        mant80 |= (1n << 63n);
        exp = 0x7fff;
    } else {
        mant80 |= (1n << 63n);
        exp += BIAS80 - BIAS64;
    }

    return {
        mant0: Number(mant80 & 0xffffffffn) >>> 0,
        mant1: Number((mant80 >> 32n) & 0xffffffffn) >>> 0,
        high: ((sign << 15) | (exp & 0x7fff)) & 0xffff
    };
}

function fromf80(f80) {
    const sign = (f80.high >>> 15) & 1;
    let exp = f80.high & 0x7fff;
    const mant80 = (BigInt(f80.mant1 >>> 0) << 32n) | BigInt(f80.mant0 >>> 0);

    let mant64 = 0n;
    if (exp === 0) {
        mant64 = 0n;
    } else if (exp === 0x7fff) {
        exp = 0x7ff;
        mant64 = mant80 >> 11n;
        if (mant64 === 0n && mant80 !== 0n) {
            mant64 = 1n;
        }
    } else {
        exp += BIAS64 - BIAS80;
        if (exp <= -52) {
            exp = 0;
            mant64 = 0n;
        } else if (exp <= 0) {
            mant64 = mant80 >> BigInt(12 - exp);
            exp = 0;
        } else if (exp >= 0x7ff) {
            exp = 0x7ff;
            mant64 = 0n;
        } else {
            mant64 = (mant80 >> 11n) & ((1n << 52n) - 1n);
        }
    }

    const res = (BigInt(sign) << 63n) | (BigInt(exp) << 52n) | (mant64 & ((1n << 52n) - 1n));
    f64View.setUint32(0, Number(res & 0xffffffffn) >>> 0, true);
    f64View.setUint32(4, Number((res >> 32n) & 0xffffffffn) >>> 0, true);
    return f64View.getFloat64(0, true);
}

function bcd100(b) {
    b &= 0xff;
    return b - (6 * (b >>> 4));
}

function signbit(x) {
    return x < 0 || Object.is(x, -0);
}

function copysign(x, y) {
    const mag = Math.abs(x);
    return signbit(y) ? -mag : mag;
}

function isunordered(a, b) {
    return Number.isNaN(a) || Number.isNaN(b);
}

function nearbyint(x) {
    if (!Number.isFinite(x)) return x;
    const r = Math.round(x);
    if (Math.abs(x - r) === 0.5) {
        return 2 * Math.round(x / 2);
    }
    return r;
}

function frexp(value) {
    if (value === 0 || !Number.isFinite(value)) {
        return { mant: value, exp: 0 };
    }
    const absVal = Math.abs(value);
    let exp = Math.floor(Math.log2(absVal)) + 1;
    let mant = value / Math.pow(2, exp);
    if (Math.abs(mant) >= 1.0) {
        mant /= 2;
        exp++;
    } else if (Math.abs(mant) < 0.5) {
        mant *= 2;
        exp--;
    }
    return { mant, exp };
}

function fpround(x, rc) {
    switch (rc & 3) {
        case 0: return nearbyint(x);
        case 1: return Math.floor(x);
        case 2: return Math.ceil(x);
        case 3: return Math.trunc(x);
    }
    return x;
}

export class FPU {
    constructor() {
        this.cw = 0x0040;
        this.sw = 0x0000;
        this.top = 0;
        this.st = new Float64Array(8);
        this.rawst = Array.from({ length: 8 }, () => ({ mant0: 0, mant1: 0, high: 0 }));
        this.rawtagr = 0;
        this.rawtagw = 0;
    }

    reset() {
        this.cw = 0x0040;
        this.sw = 0x0000;
        this.top = 0;
        this.st.fill(0);
        for (let i = 0; i < 8; i++) {
            this.rawst[i].mant0 = 0;
            this.rawst[i].mant1 = 0;
            this.rawst[i].high = 0;
        }
        this.rawtagr = 0;
        this.rawtagw = 0;
    }

    getsw() {
        return ((this.sw & 0xc7ff) | ((this.top & 7) << 11)) & 0xffff;
    }

    setsw(sw) {
        this.sw = sw & 0xffff;
        this.top = (sw >>> 11) & 7;
    }

    fpget(i) {
        const idx = (this.top + i) & 7;
        const mask = 1 << idx;
        if (!(this.rawtagr & mask) && !(this.rawtagw & mask)) {
            this.st[idx] = fromf80(this.rawst[idx]);
            this.rawtagr |= mask;
        }
        return this.st[idx];
    }

    fpset(i, val) {
        const idx = (this.top + i) & 7;
        const mask = 1 << idx;
        this.st[idx] = val;
        this.rawtagw |= mask;
    }

    fppush(val) {
        this.top = (this.top - 1) & 7;
        this.fpset(0, val);
    }

    fppop() {
        this.top = (this.top + 1) & 7;
    }

    fploadf32(cpu, seg, addr) {
        const r = cpu.cpu_load32(seg, addr);
        if (!r.ok) return null;
        f32View.setUint32(0, r.val >>> 0, true);
        return f32View.getFloat32(0, true);
    }

    fploadf64(cpu, seg, addr) {
        const r1 = cpu.cpu_load32(seg, addr);
        if (!r1.ok) return null;
        const r2 = cpu.cpu_load32(seg, (addr + 4) >>> 0);
        if (!r2.ok) return null;
        f64View.setUint32(0, r1.val >>> 0, true);
        f64View.setUint32(4, r2.val >>> 0, true);
        return f64View.getFloat64(0, true);
    }

    fploadf80(cpu, seg, addr) {
        const r0 = cpu.cpu_load32(seg, addr);
        if (!r0.ok) return null;
        const r1 = cpu.cpu_load32(seg, (addr + 4) >>> 0);
        if (!r1.ok) return null;
        const r2 = cpu.cpu_load16(seg, (addr + 8) >>> 0);
        if (!r2.ok) return null;
        return fromf80({ mant0: r0.val >>> 0, mant1: r1.val >>> 0, high: r2.val & 0xffff });
    }

    fploadi16(cpu, seg, addr) {
        const r = cpu.cpu_load16(seg, addr);
        if (!r.ok) return null;
        return (r.val << 16) >> 16;
    }

    fploadi32(cpu, seg, addr) {
        const r = cpu.cpu_load32(seg, addr);
        if (!r.ok) return null;
        return r.val | 0;
    }

    fploadi64(cpu, seg, addr) {
        const r1 = cpu.cpu_load32(seg, addr);
        if (!r1.ok) return null;
        const r2 = cpu.cpu_load32(seg, (addr + 4) >>> 0);
        if (!r2.ok) return null;
        const v = BigInt.asIntN(64, (BigInt(r2.val >>> 0) << 32n) | BigInt(r1.val >>> 0));
        return Number(v);
    }

    fploadbcd(cpu, seg, addr) {
        const r0 = cpu.cpu_load32(seg, addr);
        if (!r0.ok) return null;
        const r1 = cpu.cpu_load32(seg, (addr + 4) >>> 0);
        if (!r1.ok) return null;
        const r2 = cpu.cpu_load16(seg, (addr + 8) >>> 0);
        if (!r2.ok) return null;

        let lo = r0.val >>> 0;
        let mi = r1.val >>> 0;
        let hi = r2.val & 0xffff;
        const sign = hi & 0x8000;
        hi &= 0x7fff;

        let val = 0n;
        let base = 1n;
        for (let i = 0; i < 4; i++) {
            val += base * BigInt(bcd100(lo & 0xff));
            lo >>>= 8;
            base *= 100n;
        }
        for (let i = 0; i < 4; i++) {
            val += base * BigInt(bcd100(mi & 0xff));
            mi >>>= 8;
            base *= 100n;
        }
        for (let i = 0; i < 2; i++) {
            val += base * BigInt(bcd100(hi & 0xff));
            hi >>>= 8;
            base *= 100n;
        }
        return copysign(Number(val), sign ? -1.0 : 1.0);
    }

    fpstoref32(cpu, seg, addr, val) {
        f32View.setFloat32(0, val, true);
        const v = f32View.getUint32(0, true);
        return cpu.cpu_store32(seg, addr, v);
    }

    fpstoref64(cpu, seg, addr, val) {
        f64View.setFloat64(0, val, true);
        const lo = f64View.getUint32(0, true);
        const hi = f64View.getUint32(4, true);
        if (!cpu.cpu_store32(seg, addr, lo)) return false;
        if (!cpu.cpu_store32(seg, (addr + 4) >>> 0, hi)) return false;
        return true;
    }

    fpstoref80(cpu, seg, addr, val) {
        const f80 = tof80(val);
        if (!cpu.cpu_store32(seg, addr, f80.mant0)) return false;
        if (!cpu.cpu_store32(seg, (addr + 4) >>> 0, f80.mant1)) return false;
        if (!cpu.cpu_store16(seg, (addr + 8) >>> 0, f80.high)) return false;
        return true;
    }

    fpstorei16(cpu, seg, addr, val) {
        const v = (val < 32768.0 && val >= -32768.0) ? (val | 0) & 0xffff : 0x8000;
        return cpu.cpu_store16(seg, addr, v);
    }

    fpstorei32(cpu, seg, addr, val) {
        const v = (val < 2147483648.0 && val >= -2147483648.0) ? (val | 0) >>> 0 : 0x80000000;
        return cpu.cpu_store32(seg, addr, v);
    }

    fpstorei64(cpu, seg, addr, val) {
        let v;
        if (val < 9223372036854775808.0 && val >= -9223372036854775808.0 && Number.isFinite(val)) {
            v = BigInt(Math.trunc(val));
        } else {
            v = -0x8000000000000000n;
        }
        const u = BigInt.asUintN(64, v);
        if (!cpu.cpu_store32(seg, addr, Number(u & 0xffffffffn) >>> 0)) return false;
        if (!cpu.cpu_store32(seg, (addr + 4) >>> 0, Number((u >> 32n) & 0xffffffffn) >>> 0)) return false;
        return true;
    }

    fpstorebcd(cpu, seg, addr, val) {
        let v;
        if (val < 9223372036854775808.0 && val >= -9223372036854775808.0 && Number.isFinite(val)) {
            v = BigInt(Math.trunc(val));
        } else {
            v = -0x8000000000000000n;
        }
        let sign = 0;
        if (v < 0n) {
            sign = 1;
            v = -v;
        }
        for (let i = 0; i < 9; i++) {
            const d0 = Number(v % 10n);
            const d1 = Number((v / 10n) % 10n);
            const res = d0 | (d1 << 4);
            v /= 100n;
            if (!cpu.cpu_store8(seg, (addr + i) >>> 0, res)) return false;
        }
        let res = Number(v % 10n) | (Number((v / 10n) % 10n) << 4);
        if (sign) res |= 0x80;
        if (!cpu.cpu_store8(seg, (addr + 9) >>> 0, res)) return false;
        return true;
    }

    fparith(group, d, a, b) {
        let c = 0;
        switch (group) {
            case 0: c = a + b; break;
            case 1: c = a * b; break;
            case 2:
            case 3:
                if (isunordered(a, b)) {
                    this.sw |= C0 | C2 | C3;
                } else if (a === b) {
                    this.sw |= C3;
                    this.sw &= ~(C0 | C2);
                } else if (a < b) {
                    this.sw |= C0;
                    this.sw &= ~(C2 | C3);
                } else {
                    this.sw &= ~(C0 | C2 | C3);
                }
                break;
            case 4: c = a - b; break;
            case 5: c = b - a; break;
            case 6: c = a / b; break;
            case 7: c = b / a; break;
        }
        if (group === 3) {
            this.fppop();
        } else if (group !== 2) {
            this.fpset(d, c);
        }
    }

    cmov_cond(cpu, i) {
        const flags = cpu.cpu_getflags();
        switch (i) {
            case 0x0: return (flags & CF) !== 0;
            case 0x1: return (flags & ZF) !== 0;
            case 0x2: return (flags & (CF | ZF)) !== 0;
            case 0x3: return (flags & PF) !== 0;
        }
        return false;
    }

    ucomi(cpu, i) {
        const a = this.fpget(0);
        const b = this.fpget(i);
        if (isunordered(a, b)) {
            cpu.cpu_setflags(ZF | PF | CF, 0);
        } else if (a === b) {
            cpu.cpu_setflags(ZF, PF | CF);
        } else if (a < b) {
            cpu.cpu_setflags(CF, ZF | PF);
        } else {
            cpu.cpu_setflags(0, ZF | PF | CF);
        }
    }

    fpu_exec2(cpu, opsz16, op, group, seg, addr) {
        addr >>>= 0;
        let a, b;
        switch (op) {
            case 0: {
                a = this.fpget(0);
                b = this.fploadf32(cpu, seg, addr);
                if (b === null) return false;
                this.fparith(group, 0, a, b);
                break;
            }
            case 1: {
                switch (group) {
                    case 0: {
                        a = this.fploadf32(cpu, seg, addr);
                        if (a === null) return false;
                        this.fppush(a);
                        break;
                    }
                    case 1:
                        cpu.cpu_setexc(6, 0);
                        return false;
                    case 2: {
                        a = this.fpget(0);
                        if (!this.fpstoref32(cpu, seg, addr, a)) return false;
                        break;
                    }
                    case 3: {
                        a = this.fpget(0);
                        if (!this.fpstoref32(cpu, seg, addr, a)) return false;
                        this.fppop();
                        break;
                    }
                    case 4: { // FLDENV
                        if (opsz16) {
                            const r0 = cpu.cpu_load16(seg, addr);
                            if (!r0.ok) return false;
                            this.cw = r0.val;
                            const r1 = cpu.cpu_load16(seg, (addr + 2) >>> 0);
                            if (!r1.ok) return false;
                            this.setsw(r1.val);
                        } else {
                            const r0 = cpu.cpu_load16(seg, addr);
                            if (!r0.ok) return false;
                            this.cw = r0.val;
                            const r1 = cpu.cpu_load16(seg, (addr + 4) >>> 0);
                            if (!r1.ok) return false;
                            this.setsw(r1.val);
                        }
                        break;
                    }
                    case 5: { // FLDCW
                        const r0 = cpu.cpu_load16(seg, addr);
                        if (!r0.ok) return false;
                        this.cw = r0.val;
                        break;
                    }
                    case 6: { // FNSTENV
                        const sw = this.getsw();
                        if (opsz16) {
                            if (!cpu.cpu_store16(seg, addr, this.cw)) return false;
                            if (!cpu.cpu_store16(seg, (addr + 2) >>> 0, sw)) return false;
                            if (!cpu.cpu_store16(seg, (addr + 4) >>> 0, 0)) return false;
                        } else {
                            if (!cpu.cpu_store32(seg, addr, this.cw)) return false;
                            if (!cpu.cpu_store32(seg, (addr + 4) >>> 0, sw)) return false;
                            if (!cpu.cpu_store32(seg, (addr + 8) >>> 0, 0)) return false;
                        }
                        break;
                    }
                    case 7: { // FNSTCW
                        if (!cpu.cpu_store16(seg, addr, this.cw)) return false;
                        break;
                    }
                }
                break;
            }
            case 2: {
                a = this.fpget(0);
                b = this.fploadi32(cpu, seg, addr);
                if (b === null) return false;
                this.fparith(group, 0, a, b);
                break;
            }
            case 3: {
                switch (group) {
                    case 0: {
                        a = this.fploadi32(cpu, seg, addr);
                        if (a === null) return false;
                        this.fppush(a);
                        break;
                    }
                    case 1:
                    case 2:
                    case 3: {
                        a = this.fpget(0);
                        if (group !== 1) {
                            const rc = (this.cw >>> 10) & 3;
                            a = fpround(a, rc);
                        }
                        if (!this.fpstorei32(cpu, seg, addr, a)) return false;
                        if (group !== 2) this.fppop();
                        break;
                    }
                    case 4:
                    case 6:
                        cpu.cpu_setexc(6, 0);
                        return false;
                    case 5: {
                        a = this.fploadf80(cpu, seg, addr);
                        if (a === null) return false;
                        this.fppush(a);
                        break;
                    }
                    case 7: {
                        a = this.fpget(0);
                        if (!this.fpstoref80(cpu, seg, addr, a)) return false;
                        this.fppop();
                        break;
                    }
                }
                break;
            }
            case 4: {
                a = this.fpget(0);
                b = this.fploadf64(cpu, seg, addr);
                if (b === null) return false;
                this.fparith(group, 0, a, b);
                break;
            }
            case 5: {
                switch (group) {
                    case 0: {
                        a = this.fploadf64(cpu, seg, addr);
                        if (a === null) return false;
                        this.fppush(a);
                        break;
                    }
                    case 1: {
                        a = this.fpget(0);
                        if (!this.fpstorei64(cpu, seg, addr, a)) return false;
                        this.fppop();
                        break;
                    }
                    case 2: {
                        a = this.fpget(0);
                        if (!this.fpstoref64(cpu, seg, addr, a)) return false;
                        break;
                    }
                    case 3: {
                        a = this.fpget(0);
                        if (!this.fpstoref64(cpu, seg, addr, a)) return false;
                        this.fppop();
                        break;
                    }
                    case 4: { // FRSTOR
                        let start = addr;
                        if (opsz16) {
                            const r0 = cpu.cpu_load16(seg, addr);
                            if (!r0.ok) return false;
                            this.cw = r0.val;
                            const r1 = cpu.cpu_load16(seg, (addr + 2) >>> 0);
                            if (!r1.ok) return false;
                            this.setsw(r1.val);
                            start = (start + 14) >>> 0;
                        } else {
                            const r0 = cpu.cpu_load16(seg, addr);
                            if (!r0.ok) return false;
                            this.cw = r0.val;
                            const r1 = cpu.cpu_load16(seg, (addr + 4) >>> 0);
                            if (!r1.ok) return false;
                            this.setsw(r1.val);
                            start = (start + 28) >>> 0;
                        }
                        for (let j = 0; j < 8; j++) {
                            const m0 = cpu.cpu_load32(seg, start);
                            if (!m0.ok) return false;
                            const m1 = cpu.cpu_load32(seg, (start + 4) >>> 0);
                            if (!m1.ok) return false;
                            const hi = cpu.cpu_load16(seg, (start + 8) >>> 0);
                            if (!hi.ok) return false;
                            this.rawst[j].mant0 = m0.val >>> 0;
                            this.rawst[j].mant1 = m1.val >>> 0;
                            this.rawst[j].high = hi.val & 0xffff;
                            this.rawtagr &= ~(1 << j);
                            this.rawtagw &= ~(1 << j);
                            start = (start + 10) >>> 0;
                        }
                        break;
                    }
                    case 5:
                        cpu.cpu_setexc(6, 0);
                        return false;
                    case 6: { // FNSAVE
                        let start = addr;
                        const sw = this.getsw();
                        if (opsz16) {
                            if (!cpu.cpu_store16(seg, addr, this.cw)) return false;
                            if (!cpu.cpu_store16(seg, (addr + 2) >>> 0, sw)) return false;
                            if (!cpu.cpu_store16(seg, (addr + 4) >>> 0, 0)) return false;
                            start = (start + 14) >>> 0;
                        } else {
                            if (!cpu.cpu_store32(seg, addr, this.cw)) return false;
                            if (!cpu.cpu_store32(seg, (addr + 4) >>> 0, sw)) return false;
                            if (!cpu.cpu_store32(seg, (addr + 8) >>> 0, 0)) return false;
                            start = (start + 28) >>> 0;
                        }
                        for (let j = 0; j < 8; j++) {
                            if (this.rawtagw & (1 << j)) {
                                this.rawst[j] = tof80(this.st[j]);
                                this.rawtagw &= ~(1 << j);
                            }
                            if (!cpu.cpu_store32(seg, start, this.rawst[j].mant0)) return false;
                            if (!cpu.cpu_store32(seg, (start + 4) >>> 0, this.rawst[j].mant1)) return false;
                            if (!cpu.cpu_store16(seg, (start + 8) >>> 0, this.rawst[j].high)) return false;
                            start = (start + 10) >>> 0;
                        }
                        this.sw = 0;
                        this.top = 0;
                        this.cw = 0x037f;
                        break;
                    }
                    case 7: { // FNSTSW
                        if (!cpu.cpu_store16(seg, addr, this.getsw())) return false;
                        break;
                    }
                }
                break;
            }
            case 6: {
                a = this.fpget(0);
                b = this.fploadi16(cpu, seg, addr);
                if (b === null) return false;
                this.fparith(group, 0, a, b);
                break;
            }
            case 7: {
                switch (group) {
                    case 0: {
                        a = this.fploadi16(cpu, seg, addr);
                        if (a === null) return false;
                        this.fppush(a);
                        break;
                    }
                    case 1:
                    case 2:
                    case 3: {
                        a = this.fpget(0);
                        if (group !== 1) {
                            const rc = (this.cw >>> 10) & 3;
                            a = fpround(a, rc);
                        }
                        if (!this.fpstorei16(cpu, seg, addr, a)) return false;
                        if (group !== 2) this.fppop();
                        break;
                    }
                    case 4: {
                        a = this.fploadbcd(cpu, seg, addr);
                        if (a === null) return false;
                        this.fppush(a);
                        break;
                    }
                    case 5: {
                        a = this.fploadi64(cpu, seg, addr);
                        if (a === null) return false;
                        this.fppush(a);
                        break;
                    }
                    case 6: {
                        const rc = (this.cw >>> 10) & 3;
                        a = fpround(this.fpget(0), rc);
                        if (!this.fpstorebcd(cpu, seg, addr, a)) return false;
                        this.fppop();
                        break;
                    }
                    case 7: {
                        const rc = (this.cw >>> 10) & 3;
                        a = fpround(this.fpget(0), rc);
                        if (!this.fpstorei64(cpu, seg, addr, a)) return false;
                        this.fppop();
                        break;
                    }
                }
                break;
            }
        }
        return true;
    }

    fpu_exec1(cpu, op, group, i) {
        switch (op) {
            case 0: {
                const a = this.fpget(0);
                const b = this.fpget(i);
                this.fparith(group, 0, a, b);
                break;
            }
            case 1: {
                let temp, temp2;
                switch (group) {
                    case 0:
                        temp = this.fpget(i);
                        this.fppush(temp);
                        break;
                    case 1:
                        temp = this.fpget(i);
                        temp2 = this.fpget(0);
                        this.fpset(i, temp2);
                        this.fpset(0, temp);
                        break;
                    case 2:
                        break;
                    case 3:
                        temp = this.fpget(0);
                        this.fpset(i, temp);
                        this.fppop();
                        break;
                    case 4:
                        temp = this.fpget(0);
                        switch (i) {
                            case 0:
                                this.fpset(0, copysign(temp, signbit(temp) ? 1.0 : -1.0));
                                break;
                            case 1:
                                this.fpset(0, Math.abs(temp));
                                break;
                            case 2:
                            case 3:
                            case 6:
                            case 7:
                                cpu.cpu_setexc(6, 0);
                                return false;
                            case 4:
                                this.fparith(2, 0, temp, 0.0);
                                break;
                            case 5:
                                if (signbit(temp)) this.sw |= C1;
                                else this.sw &= ~C1;
                                if (temp === 0.0) {
                                    this.sw |= C3;
                                    this.sw &= ~(C0 | C2);
                                } else if (Number.isNaN(temp)) {
                                    this.sw |= C0;
                                    this.sw &= ~(C2 | C3);
                                } else if (Number.isFinite(temp)) {
                                    this.sw |= C2;
                                    this.sw &= ~(C0 | C3);
                                } else {
                                    this.sw |= (C0 | C2);
                                    this.sw &= ~C3;
                                }
                                break;
                        }
                        break;
                    case 5:
                        switch (i) {
                            case 0: this.fppush(1.0); break;
                            case 1: this.fppush(L2T); break;
                            case 2: this.fppush(L2E); break;
                            case 3: this.fppush(PI); break;
                            case 4: this.fppush(LG2); break;
                            case 5: this.fppush(LN2); break;
                            case 6: this.fppush(0.0); break;
                            case 7:
                                cpu.cpu_setexc(6, 0);
                                return false;
                        }
                        break;
                    case 6:
                        temp = this.fpget(0);
                        switch (i) {
                            case 0:
                                this.fpset(0, Math.pow(2.0, temp) - 1);
                                break;
                            case 1:
                                temp2 = this.fpget(1);
                                this.fpset(1, temp2 * Math.log2(temp));
                                this.fppop();
                                break;
                            case 2:
                                this.fpset(0, Math.tan(temp));
                                this.fppush(1.0);
                                this.sw &= ~C2;
                                break;
                            case 3:
                                temp2 = this.fpget(1);
                                this.fpset(1, Math.atan2(temp2, temp));
                                this.fppop();
                                break;
                            case 4: {
                                const fr = frexp(temp);
                                const mant = fr.mant * 2;
                                const exp = fr.exp - 1;
                                this.fpset(0, exp);
                                this.fppush(mant);
                                break;
                            }
                            case 5: {
                                temp2 = this.fpget(1);
                                const q = Math.trunc(nearbyint(temp / temp2));
                                this.fpset(0, temp - q * temp2);
                                this.sw &= ~C2;
                                if (q & 1) this.sw |= C1; else this.sw &= ~C1;
                                if (q & 2) this.sw |= C3; else this.sw &= ~C3;
                                if (q & 4) this.sw |= C0; else this.sw &= ~C0;
                                break;
                            }
                            case 6:
                                this.top = (this.top - 1) & 7;
                                break;
                            case 7:
                                this.top = (this.top + 1) & 7;
                                break;
                        }
                        break;
                    case 7:
                        temp = this.fpget(0);
                        switch (i) {
                            case 0: {
                                temp2 = this.fpget(1);
                                const q = Math.trunc(temp / temp2);
                                this.fpset(0, temp - q * temp2);
                                this.sw &= ~C2;
                                if (q & 1) this.sw |= C1; else this.sw &= ~C1;
                                if (q & 2) this.sw |= C3; else this.sw &= ~C3;
                                if (q & 4) this.sw |= C0; else this.sw &= ~C0;
                                break;
                            }
                            case 1:
                                temp2 = this.fpget(1);
                                this.fpset(1, temp2 * Math.log2(1.0 + temp));
                                this.fppop();
                                break;
                            case 2:
                                this.fpset(0, Math.sqrt(temp));
                                break;
                            case 3: {
                                const s = Math.sin(temp);
                                const c = Math.cos(temp);
                                this.fpset(0, s);
                                this.fppush(c);
                                this.sw &= ~C2;
                                break;
                            }
                            case 4: {
                                const rc = (this.cw >>> 10) & 3;
                                this.fpset(0, fpround(temp, rc));
                                break;
                            }
                            case 5:
                                this.fpset(0, temp * Math.pow(2.0, Math.trunc(this.fpget(1))));
                                break;
                            case 6:
                                this.fpset(0, Math.sin(temp));
                                this.sw &= ~C2;
                                break;
                            case 7:
                                this.fpset(0, Math.cos(temp));
                                this.sw &= ~C2;
                                break;
                        }
                        break;
                }
                break;
            }
            case 2:
                switch (group) {
                    case 5:
                        if (i === 1) {
                            const a = this.fpget(0);
                            const b = this.fpget(1);
                            if (isunordered(a, b)) {
                                this.sw |= C0 | C2 | C3;
                            } else if (a === b) {
                                this.sw |= C3;
                                this.sw &= ~(C0 | C2);
                            } else if (a < b) {
                                this.sw |= C0;
                                this.sw &= ~(C2 | C3);
                            } else {
                                this.sw &= ~(C0 | C2 | C3);
                            }
                            this.fppop();
                            this.fppop();
                            break;
                        }
                        cpu.cpu_setexc(6, 0);
                        return false;
                    case 0:
                    case 1:
                    case 2:
                    case 3:
                        if (this.cmov_cond(cpu, group)) {
                            this.fpset(0, this.fpget(i));
                        }
                        break;
                    default:
                        cpu.cpu_setexc(6, 0);
                        return false;
                }
                break;
            case 3:
                switch (group) {
                    case 4:
                        switch (i) {
                            case 0:
                            case 1:
                            case 4:
                            case 5:
                                break;
                            case 2:
                                this.sw &= ~0x80ff;
                                break;
                            case 3:
                                this.sw = 0;
                                this.top = 0;
                                this.cw = 0x037f;
                                break;
                            case 6:
                            case 7:
                                cpu.cpu_setexc(6, 0);
                                return false;
                        }
                        break;
                    case 0:
                    case 1:
                    case 2:
                    case 3:
                        if (!this.cmov_cond(cpu, group)) {
                            this.fpset(0, this.fpget(i));
                        }
                        break;
                    case 5:
                    case 6:
                        this.ucomi(cpu, i);
                        break;
                    default:
                        cpu.cpu_setexc(6, 0);
                        return false;
                }
                break;
            case 4: {
                const a = this.fpget(0);
                const b = this.fpget(i);
                this.fparith(group, i, a, b);
                break;
            }
            case 5: {
                let temp, temp2;
                switch (group) {
                    case 0:
                        break;
                    case 1:
                        temp = this.fpget(i);
                        temp2 = this.fpget(0);
                        this.fpset(i, temp2);
                        this.fpset(0, temp);
                        break;
                    case 2:
                        temp = this.fpget(0);
                        this.fpset(i, temp);
                        break;
                    case 3:
                        temp = this.fpget(0);
                        this.fpset(i, temp);
                        this.fppop();
                        break;
                    case 4:
                    case 5: {
                        const a = this.fpget(0);
                        const b = this.fpget(i);
                        if (isunordered(a, b)) {
                            this.sw |= C0 | C2 | C3;
                        } else if (a === b) {
                            this.sw |= C3;
                            this.sw &= ~(C0 | C2);
                        } else if (a < b) {
                            this.sw |= C0;
                            this.sw &= ~(C2 | C3);
                        } else {
                            this.sw &= ~(C0 | C2 | C3);
                        }
                        if (group === 5) this.fppop();
                        break;
                    }
                    case 6:
                    case 7:
                        cpu.cpu_setexc(6, 0);
                        return false;
                }
                break;
            }
            case 6: {
                const a = this.fpget(0);
                const b = this.fpget(i);
                this.fparith(group, i, a, b);
                this.fppop();
                break;
            }
            case 7:
                switch (group) {
                    case 0:
                        this.fppop();
                        break;
                    case 1: {
                        const temp = this.fpget(i);
                        const temp2 = this.fpget(0);
                        this.fpset(i, temp2);
                        this.fpset(0, temp);
                        break;
                    }
                    case 2:
                    case 3: {
                        const temp = this.fpget(0);
                        this.fpset(i, temp);
                        this.fppop();
                        break;
                    }
                    case 4:
                        if (i === 0) {
                            cpu.cpu_setax(this.getsw());
                        } else {
                            cpu.cpu_setexc(6, 0);
                            return false;
                        }
                        break;
                    case 5:
                    case 6:
                        this.ucomi(cpu, i);
                        this.fppop();
                        break;
                    case 7:
                        cpu.cpu_setexc(6, 0);
                        return false;
                }
                break;
        }
        return true;
    }
}
