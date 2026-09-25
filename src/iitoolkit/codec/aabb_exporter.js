/* global autoStringify, globalThis, ModelProject, Property */
import {AABB} from '../elements/aabb';
import {parseStructureNBT} from './structure_nbt';
import {
    cloneData,
    compileMultiblockSections,
    getMultiblockData,
    importMultiblockSections,
    removeOutsideBounds,
    setMultiblockData
} from '../multiblock/multiblock_data';

const PROJECT_SETTINGS_KEY = 'ii_aabb_export_settings';
const EPSILON = 1e-5;
const DEFAULT_SETTINGS = Object.freeze({
    preserve_contents: true,
    export_multiblock: true,
    export_tactiles: false,
    tactile_transforms: defaultTactileTransforms(),
    model_schema: '',
    schema_file: '',
    target_file: ''
});

let projectSettingsPersistenceRegistered = false;

function defaultTactileTransforms() {
    return {
        all: {offset: [0, 0, 0]},
        south: {rotation: [0, 0, 0], flip_xz_size: false},
        west: {rotation: [0, 90, 0], flip_xz_size: true},
        north: {rotation: [0, 180, 0], flip_xz_size: false},
        east: {rotation: [0, 270, 0], flip_xz_size: true},
        mirrored: {}
    };
}

function cloneJSON(value, fallback = {}) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (ignored) {
        return fallback;
    }
}

function vector3(value, fallback = [0, 0, 0]) {
    if (!Array.isArray(value)) return fallback.slice();
    return [0, 1, 2].map(index => {
        const number = Number(value[index]);
        return Number.isFinite(number) ? number : fallback[index];
    });
}

function round(value) {
    const rounded = Math.round(Number(value) * 100000) / 100000;
    return Object.is(rounded, -0) ? 0 : rounded;
}

function validBounds(bounds) {
    return Array.isArray(bounds) && bounds.length === 6
        && bounds.every(value => Number.isFinite(Number(value)));
}

function normalisedMinMax(bounds) {
    const first = bounds.slice(0, 3).map(Number);
    const second = bounds.slice(3, 6).map(Number);
    return {
        min: first.map((value, axis) => Math.min(value, second[axis])),
        max: first.map((value, axis) => Math.max(value, second[axis]))
    };
}

function sameBounds(first, second) {
    return validBounds(first) && validBounds(second)
        && first.every((value, index) => Math.abs(Number(value) - Number(second[index])) < EPSILON);
}

function filePath(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return filePath(value[0]);
    return value && typeof value.path === 'string' ? value.path : '';
}

function serialiseJSON(value) {
    return typeof autoStringify === 'function' ? autoStringify(value) : JSON.stringify(value, null, 2);
}

function normaliseTactileTransforms(value) {
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch (ignored) {
            throw new Error('Tactile Transforms must be a valid JSON object.');
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultTactileTransforms();
    return cloneJSON(value, defaultTactileTransforms());
}

function migrateLegacyTactileOffset(value) {
    const transforms = defaultTactileTransforms();
    transforms.all.offset = vector3(value);
    return transforms;
}

function normaliseSettings(source = {}) {
    const transforms = source.tactile_transforms !== undefined
        ? source.tactile_transforms
        : (source.tactile_offset !== undefined ? migrateLegacyTactileOffset(source.tactile_offset) : undefined);
    return {
        preserve_contents: source.preserve_contents !== false,
        export_multiblock: source.export_multiblock !== false,
        export_tactiles: source.export_tactiles === true,
        tactile_transforms: normaliseTactileTransforms(transforms),
        model_schema: typeof source.model_schema === 'string' ? source.model_schema : '',
        schema_file: filePath(source.schema_file),
        target_file: filePath(source.target_file || source.static_target_file || source.tactile_target_file)
    };
}

export function registerAABBExporterPersistence() {
    if (projectSettingsPersistenceRegistered) return;
    const projectClass = typeof ModelProject !== 'undefined'
        ? ModelProject
        : (typeof Project !== 'undefined' ? Project?.constructor : null);
    if (projectClass && typeof Property === 'function') {
        try {
            new Property(projectClass, 'object', PROJECT_SETTINGS_KEY, {default: {}});
        } catch (ignored) {
            // The active Blockbench build may already have the property registered.
        }
    }
    projectSettingsPersistenceRegistered = true;
}

function getProjectSettings() {
    registerAABBExporterPersistence();
    return normaliseSettings(Project?.[PROJECT_SETTINGS_KEY] || DEFAULT_SETTINGS);
}

function rememberProjectSettings(settings) {
    if (!Project) return;
    Project[PROJECT_SETTINGS_KEY] = cloneJSON(normaliseSettings(settings));
    if ('saved' in Project) Project.saved = false;
}

class BoundsRegistry {
    constructor(existingBounds = {}) {
        this.bounds = cloneJSON(existingBounds || {}, {});
    }

    add(preferredName, bounds) {
        const preferred = String(preferredName || 'aabb').trim() || 'aabb';
        const normalised = bounds.map(round);
        let candidate = preferred;
        let suffix = 2;
        while (Object.prototype.hasOwnProperty.call(this.bounds, candidate)
            && !sameBounds(this.bounds[candidate], normalised)) {
            candidate = `${preferred}_${suffix++}`;
        }
        if (!Object.prototype.hasOwnProperty.call(this.bounds, candidate)) this.bounds[candidate] = normalised;
        return candidate;
    }
}

function getAABBElements() {
    return (Outliner.elements || []).filter(element => element instanceof AABB && element.export !== false);
}

function findParentGroup(element) {
    let parent = element?.parent;
    while (parent && parent !== 'root') {
        if (parent instanceof Group || parent.type === 'group') return parent;
        parent = parent.parent;
    }
    return null;
}

function elementDimensions(element) {
    return [element.width, element.height, element.depth].map(value => Math.max(0, Number(value) || 0));
}

export function compileTactileAABB(elements, settings, registry) {
    const tactile = {};
    const schema = resourceLocationFromSchema(settings.model_schema || settings.schema_file);
    if (!schema) throw new Error('Select a model schema or enter its resource location for tactile export.');
    tactile._schema = schema;

    elements.forEach(element => {
        const group = findParentGroup(element);
        const groupName = group?.name || 'main';
        const groupOrigin = vector3(group?.origin);
        const centre = vector3(element.position || element.origin);
        const size = elementDimensions(element);
        const bounds = [-size[0] / 2, -size[1] / 2, -size[2] / 2,
            size[0] / 2, size[1] / 2, size[2] / 2];
        const templateName = registry.add(element.name, bounds);
        const offset = centre.map((value, axis) => round(value - groupOrigin[axis]));
        if (!tactile[groupName]) tactile[groupName] = [];
        tactile[groupName].push({offset, type: templateName});
    });
    return tactile;
}

function orderedWithBounds(result, bounds) {
    const ordered = {bounds};
    Object.entries(result).forEach(([key, value]) => {
        if (key !== 'bounds') ordered[key] = value;
    });
    return ordered;
}

export function compileStaticData(existingData = {}, preserveContents = true) {
    const result = preserveContents ? cloneJSON(existingData, {}) : {};
    const sections = compileMultiblockSections(getMultiblockData());
    const registry = new BoundsRegistry(preserveContents ? result.bounds : {});
    const names = {};
    Object.entries(sections.bounds).forEach(([name, bounds]) => {
        names[name] = registry.add(name, bounds);
    });
    result.bounds = registry.bounds;
    result.positions = {};
    Object.entries(sections.positions).forEach(([positions, references]) => {
        result.positions[positions] = Array.isArray(references)
            ? references.map(name => names[name])
            : names[references];
    });
    result.poi = sections.poi;
    result.rotations = sections.rotations;
    return orderedWithBounds(result, result.bounds);
}

export function compileTactileData(settings, existingData = {}) {
    settings = normaliseSettings(settings);
    const result = settings.preserve_contents ? cloneJSON(existingData, {}) : {};
    const registry = new BoundsRegistry(settings.preserve_contents ? result.bounds : {});
    delete result.tactile_offset;
    result.tactile_transforms = cloneJSON(settings.tactile_transforms, defaultTactileTransforms());
    result.tactile = compileTactileAABB(getAABBElements(), settings, registry);
    return orderedWithBounds(result, registry.bounds);
}

export function compileAABBData(settings, existingData = {}) {
    settings = normaliseSettings(settings);
    let result = settings.preserve_contents ? cloneJSON(existingData, {}) : {};
    if (settings.export_multiblock) result = compileStaticData(result, true);
    if (settings.export_tactiles) {
        result = compileTactileData({...settings, preserve_contents: true}, result);
    }
    return result;
}

export function resourceLocationFromSchema(value) {
    let path = typeof value === 'string' ? value.trim() : '';
    if (!path) return '';
    path = path.replace(/\\/g, '/');
    if (!/^[a-z]:\//i.test(path) && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(path)) return path;
    const assetsMatch = path.match(/(?:^|\/)assets\/([^/]+)\/(.+)$/i);
    if (assetsMatch) return `${assetsMatch[1]}:${assetsMatch[2]}`;
    const fileName = path.substring(path.lastIndexOf('/') + 1);
    return fileName ? `immersiveintelligence:models/${fileName}` : '';
}

export function readDesktopText(fileValue) {
    if (!fileValue) return '';
    if (Array.isArray(fileValue)) return readDesktopText(fileValue[0]);
    if (typeof fileValue.content === 'string') return fileValue.content;
    const path = filePath(fileValue);
    if (!path) return '';
    try {
        const desktopFS = globalThis.fs
            || (typeof window !== 'undefined' && typeof window.require === 'function'
                ? window.require('fs') : null);
        return desktopFS?.readFileSync(path, 'utf8') || '';
    } catch (ignored) {
        return '';
    }
}

function readBinaryData(fileValue) {
    if (!fileValue) return null;
    if (fileValue instanceof ArrayBuffer || ArrayBuffer.isView(fileValue)) return fileValue;
    if (typeof fileValue.content !== 'undefined') return fileValue.content;
    const path = filePath(fileValue);
    if (!path) return null;
    try {
        const desktopFS = globalThis.fs
            || (typeof window !== 'undefined' && typeof window.require === 'function'
                ? window.require('fs') : null);
        return desktopFS?.readFileSync(path) || null;
    } catch (ignored) {
        return null;
    }
}

async function parseStructureFile(fileValue) {
    const contents = readBinaryData(fileValue);
    if (!contents) throw new Error('The NBT structure file could not be read.');
    return parseStructureNBT(contents);
}

export function parseExistingFile(value) {
    if (!value) return {};
    const contents = readDesktopText(value);
    if (!contents) throw new Error('The existing AABB file could not be read.');
    try {
        return JSON.parse(contents);
    } catch (error) {
        throw new Error(`The existing AABB file is not valid JSON: ${error.message}`);
    }
}

function fileBaseName(path, fallback = 'aabb') {
    if (!path) return fallback;
    const normalised = String(path).replace(/\\/g, '/');
    return normalised.substring(normalised.lastIndexOf('/') + 1).replace(/\.json$/i, '') || fallback;
}

function writeExport(data, targetValue) {
    const targetPath = filePath(targetValue);
    const content = serialiseJSON(data);
    if (isApp && targetPath) {
        Blockbench.writeFile(targetPath, {content});
        Blockbench.showQuickMessage('AABB data exported');
        return;
    }
    Blockbench.export({
        resource_id: 'ii_aabb', type: 'Immersive Intelligence AABB', extensions: ['json'],
        name: fileBaseName(targetPath, Project?.name || 'aabb'), content
    });
}

function showError(error) {
    const message = error instanceof Error ? error.message : String(error);
    Blockbench.showMessageBox({title: 'AABB Error', message, icon: 'error'});
}

function importJSON(callback) {
    Blockbench.import({
        resource_id: 'ii_aabb', type: 'Immersive Intelligence AABB',
        extensions: ['json'], readtype: 'text', multiple: false
    }, files => {
        if (!files?.length) return;
        try {
            callback(JSON.parse(files[0].content));
        } catch (error) {
            showError(new Error(`Could not parse AABB JSON: ${error.message}`));
        }
    });
}

function openStaticImportDialog(data) {
    const current = getMultiblockData();
    let parsedStructure = null;
    let parsedStructureSource = null;
    let structureRequest = 0;
    const dialog = new Dialog('ii_multiblock_import_options', {
        title: 'Import Multiblock Data',
        form: {
            structure_file: {
                label: 'Minecraft Structure', type: 'file', extensions: ['nbt'], readtype: 'binary',
                return_as: 'file', description: 'Optional: imports the size and prevents editing air blocks.'
            },
            size: {label: 'Multiblock Size (X, Y, Z)', type: 'vector', dimensions: 3, min: 1, value: current.size},
            master: {
                label: 'Master Block Position (X, Y, Z)', type: 'vector', dimensions: 3, min: 0,
                value: current.master
            },
            translation: {
                label: 'Preview Translation (X, Y, Z)', type: 'vector', dimensions: 3, value: current.translation
            }
        },
        async onFormChange(result) {
            const source = result.structure_file;
            if (!source || source === parsedStructureSource) return;
            const request = ++structureRequest;
            try {
                const structure = await parseStructureFile(source);
                if (request !== structureRequest) return;
                parsedStructure = structure;
                parsedStructureSource = source;
                dialog.setFormValues({size: structure.size});
                Blockbench.showQuickMessage(`Structure size: ${structure.size.join(' × ')}`);
            } catch (error) {
                if (request === structureRequest) showError(error);
            }
        },
        async onConfirm(result) {
            try {
                const structure = result.structure_file
                    ? (result.structure_file === parsedStructureSource
                        ? parsedStructure : await parseStructureFile(result.structure_file))
                    : null;
                const imported = importMultiblockSections(data, structure?.size || result.size);
                imported.master = vector3(result.master);
                imported.translation = vector3(result.translation);
                if (structure) {
                    imported.air = structure.air;
                    imported.structure_blocks = structure.blocks;
                    const air = new Set(structure.air);
                    Object.keys(imported.positions).forEach(key => {
                        if (air.has(key)) delete imported.positions[key];
                    });
                    Object.keys(imported.poi).forEach(name => {
                        imported.poi[name] = imported.poi[name].filter(key => !air.has(key));
                    });
                }
                Undo.initEdit({multiblock: true});
                setMultiblockData(imported);
                Undo.finishEdit('Import multiblock data', {multiblock: true});
                Blockbench.dispatchEvent('ii_multiblock_refresh');
                Blockbench.showQuickMessage(structure
                    ? `Multiblock imported; ${structure.air.length} air block${structure.air.length === 1 ? '' : 's'} locked`
                    : 'Multiblock data imported');
            } catch (error) {
                if (typeof Undo.cancelEdit === 'function') Undo.cancelEdit();
                showError(error);
            }
        }
    });
    dialog.show();
}

function applyStructureData(structure) {
    const current = cloneData(getMultiblockData());
    const wasAllLayers = current.layer >= current.size[1];
    current.size = structure.size.slice();
    removeOutsideBounds(current, current.size);
    current.master = current.master.map((coordinate, axis) =>
        Math.min(Math.max(0, coordinate), current.size[axis] - 1));
    current.layer = wasAllLayers ? current.size[1] : Math.min(current.layer, current.size[1] - 1);
    current.air = structure.air.slice();
    current.structure_blocks = cloneData(structure.blocks);

    const air = new Set(current.air);
    Object.keys(current.positions).forEach(key => {
        if (air.has(key)) delete current.positions[key];
    });
    Object.keys(current.poi).forEach(name => {
        current.poi[name] = current.poi[name].filter(key => !air.has(key));
    });
    return current;
}

function importMultiblockStructure() {
    Blockbench.import({
        resource_id: 'ii_multiblock_structure', type: 'Minecraft Structure NBT',
        extensions: ['nbt'], readtype: 'binary', multiple: false
    }, async files => {
        if (!files?.length) return;
        let editing = false;
        try {
            const structure = await parseStructureFile(files[0]);
            const imported = applyStructureData(structure);
            Undo.initEdit({multiblock: true});
            editing = true;
            setMultiblockData(imported);
            Undo.finishEdit('Import multiblock structure NBT', {multiblock: true});
            editing = false;
            Blockbench.dispatchEvent('ii_multiblock_refresh');
            const count = Object.keys(structure.blocks).length;
            Blockbench.showQuickMessage(`Imported ${structure.size.join(' × ')} structure with ${count} non-air block${count === 1 ? '' : 's'}`);
        } catch (error) {
            if (editing && typeof Undo.cancelEdit === 'function') Undo.cancelEdit();
            showError(error);
        }
    });
}

function createAABB(data, parent, created) {
    const element = new AABB(data).addTo(parent || 'root').init();
    created.push(element);
    return element;
}

function findOrCreateGroup(name, createdGroups) {
    const existing = (Group.all || []).find(group => group.name === name);
    if (existing) return existing;
    const group = new Group({name}).addTo().init();
    createdGroups.push(group);
    return group;
}

export function importTactileAABB(data, created, createdGroups) {
    const bounds = data.bounds || {};
    Object.entries(data.tactile || {}).forEach(([groupName, entries]) => {
        if (groupName === '_schema' || !Array.isArray(entries)) return;
        const group = findOrCreateGroup(groupName, createdGroups);
        const groupOrigin = vector3(group.origin);
        entries.forEach((entry, index) => {
            if (!entry || typeof entry !== 'object') {
                throw new Error(`Tactile entry '${groupName}[${index}]' is invalid.`);
            }
            const template = entry.type ? bounds[entry.type] : entry.bounds;
            if (!validBounds(template)) {
                throw new Error(`Tactile AABB template '${entry.type || `${groupName}[${index}]`}' is missing or invalid.`);
            }
            const {min, max} = normalisedMinMax(template);
            const offset = vector3(entry.offset);
            createAABB({
                name: entry.type || `${groupName}_aabb_${index + 1}`,
                position: min.map((value, axis) => groupOrigin[axis] + offset[axis] + (value + max[axis]) / 2),
                width: max[0] - min[0], height: max[1] - min[1], depth: max[2] - min[2]
            }, group, created);
        });
    });
}

function importTactileData(data) {
    const created = [];
    const createdGroups = [];
    try {
        Undo.initEdit({outliner: true, elements: [], selection: true});
        importTactileAABB(data, created, createdGroups);
        Undo.finishEdit('Import tactile AABB data', {outliner: true, elements: created, selection: true});
        const settings = getProjectSettings();
        settings.model_schema = typeof data.tactile?._schema === 'string'
            ? data.tactile._schema : settings.model_schema;
        settings.tactile_transforms = data.tactile_transforms
            || (data.tactile_offset ? migrateLegacyTactileOffset(data.tactile_offset) : settings.tactile_transforms);
        rememberProjectSettings(settings);
        Blockbench.showQuickMessage(`Imported ${created.length} tactile AABB${created.length === 1 ? '' : 's'}`);
    } catch (error) {
        if (typeof Undo.cancelEdit === 'function') Undo.cancelEdit();
        showError(error);
    }
}

function openAABBExportDialog() {
    const settings = getProjectSettings();
    let lastSchemaFile = settings.schema_file;
    let applyingSchema = false;
    const dialog = new Dialog('ii_aabb_export', {
        title: 'Export Multiblock and Tactile Data',
        form: {
            export_multiblock: {
                label: 'Export Multiblock', type: 'checkbox', value: settings.export_multiblock
            },
            export_tactiles: {
                label: 'Export Tactiles', type: 'checkbox', value: settings.export_tactiles
            },
            preserve_contents: {
                label: 'Preserve unaltered contents', type: 'checkbox', value: settings.preserve_contents
            },
            target_file: {
                label: 'Existing/output AABB file', type: 'file', extensions: ['json'],
                value: settings.target_file
            },
            tactile_transforms: {
                label: 'Tactile Transforms (JSON)', type: 'textarea',
                value: JSON.stringify(settings.tactile_transforms, null, 2),
                condition: result => result.export_tactiles
            },
            schema_file: {
                label: 'AMT Model Schema', type: 'file', extensions: ['amt'], value: settings.schema_file,
                condition: result => result.export_tactiles
            },
            model_schema: {
                label: 'Schema Resource Location', type: 'text', value: settings.model_schema,
                condition: result => result.export_tactiles
            }
        },
        onFormChange(result) {
            if (applyingSchema) return;
            const selected = filePath(result.schema_file);
            if (!selected || selected === lastSchemaFile) return;
            lastSchemaFile = selected;
            applyingSchema = true;
            dialog.setFormValues({model_schema: resourceLocationFromSchema(selected)});
            applyingSchema = false;
        },
        onConfirm(result) {
            try {
                if (!result.export_multiblock && !result.export_tactiles)
                    throw new Error('Select Multiblock, Tactiles, or both for export.');
                const next = normaliseSettings({...settings, ...result});
                if (next.schema_file && !next.model_schema) next.model_schema = resourceLocationFromSchema(next.schema_file);
                const existing = next.preserve_contents && result.target_file
                    ? parseExistingFile(result.target_file) : {};
                writeExport(compileAABBData(next, existing), result.target_file);
                rememberProjectSettings(next);
            } catch (error) {
                showError(error);
            }
        }
    });
    dialog.show();
}

export const exportAABBData = new Action('export_aabb_data', {
    name: 'Export Multiblock/Tactile Data...', icon: 'save',
    description: 'Export multiblock and animated tactile AABB data',
    condition: () => Format?.id === 'free', click: openAABBExportDialog
});

export const importMultiblockData = new Action('import_multiblock_data', {
    name: 'Import Multiblock Data...', icon: 'folder_open',
    description: 'Import static AABB presets, positions, POIs, and directions',
    condition: () => Format?.id === 'free', click: () => importJSON(openStaticImportDialog)
});

export const importMultiblockStructureAction = new Action('import_multiblock_structure', {
    name: 'Import Multiblock Structure NBT...', icon: 'grid_on',
    description: 'Import multiblock size, occupied blocks, and the bill of materials from a Minecraft structure',
    condition: () => Format?.id === 'free', click: importMultiblockStructure
});

export const importTactileAABBAction = new Action('import_tactile_aabb', {
    name: 'Import Tactile AABB...', icon: 'folder_open',
    description: 'Import animated tactile AABB elements', click: () => importJSON(importTactileData)
});
