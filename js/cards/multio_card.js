/**
 * Multi-I/O Storage Controller Modular Card
 * 100% Pure JavaScript port of tiny386 ide.c (Dual ATA/ATAPI IDE Controller)
 * and misc.c EMULINK Floppy Controller (0xF1F0/0xF1F4 + 0x3F0-0x3F7)
 * supporting Drive A:, B: (Floppies), C:, D: (Hard Drives), and E: (ATAPI CD-ROM).
 *
 * Copyright (c) 2003-2016 Fabrice Bellard (MIT)
 * Portions Copyright (c) 2024-2025 Chunhui He (BSD-3-Clause)
 * Portions Copyright (c) 2026 Jan de Jager
 */

import { AdapterCard } from './adapter_card.js';

const ERR_STAT = 0x01;
const DRQ_STAT = 0x08;
const SEEK_STAT = 0x10;
const READY_STAT = 0x40;
const BUSY_STAT = 0x80;

const ABRT_ERR = 0x04;
const MC_ERR = 0x20;

const IDE_CMD_RESET = 0x04;
const IDE_CMD_DISABLE_IRQ = 0x02;

const WIN_DEVICE_RESET = 0x08;
const WIN_RECAL = 0x10;
const WIN_READ = 0x20;
const WIN_READ_ONCE = 0x21;
const WIN_WRITE = 0x30;
const WIN_WRITE_ONCE = 0x31;
const WIN_VERIFY = 0x40;
const WIN_VERIFY_ONCE = 0x41;
const WIN_SEEK = 0x70;
const WIN_DIAGNOSE = 0x90;
const WIN_SPECIFY = 0x91;
const WIN_STANDBYNOW2 = 0x94;
const WIN_IDLEIMMEDIATE2 = 0x95;
const WIN_STANDBY2 = 0x96;
const WIN_SETIDLE2 = 0x97;
const WIN_CHECKPOWERMODE2 = 0x98;
const WIN_SLEEPNOW2 = 0x99;
const WIN_PACKETCMD = 0xA0;
const WIN_PIDENTIFY = 0xA1;
const WIN_MULTREAD = 0xC4;
const WIN_MULTWRITE = 0xC5;
const WIN_SETMULT = 0xC6;
const WIN_STANDBYNOW1 = 0xE0;
const WIN_IDLEIMMEDIATE = 0xE1;
const WIN_STANDBY = 0xE2;
const WIN_SETIDLE1 = 0xE3;
const WIN_CHECKPOWERMODE1 = 0xE5;
const WIN_SLEEPNOW1 = 0xE6;
const WIN_FLUSH_CACHE = 0xE7;
const WIN_IDENTIFY = 0xEC;
const WIN_SETFEATURES = 0xEF;
const WIN_READ_NATIVE_MAX = 0xF8;

const MAX_MULT_SECTORS = 4;

const ATAPI_PACKET_SIZE = 12;
const ATAPI_INT_REASON_CD = 0x01;
const ATAPI_INT_REASON_IO = 0x02;
const SENSE_NONE = 0;
const SENSE_NOT_READY = 2;
const SENSE_ILLEGAL_REQUEST = 5;
const SENSE_UNIT_ATTENTION = 6;
const ASC_ILLEGAL_OPCODE = 0x20;
const ASC_LOGICAL_BLOCK_OOR = 0x21;
const ASC_INV_FIELD_IN_CMD_PACKET = 0x24;
const ASC_MEDIUM_MAY_HAVE_CHANGED = 0x28;
const ASC_MEDIUM_NOT_PRESENT = 0x3a;
const ASC_SAVING_PARAMETERS_NOT_SUPPORTED = 0x39;

const GPCMD_TEST_UNIT_READY = 0x00;
const GPCMD_REQUEST_SENSE = 0x03;
const GPCMD_INQUIRY = 0x12;
const GPCMD_MODE_SENSE_6 = 0x1a;
const GPCMD_START_STOP_UNIT = 0x1b;
const GPCMD_PREVENT_ALLOW_MEDIUM_REMOVAL = 0x1e;
const GPCMD_READ_CDVD_CAPACITY = 0x25;
const GPCMD_READ_10 = 0x28;
const GPCMD_SEEK = 0x2b;
const GPCMD_READ_TOC_PMA_ATIP = 0x43;
const GPCMD_GET_CONFIGURATION = 0x46;
const GPCMD_MODE_SENSE_10 = 0x5a;
const GPCMD_READ_12 = 0xa8;
const GPCMD_SET_SPEED = 0xbb;
const GPCMD_MECHANISM_STATUS = 0xbd;
const GPCMD_READ_CD = 0xbe;

const FLOPPY_FORMATS = [
    { sectors: 18, tracks: 80, heads: 2 }, // 1.44 MB 3.5"
    { sectors: 20, tracks: 80, heads: 2 },
    { sectors: 21, tracks: 80, heads: 2 },
    { sectors: 21, tracks: 82, heads: 2 },
    { sectors: 21, tracks: 83, heads: 2 },
    { sectors: 22, tracks: 80, heads: 2 },
    { sectors: 23, tracks: 80, heads: 2 },
    { sectors: 24, tracks: 80, heads: 2 },
    { sectors: 36, tracks: 80, heads: 2 }, // 2.88 MB 3.5"
    { sectors: 39, tracks: 80, heads: 2 },
    { sectors: 40, tracks: 80, heads: 2 },
    { sectors: 44, tracks: 80, heads: 2 },
    { sectors: 48, tracks: 80, heads: 2 },
    { sectors: 9,  tracks: 80, heads: 2 }, // 720 KB 3.5"
    { sectors: 10, tracks: 80, heads: 2 },
    { sectors: 10, tracks: 82, heads: 2 },
    { sectors: 10, tracks: 83, heads: 2 },
    { sectors: 13, tracks: 80, heads: 2 },
    { sectors: 14, tracks: 80, heads: 2 },
    { sectors: 15, tracks: 80, heads: 2 }, // 1.2 MB 5.25"
    { sectors: 18, tracks: 82, heads: 2 },
    { sectors: 18, tracks: 83, heads: 2 },
    { sectors: 11, tracks: 80, heads: 2 },
    { sectors: 9,  tracks: 40, heads: 2 }, // 360 KB 5.25"
    { sectors: 9,  tracks: 40, heads: 1 },
    { sectors: 10, tracks: 41, heads: 2 },
    { sectors: 10, tracks: 42, heads: 2 },
    { sectors: 8,  tracks: 40, heads: 2 }, // 320 KB 5.25"
    { sectors: 8,  tracks: 40, heads: 1 }
];

function padstr(buf, byteOffset, src, len) {
    for (let i = 0; i < len; i++) {
        const ch = i < src.length ? src.charCodeAt(i) : 0x20;
        buf[byteOffset + (i ^ 1)] = ch & 0xff;
    }
}

function padstr8(buf, byteOffset, bufSize, src) {
    for (let i = 0; i < bufSize; i++) {
        buf[byteOffset + i] = i < src.length ? (src.charCodeAt(i) & 0xff) : 0x20;
    }
}

function stw(buf16, wordIdx, val) {
    buf16[wordIdx] = val & 0xffff;
}

function cpu_to_ube16(buf, offset, val) {
    buf[offset] = (val >>> 8) & 0xff;
    buf[offset + 1] = val & 0xff;
}

function cpu_to_ube32(buf, offset, val) {
    buf[offset] = (val >>> 24) & 0xff;
    buf[offset + 1] = (val >>> 16) & 0xff;
    buf[offset + 2] = (val >>> 8) & 0xff;
    buf[offset + 3] = val & 0xff;
}

function ube16_to_cpu(buf, offset) {
    return (buf[offset] << 8) | buf[offset + 1];
}

function ube32_to_cpu(buf, offset) {
    return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

function lba_to_msf(buf, offset, lba) {
    lba += 150;
    buf[offset] = Math.floor(Math.floor(lba / 75) / 60) & 0xff;
    buf[offset + 1] = (Math.floor(lba / 75) % 60) & 0xff;
    buf[offset + 2] = (lba % 75) & 0xff;
}

export class MultiIOCard extends AdapterCard {
    constructor(config = {}) {
        super(Object.assign({
            id: 'multio_card',
            name: 'GoldStar Prime 2C Multi-I/O Controller',
            shortName: 'Multi-I/O IDE/FDC',
            slotType: 'ISA-16',
            category: 'Storage',
            description: '16-bit ISA Multi-I/O card with dual IDE ATA/ATAPI channels, EMULINK/NEC765 floppy controller, and serial/parallel ports.',
            pcbColor: '#2b4d24',
            accentColor: '#c8a432',
            jumpers: {
                primaryIde: true,
                secondaryIde: true,
                floppyEnabled: true,
                com1Enabled: true,
                lpt1Enabled: true
            }
        }, config));

        // Drives Storage (compatible with StorageView and unit tests)
        this.drives = {
            fddA: { mounted: false, name: '[None]', data: null, dirty: false, size: 1474560, motor: false, fmt: FLOPPY_FORMATS[0] },
            fddB: { mounted: false, name: '[None]', data: null, dirty: false, size: 1474560, motor: false, fmt: FLOPPY_FORMATS[0] },
            hddC: { mounted: false, name: '[None]', data: null, dirty: false, size: 0, heads: 16, sectors: 63, cylinders: 0 },
            hddD: { mounted: false, name: '[None]', data: null, dirty: false, size: 0, heads: 16, sectors: 63, cylinders: 0 },
            cdE:  { mounted: false, name: '[None]', data: null, dirty: false, size: 0, trayOpen: false }
        };

        // EMULINK Floppy state (ports 0xF1F0, 0xF1F4)
        this.emulink = {
            status: 0,
            cmd: -1,
            args: new Uint32Array(4),
            argi: 0,
            dataleft: 0,
            offset: 0,
            driveIdx: 0
        };

        // Legacy FDC registers (0x3F0-0x3F7)
        this.fdc = {
            mainStatus: 0x80,
            digitalOutput: 0x0C,
            dataFifo: []
        };

        // Dual IDE Interfaces (0 = Primary 0x1F0 IRQ 14, 1 = Secondary 0x170 IRQ 15)
        this.ideIf = [
            this.createIdeInterface(14),
            this.createIdeInterface(15)
        ];

        // Setup Secondary Master as ATAPI CD-ROM (Drive E:)
        this.ideIf[1].drives[0] = this.createIdeDriveState(this.ideIf[1], 'cd', this.drives.cdE);
        this.ideIf[1].cur_drive = this.ideIf[1].drives[0];
    }

    createIdeInterface(irq) {
        return {
            irq,
            cmd: 0,
            cur_drive: null,
            drives: [null, null]
        };
    }

    createIdeDriveState(ide_if, kind, backingDrive) {
        const io_buffer = new Uint8Array(MAX_MULT_SECTORS * 512 + 4);
        const s = {
            ide_if,
            drive_kind: kind, // 'hd' | 'cd'
            backing: backingDrive,
            cylinders: backingDrive.cylinders || 0,
            heads: backingDrive.heads || 16,
            sectors: backingDrive.sectors || 63,
            mult_sectors: MAX_MULT_SECTORS,
            nb_sectors: Math.floor((backingDrive.size || 0) / 512),

            feature: 0,
            error: 0,
            nsector: 0,
            sector: 1,
            lcyl: 0,
            hcyl: 0,
            select: 0xa0,
            status: READY_STAT | SEEK_STAT,

            sense_key: 0,
            asc: 0,
            cdrom_changed: 0,
            packet_transfer_size: 0,
            elementary_transfer_size: 0,
            io_buffer_index: 0,
            lba: -1,
            cd_sector_size: 2048,

            io_nb_sectors: 0,
            req_nb_sectors: 0,
            end_transfer_func: null,
            data_index: 0,
            data_end: 0,
            io_buffer,
            io_buffer16: new Uint16Array(io_buffer.buffer)
        };
        s.end_transfer_func = () => this.ideTransferStop(s);
        if (kind === 'cd') {
            this.ideSetSignature(s);
            s.end_transfer_func = () => this.ideTransferStop2(s);
        }
        return s;
    }

    onInstall(bus, slotNumber) {
        super.onInstall(bus, slotNumber);
        this.syncCmos();
    }

    onReset() {
        this.emulink.status = 0;
        this.emulink.cmd = -1;
        this.emulink.argi = 0;
        this.emulink.dataleft = 0;
        for (const iface of this.ideIf) {
            iface.cmd = 0;
            for (const d of iface.drives) {
                if (d) {
                    d.status = READY_STAT | SEEK_STAT;
                    d.error = 0;
                    this.ideSetSignature(d);
                }
            }
            iface.cur_drive = iface.drives[0];
        }
        this.syncCmos();
    }

    /* ======================================================================
     * DRIVE MOUNTING & MEDIA MANAGEMENT
     * ====================================================================== */

    detectFloppyFormat(byteLength) {
        for (const f of FLOPPY_FORMATS) {
            if (byteLength === f.sectors * f.tracks * f.heads * 512) {
                return f;
            }
        }
        return FLOPPY_FORMATS[0];
    }

    mountFloppy(driveIdx, buffer, filename) {
        const drive = (driveIdx === 0) ? this.drives.fddA : this.drives.fddB;
        drive.data = new Uint8Array(buffer);
        drive.size = buffer.byteLength;
        drive.name = filename;
        drive.mounted = true;
        drive.dirty = false;
        drive.fmt = this.detectFloppyFormat(drive.size);
        this.pulseActivity();
        this.syncCmos();
        return true;
    }

    ejectFloppy(driveIdx) {
        const drive = (driveIdx === 0) ? this.drives.fddA : this.drives.fddB;
        drive.mounted = false;
        drive.name = '[None]';
        drive.data = null;
        drive.dirty = false;
        this.pulseActivity();
        this.syncCmos();
    }

    mountHardDisk(driveIdx, buffer, filename) {
        const drive = (driveIdx === 0) ? this.drives.hddC : this.drives.hddD;
        drive.data = new Uint8Array(buffer);
        drive.size = buffer.byteLength;
        drive.name = filename;
        drive.mounted = true;
        drive.dirty = false;

        const nb_sectors = Math.floor(drive.size / 512);
        let cylinders = Math.floor(nb_sectors / (16 * 63));
        if (cylinders > 16383) cylinders = 16383;
        else if (cylinders < 2) cylinders = 2;

        drive.sectors = 63;
        drive.heads = 16;
        drive.cylinders = cylinders;

        const state = this.createIdeDriveState(this.ideIf[0], 'hd', drive);
        this.ideIf[0].drives[driveIdx] = state;
        if (!this.ideIf[0].cur_drive || driveIdx === 0) {
            this.ideIf[0].cur_drive = state;
        }

        this.pulseActivity();
        this.syncCmos();
        return true;
    }

    mountCdrom(buffer, filename) {
        this.drives.cdE.data = new Uint8Array(buffer);
        this.drives.cdE.size = buffer.byteLength;
        this.drives.cdE.name = filename;
        this.drives.cdE.mounted = true;
        this.drives.cdE.trayOpen = false;

        let cdState = this.ideIf[1].drives[0];
        if (!cdState) {
            cdState = this.createIdeDriveState(this.ideIf[1], 'cd', this.drives.cdE);
            this.ideIf[1].drives[0] = cdState;
            this.ideIf[1].cur_drive = cdState;
        }
        cdState.nb_sectors = Math.floor(this.drives.cdE.size / 512);
        cdState.sense_key = SENSE_UNIT_ATTENTION;
        cdState.asc = ASC_MEDIUM_MAY_HAVE_CHANGED;
        cdState.cdrom_changed = 1;
        this.ideSetIrq(cdState);

        this.pulseActivity();
        return true;
    }

    ejectCdrom() {
        this.drives.cdE.trayOpen = !this.drives.cdE.trayOpen;
        if (this.drives.cdE.trayOpen) {
            this.drives.cdE.mounted = false;
            this.drives.cdE.name = '[Tray Open]';
            this.drives.cdE.data = null;
            this.drives.cdE.size = 0;
            const cdState = this.ideIf[1].drives[0];
            if (cdState) {
                cdState.nb_sectors = 0;
                cdState.cdrom_changed = 1;
            }
        }
        this.pulseActivity();
        return this.drives.cdE.trayOpen;
    }

    getDriveStatus() {
        return {
            fddA: { mounted: this.drives.fddA.mounted, name: this.drives.fddA.name, dirty: this.drives.fddA.dirty },
            fddB: { mounted: this.drives.fddB.mounted, name: this.drives.fddB.name, dirty: this.drives.fddB.dirty },
            hddC: { mounted: this.drives.hddC.mounted, name: this.drives.hddC.name, dirty: this.drives.hddC.dirty, sizeMb: (this.drives.hddC.size / (1024 * 1024)) | 0 },
            hddD: { mounted: this.drives.hddD.mounted, name: this.drives.hddD.name, dirty: this.drives.hddD.dirty, sizeMb: (this.drives.hddD.size / (1024 * 1024)) | 0 },
            cdE:  { mounted: this.drives.cdE.mounted, name: this.drives.cdE.name, trayOpen: this.drives.cdE.trayOpen }
        };
    }

    syncCmos() {
        if (!this.bus || !this.bus.cmos) return;
        const nvram = this.bus.cmos.nvram;

        // Floppy types in CMOS 0x10 (4 = 1.44MB 3.5")
        let fdByte = 0;
        if (this.drives.fddA.mounted) fdByte |= 0x40;
        if (this.drives.fddB.mounted) fdByte |= 0x04;
        if (fdByte === 0) fdByte = 0x40; // Default 1.44M drive A present
        nvram[0x10] = fdByte;

        // Hard disk CMOS geometry (ide_fill_cmos from ide.c)
        let d_0x12 = 0;
        const d0 = this.ideIf[0].drives[0];
        const d1 = this.ideIf[0].drives[1];
        if (d0 && d0.backing.mounted && d0.nb_sectors > 0) {
            d_0x12 |= 0xf0;
            nvram[0x19] = 47;
            nvram[0x1b] = nvram[0x21] = d0.cylinders & 0xff;
            nvram[0x1c] = nvram[0x22] = (d0.cylinders >>> 8) & 0xff;
            nvram[0x1d] = d0.heads & 0xff;
            nvram[0x1e] = 0xff;
            nvram[0x1f] = 0xff;
            nvram[0x20] = 0xc0 | ((d0.heads > 8 ? 1 : 0) << 3);
            nvram[0x23] = d0.sectors & 0xff;
        }
        if (d1 && d1.backing.mounted && d1.nb_sectors > 0) {
            d_0x12 |= 0x0f;
            nvram[0x1a] = 47;
            nvram[0x24] = nvram[0x2a] = d1.cylinders & 0xff;
            nvram[0x25] = nvram[0x2b] = (d1.cylinders >>> 8) & 0xff;
            nvram[0x26] = d1.heads & 0xff;
            nvram[0x27] = 0xff;
            nvram[0x28] = 0xff;
            nvram[0x29] = 0xc0 | ((d1.heads > 8 ? 1 : 0) << 3);
            nvram[0x2c] = d1.sectors & 0xff;
        }
        nvram[0x12] = d_0x12;
    }

    /* ======================================================================
     * EMULINK FLOPPY CONTROLLER (PORTS 0xF1F0 & 0xF1F4)
     * ====================================================================== */

    emulinkStatusRead() {
        return this.emulink.status >>> 0;
    }

    emulinkExecCmd() {
        const e = this.emulink;
        switch (e.cmd) {
            case 0:
                e.status = 0xaa55ff00 >>> 0;
                e.cmd = -1;
                break;
            case 0x100: {
                let st = 0;
                if (this.drives.fddA.mounted && this.drives.fddA.data) st |= 0x40;
                if (this.drives.fddB.mounted && this.drives.fddB.data) st |= 0x04;
                e.status = st >>> 0;
                e.cmd = -1;
                break;
            }
            case 0x101:
            case 0x102:
                if (e.argi === 3) {
                    const drvIdx = e.args[0];
                    const drv = (drvIdx === 0) ? this.drives.fddA : (drvIdx === 1 ? this.drives.fddB : null);
                    if (!drv || !drv.mounted || !drv.data) {
                        e.status = (-5) >>> 0; // -EIO
                        e.cmd = -1;
                        break;
                    }
                    const c = (e.args[1] >>> 16) & 0xffff;
                    const h = (e.args[1] >>> 8) & 0xff;
                    const s = e.args[1] & 0xff;
                    const f = drv.fmt || FLOPPY_FORMATS[0];
                    const lba = (c * f.heads + h) * f.sectors + (s - 1);
                    const byteOffset = 512 * lba;
                    if (byteOffset < 0 || byteOffset > drv.data.byteLength) {
                        e.status = (-5) >>> 0;
                        e.cmd = -1;
                    } else {
                        e.status = 0;
                        e.driveIdx = drvIdx;
                        e.offset = byteOffset;
                        e.dataleft = 512 * e.args[2];
                    }
                }
                break;
        }
    }

    emulinkCmdWrite(val) {
        this.emulink.cmd = val | 0;
        this.emulink.argi = 0;
        this.emulinkExecCmd();
    }

    emulinkDataWrite32(val) {
        if (this.emulink.argi < 4) {
            this.emulink.args[this.emulink.argi++] = val >>> 0;
        }
        this.emulinkExecCmd();
    }

    emulinkDataReadString(buf, offset, size, count) {
        this.pulseActivity();
        const e = this.emulink;
        if (e.cmd === 0x101 && e.argi === 3) {
            const drv = (e.driveIdx === 0) ? this.drives.fddA : this.drives.fddB;
            if (drv && drv.mounted && drv.data) {
                const len = size * count;
                if (len <= e.dataleft) {
                    for (let i = 0; i < len; i++) {
                        buf[offset + i] = drv.data[e.offset + i] || 0;
                    }
                    e.offset += len;
                    e.dataleft -= len;
                    if (e.dataleft === 0) {
                        e.cmd = -1;
                        e.status = 0;
                    }
                    return count;
                }
            }
        }
        e.cmd = -1;
        e.status = 0xffffffff;
        return count;
    }

    emulinkDataWriteString(buf, offset, size, count) {
        this.pulseActivity();
        const e = this.emulink;
        if (e.cmd === 0x102 && e.argi === 3) {
            const drv = (e.driveIdx === 0) ? this.drives.fddA : this.drives.fddB;
            if (drv && drv.mounted && drv.data) {
                const len = size * count;
                if (len <= e.dataleft) {
                    for (let i = 0; i < len; i++) {
                        if (e.offset + i < drv.data.byteLength) {
                            drv.data[e.offset + i] = buf[offset + i];
                        }
                    }
                    drv.dirty = true;
                    e.offset += len;
                    e.dataleft -= len;
                    if (e.dataleft === 0) {
                        e.cmd = -1;
                        e.status = 0;
                    }
                    return count;
                }
            }
        }
        e.cmd = -1;
        e.status = 0xffffffff;
        return count;
    }

    /* ======================================================================
     * IDE ATA / ATAPI EMULATION (ide.c)
     * ====================================================================== */

    ideSetIrq(s) {
        const ide_if = s.ide_if;
        if (!(ide_if.cmd & IDE_CMD_DISABLE_IRQ)) {
            if (this.bus) this.bus.raiseIRQ(ide_if.irq);
        }
    }

    ideAbortCommand(s) {
        s.status = READY_STAT | ERR_STAT;
        s.error = ABRT_ERR;
    }

    ideSetSignature(s) {
        s.select &= 0xf0;
        s.nsector = 1;
        s.sector = 1;
        if (s.drive_kind === 'cd') {
            s.lcyl = 0x14;
            s.hcyl = 0xeb;
        } else {
            s.lcyl = 0;
            s.hcyl = 0;
        }
    }

    ideTransferStart(s, size, func) {
        s.end_transfer_func = func;
        s.data_index = 0;
        s.data_end = size;
    }

    ideTransferStop(s) {
        s.end_transfer_func = () => this.ideTransferStop(s);
        s.data_index = 0;
        s.data_end = 0;
    }

    ideTransferStart2(s, off, size, func) {
        s.end_transfer_func = func;
        s.data_index = off;
        s.data_end = off + size;
        if (!(s.status & ERR_STAT)) {
            s.status |= DRQ_STAT;
        }
    }

    ideTransferStop2(s) {
        s.end_transfer_func = () => this.ideTransferStop2(s);
        s.data_index = 0;
        s.data_end = 0;
        s.status &= ~DRQ_STAT;
    }

    ideGetSector(s) {
        if (s.select & 0x40) {
            return (((s.select & 0x0f) << 24) | (s.hcyl << 16) | (s.lcyl << 8) | s.sector) >>> 0;
        } else {
            return (((s.hcyl << 8) | s.lcyl) * s.heads * s.sectors +
                (s.select & 0x0f) * s.sectors + (s.sector - 1));
        }
    }

    ideSetSector(s, sector_num) {
        if (s.select & 0x40) {
            s.select = (s.select & 0xf0) | ((sector_num >>> 24) & 0x0f);
            s.hcyl = (sector_num >>> 16) & 0xff;
            s.lcyl = (sector_num >>> 8) & 0xff;
            s.sector = sector_num & 0xff;
        } else {
            const cyl = Math.floor(sector_num / (s.heads * s.sectors));
            const r = sector_num % (s.heads * s.sectors);
            s.hcyl = (cyl >>> 8) & 0xff;
            s.lcyl = cyl & 0xff;
            s.select = (s.select & 0xf0) | (Math.floor(r / s.sectors) & 0x0f);
            s.sector = ((r % s.sectors) + 1) & 0xff;
        }
    }

    ideIdentify(s) {
        const tab = s.io_buffer16;
        s.io_buffer.fill(0, 0, 512);

        stw(tab, 0, 0x0040);
        stw(tab, 1, s.cylinders);
        stw(tab, 3, s.heads);
        stw(tab, 4, 512 * s.sectors);
        stw(tab, 5, 512);
        stw(tab, 6, s.sectors);
        stw(tab, 20, 3);
        stw(tab, 21, 512);
        stw(tab, 22, 4);
        padstr(s.io_buffer, 27 * 2, "RETRO486 HARDDISK", 40);
        stw(tab, 47, 0x8000 | MAX_MULT_SECTORS);
        stw(tab, 48, 1);
        stw(tab, 49, 1 << 9);
        stw(tab, 51, 0x200);
        stw(tab, 52, 0x200);
        stw(tab, 54, s.cylinders);
        stw(tab, 55, s.heads);
        stw(tab, 56, s.sectors);
        const oldsize = (s.cylinders * s.heads * s.sectors) >>> 0;
        stw(tab, 57, oldsize & 0xffff);
        stw(tab, 58, (oldsize >>> 16) & 0xffff);
        if (s.mult_sectors) stw(tab, 59, 0x100 | s.mult_sectors);
        stw(tab, 60, s.nb_sectors & 0xffff);
        stw(tab, 61, (s.nb_sectors >>> 16) & 0xffff);
        stw(tab, 80, (1 << 1) | (1 << 2));
        stw(tab, 82, (1 << 14));
        stw(tab, 83, (1 << 14));
        stw(tab, 84, (1 << 14));
        stw(tab, 85, (1 << 14));
        stw(tab, 86, 0);
        stw(tab, 87, (1 << 14));
    }

    ideAtapiIdentify(s) {
        const tab = s.io_buffer16;
        s.io_buffer.fill(0, 0, 512);

        stw(tab, 0, (2 << 14) | (5 << 8) | (1 << 7) | (2 << 5) | (0 << 0));
        stw(tab, 20, 3);
        stw(tab, 21, 512);
        stw(tab, 22, 4);
        padstr(s.io_buffer, 27 * 2, "RETRO486 CD-ROM", 40);
        stw(tab, 48, 1);
        stw(tab, 49, 1 << 9);
        stw(tab, 53, 3);
        stw(tab, 63, 0x103);
        stw(tab, 64, 1);
        stw(tab, 65, 0xb4);
        stw(tab, 66, 0xb4);
        stw(tab, 67, 0x12c);
        stw(tab, 68, 0xb4);
        stw(tab, 71, 30);
        stw(tab, 72, 30);
        stw(tab, 80, 0x1e);
    }

    ideSectorRead(s) {
        this.pulseActivity();
        if (!s.backing.mounted || !s.backing.data) {
            this.ideAbortCommand(s);
            this.ideSetIrq(s);
            return;
        }
        const sector_num = this.ideGetSector(s);
        let n = s.nsector;
        if (n === 0) n = 256;
        if (n > s.req_nb_sectors) n = s.req_nb_sectors;
        s.io_nb_sectors = n;

        const byteOff = sector_num * 512;
        const byteLen = n * 512;
        s.io_buffer.fill(0, 0, byteLen);
        if (byteOff >= 0 && byteOff < s.backing.data.byteLength) {
            const avail = Math.min(byteLen, s.backing.data.byteLength - byteOff);
            s.io_buffer.set(s.backing.data.subarray(byteOff, byteOff + avail), 0);
        }

        this.ideSetSector(s, sector_num + n);
        s.nsector = (s.nsector - n) & 0xff;
        const func = (s.nsector === 0)
            ? () => {
                s.status = READY_STAT | SEEK_STAT;
                s.error = 0;
                this.ideTransferStop(s);
            }
            : () => this.ideSectorRead(s);

        this.ideTransferStart(s, 512 * n, func);
        this.ideSetIrq(s);
        s.status = READY_STAT | SEEK_STAT | DRQ_STAT;
        s.error = 0;
    }

    ideSectorWriteCb1(s) {
        this.ideTransferStop(s);
        const sector_num = this.ideGetSector(s);
        const n = s.io_nb_sectors;
        const byteOff = sector_num * 512;
        const byteLen = n * 512;

        if (s.backing.mounted && s.backing.data && byteOff >= 0 && byteOff + byteLen <= s.backing.data.byteLength) {
            s.backing.data.set(s.io_buffer.subarray(0, byteLen), byteOff);
            s.backing.dirty = true;
        }

        this.ideSetSector(s, sector_num + n);
        s.nsector = (s.nsector - n) & 0xff;
        if (s.nsector === 0) {
            s.status = READY_STAT | SEEK_STAT;
        } else {
            let nextN = s.nsector;
            if (nextN > s.req_nb_sectors) nextN = s.req_nb_sectors;
            s.io_nb_sectors = nextN;
            this.ideTransferStart(s, 512 * nextN, () => this.ideSectorWriteCb1(s));
            s.status = READY_STAT | SEEK_STAT | DRQ_STAT;
        }
        this.ideSetIrq(s);
    }

    ideSectorWrite(s) {
        this.pulseActivity();
        if (!s.backing.mounted || !s.backing.data) {
            this.ideAbortCommand(s);
            this.ideSetIrq(s);
            return;
        }
        let n = s.nsector;
        if (n === 0) n = 256;
        if (n > s.req_nb_sectors) n = s.req_nb_sectors;
        s.io_nb_sectors = n;
        this.ideTransferStart(s, 512 * n, () => this.ideSectorWriteCb1(s));
        s.status = READY_STAT | SEEK_STAT | DRQ_STAT;
    }

    ideExecCmd(s, val) {
        switch (val) {
            case WIN_IDENTIFY:
                if (!s.backing.mounted) {
                    this.ideAbortCommand(s);
                    this.ideSetIrq(s);
                    break;
                }
                this.ideIdentify(s);
                s.status = READY_STAT | SEEK_STAT | DRQ_STAT;
                this.ideTransferStart(s, 512, () => {
                    this.ideTransferStop(s);
                    s.status = READY_STAT;
                });
                this.ideSetIrq(s);
                break;
            case WIN_SPECIFY:
            case WIN_RECAL:
            case WIN_SEEK:
            case WIN_VERIFY:
            case WIN_VERIFY_ONCE:
            case WIN_FLUSH_CACHE:
            case WIN_STANDBYNOW1:
            case WIN_STANDBYNOW2:
            case WIN_IDLEIMMEDIATE:
            case WIN_IDLEIMMEDIATE2:
            case WIN_STANDBY:
            case WIN_STANDBY2:
            case WIN_SETIDLE1:
            case WIN_SETIDLE2:
            case WIN_SETFEATURES:
                s.error = 0;
                s.status = READY_STAT | SEEK_STAT;
                this.ideSetIrq(s);
                break;
            case WIN_DIAGNOSE:
                s.error = 0x01;
                s.status = READY_STAT | SEEK_STAT;
                this.ideSetSignature(s);
                this.ideSetIrq(s);
                break;
            case WIN_CHECKPOWERMODE1:
            case WIN_CHECKPOWERMODE2:
                s.nsector = 0xff;
                s.status = READY_STAT | SEEK_STAT;
                this.ideSetIrq(s);
                break;
            case WIN_SETMULT:
                if (s.nsector > MAX_MULT_SECTORS || (s.nsector & (s.nsector - 1)) !== 0) {
                    this.ideAbortCommand(s);
                } else {
                    s.mult_sectors = s.nsector;
                    s.status = READY_STAT;
                }
                this.ideSetIrq(s);
                break;
            case WIN_READ:
            case WIN_READ_ONCE:
                s.req_nb_sectors = 1;
                this.ideSectorRead(s);
                break;
            case WIN_WRITE:
            case WIN_WRITE_ONCE:
                s.req_nb_sectors = 1;
                this.ideSectorWrite(s);
                break;
            case WIN_MULTREAD:
                if (!s.mult_sectors) {
                    this.ideAbortCommand(s);
                    this.ideSetIrq(s);
                } else {
                    s.req_nb_sectors = s.mult_sectors;
                    this.ideSectorRead(s);
                }
                break;
            case WIN_MULTWRITE:
                if (!s.mult_sectors) {
                    this.ideAbortCommand(s);
                    this.ideSetIrq(s);
                } else {
                    s.req_nb_sectors = s.mult_sectors;
                    this.ideSectorWrite(s);
                }
                break;
            case WIN_READ_NATIVE_MAX:
                this.ideSetSector(s, s.nb_sectors - 1);
                s.status = READY_STAT;
                this.ideSetIrq(s);
                break;
            default:
                this.ideAbortCommand(s);
                this.ideSetIrq(s);
                break;
        }
    }

    /* ======================================================================
     * ATAPI CD-ROM PACKET COMMANDS
     * ====================================================================== */

    idecdExecCmd(s, val) {
        switch (val) {
            case WIN_DEVICE_RESET:
                this.ideSetSignature(s);
                s.status = 0x00;
                break;
            case WIN_PACKETCMD:
                s.status = READY_STAT | SEEK_STAT;
                s.nsector = 1;
                this.ideTransferStart2(s, 0, ATAPI_PACKET_SIZE, () => this.ideAtapiCmd(s));
                this.ideSetIrq(s);
                break;
            case WIN_PIDENTIFY:
                this.ideAtapiIdentify(s);
                s.status = READY_STAT | SEEK_STAT;
                this.ideTransferStart2(s, 0, 512, () => this.ideTransferStop2(s));
                this.ideSetIrq(s);
                break;
            case WIN_IDENTIFY:
            case WIN_READ:
                this.ideSetSignature(s);
                this.ideAbortCommand(s);
                this.ideSetIrq(s);
                break;
            default:
                this.ideAbortCommand(s);
                this.ideSetIrq(s);
                break;
        }
    }

    ideAtapiCmdOk(s) {
        s.error = 0;
        s.status = READY_STAT | SEEK_STAT;
        s.nsector = (s.nsector & ~7) | ATAPI_INT_REASON_IO | ATAPI_INT_REASON_CD;
        this.ideSetIrq(s);
    }

    ideAtapiCmdError(s, sense_key, asc) {
        s.error = sense_key << 4;
        s.status = READY_STAT | ERR_STAT;
        s.nsector = (s.nsector & ~7) | ATAPI_INT_REASON_IO | ATAPI_INT_REASON_CD;
        s.sense_key = sense_key;
        s.asc = asc;
        this.ideSetIrq(s);
    }

    ideAtapiCmdReplyEnd(s) {
        if (s.packet_transfer_size <= 0) {
            this.ideTransferStop2(s);
            s.status = READY_STAT | SEEK_STAT;
            s.nsector = (s.nsector & ~7) | ATAPI_INT_REASON_IO | ATAPI_INT_REASON_CD;
            this.ideSetIrq(s);
        } else {
            if (s.lba !== -1 && s.io_buffer_index >= s.cd_sector_size) {
                if (!s.backing.mounted || !s.backing.data) {
                    this.ideTransferStop2(s);
                    this.ideAtapiCmdError(s, SENSE_NOT_READY, ASC_MEDIUM_NOT_PRESENT);
                    return;
                }
                const byteOff = s.lba * 2048;
                s.io_buffer.fill(0, 0, 2048);
                if (byteOff >= 0 && byteOff < s.backing.data.byteLength) {
                    const avail = Math.min(2048, s.backing.data.byteLength - byteOff);
                    s.io_buffer.set(s.backing.data.subarray(byteOff, byteOff + avail), 0);
                }
                s.lba++;
                s.io_buffer_index = 0;
            }
            if (s.elementary_transfer_size > 0) {
                let size = s.cd_sector_size - s.io_buffer_index;
                if (size > s.elementary_transfer_size) size = s.elementary_transfer_size;
                this.ideTransferStart2(s, s.io_buffer_index, size, () => this.ideAtapiCmdReplyEnd(s));
                s.packet_transfer_size -= size;
                s.elementary_transfer_size -= size;
                s.io_buffer_index += size;
            } else {
                s.nsector = (s.nsector & ~7) | ATAPI_INT_REASON_IO;
                let byte_count_limit = s.lcyl | (s.hcyl << 8);
                if (byte_count_limit === 0xffff) byte_count_limit--;
                let size = s.packet_transfer_size;
                if (size > byte_count_limit) {
                    if (byte_count_limit & 1) byte_count_limit--;
                    size = byte_count_limit;
                }
                s.lcyl = size & 0xff;
                s.hcyl = (size >>> 8) & 0xff;
                s.elementary_transfer_size = size;
                if (s.lba !== -1) {
                    if (size > (s.cd_sector_size - s.io_buffer_index)) {
                        size = s.cd_sector_size - s.io_buffer_index;
                    }
                }
                this.ideTransferStart2(s, s.io_buffer_index, size, () => this.ideAtapiCmdReplyEnd(s));
                s.packet_transfer_size -= size;
                s.elementary_transfer_size -= size;
                s.io_buffer_index += size;
                this.ideSetIrq(s);
            }
        }
    }

    ideAtapiCmdReply(s, size, max_size) {
        if (size > max_size) size = max_size;
        s.lba = -1;
        s.packet_transfer_size = size;
        s.elementary_transfer_size = 0;
        s.io_buffer_index = 0;
        s.status = READY_STAT | SEEK_STAT;
        this.ideAtapiCmdReplyEnd(s);
    }

    ideAtapiCmdReadPio(s, lba, nb_sectors, sector_size) {
        s.lba = lba;
        s.packet_transfer_size = nb_sectors * sector_size;
        s.elementary_transfer_size = 0;
        s.io_buffer_index = sector_size;
        s.cd_sector_size = sector_size;
        s.status = READY_STAT | SEEK_STAT;
        this.ideAtapiCmdReplyEnd(s);
    }

    ideAtapiCmd(s) {
        this.pulseActivity();
        const packet = new Uint8Array(s.io_buffer.subarray(0, ATAPI_PACKET_SIZE));
        const buf = s.io_buffer;

        if (s.sense_key === SENSE_UNIT_ATTENTION &&
            packet[0] !== GPCMD_REQUEST_SENSE &&
            packet[0] !== GPCMD_INQUIRY) {
            s.error = MC_ERR | (SENSE_UNIT_ATTENTION << 4);
            s.status = ERR_STAT;
            s.nsector = 0;
            this.ideSetIrq(s);
            return;
        }

        switch (packet[0]) {
            case GPCMD_TEST_UNIT_READY:
                if (s.backing.mounted && !s.cdrom_changed) {
                    this.ideAtapiCmdOk(s);
                } else {
                    s.cdrom_changed = 0;
                    this.ideAtapiCmdError(s, SENSE_NOT_READY, ASC_MEDIUM_NOT_PRESENT);
                }
                break;
            case GPCMD_REQUEST_SENSE: {
                const max_len = packet[4];
                buf.fill(0, 0, 18);
                buf[0] = 0x70 | (1 << 7);
                buf[2] = s.sense_key;
                buf[7] = 10;
                buf[12] = s.asc;
                if (s.sense_key === SENSE_UNIT_ATTENTION) s.sense_key = SENSE_NONE;
                this.ideAtapiCmdReply(s, 18, max_len);
                break;
            }
            case GPCMD_PREVENT_ALLOW_MEDIUM_REMOVAL:
            case GPCMD_START_STOP_UNIT:
            case GPCMD_SET_SPEED:
                this.ideAtapiCmdOk(s);
                break;
            case GPCMD_INQUIRY: {
                const max_len = packet[4];
                buf[0] = 0x05;
                buf[1] = 0x80;
                buf[2] = 0x00;
                buf[3] = 0x21;
                buf[4] = 31;
                buf[5] = 0;
                buf[6] = 0;
                buf[7] = 0;
                padstr8(buf, 8, 8, "RETRO486");
                padstr8(buf, 16, 16, "RETRO486 CD-ROM");
                padstr8(buf, 32, 4, "1.0");
                this.ideAtapiCmdReply(s, 36, max_len);
                break;
            }
            case GPCMD_READ_10:
            case GPCMD_READ_12: {
                if (!s.backing.mounted) {
                    this.ideAtapiCmdError(s, SENSE_NOT_READY, ASC_MEDIUM_NOT_PRESENT);
                    break;
                }
                const nb_sectors = (packet[0] === GPCMD_READ_10)
                    ? ube16_to_cpu(packet, 7)
                    : ube32_to_cpu(packet, 6);
                const lba = ube32_to_cpu(packet, 2);
                if (nb_sectors === 0) {
                    this.ideAtapiCmdOk(s);
                    break;
                }
                this.ideAtapiCmdReadPio(s, lba, nb_sectors, 2048);
                break;
            }
            case GPCMD_READ_CDVD_CAPACITY: {
                const total_sectors = s.nb_sectors >>> 2;
                if (total_sectors === 0) {
                    this.ideAtapiCmdError(s, SENSE_NOT_READY, ASC_MEDIUM_NOT_PRESENT);
                    break;
                }
                cpu_to_ube32(buf, 0, total_sectors - 1);
                cpu_to_ube32(buf, 4, 2048);
                this.ideAtapiCmdReply(s, 8, 8);
                break;
            }
            case GPCMD_READ_TOC_PMA_ATIP: {
                const total_sectors = s.nb_sectors >>> 2;
                if (total_sectors === 0) {
                    this.ideAtapiCmdError(s, SENSE_NOT_READY, ASC_MEDIUM_NOT_PRESENT);
                    break;
                }
                const max_len = ube16_to_cpu(packet, 7);
                const format = packet[9] >>> 6;
                const msf = (packet[1] >>> 1) & 1;
                const start_track = packet[6];
                if (format === 0 && (start_track <= 1 || start_track === 0xaa)) {
                    let q = 2;
                    buf[q++] = 1;
                    buf[q++] = 1;
                    if (start_track <= 1) {
                        buf[q++] = 0;
                        buf[q++] = 0x14;
                        buf[q++] = 1;
                        buf[q++] = 0;
                        if (msf) {
                            buf[q++] = 0;
                            lba_to_msf(buf, q, 0);
                            q += 3;
                        } else {
                            cpu_to_ube32(buf, q, 0);
                            q += 4;
                        }
                    }
                    buf[q++] = 0;
                    buf[q++] = 0x16;
                    buf[q++] = 0xaa;
                    buf[q++] = 0;
                    if (msf) {
                        buf[q++] = 0;
                        lba_to_msf(buf, q, total_sectors);
                        q += 3;
                    } else {
                        cpu_to_ube32(buf, q, total_sectors);
                        q += 4;
                    }
                    cpu_to_ube16(buf, 0, q - 2);
                    this.ideAtapiCmdReply(s, q, max_len);
                } else if (format === 1) {
                    buf.fill(0, 0, 12);
                    buf[1] = 0x0a;
                    buf[2] = 0x01;
                    buf[3] = 0x01;
                    this.ideAtapiCmdReply(s, 12, max_len);
                } else {
                    this.ideAtapiCmdError(s, SENSE_ILLEGAL_REQUEST, ASC_INV_FIELD_IN_CMD_PACKET);
                }
                break;
            }
            default:
                this.ideAtapiCmdError(s, SENSE_ILLEGAL_REQUEST, ASC_ILLEGAL_OPCODE);
                break;
        }
    }

    /* ======================================================================
     * IDE PORT I/O DISPATCH (8/16/32-BIT + STRING PIO)
     * ====================================================================== */

    ideIoportRead(ifIdx, regOffset) {
        const s1 = this.ideIf[ifIdx];
        const s = s1.cur_drive;
        if (!s) return 0x00;
        switch (regOffset & 7) {
            case 0: return this.ideDataRead8(ifIdx);
            case 1: return s.error;
            case 2: return s.nsector & 0xff;
            case 3: return s.sector;
            case 4: return s.lcyl;
            case 5: return s.hcyl;
            case 6: return s.select;
            default:
            case 7:
                if (this.bus) this.bus.lowerIRQ(s1.irq);
                return s.status;
        }
    }

    ideIoportWrite(ifIdx, regOffset, val) {
        val &= 0xff;
        const s1 = this.ideIf[ifIdx];
        let s = s1.cur_drive;
        switch (regOffset & 7) {
            case 0:
                this.ideDataWrite8(ifIdx, val);
                break;
            case 1:
                if (s) s.feature = val;
                break;
            case 2:
                if (s) s.nsector = val;
                break;
            case 3:
                if (s) s.sector = val;
                break;
            case 4:
                if (s) s.lcyl = val;
                break;
            case 5:
                if (s) s.hcyl = val;
                break;
            case 6:
                s = s1.cur_drive = s1.drives[(val >>> 4) & 1];
                if (s) s.select = val;
                break;
            case 7:
                if (s) {
                    if (s.drive_kind !== 'cd') this.ideExecCmd(s, val);
                    else this.idecdExecCmd(s, val);
                }
                break;
        }
    }

    ideStatusRead(ifIdx) {
        const s = this.ideIf[ifIdx].cur_drive;
        return s ? s.status : 0;
    }

    ideCmdWrite(ifIdx, val) {
        const s1 = this.ideIf[ifIdx];
        if (!(s1.cmd & IDE_CMD_RESET) && (val & IDE_CMD_RESET)) {
            for (let i = 0; i < 2; i++) {
                const s = s1.drives[i];
                if (s) {
                    s.status = BUSY_STAT | SEEK_STAT;
                    s.error = 0x01;
                }
            }
        } else if ((s1.cmd & IDE_CMD_RESET) && !(val & IDE_CMD_RESET)) {
            for (let i = 0; i < 2; i++) {
                const s = s1.drives[i];
                if (s) {
                    s.status = READY_STAT | SEEK_STAT;
                    this.ideSetSignature(s);
                }
            }
        }
        s1.cmd = val & 0xff;
    }

    ideDataRead8(ifIdx) {
        const s = this.ideIf[ifIdx].cur_drive;
        if (!s || s.data_index >= s.data_end) return 0;
        const ret = s.io_buffer[s.data_index++];
        if (s.data_index >= s.data_end && s.end_transfer_func) {
            s.end_transfer_func(s);
        }
        return ret;
    }

    ideDataWrite8(ifIdx, val) {
        const s = this.ideIf[ifIdx].cur_drive;
        if (!s || s.data_index >= s.data_end) return;
        s.io_buffer[s.data_index++] = val & 0xff;
        if (s.data_index >= s.data_end && s.end_transfer_func) {
            s.end_transfer_func(s);
        }
    }

    ideDataRead16(ifIdx) {
        const s = this.ideIf[ifIdx].cur_drive;
        if (!s || s.data_index + 2 > s.data_end) return 0;
        const p = s.data_index;
        const ret = s.io_buffer[p] | (s.io_buffer[p + 1] << 8);
        s.data_index = p + 2;
        if (s.data_index >= s.data_end && s.end_transfer_func) {
            s.end_transfer_func(s);
        }
        return ret;
    }

    ideDataWrite16(ifIdx, val) {
        const s = this.ideIf[ifIdx].cur_drive;
        if (!s || s.data_index + 2 > s.data_end) return;
        const p = s.data_index;
        s.io_buffer[p] = val & 0xff;
        s.io_buffer[p + 1] = (val >>> 8) & 0xff;
        s.data_index = p + 2;
        if (s.data_index >= s.data_end && s.end_transfer_func) {
            s.end_transfer_func(s);
        }
    }

    ideDataRead32(ifIdx) {
        const s = this.ideIf[ifIdx].cur_drive;
        if (!s || s.data_index + 4 > s.data_end) return 0;
        const p = s.data_index;
        const ret = (s.io_buffer[p] |
            (s.io_buffer[p + 1] << 8) |
            (s.io_buffer[p + 2] << 16) |
            (s.io_buffer[p + 3] << 24)) >>> 0;
        s.data_index = p + 4;
        if (s.data_index >= s.data_end && s.end_transfer_func) {
            s.end_transfer_func(s);
        }
        return ret;
    }

    ideDataWrite32(ifIdx, val) {
        const s = this.ideIf[ifIdx].cur_drive;
        if (!s || s.data_index + 4 > s.data_end) return;
        const p = s.data_index;
        s.io_buffer[p] = val & 0xff;
        s.io_buffer[p + 1] = (val >>> 8) & 0xff;
        s.io_buffer[p + 2] = (val >>> 16) & 0xff;
        s.io_buffer[p + 3] = (val >>> 24) & 0xff;
        s.data_index = p + 4;
        if (s.data_index >= s.data_end && s.end_transfer_func) {
            s.end_transfer_func(s);
        }
    }

    ideDataReadString(ifIdx, buf, offset, size, count) {
        const s = this.ideIf[ifIdx].cur_drive;
        if (!s) return 0;
        let len1 = size * count;
        if (len1 > s.data_end - s.data_index) {
            len1 = s.data_end - s.data_index;
        }
        len1 -= len1 % size;
        if (len1 > 0) {
            for (let i = 0; i < len1; i++) {
                buf[offset + i] = s.io_buffer[s.data_index + i];
            }
        }
        s.data_index += len1;
        if (s.data_index >= s.data_end && s.end_transfer_func) {
            s.end_transfer_func(s);
        }
        return Math.floor(len1 / size);
    }

    ideDataWriteString(ifIdx, buf, offset, size, count) {
        const s = this.ideIf[ifIdx].cur_drive;
        if (!s) return 0;
        let len1 = size * count;
        if (len1 > s.data_end - s.data_index) {
            len1 = s.data_end - s.data_index;
        }
        len1 -= len1 % size;
        if (len1 > 0) {
            for (let i = 0; i < len1; i++) {
                s.io_buffer[s.data_index + i] = buf[offset + i];
            }
        }
        s.data_index += len1;
        if (s.data_index >= s.data_end && s.end_transfer_func) {
            s.end_transfer_func(s);
        }
        return Math.floor(len1 / size);
    }

    /* ======================================================================
     * BUS REGISTRATION
     * ====================================================================== */

    getIOPortHandlers() {
        const handlers = [
            // Legacy Floppy ports (0x3F2-0x3F7)
            { port: 0x3F2, read: () => this.fdc.digitalOutput, write: (_, val) => { this.fdc.digitalOutput = val; } },
            { port: 0x3F4, read: () => this.fdc.mainStatus, write: () => {} },
            { port: 0x3F5, read: () => 0x00, write: () => {} },
            { port: 0x3F7, read: () => 0x00, write: () => {} },

            // Primary IDE Status/Control (0x3F6)
            { port: 0x3F6, read: () => this.ideStatusRead(0), write: (_, val) => this.ideCmdWrite(0, val) },
            // Secondary IDE Status/Control (0x376)
            { port: 0x376, read: () => this.ideStatusRead(1), write: (_, val) => this.ideCmdWrite(1, val) }
        ];

        // Primary IDE 0x1F0..0x1F7
        for (let r = 0; r < 8; r++) {
            handlers.push({
                port: 0x1F0 + r,
                read: () => this.ideIoportRead(0, r),
                write: (_, val) => this.ideIoportWrite(0, r, val)
            });
        }

        // Secondary IDE 0x170..0x177
        for (let r = 0; r < 8; r++) {
            handlers.push({
                port: 0x170 + r,
                read: () => this.ideIoportRead(1, r),
                write: (_, val) => this.ideIoportWrite(1, r, val)
            });
        }

        return handlers;
    }

    getIRQLines() {
        return [6, 14, 15];
    }

    getDMALines() {
        return [2];
    }

    getPcbVisualData() {
        return {
            pcbColor: this.pcbColor,
            chips: [
                { name: 'PRIME 2C IDE/FDC', x: 25, y: 12, w: 50, h: 32 },
                { name: '16550 UART', x: 85, y: 15, w: 30, h: 22 },
                { name: 'IDE PRI/SEC', x: 125, y: 10, w: 45, h: 15 },
                { name: 'FDC 34-PIN', x: 125, y: 30, w: 40, h: 12 }
            ],
            leds: [
                { name: 'HDD/FDD', active: this.activityLed, color: '#ff3300' }
            ],
            bracketConnectors: ['DB-9 COM1', 'DB-25 LPT1', 'DB-15 GAME']
        };
    }

    saveState() {
        return {
            id: this.id,
            jumpers: Object.assign({}, this.jumpers),
            drives: {
                fddA: { mounted: this.drives.fddA.mounted, name: this.drives.fddA.name, writeProtected: this.drives.fddA.writeProtected },
                fddB: { mounted: this.drives.fddB.mounted, name: this.drives.fddB.name, writeProtected: this.drives.fddB.writeProtected },
                hddC: { mounted: this.drives.hddC.mounted, name: this.drives.hddC.name, cylinders: this.drives.hddC.cylinders, heads: this.drives.hddC.heads, sectors: this.drives.hddC.sectors },
                hddD: { mounted: this.drives.hddD.mounted, name: this.drives.hddD.name, cylinders: this.drives.hddD.cylinders, heads: this.drives.hddD.heads, sectors: this.drives.hddD.sectors }
            }
        };
    }

    loadState(state) {
        if (!state) return;
        if (state.jumpers) {
            Object.assign(this.jumpers, state.jumpers);
            this.applyJumpers();
        }
    }
}
