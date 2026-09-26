const ROTATIONS = ['none', 'clockwise_90', 'clockwise_180', 'counterclockwise_90'];

export const MULTIBLOCK_PROJECT_PROPERTY = 'ii_multiblock';
export {ROTATIONS};

export function createDefaultMultiblockData() {
    return {
        version: 4,
        name: '',
        mod_id: 'immersiveintelligence',
        size: [1, 1, 1],
        master: [0, 0, 0],
        translation: [0, 0, 0],
        layer: 1,
        bounds: {},
        positions: {},
        poi: {},
        rotations: {},
        air: [],
        structure_blocks: {},
        inwards: [],
        hidden_poi: [],
        hidden_directions: []
    };
}

export function cloneData(value, fallback = {}) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (ignored) {
        return cloneData(fallback, {});
    }
}

function vector3(value, fallback, integer = false, minimum = -Infinity) {
    if (!Array.isArray(value)) return fallback.slice();
    return [0, 1, 2].map(index => {
        let number = Number(value[index]);
        if (!Number.isFinite(number)) number = fallback[index];
        if (integer) number = Math.trunc(number);
        return Math.max(minimum, number);
    });
}

export function normaliseBounds(bounds) {
    if (!Array.isArray(bounds) || bounds.length !== 6) return null;
    const values = bounds.map(Number);
    if (!values.every(Number.isFinite)) return null;
    return [
        Math.min(values[0], values[3]),
        Math.min(values[1], values[4]),
        Math.min(values[2], values[5]),
        Math.max(values[0], values[3]),
        Math.max(values[1], values[4]),
        Math.max(values[2], values[5])
    ];
}

export function blockKey(position) {
    return position.map(value => Math.trunc(Number(value) || 0)).join(',');
}

export function parseBlockKey(key) {
    const values = String(key).split(',').map(Number);
    return values.length === 3 && values.every(Number.isInteger) ? values : null;
}

export function isInside(position, size) {
    return position && position.every((value, axis) => value >= 0 && value < size[axis]);
}

export function toPreviewPosition(position) {
    return [position[0], position[1], position[2]];
}

/**
 * Mirrors block-local AABB coordinates on Z into Blockbench preview space.
 * Applying the conversion twice restores the stored coordinates.
 */
export function toPreviewBounds(bounds) {
    const normalised = normaliseBounds(bounds);
    if (!normalised) return null;
    return [
        normalised[0], normalised[1], 16 - normalised[5],
        normalised[3], normalised[4], 16 - normalised[2]
    ];
}

export function flattenPosition(position, size) {
    return position[1] * size[2] * size[0] + position[2] * size[0] + position[0];
}

export function positionFromIndex(index, size) {
    const layerSize = size[0] * size[2];
    const y = Math.floor(index / layerSize);
    const layerIndex = index - y * layerSize;
    const z = Math.floor(layerIndex / size[0]);
    const x = layerIndex - z * size[0];
    return [x, y, z];
}

function uniqueStrings(value) {
    if (typeof value === 'string') return [value];
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(item => typeof item === 'string' && item.length))];
}

export function normaliseMultiblockData(value) {
    const result = createDefaultMultiblockData();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;

    result.name = typeof value.name === 'string' ? value.name.trim() : result.name;
    const modId = typeof value.mod_id === 'string' ? value.mod_id.trim().toLowerCase() : '';
    if (/^[a-z0-9_.-]+$/.test(modId)) result.mod_id = modId;
    result.size = vector3(value.size, result.size, true, 1);
    result.master = vector3(value.master || value.master_position, result.master, true, 0)
        .map((coordinate, axis) => Math.min(coordinate, result.size[axis] - 1));
    result.translation = vector3(value.translation, result.translation);
    result.layer = Math.min(result.size[1], Math.max(0, Math.trunc(Number(value.layer))));
    if (!Number.isFinite(Number(value.layer))) result.layer = result.size[1];

    if (value.bounds && typeof value.bounds === 'object') {
        Object.entries(value.bounds).forEach(([name, bounds]) => {
            const normalised = normaliseBounds(bounds);
            if (name && normalised) result.bounds[name] = normalised;
        });
    }
    if (value.positions && typeof value.positions === 'object') {
        Object.entries(value.positions).forEach(([key, references]) => {
            const position = parseBlockKey(key);
            const names = uniqueStrings(references).filter(name => result.bounds[name]);
            if (isInside(position, result.size) && names.length) result.positions[blockKey(position)] = names;
        });
    }
    if (value.poi && typeof value.poi === 'object') {
        Object.entries(value.poi).forEach(([name, positions]) => {
            if (!name) return;
            const values = Array.isArray(positions) ? positions : [];
            const keys = [...new Set(values.map(item => Array.isArray(item) ? blockKey(item) : String(item)))]
                .filter(key => isInside(parseBlockKey(key), result.size));
            result.poi[name] = keys;
        });
    }
    if (value.rotations && typeof value.rotations === 'object') {
        Object.entries(value.rotations).forEach(([name, rotation]) => {
            if (result.poi[name] && ROTATIONS.includes(rotation)) result.rotations[name] = rotation;
        });
    }
    if (Array.isArray(value.air)) {
        result.air = [...new Set(value.air.map(item => Array.isArray(item) ? blockKey(item) : String(item)))]
            .filter(key => isInside(parseBlockKey(key), result.size));
    }
    if (value.structure_blocks && typeof value.structure_blocks === 'object'
        && !Array.isArray(value.structure_blocks)) {
        Object.entries(value.structure_blocks).forEach(([key, block]) => {
            const position = parseBlockKey(key);
            const name = typeof block === 'string' ? block.trim() : '';
            if (name && isInside(position, result.size)) result.structure_blocks[blockKey(position)] = name;
        });
    }
    if (Array.isArray(value.inwards)) {
        result.inwards = [...new Set(value.inwards)]
            .filter(name => typeof name === 'string' && result.rotations[name]);
    }
    result.hidden_poi = uniqueStrings(value.hidden_poi)
        .filter(name => result.poi[name]);
    result.hidden_directions = uniqueStrings(value.hidden_directions)
        .filter(name => result.rotations[name]);
    return result;
}

export function getMultiblockData() {
    if (!Project) return createDefaultMultiblockData();
    const current = Project[MULTIBLOCK_PROJECT_PROPERTY];
    const normalised = normaliseMultiblockData(current);
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
        Project[MULTIBLOCK_PROJECT_PROPERTY] = normalised;
        return normalised;
    }
    replaceObjectContents(current, normalised);
    return current;
}

export function setMultiblockData(data) {
    if (!Project) return;
    const normalised = normaliseMultiblockData(data);
    const current = Project[MULTIBLOCK_PROJECT_PROPERTY];
    if (current && typeof current === 'object' && !Array.isArray(current)) {
        replaceObjectContents(current, normalised);
    } else {
        Project[MULTIBLOCK_PROJECT_PROPERTY] = normalised;
    }
    Project.saved = false;
}

function replaceObjectContents(target, source) {
    Object.keys(target).forEach(key => delete target[key]);
    Object.assign(target, source);
}

export function removeOutsideBounds(data, size) {
    let positions = 0;
    let poi = 0;
    Object.keys(data.positions).forEach(key => {
        if (!isInside(parseBlockKey(key), size)) {
            delete data.positions[key];
            positions++;
        }
    });
    Object.keys(data.poi).forEach(name => {
        const before = data.poi[name].length;
        data.poi[name] = data.poi[name].filter(key => isInside(parseBlockKey(key), size));
        poi += before - data.poi[name].length;
    });
    data.air = (data.air || []).filter(key => isInside(parseBlockKey(key), size));
    Object.keys(data.structure_blocks || {}).forEach(key => {
        if (!isInside(parseBlockKey(key), size)) delete data.structure_blocks[key];
    });
    return {positions, poi};
}

export function isAirBlock(data, position) {
    return Array.isArray(data?.air) && data.air.includes(blockKey(position));
}

export function getBillOfMaterials(data) {
    const counts = new Map();
    Object.values(data?.structure_blocks || {}).forEach(name => {
        if (typeof name !== 'string' || !name) return;
        counts.set(name, (counts.get(name) || 0) + 1);
    });
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const entries = [...counts.entries()]
        .map(([name, count]) => ({
            name,
            count,
            percentage: total ? count / total * 100 : 0
        }))
        .sort((first, second) => second.count - first.count || first.name.localeCompare(second.name));
    return {total, entries};
}

export function importMultiblockSections(source, size) {
    const result = createDefaultMultiblockData();
    result.name = typeof source?.name === 'string' ? source.name.trim() : result.name;
    const modId = typeof source?.mod_id === 'string' ? source.mod_id.trim().toLowerCase() : '';
    if (/^[a-z0-9_.-]+$/.test(modId)) result.mod_id = modId;
    result.size = vector3(size, result.size, true, 1);
    result.master = vector3(source?.master || source?.master_position, result.master, true, 0)
        .map((coordinate, axis) => Math.min(coordinate, result.size[axis] - 1));
    result.layer = result.size[1];

    const allBounds = source?.bounds && typeof source.bounds === 'object' ? source.bounds : {};
    Object.entries(source?.positions || {}).forEach(([indices, references]) => {
        const names = uniqueStrings(references);
        String(indices).split(',').map(value => Number(value.trim())).forEach(index => {
            if (!Number.isInteger(index) || index < 0 || index >= result.size[0] * result.size[1] * result.size[2]) return;
            const position = positionFromIndex(index, result.size);
            const validNames = names.filter(name => normaliseBounds(allBounds[name]));
            if (!validNames.length) return;
            validNames.forEach(name => {
                if (!result.bounds[name]) result.bounds[name] = normaliseBounds(allBounds[name]);
            });
            result.positions[blockKey(position)] = validNames;
        });
    });

    Object.entries(source?.poi || {}).forEach(([name, indices]) => {
        const sourceIndices = Array.isArray(indices) ? indices : [indices];
        const keys = [];
        sourceIndices.forEach(value => {
            String(value).split(',').map(item => Number(item.trim())).forEach(index => {
                if (!Number.isInteger(index) || index < 0 || index >= result.size[0] * result.size[1] * result.size[2]) return;
                keys.push(blockKey(positionFromIndex(index, result.size)));
            });
        });
        result.poi[name] = [...new Set(keys)];
    });
    Object.entries(source?.rotations || {}).forEach(([name, rotation]) => {
        if (result.poi[name] && ROTATIONS.includes(rotation)) result.rotations[name] = rotation;
    });
    return result;
}

export function compileMultiblockSections(data) {
    data = normaliseMultiblockData(data);
    const groupedPositions = new Map();
    Object.entries(data.positions).forEach(([key, names]) => {
        const position = parseBlockKey(key);
        if (!isInside(position, data.size) || !names.length) return;
        const signature = JSON.stringify(names);
        if (!groupedPositions.has(signature)) groupedPositions.set(signature, []);
        groupedPositions.get(signature).push(flattenPosition(position, data.size));
    });
    const positions = {};
    groupedPositions.forEach((indices, signature) => {
        indices.sort((a, b) => a - b);
        const names = JSON.parse(signature);
        positions[indices.join(',')] = names.length === 1 ? names[0] : names;
    });

    const poi = {};
    Object.entries(data.poi).forEach(([name, keys]) => {
        const indices = [...new Set(keys.map(parseBlockKey)
            .filter(position => isInside(position, data.size))
            .map(position => flattenPosition(position, data.size)))]
            .sort((a, b) => a - b);
        if (indices.length === 1) poi[name] = indices[0];
        else if (indices.length) poi[name] = indices;
    });

    const rotations = {};
    Object.entries(data.rotations).forEach(([name, rotation]) => {
        if (data.poi[name] && ROTATIONS.includes(rotation)) rotations[name] = rotation;
    });
    return {
        name: data.name,
        master: data.master.slice(),
        bounds: cloneData(data.bounds),
        positions,
        poi,
        rotations
    };
}

export function nextName(existing, base) {
    if (!existing[base]) return base;
    let index = 2;
    while (existing[`${base}_${index}`]) index++;
    return `${base}_${index}`;
}

export function nextDuplicateName(existing, sourceName) {
    const source = String(sourceName || 'aabb').trim() || 'aabb';
    const numbered = source.match(/^(.*?)(\d+)$/);
    if (numbered) {
        const prefix = numbered[1];
        const width = numbered[2].length;
        let index = Number(numbered[2]);
        if (Number.isSafeInteger(index)) {
            let candidate;
            do {
                candidate = `${prefix}${String(++index).padStart(width, '0')}`;
            } while (existing[candidate]);
            return candidate;
        }
    }
    const base = source.replace(/_copy(?:_\d+)?$/i, '') || 'aabb';
    return nextName(existing, `${base}_copy`);
}
