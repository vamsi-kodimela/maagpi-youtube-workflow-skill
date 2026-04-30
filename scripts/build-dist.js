#!/usr/bin/env node
// Builds the Claude Desktop skill bundle: dist/youtube-content-workflow/ + a portable .zip.
// Plain Node, no deps. Produces ZIP entries with forward slashes (cross-platform).

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT      = path.resolve(__dirname, '..');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION   = PKG.version;
const SKILL     = 'youtube-content-workflow';
const DIST      = path.join(ROOT, 'dist');
const STAGE     = path.join(DIST, SKILL);
const SCHEMAS   = path.join(STAGE, 'schemas');
const ZIP_PATH  = path.join(DIST, `${SKILL}-${VERSION}.zip`);

// --- stage ----------------------------------------------------------------

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(SCHEMAS, { recursive: true });

fs.copyFileSync(path.join(ROOT, 'SKILL.md'), path.join(STAGE, 'SKILL.md'));
for (const f of fs.readdirSync(path.join(ROOT, 'schemas'))) {
    fs.copyFileSync(path.join(ROOT, 'schemas', f), path.join(SCHEMAS, f));
}

// --- collect files (forward-slash relative paths) -------------------------

function walk(dir, baseRel) {
    const out = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const abs = path.join(dir, name);
        const rel = baseRel ? `${baseRel}/${name}` : name;
        if (fs.statSync(abs).isDirectory()) {
            out.push(...walk(abs, rel));
        } else {
            out.push({ abs, rel });
        }
    }
    return out;
}

const files = walk(STAGE, SKILL);

// --- crc32 ----------------------------------------------------------------

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// --- zip writer (STORED, no compression chosen per file) ------------------

const DOS_DATE = ((2026 - 1980) << 9) | (4 << 5) | 30;  // 2026-04-30
const DOS_TIME = (12 << 11) | (0 << 5) | 0;             // 12:00:00

const chunks = [];
const central = [];
let offset = 0;

for (const f of files) {
    const nameBuf  = Buffer.from(f.rel, 'utf8');
    const raw      = fs.readFileSync(f.abs);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDef   = deflated.length < raw.length;
    const data     = useDef ? deflated : raw;
    const method   = useDef ? 8 : 0;
    const crc      = crc32(raw);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);            // version needed
    lfh.writeUInt16LE(0x0800, 6);        // flag: UTF-8 names
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(DOS_TIME, 10);
    lfh.writeUInt16LE(DOS_DATE, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    chunks.push(lfh, nameBuf, data);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);            // version made by (DOS, 2.0)
    cdh.writeUInt16LE(20, 6);            // version needed
    cdh.writeUInt16LE(0x0800, 8);        // flag: UTF-8 names
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(DOS_TIME, 12);
    cdh.writeUInt16LE(DOS_DATE, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(data.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);            // extra
    cdh.writeUInt16LE(0, 32);            // comment
    cdh.writeUInt16LE(0, 34);            // disk
    cdh.writeUInt16LE(0, 36);            // internal attrs
    cdh.writeUInt32LE(0, 38);            // external attrs
    cdh.writeUInt32LE(offset, 42);

    central.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + data.length;
}

const cdStart = offset;
const cdBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(cdStart, 16);
eocd.writeUInt16LE(0, 20);

if (fs.existsSync(ZIP_PATH)) fs.rmSync(ZIP_PATH, { force: true });
fs.writeFileSync(ZIP_PATH, Buffer.concat([...chunks, cdBuf, eocd]));

console.log(`Built  : ${path.relative(ROOT, ZIP_PATH)}`);
console.log(`Files  : ${files.length}`);
console.log(`Size   : ${fs.statSync(ZIP_PATH).size} bytes`);
console.log('');
console.log('Entries:');
for (const f of files) console.log(`  ${f.rel}`);
