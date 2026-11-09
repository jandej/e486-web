/**
 * Retro486 System Bus & Motherboard Chipset
 * 100% Pure JavaScript port of tiny386 pc.c, i8259.c, i8254.c, i8042.c, pci.c, misc.c
 *
 * Copyright (c) 2024-2025 Chunhui He (BSD-3-Clause)
 * Portions Copyright (c) 2003-2017 Fabrice Bellard (MIT)
 * Portions Copyright (c) 2026 Jan de Jager
 *
 * Handles I/O dispatch (8/16/32-bit & string I/O), memory mapping, A20 gate,
 * dual 8259 PIC, 8254 PIT, 8237 DMA, CMOS RTC, 8042 PS/2 Keyboard & Mouse,
 * i440FX/PIIX3 PCI bus, SeaBIOS timer (0x3CC), and expansion slot management.
 */

const PIT_FREQ = 1193182;
const RW_STATE_LSB = 1;
const RW_STATE_MSB = 2;
const RW_STATE_WORD0 = 3;
const RW_STATE_WORD1 = 4;

const KBD_CCMD_READ_MODE = 0x20;
const KBD_CCMD_WRITE_MODE = 0x60;
const KBD_CCMD_MOUSE_DISABLE = 0xA7;
const KBD_CCMD_MOUSE_ENABLE = 0xA8;
const KBD_CCMD_TEST_MOUSE = 0xA9;
const KBD_CCMD_SELF_TEST = 0xAA;
const KBD_CCMD_KBD_TEST = 0xAB;
const KBD_CCMD_KBD_DISABLE = 0xAD;
const KBD_CCMD_KBD_ENABLE = 0xAE;
const KBD_CCMD_READ_INPORT = 0xC0;
const KBD_CCMD_READ_OUTPORT = 0xD0;
const KBD_CCMD_WRITE_OUTPORT = 0xD1;
const KBD_CCMD_WRITE_OBUF = 0xD2;
const KBD_CCMD_WRITE_AUX_OBUF = 0xD3;
const KBD_CCMD_WRITE_MOUSE = 0xD4;
const KBD_CCMD_DISABLE_A20 = 0xDD;
const KBD_CCMD_ENABLE_A20 = 0xDF;
const KBD_CCMD_RESET = 0xFE;

const KBD_STAT_OBF = 0x01;
const KBD_STAT_SELFTEST = 0x04;
const KBD_STAT_CMD = 0x08;
const KBD_STAT_UNLOCKED = 0x10;
const KBD_STAT_MOUSE_OBF = 0x20;

const KBD_MODE_KBD_INT = 0x01;
const KBD_MODE_MOUSE_INT = 0x02;
const KBD_MODE_DISABLE_KBD = 0x10;
const KBD_MODE_DISABLE_MOUSE = 0x20;
const KBD_MODE_KCC = 0x40;

const KBD_PENDING_KBD = 1;
const KBD_PENDING_AUX = 2;

const KBD_CMD_SET_LEDS = 0xED;
const KBD_CMD_ECHO = 0xEE;
const KBD_CMD_GET_ID = 0xF2;
const KBD_CMD_SET_RATE = 0xF3;
const KBD_CMD_ENABLE = 0xF4;
const KBD_CMD_RESET_DISABLE = 0xF5;
const KBD_CMD_RESET_ENABLE = 0xF6;
const KBD_CMD_RESET = 0xFF;

const KBD_REPLY_POR = 0xAA;
const KBD_REPLY_ACK = 0xFA;
const KBD_REPLY_RESEND = 0xFE;

const AUX_SET_SCALE11 = 0xE6;
const AUX_SET_SCALE21 = 0xE7;
const AUX_SET_RES = 0xE8;
const AUX_GET_SCALE = 0xE9;
const AUX_SET_STREAM = 0xEA;
const AUX_POLL = 0xEB;
const AUX_RESET_WRAP = 0xEC;
const AUX_SET_WRAP = 0xEE;
const AUX_SET_REMOTE = 0xF0;
const AUX_GET_TYPE = 0xF2;
const AUX_SET_SAMPLE = 0xF3;
const AUX_ENABLE_DEV = 0xF4;
const AUX_DISABLE_DEV = 0xF5;
const AUX_SET_DEFAULT = 0xF6;
const AUX_RESET = 0xFF;
const AUX_ACK = 0xFA;

const MOUSE_STATUS_REMOTE = 0x40;
const MOUSE_STATUS_ENABLED = 0x20;
const MOUSE_STATUS_SCALE21 = 0x10;

const PS2_QUEUE_SIZE = 256;

function bin2bcd(a) {
    return (((a / 10) | 0) << 4) | (a % 10);
}

export class RetroBus {
    constructor(ramSizeMb = 16) {
        this.ramSizeBytes = Math.max(1, Math.min(64, ramSizeMb)) * 1024 * 1024;
        this.ram = new Uint8Array(this.ramSizeBytes);
        this.ram16 = new Uint16Array(this.ram.buffer);
        this.ram32 = new Uint32Array(this.ram.buffer);
        this.ramView = new DataView(this.ram.buffer);

        this.a20Enabled = true;
        this.cpu = null; // Set by Cpu486 constructor
        this.bios = null; // Set by BiosRom constructor
        this.resetRequest = false;
        this.uticksNudge = 0;
        this.bootStartTime = this.getUticks();

        // Expansion slots (1-indexed, 1 through 6)
        this.slots = [null, null, null, null, null, null];
        this.activeVgaCard = null;
        this.activeMultiIOCard = null;
        this.pciVgaRamAddr = 0xe0000000;

        // Fast I/O dispatch table (65536 ports)
        this.ioReaders = new Array(65536).fill(null);
        this.ioWriters = new Array(65536).fill(null);

        // Memory windows registered by cards (sorted by start address)
        this.memoryWindows = [];

        // Bus Activity Tracking (for Motherboard live LEDs)
        this.busActivity = {
            memr: 0,
            memw: 0,
            ior: 0,
            iow: 0,
            lastIoPort: 0,
            lastMemAddr: 0,
            irqStates: new Uint8Array(16),
            dmaStates: new Uint8Array(8),
            postCode: 0x00,
            biosLog: ''
        };

        // Initialize Onboard Chipset Peripherals
        this.initPIC();
        this.initPIT();
        this.initDMA();
        this.initCMOS();
        this.initKBC();
        this.initSerial();
        this.initPCI();
        this.initMotherboardPorts();
    }

    getUticks() {
        this.uticksNudge = (this.uticksNudge + 10) >>> 0;
        return (((performance.now() * 1000) >>> 0) + this.uticksNudge) >>> 0;
    }

    afterEq(a, b) {
        return ((a - b) >>> 0) < 0x80000000;
    }

    /* ======================================================================
     * EXPANSION SLOTS & CARD MANAGEMENT
     * ====================================================================== */

    installCard(slotNumber, card) {
        if (slotNumber < 1 || slotNumber > 6) {
            throw new Error(`Invalid slot number: ${slotNumber}. Valid slots are 1-6.`);
        }
        const index = slotNumber - 1;
        if (this.slots[index]) {
            this.removeCard(slotNumber);
        }

        this.slots[index] = card;
        card.onInstall(this, slotNumber);
        this.mapCard(card);
        this.refreshFastCardRefs();
        return card;
    }

    removeCard(slotNumber) {
        if (slotNumber < 1 || slotNumber > 6) return null;
        const index = slotNumber - 1;
        const card = this.slots[index];
        if (!card) return null;

        this.unmapCard(card);
        card.onRemove();
        this.slots[index] = null;
        this.refreshFastCardRefs();
        return card;
    }

    getCard(slotNumber) {
        if (slotNumber < 1 || slotNumber > 6) return null;
        return this.slots[slotNumber - 1];
    }

    remapCard(card) {
        this.unmapCard(card);
        this.mapCard(card);
        this.refreshFastCardRefs();
    }

    refreshFastCardRefs() {
        this.activeVgaCard = null;
        this.activeMultiIOCard = null;
        for (const c of this.slots) {
            if (!c) continue;
            if (c.id === 'vga_card' && !this.activeVgaCard) {
                this.activeVgaCard = c;
            }
            if (c.id === 'multio_card' && !this.activeMultiIOCard) {
                this.activeMultiIOCard = c;
            }
        }
    }

    mapCard(card) {
        const ioHandlers = card.getIOPortHandlers() || [];
        for (const handler of ioHandlers) {
            const port = handler.port & 0xffff;
            if (handler.read) this.ioReaders[port] = handler.read;
            if (handler.write) this.ioWriters[port] = handler.write;
        }

        const memWindows = card.getMemoryWindows() || [];
        for (const win of memWindows) {
            this.memoryWindows.push({
                card,
                start: win.start,
                end: win.end,
                read: win.read,
                write: win.write
            });
        }
        this.memoryWindows.sort((a, b) => a.start - b.start);
    }

    unmapCard(card) {
        const ioHandlers = card.getIOPortHandlers() || [];
        for (const handler of ioHandlers) {
            const port = handler.port & 0xffff;
            if (this.ioReaders[port] === handler.read) this.ioReaders[port] = null;
            if (this.ioWriters[port] === handler.write) this.ioWriters[port] = null;
        }
        this.memoryWindows = this.memoryWindows.filter(w => w.card !== card);
    }

    /* ======================================================================
     * I/O DISPATCH (8 / 16 / 32-BIT & STRING I/O)
     * ====================================================================== */

    ioRead(port, size = 1) {
        port &= 0xffff;
        this.busActivity.ior = 10;
        this.busActivity.lastIoPort = port;

        if (size === 1) {
            if (port === 0xf1f4 && this.activeMultiIOCard) {
                const tmp = new Uint8Array(1);
                this.activeMultiIOCard.emulinkDataReadString(tmp, 0, 1, 1);
                return tmp[0];
            }
            const reader = this.ioReaders[port];
            return reader ? (reader(port) & 0xff) : 0xff;
        } else if (size === 2) {
            switch (port) {
                case 0x1ce:
                case 0x1cf:
                    if (this.activeVgaCard) return this.activeVgaCard.vbeRead(port - 0x1ce) & 0xffff;
                    break;
                case 0x1f0:
                    if (this.activeMultiIOCard) return this.activeMultiIOCard.ideDataRead16(0) & 0xffff;
                    break;
                case 0x170:
                    if (this.activeMultiIOCard) return this.activeMultiIOCard.ideDataRead16(1) & 0xffff;
                    break;
                case 0xcf8:
                    return this.i440fxReadAddr(0, 1) & 0xffff;
                case 0xcfc:
                case 0xcfe:
                    return this.i440fxReadData(port - 0xcfc, 1) & 0xffff;
            }
            const low = this.ioRead(port, 1);
            const high = this.ioRead(port + 1, 1);
            return ((high << 8) | low) & 0xffff;
        } else if (size === 4) {
            switch (port) {
                case 0x1f0:
                    if (this.activeMultiIOCard) return this.activeMultiIOCard.ideDataRead32(0) >>> 0;
                    break;
                case 0x170:
                    if (this.activeMultiIOCard) return this.activeMultiIOCard.ideDataRead32(1) >>> 0;
                    break;
                case 0x3cc:
                    // SeaBIOS millisecond hardware timer!
                    return Math.floor(((this.getUticks() - this.bootStartTime) >>> 0) / 1000) >>> 0;
                case 0xcf8:
                    return this.i440fxReadAddr(0, 2) >>> 0;
                case 0xcfc:
                    return this.i440fxReadData(0, 2) >>> 0;
                case 0xf1f0:
                    if (this.activeMultiIOCard) return this.activeMultiIOCard.emulinkStatusRead() >>> 0;
                    return 0xffffffff;
            }
            const low = this.ioRead(port, 2);
            const high = this.ioRead(port + 2, 2);
            return ((high << 16) | low) >>> 0;
        }
        return 0xff;
    }

    ioWrite(port, val, size = 1) {
        port &= 0xffff;
        this.busActivity.iow = 10;
        this.busActivity.lastIoPort = port;

        if (size === 1) {
            val &= 0xff;
            if (port === 0xf1f4 && this.activeMultiIOCard) {
                const tmp = new Uint8Array([val]);
                this.activeMultiIOCard.emulinkDataWriteString(tmp, 0, 1, 1);
                return;
            }
            if (port === 0x402) {
                // SeaBIOS debug console output
                this.busActivity.biosLog += String.fromCharCode(val);
                if (this.busActivity.biosLog.length > 4096) {
                    this.busActivity.biosLog = this.busActivity.biosLog.slice(-2048);
                }
                return;
            }
            if (port === 0x80) {
                this.busActivity.postCode = val;
            }
            const writer = this.ioWriters[port];
            if (writer) writer(port, val);
        } else if (size === 2) {
            val &= 0xffff;
            switch (port) {
                case 0x1f0:
                    if (this.activeMultiIOCard) {
                        this.activeMultiIOCard.ideDataWrite16(0, val);
                        return;
                    }
                    break;
                case 0x170:
                    if (this.activeMultiIOCard) {
                        this.activeMultiIOCard.ideDataWrite16(1, val);
                        return;
                    }
                    break;
                case 0x1ce:
                case 0x1cf:
                    if (this.activeVgaCard) {
                        this.activeVgaCard.vbeWrite(port - 0x1ce, val);
                        return;
                    }
                    break;
                case 0xcfc:
                case 0xcfe:
                    this.i440fxWriteData(port - 0xcfc, val, 1);
                    return;
            }
            this.ioWrite(port, val & 0xff, 1);
            this.ioWrite(port + 1, (val >>> 8) & 0xff, 1);
        } else if (size === 4) {
            val >>>= 0;
            switch (port) {
                case 0x1f0:
                    if (this.activeMultiIOCard) {
                        this.activeMultiIOCard.ideDataWrite32(0, val);
                        return;
                    }
                    break;
                case 0x170:
                    if (this.activeMultiIOCard) {
                        this.activeMultiIOCard.ideDataWrite32(1, val);
                        return;
                    }
                    break;
                case 0xcf8:
                    this.i440fxWriteAddr(0, val, 2);
                    return;
                case 0xcfc:
                    this.i440fxWriteData(0, val, 2);
                    return;
                case 0xf1f0:
                    if (this.activeMultiIOCard) {
                        this.activeMultiIOCard.emulinkCmdWrite(val);
                        return;
                    }
                    break;
                case 0xf1f4:
                    if (this.activeMultiIOCard) {
                        this.activeMultiIOCard.emulinkDataWrite32(val);
                        return;
                    }
                    break;
            }
            this.ioWrite(port, val & 0xffff, 2);
            this.ioWrite(port + 2, (val >>> 16) & 0xffff, 2);
        }
    }

    ioReadString(port, buf, offset, size, count) {
        port &= 0xffff;
        this.busActivity.ior = 10;
        this.busActivity.lastIoPort = port;
        if (!this.activeMultiIOCard) return 0;
        switch (port) {
            case 0x1f0:
                return this.activeMultiIOCard.ideDataReadString(0, buf, offset, size, count);
            case 0x170:
                return this.activeMultiIOCard.ideDataReadString(1, buf, offset, size, count);
            case 0xf1f4:
                return this.activeMultiIOCard.emulinkDataReadString(buf, offset, size, count);
        }
        return 0;
    }

    ioWriteString(port, buf, offset, size, count) {
        port &= 0xffff;
        this.busActivity.iow = 10;
        this.busActivity.lastIoPort = port;
        if (!this.activeMultiIOCard) return 0;
        switch (port) {
            case 0x1f0:
                return this.activeMultiIOCard.ideDataWriteString(0, buf, offset, size, count);
            case 0x170:
                return this.activeMultiIOCard.ideDataWriteString(1, buf, offset, size, count);
            case 0xf1f4:
                return this.activeMultiIOCard.emulinkDataWriteString(buf, offset, size, count);
        }
        return 0;
    }

    /* ======================================================================
     * MEMORY DISPATCH & A20 GATE
     * ====================================================================== */

    translateAddress(addr) {
        addr >>>= 0;
        if (!this.a20Enabled) {
            addr &= ~(1 << 20);
        }
        return addr >>> 0;
    }

    inIomem(addr) {
        return (addr >= 0xa0000 && addr < 0xc0000) || (addr >>> 0) >= 0xe0000000;
    }

    iomemRead8(addr) {
        addr >>>= 0;
        if (addr >= (this.pciVgaRamAddr >>> 0) && this.activeVgaCard) {
            const off = addr - (this.pciVgaRamAddr >>> 0);
            if (off < this.activeVgaCard.vga_ram_size) {
                return this.activeVgaCard.vga_ram[off];
            }
            return 0;
        }
        for (let i = 0; i < this.memoryWindows.length; i++) {
            const win = this.memoryWindows[i];
            if (addr >= win.start && addr <= win.end) {
                return win.read(addr);
            }
        }
        return 0xff;
    }

    iomemWrite8(addr, val) {
        addr >>>= 0;
        val &= 0xff;
        if (addr >= (this.pciVgaRamAddr >>> 0) && this.activeVgaCard) {
            const off = addr - (this.pciVgaRamAddr >>> 0);
            if (off < this.activeVgaCard.vga_ram_size) {
                this.activeVgaCard.vga_ram[off] = val;
            }
            return;
        }
        for (let i = 0; i < this.memoryWindows.length; i++) {
            const win = this.memoryWindows[i];
            if (addr >= win.start && addr <= win.end) {
                win.write(addr, val);
                return;
            }
        }
    }

    iomemRead16(addr) {
        return this.iomemRead8(addr) | (this.iomemRead8((addr + 1) >>> 0) << 8);
    }

    iomemWrite16(addr, val) {
        addr >>>= 0;
        if (this.activeVgaCard && addr >= 0xa0000 && addr < 0xc0000) {
            this.activeVgaCard.vgaMemWrite16(addr - 0xa0000, val & 0xffff);
            return;
        }
        this.iomemWrite8(addr, val & 0xff);
        this.iomemWrite8((addr + 1) >>> 0, (val >>> 8) & 0xff);
    }

    iomemRead32(addr) {
        return (this.iomemRead16(addr) | (this.iomemRead16((addr + 2) >>> 0) << 16)) >>> 0;
    }

    iomemWrite32(addr, val) {
        addr >>>= 0;
        if (this.activeVgaCard && addr >= 0xa0000 && addr < 0xc0000) {
            this.activeVgaCard.vgaMemWrite32(addr - 0xa0000, val >>> 0);
            return;
        }
        this.iomemWrite16(addr, val & 0xffff);
        this.iomemWrite16((addr + 2) >>> 0, (val >>> 16) & 0xffff);
    }

    iomemWriteString(addr, srcBuf, srcOffset, len) {
        addr >>>= 0;
        if (this.activeVgaCard && addr >= 0xa0000 && (addr + len) <= 0xc0000) {
            return this.activeVgaCard.vgaMemWriteString(addr - 0xa0000, srcBuf, srcOffset, len);
        }
        return false;
    }

    memRead8(addr) {
        addr = this.translateAddress(addr);
        this.busActivity.memr = 10;
        this.busActivity.lastMemAddr = addr;

        if (this.inIomem(addr)) {
            return this.iomemRead8(addr);
        }
        if (addr < this.ramSizeBytes) {
            return this.ram[addr];
        }
        return 0xff;
    }

    memWrite8(addr, val) {
        addr = this.translateAddress(addr);
        val &= 0xff;
        this.busActivity.memw = 10;
        this.busActivity.lastMemAddr = addr;

        if (this.inIomem(addr)) {
            this.iomemWrite8(addr, val);
            return;
        }
        if (addr < this.ramSizeBytes) {
            this.ram[addr] = val;
        }
    }

    memRead16(addr) {
        return this.memRead8(addr) | (this.memRead8(addr + 1) << 8);
    }

    memWrite16(addr, val) {
        this.memWrite8(addr, val & 0xff);
        this.memWrite8(addr + 1, (val >> 8) & 0xff);
    }

    memRead32(addr) {
        return (this.memRead16(addr) | (this.memRead16(addr + 2) << 16)) >>> 0;
    }

    memWrite32(addr, val) {
        this.memWrite16(addr, val & 0xffff);
        this.memWrite16(addr + 2, (val >>> 16) & 0xffff);
    }

    /* ======================================================================
     * CHIPSET: DUAL 8259 PIC (i8259.c)
     * ====================================================================== */

    createPicChip(defaultBase) {
        return {
            last_irr: 0,
            irr: 0,
            imr: 0,
            isr: 0,
            priority_add: 0,
            irq_base: defaultBase,
            read_reg_select: 0,
            poll: 0,
            special_mask: 0,
            init_state: 0,
            auto_eoi: 0,
            rotate_on_auto_eoi: 0,
            special_fully_nested_mode: 0,
            init4: 0,
            single_mode: 0
        };
    }

    initPIC() {
        this.pics = [
            this.createPicChip(0x08),
            this.createPicChip(0x70)
        ];
        // Backwards compatible alias
        this.pic = {
            master: this.pics[0],
            slave: this.pics[1]
        };

        this.ioReaders[0x20] = () => this.picIoportRead(0, 0x20);
        this.ioReaders[0x21] = () => this.picIoportRead(0, 0x21);
        this.ioWriters[0x20] = (_, val) => this.picIoportWrite(0, 0x20, val);
        this.ioWriters[0x21] = (_, val) => this.picIoportWrite(0, 0x21, val);

        this.ioReaders[0xA0] = () => this.picIoportRead(1, 0xA0);
        this.ioReaders[0xA1] = () => this.picIoportRead(1, 0xA1);
        this.ioWriters[0xA0] = (_, val) => this.picIoportWrite(1, 0xA0, val);
        this.ioWriters[0xA1] = (_, val) => this.picIoportWrite(1, 0xA1, val);
    }

    picResetChip(s, defaultBase) {
        s.last_irr = 0;
        s.irr = 0;
        s.imr = 0;
        s.isr = 0;
        s.priority_add = 0;
        s.irq_base = defaultBase;
        s.read_reg_select = 0;
        s.poll = 0;
        s.special_mask = 0;
        s.init_state = 0;
        s.auto_eoi = 0;
        s.rotate_on_auto_eoi = 0;
        s.special_fully_nested_mode = 0;
        s.init4 = 0;
        s.single_mode = 0;
    }

    picSetIrq1(s, irq, level) {
        const mask = 1 << irq;
        if (level) {
            if ((s.last_irr & mask) === 0) {
                s.irr |= mask;
            }
            s.last_irr |= mask;
        } else {
            s.last_irr &= ~mask;
        }
    }

    picGetPriority(s, mask) {
        if ((mask & 0xff) === 0) return 8;
        let priority = 0;
        while ((mask & (1 << ((priority + s.priority_add) & 7))) === 0) {
            priority++;
        }
        return priority;
    }

    picGetIrq(idx) {
        const s = this.pics[idx];
        let mask = s.irr & ~s.imr;
        const priority = this.picGetPriority(s, mask);
        if (priority === 8) return -1;

        mask = s.isr;
        if (s.special_mask) mask &= ~s.imr;
        if (s.special_fully_nested_mode && idx === 0) mask &= ~(1 << 2);
        const cur_priority = this.picGetPriority(s, mask);
        if (priority < cur_priority) {
            return (priority + s.priority_add) & 7;
        }
        return -1;
    }

    picUpdateIrq() {
        const irq2 = this.picGetIrq(1);
        if (irq2 >= 0) {
            this.picSetIrq1(this.pics[0], 2, 1);
            this.picSetIrq1(this.pics[0], 2, 0);
        }
        const irq = this.picGetIrq(0);
        if (irq >= 0) {
            if (this.cpu && this.cpu.raiseIrq) {
                this.cpu.raiseIrq();
            }
        }
    }

    i8259SetIrq(irq, level) {
        irq &= 0x0f;
        if (level) this.busActivity.irqStates[irq] = 10;
        this.picSetIrq1(this.pics[irq >>> 3], irq & 7, level);
        this.picUpdateIrq();
    }

    raiseIRQ(irq) {
        this.i8259SetIrq(irq, 1);
        this.i8259SetIrq(irq, 0);
    }

    lowerIRQ(irq) {
        this.i8259SetIrq(irq, 0);
    }

    picIntAck(s, irq) {
        if (s.auto_eoi) {
            if (s.rotate_on_auto_eoi) s.priority_add = (irq + 1) & 7;
        } else {
            s.isr |= (1 << irq);
        }
        s.irr &= ~(1 << irq);
    }

    i8259ReadIrq() {
        let irq = this.picGetIrq(0);
        let intno;
        if (irq >= 0) {
            this.picIntAck(this.pics[0], irq);
            if (irq === 2) {
                let irq2 = this.picGetIrq(1);
                if (irq2 >= 0) {
                    this.picIntAck(this.pics[1], irq2);
                } else {
                    irq2 = 7;
                }
                intno = this.pics[1].irq_base + irq2;
            } else {
                intno = this.pics[0].irq_base + irq;
            }
        } else {
            irq = 7;
            intno = this.pics[0].irq_base + irq;
        }
        this.picUpdateIrq();
        return intno;
    }

    getPendingInterrupt() {
        if (this.picGetIrq(0) < 0) return -1;
        return this.i8259ReadIrq();
    }

    picPollRead(idx, addr1) {
        const s = this.pics[idx];
        let ret = this.picGetIrq(idx);
        if (ret >= 0) {
            if (addr1 >>> 7) {
                this.pics[0].isr &= ~(1 << 2);
                this.pics[0].irr &= ~(1 << 2);
            }
            s.irr &= ~(1 << ret);
            s.isr &= ~(1 << ret);
            if ((addr1 >>> 7) || ret !== 2) {
                this.picUpdateIrq();
            }
        } else {
            ret = 0x07;
            this.picUpdateIrq();
        }
        return ret;
    }

    picIoportRead(idx, addr1) {
        const s = this.pics[idx];
        const addr = addr1 & 1;
        if (s.poll) {
            const ret = this.picPollRead(idx, addr1);
            s.poll = 0;
            return ret;
        }
        if (addr === 0) {
            return s.read_reg_select ? s.isr : s.irr;
        }
        return s.imr;
    }

    picIoportWrite(idx, addr, val) {
        const s = this.pics[idx];
        val &= 0xff;
        addr &= 1;
        if (addr === 0) {
            if (val & 0x10) {
                this.picResetChip(s, idx === 0 ? 0x08 : 0x70);
                s.init_state = 1;
                s.init4 = val & 1;
                s.single_mode = val & 2;
            } else if (val & 0x08) {
                if (val & 0x04) s.poll = 1;
                if (val & 0x02) s.read_reg_select = val & 1;
                if (val & 0x40) s.special_mask = (val >>> 5) & 1;
            } else {
                const cmd = val >>> 5;
                switch (cmd) {
                    case 0:
                    case 4:
                        s.rotate_on_auto_eoi = cmd >>> 2;
                        break;
                    case 1:
                    case 5: {
                        const priority = this.picGetPriority(s, s.isr);
                        if (priority !== 8) {
                            const irq = (priority + s.priority_add) & 7;
                            s.isr &= ~(1 << irq);
                            if (cmd === 5) s.priority_add = (irq + 1) & 7;
                            this.picUpdateIrq();
                        }
                        break;
                    }
                    case 3: {
                        const irq = val & 7;
                        s.isr &= ~(1 << irq);
                        this.picUpdateIrq();
                        break;
                    }
                    case 6:
                        s.priority_add = (val + 1) & 7;
                        this.picUpdateIrq();
                        break;
                    case 7: {
                        const irq = val & 7;
                        s.isr &= ~(1 << irq);
                        s.priority_add = (irq + 1) & 7;
                        this.picUpdateIrq();
                        break;
                    }
                }
            }
        } else {
            switch (s.init_state) {
                case 0:
                    s.imr = val;
                    this.picUpdateIrq();
                    break;
                case 1:
                    s.irq_base = val & 0xf8;
                    s.init_state = s.single_mode ? (s.init4 ? 3 : 0) : 2;
                    break;
                case 2:
                    s.init_state = s.init4 ? 3 : 0;
                    break;
                case 3:
                    s.special_fully_nested_mode = (val >>> 4) & 1;
                    s.auto_eoi = (val >>> 1) & 1;
                    s.init_state = 0;
                    break;
            }
        }
    }

    /* ======================================================================
     * CHIPSET: INTEL 8254 PIT (i8254.c)
     * ====================================================================== */

    initPIT() {
        const now = this.getUticks();
        this.pit = {
            channels: [0, 1, 2].map((i) => ({
                count: 0x10000,
                latched_count: 0,
                count_latched: 0,
                status_latched: 0,
                status: 0,
                read_state: RW_STATE_WORD0,
                write_state: RW_STATE_WORD0,
                write_latch: 0,
                rw_mode: RW_STATE_WORD0,
                mode: 3,
                bcd: 0,
                gate: i !== 2 ? 1 : 0,
                count_load_time: now,
                last_irq_count: 0,
                irq: i === 0 ? 0 : -1
            })),
            port61Val: 0x00
        };

        for (let ch = 0; ch < 3; ch++) {
            this.ioReaders[0x40 + ch] = () => this.pitIoportRead(ch);
            this.ioWriters[0x40 + ch] = (_, val) => this.pitIoportWrite(ch, val);
        }
        this.ioWriters[0x43] = (_, val) => this.pitIoportWrite(3, val);

        // Port 0x61: System Control Port B / PC Speaker
        this.ioReaders[0x61] = () => {
            const nowUt = this.getUticks();
            const out2 = this.pitGetOut1(this.pit.channels[2], nowUt);
            const refreshToggle = ((nowUt >>> 4) & 1) << 4;
            return (this.pit.port61Val & 0x0f) | refreshToggle | (out2 << 5);
        };
        this.ioWriters[0x61] = (_, val) => {
            this.pit.port61Val = val & 0xff;
            this.pitSetGate(2, val & 1);
        };
    }

    pitGetCount(s) {
        const elapsedUs = (this.getUticks() - s.count_load_time) >>> 0;
        const d = Math.floor((elapsedUs * PIT_FREQ) / 1000000) >>> 0;
        switch (s.mode) {
            case 0:
            case 1:
            case 4:
            case 5:
                return (s.count - d) & 0xffff;
            case 3:
                return (s.count - ((2 * d) % s.count)) & 0xffff;
            default:
                return (s.count - (d % s.count)) & 0xffff;
        }
    }

    pitGetOut1(s, currentTime) {
        const elapsedUs = (currentTime - s.count_load_time) >>> 0;
        const d = Math.floor((elapsedUs * PIT_FREQ) / 1000000) >>> 0;
        switch (s.mode) {
            default:
            case 0:
                return d >= s.count ? 1 : 0;
            case 1:
                return d < s.count ? 1 : 0;
            case 2:
                return ((d % s.count) === 0 && d !== 0) ? 1 : 0;
            case 3:
                return (d % s.count) < ((s.count + 1) >>> 1) ? 1 : 0;
            case 4:
            case 5:
                return d === s.count ? 1 : 0;
        }
    }

    pitLoadCount(s, val) {
        if (val === 0) val = 0x10000;
        s.count_load_time = this.getUticks();
        s.last_irq_count = 0;
        s.count = val;
    }

    pitLatchCount(s) {
        if (!s.count_latched) {
            s.latched_count = this.pitGetCount(s);
            s.count_latched = s.rw_mode;
        }
    }

    pitSetGate(channel, val) {
        const s = this.pit.channels[channel];
        if ((s.mode === 1 || s.mode === 2 || s.mode === 3 || s.mode === 5) && s.gate < val) {
            s.count_load_time = this.getUticks();
        }
        s.gate = val;
    }

    pitIoportWrite(addr, val) {
        addr &= 3;
        val &= 0xff;
        if (addr === 3) {
            const channel = val >>> 6;
            if (channel === 3) {
                for (let ch = 0; ch < 3; ch++) {
                    const s = this.pit.channels[ch];
                    if (val & (2 << ch)) {
                        if (!(val & 0x20)) {
                            this.pitLatchCount(s);
                        }
                        if (!(val & 0x10) && !s.status_latched) {
                            s.status = (this.pitGetOut1(s, this.getUticks()) << 7) |
                                (s.rw_mode << 4) |
                                (s.mode << 1) |
                                s.bcd;
                            s.status_latched = 1;
                        }
                    }
                }
            } else {
                const s = this.pit.channels[channel];
                const access = (val >>> 4) & 3;
                if (access === 0) {
                    this.pitLatchCount(s);
                } else {
                    s.rw_mode = access;
                    s.read_state = access;
                    s.write_state = access;
                    s.mode = (val >>> 1) & 7;
                    s.bcd = val & 1;
                }
            }
        } else {
            const s = this.pit.channels[addr];
            switch (s.write_state) {
                default:
                case RW_STATE_LSB:
                    this.pitLoadCount(s, val);
                    break;
                case RW_STATE_MSB:
                    this.pitLoadCount(s, val << 8);
                    break;
                case RW_STATE_WORD0:
                    s.write_latch = val;
                    s.write_state = RW_STATE_WORD1;
                    break;
                case RW_STATE_WORD1:
                    this.pitLoadCount(s, s.write_latch | (val << 8));
                    s.write_state = RW_STATE_WORD0;
                    break;
            }
        }
    }

    pitIoportRead(addr) {
        addr &= 3;
        if (addr === 3) return 0xff;
        const s = this.pit.channels[addr];
        if (s.status_latched) {
            s.status_latched = 0;
            return s.status;
        }
        if (s.count_latched) {
            switch (s.count_latched) {
                default:
                case RW_STATE_LSB: {
                    const ret = s.latched_count & 0xff;
                    s.count_latched = 0;
                    return ret;
                }
                case RW_STATE_MSB: {
                    const ret = (s.latched_count >>> 8) & 0xff;
                    s.count_latched = 0;
                    return ret;
                }
                case RW_STATE_WORD0: {
                    const ret = s.latched_count & 0xff;
                    s.count_latched = RW_STATE_MSB;
                    return ret;
                }
            }
        }
        const count = this.pitGetCount(s);
        switch (s.read_state) {
            default:
            case RW_STATE_LSB:
                return count & 0xff;
            case RW_STATE_MSB:
                return (count >>> 8) & 0xff;
            case RW_STATE_WORD0:
                s.read_state = RW_STATE_WORD1;
                return count & 0xff;
            case RW_STATE_WORD1:
                s.read_state = RW_STATE_WORD0;
                return (count >>> 8) & 0xff;
        }
    }

    updatePITIrq() {
        const uticks = this.getUticks();
        const s = this.pit.channels[0];
        const elapsedUs = (uticks - s.count_load_time) >>> 0;
        const d = Math.floor((elapsedUs * PIT_FREQ) / 1000000) >>> 0;
        if (((s.last_irq_count + s.count - d) >>> 0) >= 0x80000000) {
            if (s.irq !== -1) {
                this.i8259SetIrq(s.irq, 1);
                this.i8259SetIrq(s.irq, 0);
                s.last_irq_count = (s.last_irq_count + s.count) >>> 0;
                if (elapsedUs > 0x80000000) {
                    this.pitLoadCount(s, s.count);
                }
            }
        }
    }

    tickPIT(cycles) {
        this.updatePITIrq();
    }

    /* ======================================================================
     * CHIPSET: DUAL 8237 DMA CONTROLLERS
     * ====================================================================== */

    initDMA() {
        this.dma = {
            channels: new Array(8).fill(null).map(() => ({ addr: 0, count: 0, page: 0, mask: true }))
        };

        const pagePorts = [0x87, 0x83, 0x81, 0x82, 0x8F, 0x8B, 0x89, 0x8A];
        pagePorts.forEach((port, idx) => {
            this.ioReaders[port] = () => this.dma.channels[idx].page;
            this.ioWriters[port] = (_, val) => { this.dma.channels[idx].page = val & 0xff; };
        });

        for (let p = 0x00; p <= 0x0f; p++) {
            this.ioReaders[p] = () => 0x00;
            this.ioWriters[p] = () => {};
        }
        for (let p = 0xc0; p <= 0xdf; p++) {
            this.ioReaders[p] = () => 0x00;
            this.ioWriters[p] = () => {};
        }
    }

    /* ======================================================================
     * CHIPSET: MC146818 CMOS REAL-TIME CLOCK & NVRAM (misc.c)
     * ====================================================================== */

    initCMOS() {
        this.cmos = {
            idx: 0,
            nvram: new Uint8Array(128)
        };

        this.cmosUpdateTime();
        this.cmos.nvram[10] = 0x26;
        this.cmos.nvram[11] = 0x02;
        this.cmos.nvram[12] = 0x00;
        this.cmos.nvram[13] = 0x80;
        this.cmos.nvram[0x10] = 0x40; // Drive A: 1.44M
        this.cmos.nvram[0x14] = 0x2D;

        const baseRamKb = 640;
        this.cmos.nvram[0x15] = baseRamKb & 0xff;
        this.cmos.nvram[0x16] = (baseRamKb >>> 8) & 0xff;

        let memSize = this.ramSizeBytes;
        if (memSize >= 1024 * 1024) {
            if (memSize >= 64 * 1024 * 1024) {
                memSize -= 16 * 1024 * 1024;
                this.cmos.nvram[0x35] = (memSize >>> 24) & 0xff;
                this.cmos.nvram[0x34] = (memSize >>> 16) & 0xff;
            } else {
                memSize -= 1024 * 1024;
                this.cmos.nvram[0x31] = (memSize >>> 18) & 0xff;
                this.cmos.nvram[0x30] = (memSize >>> 10) & 0xff;
                this.cmos.nvram[0x18] = (memSize >>> 18) & 0xff;
                this.cmos.nvram[0x17] = (memSize >>> 10) & 0xff;
            }
        }

        this.ioReaders[0x70] = () => 0xff;
        this.ioWriters[0x70] = (_, val) => { this.cmos.idx = val & 0x7f; };
        this.ioReaders[0x71] = () => {
            this.cmosUpdateTime();
            const val = this.cmos.nvram[this.cmos.idx];
            if (this.cmos.idx === 12) this.cmos.nvram[12] = 0x00;
            return val;
        };
        this.ioWriters[0x71] = (_, val) => {
            val &= 0xff;
            if (this.cmos.idx === 10) {
                this.cmos.nvram[10] = (val & ~0x80) | (this.cmos.nvram[10] & 0x80);
            } else {
                this.cmos.nvram[this.cmos.idx] = val;
            }
        };
    }

    cmosUpdateTime() {
        const now = new Date();
        this.cmos.nvram[0] = bin2bcd(now.getUTCSeconds());
        this.cmos.nvram[2] = bin2bcd(now.getUTCMinutes());
        this.cmos.nvram[4] = bin2bcd(now.getUTCHours());
        this.cmos.nvram[6] = bin2bcd(now.getUTCDay() + 1);
        this.cmos.nvram[7] = bin2bcd(now.getUTCDate());
        this.cmos.nvram[8] = bin2bcd(now.getUTCMonth() + 1);
        this.cmos.nvram[9] = bin2bcd(now.getUTCFullYear() % 100);
        this.cmos.nvram[0x32] = bin2bcd((now.getUTCFullYear() / 100) | 0);
    }

    /* ======================================================================
     * CHIPSET: INTEL 8042 KEYBOARD & MOUSE CONTROLLER (i8042.c)
     * ====================================================================== */

    createPs2Device(isMouse) {
        return {
            queue: {
                data: new Uint8Array(PS2_QUEUE_SIZE),
                rptr: 0,
                wptr: 0,
                count: 0
            },
            write_cmd: -1,
            isMouse,
            scan_enabled: 1,
            translate: 1,
            delay: false,
            delay_time: 0,
            delay_keycode: 0,
            mouse_status: 0,
            mouse_resolution: 2,
            mouse_sample_rate: 100,
            mouse_wrap: 0,
            mouse_type: 0,
            mouse_detect_state: 0,
            mouse_dx: 0,
            mouse_dy: 0,
            mouse_dz: 0,
            mouse_buttons: 0
        };
    }

    initKBC() {
        this.kbc = {
            write_cmd: 0,
            status: KBD_STAT_CMD | KBD_STAT_UNLOCKED,
            mode: KBD_MODE_KBD_INT | KBD_MODE_MOUSE_INT | KBD_MODE_KCC,
            pending: 0,
            kbd: this.createPs2Device(false),
            mouse: this.createPs2Device(true)
        };

        this.ioReaders[0x60] = () => this.kbdReadData();
        this.ioWriters[0x60] = (_, val) => this.kbdWriteData(val);
        this.ioReaders[0x64] = () => this.kbc.status;
        this.ioWriters[0x64] = (_, val) => this.kbdWriteCommand(val);
    }

    kbdUpdateIrq() {
        let irq_kbd_level = 0;
        let irq_mouse_level = 0;
        this.kbc.status &= ~(KBD_STAT_OBF | KBD_STAT_MOUSE_OBF);
        if (this.kbc.pending) {
            this.kbc.status |= KBD_STAT_OBF;
            if (this.kbc.pending === KBD_PENDING_AUX) {
                this.kbc.status |= KBD_STAT_MOUSE_OBF;
                if (this.kbc.mode & KBD_MODE_MOUSE_INT) irq_mouse_level = 1;
            } else {
                if ((this.kbc.mode & KBD_MODE_KBD_INT) && !(this.kbc.mode & KBD_MODE_DISABLE_KBD)) {
                    irq_kbd_level = 1;
                }
            }
        }
        this.i8259SetIrq(1, irq_kbd_level);
        this.i8259SetIrq(12, irq_mouse_level);
    }

    kbdUpdateKbdIrq(level) {
        if (level) this.kbc.pending |= KBD_PENDING_KBD;
        else this.kbc.pending &= ~KBD_PENDING_KBD;
        this.kbdUpdateIrq();
    }

    kbdUpdateAuxIrq(level) {
        if (level) this.kbc.pending |= KBD_PENDING_AUX;
        else this.kbc.pending &= ~KBD_PENDING_AUX;
        this.kbdUpdateIrq();
    }

    ps2Queue(dev, b) {
        const q = dev.queue;
        if (q.count >= PS2_QUEUE_SIZE) return;
        q.data[q.wptr] = b & 0xff;
        if (++q.wptr === PS2_QUEUE_SIZE) q.wptr = 0;
        q.count++;
        if (dev.isMouse) this.kbdUpdateAuxIrq(1);
        else this.kbdUpdateKbdIrq(1);
    }

    ps2ReadData(dev) {
        const q = dev.queue;
        let val;
        if (q.count === 0) {
            let index = q.rptr - 1;
            if (index < 0) index = PS2_QUEUE_SIZE - 1;
            val = q.data[index];
        } else {
            val = q.data[q.rptr];
            if (++q.rptr === PS2_QUEUE_SIZE) q.rptr = 0;
            q.count--;
            if (dev.isMouse) {
                this.kbdUpdateAuxIrq(0);
                this.kbdUpdateAuxIrq(q.count !== 0 ? 1 : 0);
            } else {
                this.kbdUpdateKbdIrq(0);
                this.kbdUpdateKbdIrq(q.count !== 0 ? 1 : 0);
            }
        }
        return val;
    }

    kbdQueue(b, aux) {
        this.ps2Queue(aux ? this.kbc.mouse : this.kbc.kbd, b);
    }

    kbdReadData() {
        if (this.kbc.pending === KBD_PENDING_AUX) {
            return this.ps2ReadData(this.kbc.mouse);
        }
        return this.ps2ReadData(this.kbc.kbd);
    }

    kbdWriteCommand(val) {
        val &= 0xff;
        switch (val) {
            case KBD_CCMD_READ_MODE:
                this.kbdQueue(this.kbc.mode, 1);
                break;
            case KBD_CCMD_WRITE_MODE:
            case KBD_CCMD_WRITE_OBUF:
            case KBD_CCMD_WRITE_AUX_OBUF:
            case KBD_CCMD_WRITE_MOUSE:
            case KBD_CCMD_WRITE_OUTPORT:
                this.kbc.write_cmd = val;
                break;
            case KBD_CCMD_MOUSE_DISABLE:
                this.kbc.mode |= KBD_MODE_DISABLE_MOUSE;
                break;
            case KBD_CCMD_MOUSE_ENABLE:
                this.kbc.mode &= ~KBD_MODE_DISABLE_MOUSE;
                break;
            case KBD_CCMD_TEST_MOUSE:
                this.kbdQueue(0x00, 0);
                break;
            case KBD_CCMD_SELF_TEST:
                this.kbc.status |= KBD_STAT_SELFTEST;
                this.kbdQueue(0x55, 0);
                break;
            case KBD_CCMD_KBD_TEST:
                this.kbdQueue(0x00, 0);
                break;
            case KBD_CCMD_KBD_DISABLE:
                this.kbc.mode |= KBD_MODE_DISABLE_KBD;
                this.kbdUpdateIrq();
                break;
            case KBD_CCMD_KBD_ENABLE:
                this.kbc.mode &= ~KBD_MODE_DISABLE_KBD;
                this.kbdUpdateIrq();
                break;
            case KBD_CCMD_READ_INPORT:
                this.kbdQueue(0x00, 0);
                break;
            case KBD_CCMD_READ_OUTPORT: {
                let out = 0x01 | ((this.a20Enabled ? 1 : 0) << 1);
                if (this.kbc.status & KBD_STAT_OBF) out |= 0x10;
                if (this.kbc.status & KBD_STAT_MOUSE_OBF) out |= 0x20;
                this.kbdQueue(out, 0);
                break;
            }
            case KBD_CCMD_ENABLE_A20:
                this.a20Enabled = true;
                break;
            case KBD_CCMD_DISABLE_A20:
                this.a20Enabled = false;
                break;
            case KBD_CCMD_RESET:
                this.resetRequest = true;
                this.onHardwareReset();
                break;
        }
    }

    kbdWriteData(val) {
        val &= 0xff;
        switch (this.kbc.write_cmd) {
            case 0:
                this.ps2WriteKeyboard(val);
                break;
            case KBD_CCMD_WRITE_MODE:
                this.kbc.mode = val;
                this.kbc.kbd.translate = (this.kbc.mode & KBD_MODE_KCC) ? 1 : 0;
                this.kbdUpdateIrq();
                break;
            case KBD_CCMD_WRITE_OBUF:
                this.kbdQueue(val, 0);
                break;
            case KBD_CCMD_WRITE_AUX_OBUF:
                this.kbdQueue(val, 1);
                break;
            case KBD_CCMD_WRITE_OUTPORT:
                this.a20Enabled = !!((val >>> 1) & 1);
                if (!(val & 1)) {
                    this.resetRequest = true;
                    this.onHardwareReset();
                }
                break;
            case KBD_CCMD_WRITE_MOUSE:
                this.ps2WriteMouse(val);
                break;
        }
        this.kbc.write_cmd = 0;
    }

    ps2WriteKeyboard(val) {
        const s = this.kbc.kbd;
        switch (s.write_cmd) {
            default:
            case -1:
                switch (val) {
                    case 0x00:
                        this.ps2Queue(s, KBD_REPLY_ACK);
                        break;
                    case 0x05:
                        this.ps2Queue(s, KBD_REPLY_RESEND);
                        break;
                    case KBD_CMD_GET_ID:
                        this.ps2Queue(s, KBD_REPLY_ACK);
                        this.ps2Queue(s, 0xab);
                        this.ps2Queue(s, 0x83);
                        break;
                    case KBD_CMD_ECHO:
                        this.ps2Queue(s, KBD_CMD_ECHO);
                        break;
                    case KBD_CMD_ENABLE:
                        s.scan_enabled = 1;
                        this.ps2Queue(s, KBD_REPLY_ACK);
                        break;
                    case KBD_CMD_SET_LEDS:
                    case KBD_CMD_SET_RATE:
                        s.write_cmd = val;
                        this.ps2Queue(s, KBD_REPLY_ACK);
                        break;
                    case KBD_CMD_RESET_DISABLE:
                        s.scan_enabled = 0;
                        this.ps2Queue(s, KBD_REPLY_ACK);
                        break;
                    case KBD_CMD_RESET_ENABLE:
                        s.scan_enabled = 1;
                        this.ps2Queue(s, KBD_REPLY_ACK);
                        break;
                    case KBD_CMD_RESET:
                        s.scan_enabled = 1;
                        this.ps2Queue(s, KBD_REPLY_ACK);
                        this.ps2Queue(s, KBD_REPLY_POR);
                        break;
                    default:
                        this.ps2Queue(s, KBD_REPLY_ACK);
                        break;
                }
                break;
            case KBD_CMD_SET_LEDS:
            case KBD_CMD_SET_RATE:
                this.ps2Queue(s, KBD_REPLY_ACK);
                s.write_cmd = -1;
                break;
        }
    }

    ps2WriteMouse(val) {
        const s = this.kbc.mouse;
        switch (s.write_cmd) {
            default:
            case -1:
                if (s.mouse_wrap) {
                    if (val === AUX_RESET_WRAP) {
                        s.mouse_wrap = 0;
                        this.ps2Queue(s, AUX_ACK);
                        return;
                    } else if (val !== AUX_RESET) {
                        this.ps2Queue(s, val);
                        return;
                    }
                }
                switch (val) {
                    case AUX_SET_SCALE11:
                        s.mouse_status &= ~MOUSE_STATUS_SCALE21;
                        this.ps2Queue(s, AUX_ACK);
                        break;
                    case AUX_SET_SCALE21:
                        s.mouse_status |= MOUSE_STATUS_SCALE21;
                        this.ps2Queue(s, AUX_ACK);
                        break;
                    case AUX_SET_STREAM:
                        s.mouse_status &= ~MOUSE_STATUS_REMOTE;
                        this.ps2Queue(s, AUX_ACK);
                        break;
                    case AUX_SET_WRAP:
                        s.mouse_wrap = 1;
                        this.ps2Queue(s, AUX_ACK);
                        break;
                    case AUX_SET_REMOTE:
                        s.mouse_status |= MOUSE_STATUS_REMOTE;
                        this.ps2Queue(s, AUX_ACK);
                        break;
                    case AUX_GET_TYPE:
                        this.ps2Queue(s, AUX_ACK);
                        this.ps2Queue(s, s.mouse_type);
                        break;
                    case AUX_SET_RES:
                    case AUX_SET_SAMPLE:
                        s.write_cmd = val;
                        this.ps2Queue(s, AUX_ACK);
                        break;
                    case AUX_GET_SCALE:
                        this.ps2Queue(s, AUX_ACK);
                        this.ps2Queue(s, s.mouse_status);
                        this.ps2Queue(s, s.mouse_resolution);
                        this.ps2Queue(s, s.mouse_sample_rate);
                        break;
                    case AUX_POLL:
                        this.ps2Queue(s, AUX_ACK);
                        break;
                    case AUX_ENABLE_DEV:
                        s.mouse_status |= MOUSE_STATUS_ENABLED;
                        this.ps2Queue(s, AUX_ACK);
                        break;
                    case AUX_DISABLE_DEV:
                        s.mouse_status &= ~MOUSE_STATUS_ENABLED;
                        this.ps2Queue(s, AUX_ACK);
                        break;
                    case AUX_SET_DEFAULT:
                        s.mouse_sample_rate = 100;
                        s.mouse_resolution = 2;
                        s.mouse_status = 0;
                        this.ps2Queue(s, AUX_ACK);
                        break;
                    case AUX_RESET:
                        s.mouse_sample_rate = 100;
                        s.mouse_resolution = 2;
                        s.mouse_status = 0;
                        s.mouse_type = 0;
                        this.ps2Queue(s, AUX_ACK);
                        this.ps2Queue(s, 0xaa);
                        this.ps2Queue(s, s.mouse_type);
                        break;
                }
                break;
            case AUX_SET_SAMPLE:
                s.mouse_sample_rate = val;
                this.ps2Queue(s, AUX_ACK);
                s.write_cmd = -1;
                break;
            case AUX_SET_RES:
                s.mouse_resolution = val;
                this.ps2Queue(s, AUX_ACK);
                s.write_cmd = -1;
                break;
        }
    }

    ps2PutKeycode(isDown, keycode) {
        const s = this.kbc.kbd;
        if (s.delay) {
            s.delay = false;
            this.ps2Queue(s, s.delay_keycode);
        }
        if (keycode >= 0xe000) {
            this.ps2Queue(s, (keycode >>> 8) & 0xff);
            s.delay = true;
            s.delay_time = (this.getUticks() + 1000) >>> 0;
            s.delay_keycode = (keycode & 0xff) | (isDown ? 0 : 0x80);
        } else {
            this.ps2Queue(s, (keycode & 0xff) | (isDown ? 0 : 0x80));
        }
    }

    queueKbdScancode(scancode) {
        this.ps2Queue(this.kbc.kbd, scancode & 0xff);
    }

    kbdStep() {
        const kbd = this.kbc.kbd;
        if (kbd.delay && this.afterEq(this.getUticks(), kbd.delay_time)) {
            kbd.delay = false;
            this.ps2Queue(kbd, kbd.delay_keycode);
        }
    }

    /* ======================================================================
     * CHIPSET: 8250 / 16550 UART SERIAL PORT (COM1 0x3F8)
     * ====================================================================== */

    initSerial() {
        this.serial = {
            dll: 0,
            dlh: 0,
            lcr: 0,
            ier: 0,
            mcr: 0,
            ioready: 0,
            in: 0
        };
        for (let off = 0; off < 8; off++) {
            this.ioReaders[0x3f8 + off] = () => this.u8250Read(off);
            this.ioWriters[0x3f8 + off] = (_, val) => this.u8250Write(off, val);
            // COM2..COM4 return 0
            this.ioReaders[0x2f8 + off] = () => 0;
            this.ioReaders[0x3e8 + off] = () => 0;
            this.ioReaders[0x2e8 + off] = () => 0;
        }
    }

    u8250Read(off) {
        const u = this.serial;
        switch (off) {
            case 0:
                if (u.lcr & 0x80) return u.dll;
                u.ioready &= ~1;
                return u.in;
            case 1:
                if (u.lcr & 0x80) return u.dlh;
                return u.ier;
            case 2:
                return (u.ier & u.ioready) ? 0 : 1;
            case 3:
                return u.lcr;
            case 4:
                return u.mcr;
            case 5:
                return 0x60 | (u.ioready & 1);
            case 6:
                return 0xb0;
            default:
                return 0;
        }
    }

    u8250Write(off, val) {
        const u = this.serial;
        val &= 0xff;
        switch (off) {
            case 0:
                if (u.lcr & 0x80) u.dll = val;
                break;
            case 1:
                if (u.lcr & 0x80) u.dlh = val;
                else {
                    u.ier = val;
                    if (u.ier & 2) u.ioready |= 2;
                    else u.ioready &= ~2;
                }
                break;
            case 3:
                u.lcr = val;
                break;
            case 4:
                u.mcr = val;
                break;
        }
    }

    /* ======================================================================
     * CHIPSET: i440FX / PIIX3 PCI HOST BRIDGE (0xCF8 / 0xCFC)
     * ====================================================================== */

    createPciDevice(devfn, vendorId, deviceId, revision, classId, headerType = 0x00) {
        const config = new Uint8Array(256);
        const view = new DataView(config.buffer);
        view.setUint16(0x00, vendorId, true);
        view.setUint16(0x02, deviceId, true);
        config[0x08] = revision;
        view.setUint16(0x0a, classId, true);
        config[0x0e] = headerType;
        return {
            devfn,
            config,
            view,
            bars: new Array(7).fill(null)
        };
    }

    initPCI() {
        this.pci = {
            configReg: 0,
            devices: new Array(256).fill(null)
        };

        // PIIX3 ISA Bridge at devfn = 8 (slot 1, fn 0)
        this.pci.devices[8] = this.createPciDevice(8, 0x8086, 0x7000, 0x00, 0x0601, 0x80);

        // PIIX3 IDE Controller at devfn = 9 (slot 1, fn 1)
        const piixIde = this.createPciDevice(9, 0x8086, 0x7010, 0x00, 0x0101, 0x00);
        piixIde.config[0x09] = 0x00;
        this.pci.devices[9] = piixIde;

        // PCI VGA Adapter at devfn = 0 (slot 0, fn 0)
        const pciVga = this.createPciDevice(0, 0x1234, 0x1111, 0x00, 0x0300, 0x00);
        pciVga.bars[0] = {
            size: 262144,
            type: 0x00,
            onSet: (addr, enabled) => {
                this.pciVgaRamAddr = enabled ? (addr >>> 0) : 0xffffffff;
            }
        };
        this.pci.devices[0] = pciVga;

        for (let off = 0; off < 4; off++) {
            this.ioReaders[0xcf8 + off] = () => (this.pci.configReg >>> (off * 8)) & 0xff;
            this.ioWriters[0xcf8 + off] = (_, val) => {
                const mask = ~(0xff << (off * 8));
                this.pci.configReg = ((this.pci.configReg & mask) | ((val & 0xff) << (off * 8))) >>> 0;
            };
            this.ioReaders[0xcfc + off] = () => this.i440fxReadData(off, 0);
            this.ioWriters[0xcfc + off] = (_, val) => this.i440fxWriteData(off, val, 0);
        }
    }

    i440fxWriteAddr(offset, data, sizeLog2) {
        this.pci.configReg = data >>> 0;
    }

    i440fxReadAddr(offset, sizeLog2) {
        return this.pci.configReg >>> 0;
    }

    i440fxReadData(offset, sizeLog2) {
        const valOnes = [0xff, 0xffff, 0xffffffff];
        if (!(this.pci.configReg & 0x80000000)) return valOnes[sizeLog2];
        const addr = (sizeLog2 === 2) ? (this.pci.configReg & ~3) : (this.pci.configReg | offset);
        const busNum = (addr >>> 16) & 0xff;
        if (busNum !== 0) return valOnes[sizeLog2];
        const devfn = (addr >>> 8) & 0xff;
        const d = this.pci.devices[devfn];
        if (!d) return valOnes[sizeLog2];
        const configAddr = addr & 0xff;
        if (sizeLog2 === 0) return d.config[configAddr];
        if (sizeLog2 === 1) return configAddr <= 0xfe ? d.view.getUint16(configAddr, true) : d.config[configAddr];
        return d.view.getUint32(configAddr & 0xfc, true);
    }

    i440fxWriteData(offset, data, sizeLog2) {
        if (!(this.pci.configReg & 0x80000000)) return;
        const addr = (sizeLog2 === 2) ? (this.pci.configReg & ~3) : (this.pci.configReg | offset);
        const busNum = (addr >>> 16) & 0xff;
        if (busNum !== 0) return;
        const devfn = (addr >>> 8) & 0xff;
        const d = this.pci.devices[devfn];
        if (!d) return;
        const configAddr = addr & 0xff;

        if (sizeLog2 === 2 && ((configAddr >= 0x10 && configAddr < 0x28) || configAddr === 0x30)) {
            const reg = (configAddr === 0x30) ? 6 : ((configAddr - 0x10) >>> 2);
            const bar = d.bars[reg];
            if (bar && bar.size) {
                const val = ((data & ~(bar.size - 1)) | bar.type) >>> 0;
                d.view.setUint32(configAddr, val, true);
                const cmd = d.view.getUint16(0x04, true);
                if (bar.onSet) {
                    bar.onSet(val & ~(bar.size - 1), (cmd & 0x02) !== 0);
                }
                return;
            }
        }

        const size = 1 << sizeLog2;
        for (let i = 0; i < size; i++) {
            const a = configAddr + i;
            if (a > 0xff) continue;
            const b = (data >>> (i * 8)) & 0xff;
            if (a === 0x06 || a === 0x07) {
                d.config[a] &= ~b;
            } else if (![0x00, 0x01, 0x02, 0x03, 0x08, 0x09, 0x0a, 0x0b, 0x0e, 0x3d].includes(a) &&
                       !(a >= 0x10 && a <= 0x27) && !(a >= 0x30 && a <= 0x33)) {
                d.config[a] = b;
            }
        }
    }

    /* ======================================================================
     * MOTHERBOARD MISC PORTS (PORT 0x92, PORT 0x80 POST CODE)
     * ====================================================================== */

    initMotherboardPorts() {
        this.port92 = 0x02;
        this.ioReaders[0x92] = () => this.port92;
        this.ioWriters[0x92] = (_, val) => {
            this.a20Enabled = !!(val & 0x02);
            if (val & 0x01) {
                this.resetRequest = true;
                this.onHardwareReset();
            }
            this.port92 = val & ~1;
        };

        // Port 0x80: POST Diagnostic Port
        this.ioReaders[0x80] = () => this.busActivity.postCode;
        this.ioWriters[0x80] = (_, val) => {
            this.busActivity.postCode = val & 0xff;
        };
    }

    stepPeripherals() {
        if (this.resetRequest) {
            this.resetRequest = false;
            if (this.bios) this.bios.reinstallRealBios();
            if (this.cpu) this.cpu.reset();
        }
        this.updatePITIrq();
        this.kbdStep();
    }

    onHardwareReset() {
        this.a20Enabled = true;
        this.port92 = 0x02;
        this.busActivity.postCode = 0x00;
        this.bootStartTime = this.getUticks();
        this.picResetChip(this.pics[0], 0x08);
        this.picResetChip(this.pics[1], 0x70);
        for (const slot of this.slots) {
            if (slot) slot.onReset();
        }
    }

    decayActivityLeds() {
        if (this.busActivity.memr > 0) this.busActivity.memr--;
        if (this.busActivity.memw > 0) this.busActivity.memw--;
        if (this.busActivity.ior > 0) this.busActivity.ior--;
        if (this.busActivity.iow > 0) this.busActivity.iow--;

        for (let i = 0; i < 16; i++) {
            if (this.busActivity.irqStates[i] > 0) this.busActivity.irqStates[i]--;
        }
        for (let i = 0; i < 8; i++) {
            if (this.busActivity.dmaStates[i] > 0) this.busActivity.dmaStates[i]--;
        }
    }

    saveState() {
        return {
            a20Enabled: this.a20Enabled,
            ram: this.ram.slice(),
            postCode: this.busActivity.postCode,
            pics: this.pics.map(p => ({
                last_irr: p.last_irr,
                irr: p.irr,
                imr: p.imr,
                isr: p.isr,
                priority_add: p.priority_add,
                irq_base: p.irq_base,
                read_reg_select: p.read_reg_select,
                poll: p.poll,
                special_mask: p.special_mask,
                init_state: p.init_state,
                auto_eoi: p.auto_eoi,
                rotate_on_auto_eoi: p.rotate_on_auto_eoi,
                special_fully_nested_mode: p.special_fully_nested_mode,
                init4: p.init4,
                single_mode: p.single_mode
            })),
            pit: {
                port61Val: this.pit.port61Val,
                channels: this.pit.channels.map(ch => ({
                    count: ch.count,
                    latched_count: ch.latched_count,
                    count_latched: ch.count_latched,
                    status_latched: ch.status_latched,
                    status: ch.status,
                    read_state: ch.read_state,
                    write_state: ch.write_state,
                    write_latch: ch.write_latch,
                    rw_mode: ch.rw_mode,
                    mode: ch.mode,
                    bcd: ch.bcd,
                    gate: ch.gate,
                    count_load_time: ch.count_load_time,
                    last_irq_count: ch.last_irq_count,
                    irq: ch.irq
                }))
            },
            cmos: {
                idx: this.cmos.idx,
                nvram: Array.from(this.cmos.nvram)
            },
            kbc: {
                write_cmd: this.kbc.write_cmd,
                status: this.kbc.status,
                mode: this.kbc.mode,
                pending: this.kbc.pending
            },
            serial: Object.assign({}, this.serial)
        };
    }

    loadState(state) {
        if (!state) return;
        this.a20Enabled = state.a20Enabled !== undefined ? !!state.a20Enabled : true;
        if (state.ram) {
            if (state.ram instanceof Uint8Array) {
                this.ram.set(state.ram);
            } else if (Array.isArray(state.ram)) {
                this.ram.set(new Uint8Array(state.ram));
            }
        }
        if (state.postCode !== undefined) {
            this.busActivity.postCode = state.postCode;
        }
        if (state.pics && Array.isArray(state.pics)) {
            state.pics.forEach((p, idx) => {
                if (this.pics[idx]) Object.assign(this.pics[idx], p);
            });
        }
        if (state.pit) {
            this.pit.port61Val = state.pit.port61Val || 0;
            if (state.pit.channels && Array.isArray(state.pit.channels)) {
                state.pit.channels.forEach((ch, idx) => {
                    if (this.pit.channels[idx]) Object.assign(this.pit.channels[idx], ch);
                });
            }
        }
        if (state.cmos) {
            this.cmos.idx = state.cmos.idx || 0;
            if (state.cmos.nvram) this.cmos.nvram.set(state.cmos.nvram);
        }
        if (state.kbc) {
            this.kbc.write_cmd = state.kbc.write_cmd || 0;
            this.kbc.status = state.kbc.status || 0;
            this.kbc.mode = state.kbc.mode || 0;
            this.kbc.pending = state.kbc.pending || 0;
        }
        if (state.serial) {
            Object.assign(this.serial, state.serial);
        }
    }
}
