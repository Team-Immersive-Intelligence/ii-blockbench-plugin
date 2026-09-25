const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new Error('The structure file does not contain binary data.');
}

class NBTReader {
    constructor(value) {
        this.bytes = toBytes(value);
        this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
        this.offset = 0;
        this.decoder = new TextDecoder('utf-8');
    }

    require(length) {
        if (length < 0 || this.offset + length > this.view.byteLength)
            throw new Error('Unexpected end of NBT data.');
    }

    byte() {
        this.require(1);
        return this.view.getInt8(this.offset++);
    }

    unsignedByte() {
        this.require(1);
        return this.view.getUint8(this.offset++);
    }

    short() {
        this.require(2);
        const value = this.view.getInt16(this.offset, false);
        this.offset += 2;
        return value;
    }

    unsignedShort() {
        this.require(2);
        const value = this.view.getUint16(this.offset, false);
        this.offset += 2;
        return value;
    }

    int() {
        this.require(4);
        const value = this.view.getInt32(this.offset, false);
        this.offset += 4;
        return value;
    }

    long() {
        this.require(8);
        let value;
        if (typeof this.view.getBigInt64 === 'function') value = Number(this.view.getBigInt64(this.offset, false));
        else value = this.view.getInt32(this.offset, false) * 0x100000000 + this.view.getUint32(this.offset + 4, false);
        this.offset += 8;
        return value;
    }

    float() {
        this.require(4);
        const value = this.view.getFloat32(this.offset, false);
        this.offset += 4;
        return value;
    }

    double() {
        this.require(8);
        const value = this.view.getFloat64(this.offset, false);
        this.offset += 8;
        return value;
    }

    string() {
        const length = this.unsignedShort();
        this.require(length);
        const value = this.decoder.decode(this.bytes.subarray(this.offset, this.offset + length));
        this.offset += length;
        return value;
    }

    length() {
        const length = this.int();
        if (length < 0 || length > 0x1000000) throw new Error(`Invalid NBT array length ${length}.`);
        return length;
    }

    payload(type) {
        switch (type) {
            case TAG_BYTE: return this.byte();
            case TAG_SHORT: return this.short();
            case TAG_INT: return this.int();
            case TAG_LONG: return this.long();
            case TAG_FLOAT: return this.float();
            case TAG_DOUBLE: return this.double();
            case TAG_BYTE_ARRAY: {
                const length = this.length();
                this.require(length);
                const value = this.bytes.slice(this.offset, this.offset + length);
                this.offset += length;
                return value;
            }
            case TAG_STRING: return this.string();
            case TAG_LIST: {
                const childType = this.unsignedByte();
                const length = this.length();
                const values = [];
                for (let index = 0; index < length; index++) values.push(this.payload(childType));
                return values;
            }
            case TAG_COMPOUND: {
                const value = {};
                let childType = this.unsignedByte();
                while (childType !== TAG_END) {
                    const name = this.string();
                    value[name] = this.payload(childType);
                    childType = this.unsignedByte();
                }
                return value;
            }
            case TAG_INT_ARRAY: {
                const values = [];
                const length = this.length();
                for (let index = 0; index < length; index++) values.push(this.int());
                return values;
            }
            case TAG_LONG_ARRAY: {
                const values = [];
                const length = this.length();
                for (let index = 0; index < length; index++) values.push(this.long());
                return values;
            }
            default: throw new Error(`Unsupported NBT tag type ${type}.`);
        }
    }
}

export function parseNBT(value) {
    const reader = new NBTReader(value);
    const rootType = reader.unsignedByte();
    if (rootType !== TAG_COMPOUND) throw new Error('The NBT root must be a compound tag.');
    reader.string();
    return reader.payload(rootType);
}

async function decompressWithStream(bytes, format) {
    if (typeof DecompressionStream !== 'function') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompressNBT(value) {
    const bytes = toBytes(value);
    const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const deflate = bytes[0] === 0x78;
    if (!gzip && !deflate) return bytes;

    try {
        const nodeRequire = typeof window !== 'undefined' && typeof window.require === 'function'
            ? window.require : null;
        if (nodeRequire) {
            const zlib = nodeRequire('zlib');
            const output = gzip ? zlib.gunzipSync(bytes) : zlib.inflateSync(bytes);
            return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
        }
    } catch (ignored) {
        // Fall through to the browser decompressor.
    }

    const output = await decompressWithStream(bytes, gzip ? 'gzip' : 'deflate');
    if (output) return output;
    throw new Error('Compressed NBT files are not supported by this Blockbench build.');
}

function vector3(value) {
    if (!Array.isArray(value) || value.length < 3) return null;
    const result = value.slice(0, 3).map(Number);
    return result.every(Number.isInteger) ? result : null;
}

function isAirState(name) {
    return ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', 'minecraft:structure_void']
        .includes(String(name || '').toLowerCase());
}

export function readStructureData(root) {
    const size = vector3(root?.size);
    if (!size || size.some(value => value < 1)) throw new Error('The NBT structure has no valid size tag.');

    const palettes = Array.isArray(root.palettes) ? root.palettes : [];
    const palette = Array.isArray(root.palette) ? root.palette : palettes[0];
    if (!Array.isArray(palette)) throw new Error('The NBT structure has no palette.');
    const names = palette.map(entry => entry?.Name || entry?.name || '');
    const blocks = {};

    (Array.isArray(root.blocks) ? root.blocks : []).forEach(block => {
        const position = vector3(block?.pos);
        if (!position || position.some((value, axis) => value < 0 || value >= size[axis])) return;
        const state = Number(block.state);
        const name = Number.isInteger(state) ? names[state] : '';
        if (!name) return;
        const key = position.join(',');
        if (isAirState(name)) delete blocks[key];
        else blocks[key] = name;
    });

    const air = [];
    for (let y = 0; y < size[1]; y++) {
        for (let z = 0; z < size[2]; z++) {
            for (let x = 0; x < size[0]; x++) {
                const key = `${x},${y},${z}`;
                if (!blocks[key]) air.push(key);
            }
        }
    }
    return {size, air, blocks};
}

export async function parseStructureNBT(value) {
    return readStructureData(parseNBT(await decompressNBT(value)));
}
