/* global Collection, Settings, THREE, autoStringify, Locator, Texture, scene, OutlinerNode, Mesh, Property */
//-- Export Dialogue --//
import {getResourceLocation} from '../utils';
import {Pipe} from '../elements/pipe';
import {collectVisibleMeshes, safeObjName} from '../elements/common';
import {getTextElementProperties} from '../elements/text';
import {getHandElementProperties} from '../elements/hand';
import {getBannerElementProperties} from '../elements/banner';
import {getItemElementProperties} from '../elements/item';

const ROUND = 10000;
const NORMAL_ROUND = 100;
const DEFAULT_EXPORTED_OFFSET = [0, 0, 0];
const DEFAULT_EXPORT_OPTIONS = {
    obj_model: true,
    obj_flipped: false,
    obj_amt: true,
    obj_mtl: true,
    exported_offset: DEFAULT_EXPORTED_OFFSET,
    flip_axis: 'x',
    flip_offset: [0, 0, 0]
};
const SPECIAL_AMT_TYPES = ['wire', 'bullet', 'fluid', 'track', 'ii_text', 'hand', 'banner', 'item'];
const COLLECTION_EXPORT_OPTIONS_KEY = 'ii_obj_export_options';
let collectionExportOptionsPersistenceRegistered = false;

export var exportOptions = {
    export_mode: 'obj',
    scale: 0.0625,
    offset: [0, 0, 0],
    ...DEFAULT_EXPORT_OPTIONS
};

function roundObj(value, precision = ROUND) {
    return Math.round(value * precision) / precision;
}

function vec3(value, fallback = [0, 0, 0]) {
    return Array.isArray(value)
        ? [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0]
        : fallback.slice();
}

function addVec3(a, b) {
    a = vec3(a);
    b = vec3(b);
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}


function addArrayToThree(vector, array) {
    vector.x += array[0] || 0;
    vector.y += array[1] || 0;
    vector.z += array[2] || 0;
    return vector;
}

function createExportSettings(source = {}, fallback = DEFAULT_EXPORT_OPTIONS) {
    const supplied = source || {};
    return {
        obj_model: supplied.obj_model !== undefined ? !!supplied.obj_model : fallback.obj_model,
        obj_flipped: supplied.obj_flipped !== undefined ? !!supplied.obj_flipped : fallback.obj_flipped,
        obj_amt: supplied.obj_amt !== undefined ? !!supplied.obj_amt : fallback.obj_amt,
        obj_mtl: supplied.obj_mtl !== undefined ? !!supplied.obj_mtl : fallback.obj_mtl,
        exported_offset: vec3(supplied.exported_offset || supplied.offset || fallback.exported_offset, fallback.exported_offset),
        flip_axis: ['x', 'y', 'z'].includes(supplied.flip_axis) ? supplied.flip_axis : fallback.flip_axis,
        flip_offset: vec3(supplied.flip_offset || fallback.flip_offset, fallback.flip_offset),
        flipped: !!supplied.flipped
    };
}

function plainExportSettings(settings) {
    settings = createExportSettings(settings, DEFAULT_EXPORT_OPTIONS);
    return {
        obj_model: settings.obj_model,
        obj_flipped: settings.obj_flipped,
        obj_amt: settings.obj_amt,
        obj_mtl: settings.obj_mtl,
        exported_offset: settings.exported_offset.slice(),
        flip_axis: settings.flip_axis,
        flip_offset: settings.flip_offset.slice()
    };
}

function clonePlainObject(value) {
    try {
        return JSON.parse(JSON.stringify(value || {}));
    } catch (ignored) {
        return {};
    }
}

function ensureCollectionExportOptionsPersistence() {
    if (collectionExportOptionsPersistenceRegistered || typeof Collection === 'undefined') return;

    // Collection is a Blockbench model class, so registering a Property is the
    // clean path: it makes the custom options participate in project load/save.
    try {
        if (typeof Property === 'function') {
            new Property(Collection, 'object', COLLECTION_EXPORT_OPTIONS_KEY, {default: {}});
        }
    } catch (ignored) {
        // Older Blockbench builds may not expose object properties on Collection.
        // The save-copy patch below still preserves the field in saved projects
        // when the current Collection implementation keeps unknown fields.
    }

    const prototype = Collection?.prototype;
    if (prototype && !prototype.__ii_obj_export_options_persistence && typeof prototype.getSaveCopy === 'function') {
        const baseGetSaveCopy = prototype.getSaveCopy;
        prototype.getSaveCopy = function (...args) {
            const copy = baseGetSaveCopy.apply(this, args);
            if (this[COLLECTION_EXPORT_OPTIONS_KEY]) {
                copy[COLLECTION_EXPORT_OPTIONS_KEY] = clonePlainObject(this[COLLECTION_EXPORT_OPTIONS_KEY]);
            }
            return copy;
        };
        prototype.__ii_obj_export_options_persistence = true;
    }

    collectionExportOptionsPersistenceRegistered = true;
}

function getCollectionExportSettings(collection) {
    ensureCollectionExportOptionsPersistence();
    return createExportSettings(collection?.[COLLECTION_EXPORT_OPTIONS_KEY], DEFAULT_EXPORT_OPTIONS);
}

function normaliseExportSettings(options = {}) {
    const attachmentSettings = getCollectionExportSettings(options.attachment);
    return createExportSettings(options.export_settings || options, attachmentSettings);
}

function rememberCollectionExportSettings(collection, settings) {
    if (!collection) return;
    ensureCollectionExportOptionsPersistence();
    collection[COLLECTION_EXPORT_OPTIONS_KEY] = plainExportSettings(settings);
    if ('saved' in collection) collection.saved = false;
    if (typeof Project !== 'undefined' && Project && 'saved' in Project) Project.saved = false;
}

function getSelectedCollections() {
    if (Array.isArray(Collection?.selected) && Collection.selected.length) return Collection.selected;

    const selected = Collection?.all?.filter(collection => collection.selected);
    if (selected?.length) return selected;
    if (Collection?.selected instanceof Collection) return [Collection.selected];
    return [];
}


function getExportScale() {
    return Number(Settings.get('model_export_scale')) || 1;
}

function transformOBJVertex(vector, exportScale, settings) {
    vector.divideScalar(exportScale);
    if (settings.flipped) {
        vector[settings.flip_axis] = -vector[settings.flip_axis];
        addArrayToThree(vector, settings.flip_offset);
    }
    addArrayToThree(vector, settings.exported_offset);
    return vector;
}

function transformOBJNormal(normal, settings) {
    if (settings.flipped) normal[settings.flip_axis] = -normal[settings.flip_axis];
    return normal.normalize();
}

function transformAMTPosition(origin, exportScale, settings) {
    const vector = new THREE.Vector3().fromArray(vec3(origin));
    transformOBJVertex(vector, exportScale, settings);

    // OBJ vertices are centred by the exported offset, normally [0.5, 0, 0.5].
    // The .obj.amt file stores Blockbench/model-space origins, so this default
    // visual centring must be removed again. This preserves the legacy 8px X/Z
    // difference between geometry and AMT origins when model_export_scale is 16.
    addArrayToThree(vector, DEFAULT_EXPORTED_OFFSET.map(value => -value));
    vector.multiplyScalar(exportScale);
    return [roundObj(vector.x), roundObj(vector.y), roundObj(vector.z)];
}

function getSettingValue(id) {
    try {
        if (typeof Settings !== 'undefined' && typeof Settings.get === 'function') {
            const value = Settings.get(id);
            if (value !== undefined) return value;
        }
    } catch (ignored) {
        return undefined;
    }
    try {
        if (typeof settings !== 'undefined' && settings[id]) {
            return settings[id].value !== undefined ? settings[id].value : settings[id];
        }
    } catch (ignored) {
        return undefined;
    }
    return undefined;
}

function readNestedValue(root, path) {
    return path.split('.').reduce((value, key) => value && value[key], root);
}

function normaliseFaceModeValue(value) {
    if (value === undefined || value === null) return null;
    if (value === true) return 'triangles';
    if (value === false) return null;

    const text = String(value).toLowerCase();
    if (text.includes('tri')) return 'triangles';
    if (text.includes('quad')) return 'quads';
    return null;
}

function getConfiguredFaceMode() {
    const settingKeys = [
        'obj_export_mode',
        'obj_face_export_mode',
        'obj_face_export',
        'model_export_face_mode',
        'model_export_faces',
        'model_export_face_format',
        'mesh_export_face_mode',
        'mesh_face_export_mode'
    ];
    for (const key of settingKeys) {
        const mode = normaliseFaceModeValue(getSettingValue(key));
        if (mode) return mode;
    }

    const projectKeys = [
        'export_options.obj_face_export_mode',
        'export_options.obj_face_export',
        'export_options.face_mode',
        'export_settings.obj_face_export_mode',
        'settings.obj_face_export_mode',
        'obj_face_export_mode',
        'mesh_face_export_mode'
    ];
    for (const key of projectKeys) {
        const mode = normaliseFaceModeValue(readNestedValue(Project, key));
        if (mode) return mode;
    }

    // Preserve the historical II exporter behaviour when no Blockbench setting is exposed:
    // Mesh faces are emitted as quads, with triangular faces repeated back to their first vertex.
    return 'quads';
}

function getFaceVertexRuns(sortedVerts) {
    const verts = sortedVerts.slice();
    const mode = getConfiguredFaceMode();

    if (mode === 'triangles' && verts.length === 4) {
        return [
            [verts[0], verts[1], verts[2]],
            [verts[0], verts[2], verts[3]]
        ];
    }
    if (mode === 'quads' && verts.length === 3) {
        return [[verts[0], verts[1], verts[2], verts[0]]];
    }
    return [verts];
}

function getPathInfo(path) {
    const raw = String(path || Project.name || 'model');
    const slash = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
    return {
        dir: slash >= 0 ? raw.substring(0, slash + 1) : '',
        file: slash >= 0 ? raw.substring(slash + 1) : raw
    };
}

function stripObjExtension(file) {
    let result = String(file || 'model');
    let previous;
    do {
        previous = result;
        result = result
            .replace(/\.obj\.amt$/i, '')
            .replace(/\.obj\.ie$/i, '')
            .replace(/\.obj$/i, '')
            .replace(/\.ie$/i, '')
            .replace(/\.mtl$/i, '');
    } while (result !== previous);
    return result || 'model';
}

function getObjExtensionForPath(path, fallback = '.obj') {
    const value = String(path || '').toLowerCase();
    if (value.endsWith('.obj.ie')) return '.obj.ie';
    if (value.endsWith('.obj')) return '.obj';
    return fallback;
}

function ensureObjPath(path, extension = '.obj') {
    const info = getPathInfo(path || Project.name || 'model');
    return info.dir + stripObjExtension(info.file) + (extension === '.obj.ie' ? '.obj.ie' : '.obj');
}

function getMtlPathForObj(path) {
    const info = getPathInfo(path);
    return info.dir + stripObjExtension(info.file) + '.mtl';
}


function getAmtPathForObj(path) {
    const info = getPathInfo(path);
    return info.dir + stripObjExtension(info.file) + '.obj.amt';
}

function getFlippedObjPath(path) {
    const info = getPathInfo(path);
    const extension = getObjExtensionForPath(path, '.obj');
    let base = stripObjExtension(info.file);
    const lastBase = base.lastIndexOf('_base');
    base = lastBase >= 0
        ? base.substring(0, lastBase) + '_flipped' + base.substring(lastBase + '_base'.length)
        : base + '_flipped';
    return info.dir + base + extension;
}

function writeOBJSidecars(writerCodec, path, options = {}) {
    const settings = normaliseExportSettings(options);
    const attachment = options.attachment;

    if (settings.obj_mtl) writerCodec.write(compileMaterial(), getMtlPathForObj(path));
    if (settings.obj_amt) writerCodec.write(autoStringify(compileAMT({attachment, export_settings: settings})), getAmtPathForObj(path));
}

function writeOBJToPath(codec, path, options = {}) {
    const settings = normaliseExportSettings(options);
    const attachment = options.attachment;
    const extension = codec === objIECodec ? '.obj.ie' : '.obj';
    const exportPath = ensureObjPath(path, extension);
    const compileOptions = {attachment, export_settings: settings, mtl_name: stripObjExtension(getPathInfo(exportPath).file) + '.mtl'};

    if (settings.obj_model !== false) {
        codec.write(codec.compile(compileOptions), exportPath);
        if (settings.obj_flipped) {
            codec.write(codec.compile({
                attachment,
                export_settings: {...settings, flipped: true},
                mtl_name: stripObjExtension(getPathInfo(exportPath).file) + '.mtl'
            }), getFlippedObjPath(exportPath));
        }
    }

    writeOBJSidecars(codec, exportPath, {attachment, export_settings: settings});
    return exportPath;
}

function exportOBJWithDialog(codec, options = {}) {
    const settings = normaliseExportSettings(options);
    const extension = codec === objIECodec ? '.obj.ie' : '.obj';
    Blockbench.export({
        resource_id: codec.id,
        type: codec.name,
        extensions: [extension.replace(/^\./, '')],
        name: Project.name + extension,
        content: '',
        custom_writer(content, path) {
            const exportPath = writeOBJToPath(codec, path, {attachment: options.attachment, export_settings: settings});
            if (options.attachment && 'export_path' in options.attachment) options.attachment.export_path = exportPath;
        }
    });
}

function buildOBJOptionsForm(settings, includeMode = false) {
    const form = {};
    if (includeMode) {
        form.export_mode = {
            label: 'Export Format',
            type: 'select',
            options: {none: 'None', obj: 'Static OBJ Model', obj_ie: 'Dynamic OBJ Model'},
            value: exportOptions.export_mode
        };
        form.scale = {label: 'Scale', type: 'number', value: exportOptions.scale};
    }

    Object.assign(form, {
        obj_model: {label: 'Export model geometry file', type: 'checkbox', value: settings.obj_model !== false},
        exported_offset: {label: 'Exported Offset', type: 'vector', value: settings.exported_offset},
        obj_amt: {label: 'Export .obj.amt properties', type: 'checkbox', value: settings.obj_amt},
        obj_mtl: {label: 'Export .mtl file', type: 'checkbox', value: settings.obj_mtl},
        obj_flipped: {label: 'Export flipped variant', type: 'checkbox', value: !!settings.obj_flipped},
        flip_axis: {
            label: 'Flipped Axis',
            type: 'select',
            options: {x: 'X Axis', y: 'Y Axis', z: 'Z Axis'},
            value: settings.flip_axis || 'x',
            condition: result => result.obj_flipped
        },
        flip_offset: {
            label: 'Flipped Offset',
            type: 'vector',
            value: settings.flip_offset || [0, 0, 0],
            condition: result => result.obj_flipped
        }
    });
    return form;
}

function openCollectionOBJOptionsDialog(collections = getSelectedCollections()) {
    if (!collections.length) {
        Blockbench.showQuickMessage('Select a collection first', 'error');
        return;
    }

    const dialog = new Dialog({
        id: 'ii_collection_obj_export_options',
        title: collections.length === 1 ? 'II OBJ Export Options' : `II OBJ Export Options (${collections.length} collections)`,
        form: buildOBJOptionsForm(getCollectionExportSettings(collections[0])),
        onConfirm(result) {
            collections.forEach(collection => rememberCollectionExportSettings(collection, result));
            dialog.hide();
            Blockbench.showQuickMessage('II OBJ export options updated');
        }
    });
    dialog.show();
}

export var exportAMTModel = new Action('export_amt_model', {
    name: 'Export AMT Model',
    description: 'Export an AMT Model',
    icon: 'icon-objects',
    click: function () {
        const dialog = new Dialog({
            id: 'animation_export',
            title: 'Export AMT Model',
            form: buildOBJOptionsForm(normaliseExportSettings(exportOptions), true),
            onConfirm(form_result) {
                exportOptions = Object.assign({}, exportOptions, form_result, {
                    offset: form_result.exported_offset,
                    exported_offset: form_result.exported_offset
                });
                dialog.hide();

                const settings = normaliseExportSettings(exportOptions);
                switch (form_result.export_mode) {
                    case 'obj':
                        exportOBJWithDialog(objCodec, {export_settings: settings});
                        break;
                    case 'obj_ie':
                        exportOBJWithDialog(objIECodec, {export_settings: settings});
                        break;
                }
            }
        });
        dialog.show();
    }
});

export var exportOBJStaticAction = new Action('export_obj_static', {
    name: 'Export Static OBJ',
    description: 'Export a static OBJ model using II Toolkit',
    icon: 'icon-gltf',
    category: 'file',
    condition: {modes: ['edit'], method: () => Format?.meshes},
    click: function () {
        exportOBJWithDialog(objCodec);
    }
});

export var exportOBJDynamicAction = new Action('export_obj_dynamic', {
    name: 'Export Dynamic OBJ',
    description: 'Export a dynamic OBJ model using II Toolkit',
    icon: 'icon-gltf',
    category: 'file',
    condition: {modes: ['edit'], method: () => Format?.meshes},
    click: function () {
        exportOBJWithDialog(objIECodec);
    }
});

export var configureOBJCollectionExportAction = new Action('configure_ii_obj_collection_export', {
    name: 'II OBJ Export Options',
    description: 'Configure II OBJ geometry, sidecar, offset, and flipped export settings for the selected collection',
    icon: 'settings',
    category: 'edit',
    condition: () => !!getSelectedCollections()[0],
    click: function () {
        openCollectionOBJOptionsDialog();
    }
});

let collectionMenuRegistered = false;

export function registerOBJExporterCollectionMenu() {
    ensureCollectionExportOptionsPersistence();
    if (collectionMenuRegistered) return;
    const collectionMenu = Collection?.prototype?.menu;
    if (collectionMenu && typeof collectionMenu.addAction === 'function') {
        collectionMenu.addAction(configureOBJCollectionExportAction);
        collectionMenuRegistered = true;
    }
}

function createOBJCodec(id, name, extension, action) {
    return new Codec(id, {
        name,
        support_partial_export: true,
        extension,
        remember: false,
        export_action: action,
        compile(options) {
            return compileModel(options);
        },
        async exportCollection(collection) {
            this.context = collection;
            try {
                exportOBJWithDialog(this, {attachment: collection});
                if ('saved' in collection) collection.saved = true;
            } finally {
                this.context = null;
            }
        },
        async writeCollection(collection) {
            this.context = collection;
            try {
                const exportPath = writeOBJToPath(this, collection.export_path, {attachment: collection});
                collection.export_path = exportPath;
                if ('saved' in collection) collection.saved = true;
            } finally {
                this.context = null;
            }
        }
    });
}

export var objCodec = createOBJCodec('ii_obj', 'II Static OBJ', 'obj', exportOBJStaticAction);
export var objIECodec = createOBJCodec('ii_obj_ie', 'II Dynamic OBJ', 'obj.ie', exportOBJDynamicAction);
export var mtlCodec = new Codec('mtl', {
    name: 'II MTL',
    extension: 'mtl',
    remember: false,
    compile: compileMaterial
});

//-- AMT sidecar --//

function getExportOutlinerElements(options = {}) {
    const attachment = options && options.attachment;
    return attachment ? attachment.getAllChildren() : Outliner.elements;
}

function addUniqueElement(list, element) {
    if (element && !list.includes(element)) list.push(element);
}

function getExportGroups(options = {}) {
    const attachment = options && options.attachment;
    if (!attachment) return Project.groups;

    const groups = [];
    const children = attachment.getAllChildren ? attachment.getAllChildren() : [];
    children.forEach(child => {
        if (child instanceof Group) addUniqueElement(groups, child);
        let parent = child?.parent;
        while (parent && parent !== 'root') {
            if (parent instanceof Group) addUniqueElement(groups, parent);
            parent = parent.parent;
        }
    });
    return groups;
}

function getExportTrackHierarchyElements(options = {}) {
    const elements = [];
    getExportOutlinerElements(options).forEach(element => {
        if (!element) return;
        if (element.type === 'track_suspender' || element.type === 'track_wheel') addUniqueElement(elements, element);
        if (element.type === 'track' && typeof element.forEachChild === 'function') {
            element.forEachChild(child => {
                if (child?.type === 'track_suspender' || child?.type === 'track_wheel') addUniqueElement(elements, child);
            });
        }
    });
    return elements;
}

function getElementAMTOrigin(element) {
    if (!element) return [0, 0, 0];
    if (element.type === 'hans') return element.position || [0, 0, 0];
    if (element.type === 'hans_part') return element.origin || [0, 0, 0];
    return element.position || element.origin || [0, 0, 0];
}

function getElementSceneObject(element) {
    return element?.scene_object || element?.mesh || null;
}

function transformLocalOriginThroughParent(element, localOrigin) {
    const parentObject = getElementSceneObject(element?.parent);
    if (parentObject) {
        parentObject.updateMatrixWorld(true);
        const vector = new THREE.Vector3().fromArray(vec3(localOrigin));
        vector.applyMatrix4(parentObject.matrixWorld);
        return [vector.x, vector.y, vector.z];
    }

    if (typeof element?.parent === 'object') {
        return addVec3(getAbsoluteElementAMTOrigin(element.parent), localOrigin);
    }
    return vec3(localOrigin);
}

function getAbsoluteTrackChildAMTOrigin(element) {
    // Track wheels/suspenders store their editable origin in parent-local space.
    // For path properties that is wanted, but AMT origins historically use the
    // absolute model-space point. Do not use the wheel preview object's world
    // position here: it includes live compression/rotation animation state.
    return transformLocalOriginThroughParent(element, element?.origin || [0, 0, 0]);
}

function getAbsoluteElementAMTOrigin(element) {
    if (!element) return [0, 0, 0];
    if (element.type === 'track_suspender' || element.type === 'track_wheel') {
        return getAbsoluteTrackChildAMTOrigin(element);
    }
    return getElementAMTOrigin(element);
}

function addAMTElement(element, origins, hierarchy, exportScale, settings, origin = getAbsoluteElementAMTOrigin(element)) {
    if (!element?.name) return;
    origins[element.name] = transformAMTPosition(origin, exportScale, settings);
    if (typeof element.parent === 'object') hierarchy[element.name] = element.parent.name;
}

function getElementChildrenOfType(element, type) {
    return (element?.children || []).filter(child => child?.type === type);
}

function stripModelExtension(value) {
    return String(value || '').replace(/\.[a-z0-9]+$/i, '');
}

function mapBulletCoreType(value) {
    const key = String(value || '').toLowerCase();
    const map = {
        core_softpoint: 'SOFTPOINT',
        core_shaped: 'SHAPED',
        core_shaped_sabot: 'SHAPED_SABOT',
        core_piercing: 'PIERCING',
        core_piercing_sabot: 'PIERCING_SABOT',
        core_canister: 'CANISTER',
        core_cluster: 'CLUSTER'
    };
    return map[key] || stripModelExtension(key).replace(/^core_/, '').toUpperCase();
}

function compileBulletProperties(element) {
    const props = {
        ammoType: stripModelExtension(element.bulletType),
        state: element.showCasing && element.coreType ? 'BULLET_UNUSED' : element.showCasing ? 'CASING' : element.coreType ? 'CORE' : 'BULLET_UNUSED'
    };
    if (element.coreType) {
        props.core = String(element.coreType).replace(/^core_/, '');
        props.coreType = mapBulletCoreType(element.coreType);
    }
    if (Array.isArray(element.rotation) && element.rotation.some(value => Number(value) !== 0)) props.base_rotation = vec3(element.rotation).map(value => roundObj(value));
    return props;
}

function compileFluidProperties(element) {
    const layers = getElementChildrenOfType(element, 'fluid_node')
        .filter(layer => layer.visibility !== false)
        .sort((a, b) => (Number(a.origin?.[1]) || 0) - (Number(b.origin?.[1]) || 0));
    if (layers.length < 2) return null;

    const props = {
        level: Math.clamp(Number(element.fillLevel) || 0, 0, 1),
        flowing: element.kind === 'flowing',
        layers: layers.map(layer => [
            roundObj(Number(layer.origin?.[1]) || 0),
            roundObj(Number(layer.origin?.[0]) || 0),
            roundObj(Number(layer.origin?.[2]) || 0),
            roundObj(Number(layer.sizeX) || 0),
            roundObj(Number(layer.sizeZ) || 0)
        ])
    };
    if (element.fluid) props.fluid = element.fluid;
    return props;
}

function compileWireProperties(element, exportScale, settings) {
    const nodes = getElementChildrenOfType(element, 'wire_node').filter(node => node.visibility !== false);
    if (nodes.length < 2) return null;

    const parentOrigin = element.position || [0, 0, 0];
    return {
        start: transformAMTPosition(addVec3(parentOrigin, nodes[0].origin), exportScale, settings),
        end: transformAMTPosition(addVec3(parentOrigin, nodes[1].origin), exportScale, settings),
        wire_type: element.wireType || 'copper',
        diameter: Number(element.diameter) || 0.0625,
        slack: Number(element.slack) || 1.02
    };
}

function getTrackPathElements(track) {
    if (track && typeof track.getPathNodes === 'function') return track.getPathNodes();
    return (track?.children || []).filter(child => {
        if (!child?.visibility) return false;
        if (child.type === 'track_node' || child.type === 'track_wheel') return true;
        if (child.type === 'track_suspender') return !!getElementChildrenOfType(child, 'track_wheel').find(wheel => wheel.visibility !== false);
        return false;
    });
}

function getTrackPositionArray(track, origin) {
    origin = vec3(origin);
    const direction = track?.trackDirection || 'z';
    return [
        roundObj(direction === 'x' ? origin[0] : origin[2]),
        roundObj(origin[1])
    ];
}

function getSuspenderWheel(suspender) {
    if (!suspender) return null;
    if (typeof suspender.getWheel === 'function') return suspender.getWheel();
    return getElementChildrenOfType(suspender, 'track_wheel')[0] || null;
}

function compileTrackWheelProperty(track, node, wheel = node) {
    const origin = node === wheel ? wheel.origin : addVec3(node.origin, wheel.origin);
    return {
        type: 'wheel',
        name: wheel.name || node.name || 'wheel',
        position: getTrackPositionArray(track, origin),
        radius: roundObj(Number(wheel.radius) || 0),
        max_compression: roundObj(Number(node.maxCompression) || 0)
    };
}

function compileTrackNodeProperty(track, node) {
    if (node.type === 'track_node') {
        const rotation = node.rotation || [0, 0, 0];
        return {
            type: 'link',
            name: node.name || 'link',
            position: getTrackPositionArray(track, node.origin),
            direction: roundObj(((track?.trackDirection || 'z') === 'x' ? rotation[2] : rotation[0]) || 0)
        };
    }
    if (node.type === 'track_suspender') {
        const wheel = getSuspenderWheel(node);
        return wheel ? compileTrackWheelProperty(track, node, wheel) : null;
    }
    return node.type === 'track_wheel' ? compileTrackWheelProperty(track, node) : null;
}

function compileTrackProperties(element) {
    const nodes = getTrackPathElements(element).map(node => compileTrackNodeProperty(element, node)).filter(Boolean);
    if (nodes.length < 2) return null;
    return {
        segment_model: stripModelExtension(element.segmentModel || ''),
        track_direction: element.trackDirection || 'z',
        axis_direction: element.axisDirection || 'positive',
        nodes
    };
}

function compileSpecialAMTProperties(element, exportScale, settings) {
    if (!element || element.export === false || element.visibility === false) return null;
    switch (element.type) {
        case 'wire': return compileWireProperties(element, exportScale, settings);
        case 'fluid': return compileFluidProperties(element);
        case 'bullet': return compileBulletProperties(element);
        case 'track': return compileTrackProperties(element);
        case 'ii_text': return getTextElementProperties(element);
        case 'hand': return getHandElementProperties(element);
        case 'banner': return getBannerElementProperties(element);
        case 'item': return getItemElementProperties(element);
        default: return null;
    }
}

function compileAMT(options = {}) {
    const settings = normaliseExportSettings(options);
    const exportScale = getExportScale();
    const amtFile = {origins: {}, hierarchy: {}};
    const properties = {};

    getExportGroups(options).forEach(group => addAMTElement(group, amtFile.origins, amtFile.hierarchy, exportScale, settings, group.origin));
    getExportOutlinerElements(options).forEach(element => {
        if (!element) return;
        if (element instanceof Locator || element.type === 'hans' || element.type === 'hans_part' || SPECIAL_AMT_TYPES.includes(element.type)) {
            addAMTElement(element, amtFile.origins, amtFile.hierarchy, exportScale, settings);
        }
    });
    getExportTrackHierarchyElements(options).forEach(element => addAMTElement(element, amtFile.origins, amtFile.hierarchy, exportScale, settings));
    getExportOutlinerElements(options).forEach(element => {
        const props = compileSpecialAMTProperties(element, exportScale, settings);
        if (props && Object.keys(props).length) properties[element.name] = props;
    });

    if (Object.keys(properties).length) amtFile.properties = properties;
    return amtFile;
}

//-- OBJ geometry --//


function appendPipeObj(compiled, pipe, exportScale, settings, startVertex, startUv, startNormal) {
    const counts = {vertices: 0, uvs: 0, normals: 0};
    if (!pipe.mesh || pipe.visibility === false) return counts;

    pipe.mesh.updateMatrixWorld(true);
    const meshes = collectVisibleMeshes(pipe.mesh.getObjectByName('pipe_assembly'));
    if (!meshes.length) {
        compiled.push(`# Pipe "${pipe.name}" skipped: preview geometry is not ready`);
        return counts;
    }

    compiled.push(`o ${safeObjName(pipe.name, 'pipe')}`);
    let currentMaterial = null;
    meshes.forEach(sourceMesh => {
        const result = appendThreeMeshObj(compiled, sourceMesh, exportScale, settings, startVertex + counts.vertices, startUv + counts.uvs, startNormal + counts.normals, currentMaterial);
        currentMaterial = result.currentMaterial;
        counts.vertices += result.vertices;
        counts.uvs += result.uvs;
        counts.normals += result.normals;
    });
    return counts;
}

function appendNativeMeshObj(compiled, element, mesh, textureNames, exportScale, settings, indices) {
    const vertex = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const normalMatrixWorld = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const smoothVertexNormals = element.shading === 'smooth' ? element.calculateNormals() : null;
    const vertexKeys = [];
    const vertexIndexMap = new Map();
    const vertexNormalMap = new Map();
    const out = {vertices: [], uvs: [], normals: [], faces: []};
    const counts = {vertices: 0, uvs: 0, normals: 0};

    Object.keys(element.vertices).forEach((vkey, localIndex) => {
        const coords = element.vertices[vkey];
        vertex.set(coords[0], coords[1], coords[2]);
        vertex.applyMatrix4(mesh.matrixWorld);
        transformOBJVertex(vertex, exportScale, settings);
        out.vertices.push(`v ${roundObj(vertex.x)} ${roundObj(vertex.y)} ${roundObj(vertex.z)}`);
        vertexKeys.push(vkey);
        vertexIndexMap.set(vkey, localIndex);
        counts.vertices++;

        if (smoothVertexNormals) {
            normal.fromArray(smoothVertexNormals[vkey]);
            normal.applyMatrix3(normalMatrixWorld);
            transformOBJNormal(normal, settings);
            vertexNormalMap.set(vkey, out.normals.length);
            out.normals.push(`vn ${roundObj(normal.x, NORMAL_ROUND)} ${roundObj(normal.y, NORMAL_ROUND)} ${roundObj(normal.z, NORMAL_ROUND)}`);
            counts.normals++;
        }
    });

    let currentMaterial = null;
    Object.keys(element.faces).map(key => element.faces[key]).forEach(face => {
        if (face.texture === null || face.vertices.length < 3) return;

        const texture = face.getTexture();
        const uvSize = [Project.getUVWidth(texture), Project.getUVHeight(texture)];
        const sortedVerts = face.getSortedVertices();
        const firstFaceUvIndex = out.uvs.length;

        sortedVerts.forEach(vkey => {
            const u = Math.clamp(face.uv[vkey][0] / uvSize[0], 0, 1);
            const v = Math.clamp(1 - face.uv[vkey][1] / uvSize[1], 0, 1);
            out.uvs.push(`vt ${roundObj(u)} ${roundObj(v)}`);
            counts.uvs++;
        });

        let normalIndex = -1;
        if (element.shading === 'flat') {
            normal.fromArray(face.getNormal(true));
            normal.applyMatrix3(normalMatrixWorld);
            transformOBJNormal(normal, settings);
            normalIndex = out.normals.length;
            out.normals.push(`vn ${roundObj(normal.x, NORMAL_ROUND)} ${roundObj(normal.y, NORMAL_ROUND)} ${roundObj(normal.z, NORMAL_ROUND)}`);
            counts.normals++;
        }

        const material = textureNames[texture.uuid];
        if (material !== currentMaterial) {
            currentMaterial = material;
            out.faces.push(`usemtl ${currentMaterial}`);
        }

        getFaceVertexRuns(sortedVerts).forEach(run => {
            const verts = settings.flipped ? run.slice().reverse() : run;
            out.faces.push('f ' + verts.map(vkey => {
                const vertexIndex = indices.vertices + vertexIndexMap.get(vkey) + 1;
                const uvIndex = indices.uvs + firstFaceUvIndex + sortedVerts.indexOf(vkey) + 1;
                const nIndex = indices.normals + (element.shading === 'smooth' ? vertexNormalMap.get(vkey) : normalIndex) + 1;
                return `${vertexIndex}/${uvIndex}/${nIndex}`;
            }).join(' '));
        });
    });

    compiled.push(`o ${element.name || 'mesh'}`);
    compiled.push(...out.vertices, ...out.uvs, ...out.normals, ...out.faces);
    return counts;
}

function compileModel(options = {}) {
    const settings = normaliseExportSettings(options);
    const exportElements = [...new Set(getExportOutlinerElements(options).map(element => element?.name).filter(Boolean))];
    const exportScale = getExportScale();
    const textureNames = [];
    Texture.all.forEach(texture => textureNames[texture.uuid] = texture.name.replace(/\.png$/i, '').toLowerCase());
    const compiled = [
        '# ' + Settings.get('credit'),
        '# Exported with IIToolkit Plugin on ' + new Date().toLocaleDateString(),
        `mtllib ${options.mtl_name || Project.name + '.mtl'}\n`
    ];
    const indices = {vertices: 0, uvs: 0, normals: 0};
    const oldScenePos = new THREE.Vector3().copy(scene.position);
    scene.position.set(0, 0, 0);

    getExportOutlinerElements(options).forEach(element => {
        if (element instanceof Pipe && element.export !== false && exportElements.includes(element.name)) {
            const counts = appendPipeObj(compiled, element, exportScale, settings, indices.vertices, indices.uvs, indices.normals);
            indices.vertices += counts.vertices;
            indices.uvs += counts.uvs;
            indices.normals += counts.normals;
        }
    });

    scene.traverse(mesh => {
        if (!(mesh instanceof THREE.Mesh)) return;
        const element = OutlinerNode.uuids[mesh.name];
        if (!(element instanceof Mesh) || !element.faces || element.export === false || !exportElements.includes(element.name)) return;

        const counts = appendNativeMeshObj(compiled, element, mesh, textureNames, exportScale, settings, indices);
        indices.vertices += counts.vertices;
        indices.uvs += counts.uvs;
        indices.normals += counts.normals;
    });

    scene.position.copy(oldScenePos);
    return compiled.join('\n');
}

function appendThreeMeshObj(compiled, sourceMesh, exportScale, settings, indexVertex, indexVertexUvs, indexNormals, currentMaterial) {
    let geometry = sourceMesh.geometry;
    if (!geometry || !geometry.attributes || !geometry.attributes.position) return {vertices: 0, uvs: 0, normals: 0, currentMaterial};

    if (!geometry.attributes.normal) {
        geometry = geometry.clone();
        geometry.computeVertexNormals();
    }

    const positionAttr = geometry.attributes.position;
    const uvAttr = geometry.attributes.uv;
    const normalAttr = geometry.attributes.normal;
    const vertex = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const uv = new THREE.Vector2();
    const normalMatrixWorld = new THREE.Matrix3().getNormalMatrix(sourceMesh.matrixWorld);

    for (let i = 0; i < positionAttr.count; i++) {
        vertex.fromBufferAttribute(positionAttr, i);
        vertex.applyMatrix4(sourceMesh.matrixWorld);
        transformOBJVertex(vertex, exportScale, settings);
        compiled.push(`v ${roundObj(vertex.x)} ${roundObj(vertex.y)} ${roundObj(vertex.z)}`);
    }

    if (uvAttr) {
        for (let i = 0; i < uvAttr.count; i++) {
            uv.fromBufferAttribute(uvAttr, i);
            compiled.push(`vt ${roundObj(uv.x)} ${roundObj(uv.y)}`);
        }
    }

    if (normalAttr) {
        for (let i = 0; i < normalAttr.count; i++) {
            normal.fromBufferAttribute(normalAttr, i);
            normal.applyMatrix3(normalMatrixWorld);
            transformOBJNormal(normal, settings);
            compiled.push(`vn ${roundObj(normal.x)} ${roundObj(normal.y)} ${roundObj(normal.z)}`);
        }
    }

    const material = Array.isArray(sourceMesh.material) ? sourceMesh.material[0] : sourceMesh.material;
    const rawMaterialName = material?.name || material?.map?.name || material?.map?.image?.src || 'pipe';
    const materialName = material ? safeObjName(String(rawMaterialName).replace(/\.[a-z0-9]+$/i, '').toLowerCase(), 'pipe') : null;
    if (materialName && materialName !== currentMaterial) {
        currentMaterial = materialName;
        compiled.push(`usemtl ${currentMaterial}`);
    }

    const indices = geometry.index && geometry.index.array
        ? Array.from(geometry.index.array)
        : Array.from({length: positionAttr.count}, (_, index) => index);
    for (let i = 0; i + 2 < indices.length; i += 3) {
        const faceIndices = settings.flipped ? [indices[i], indices[i + 2], indices[i + 1]] : [indices[i], indices[i + 1], indices[i + 2]];
        compiled.push('f ' + faceIndices.map(vertexIndex => {
            const v = indexVertex + vertexIndex + 1;
            const vt = uvAttr ? indexVertexUvs + vertexIndex + 1 : null;
            const vn = normalAttr ? indexNormals + vertexIndex + 1 : null;
            if (vt !== null && vn !== null) return `${v}/${vt}/${vn}`;
            if (vt !== null) return `${v}/${vt}`;
            if (vn !== null) return `${v}//${vn}`;
            return `${v}`;
        }).join(' '));
    }

    return {
        vertices: positionAttr.count,
        uvs: uvAttr ? uvAttr.count : 0,
        normals: normalAttr ? normalAttr.count : 0,
        currentMaterial
    };
}



function compileMaterial() {
    const compiled = ['# ' + Settings.get('credit'), ''];
    for (const texture of Texture.all) {
        const name = String(texture.name).replace('.png', '').toLowerCase();
        compiled.push('newmtl ' + name);
        compiled.push('map_Kd ' + getResourceLocation(texture.path.toLowerCase()));
    }
    return compiled.join('\n');
}
