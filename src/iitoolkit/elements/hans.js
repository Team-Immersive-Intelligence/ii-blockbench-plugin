import {
    attachPreviewObject,
    createPreviewObject3D,
    makeChildlessCopy,
    makeSaveCopy,
    mergeElementProperties,
    resetElementProperties,
    setPreviewVisibility
} from './common';
import { createIIPreviewMaterial, loadIIGLBModel, normalizeIIPreviewTexture } from '../utils';

const HANS_ASSET_BASE = 'https://assets.iiteam.net/model/hans/';
const SKIN_SIZE = 64;

let deletables = [];
let registered = false;
let addHansAction, rebuildHansAction;

const textureCache = new Map();
const presetModelCache = new Map();

const HANS_PRESETS = {
    default: {
        name: 'Default',
        texture: 'hans.png',
        model: null
    },
    pilot: {
        name: 'Aircraft Pilot',
        texture: 'pilot.png',
        model: 'hat_radio_black.glb'
    },
    vehicle_crewman1: {
        name: 'Vehicle Crewman (Radio Headset)',
        texture: 'crewman.png',
        model: 'hat_radio_black.glb'
    },
    vehicle_crewman2: {
        name: 'Vehicle Crewman',
        texture: 'crewman.png',
        model: 'hat_black.glb'
    },
    officer: {
        name: 'Officer',
        texture: 'officer.png',
        model: 'hat_officer.glb'
    },
    trooper1: {
        name: 'Trooper (Helmet)',
        texture: 'hans.png',
        model: 'helmet.glb'
    },
    trooper2: {
        name: 'Trooper (Field Hat with Headset)',
        texture: 'hans.png',
        model: 'hat_radio_blue.glb'
    },
    trooper3: {
        name: 'Trooper (Field Hat)',
        texture: 'hans.png',
        model: 'hat_blue.glb'
    },
    radioman: {
        name: 'Radio Operator',
        texture: 'hans.png',
        model: 'radio_backpack.glb'
    }
};

const PART_ORDER = ['body', 'head', 'left_arm', 'right_arm', 'right_leg', 'left_leg'];
const CHILDREN_OF_BODY = ['head', 'left_arm', 'right_arm'];

const PART_DEFS = {
    body: {
        title: 'Hans Body',
        suffix: 'body',
        icon: 'accessibility_new',
        // Origin is the pivot/reference offset. Position is additive transform.
        origin: [0, 12, 0],
        position: [0, 0, 0],
        size: [8, 12, 4],
        offset: [0, 6, 0],
        uv: {
            front: [20, 20, 28, 32],
            back: [32, 20, 40, 32],
            right: [16, 20, 20, 32],
            left: [28, 20, 32, 32],
            top: [20, 16, 28, 20],
            bottom: [28, 16, 36, 20]
        }
    },
    head: {
        title: 'Hans Head',
        suffix: 'head',
        icon: 'face',
        origin: [0, 12, 0],
        position: [0, 0, 0],
        size: [8, 8, 8],
        offset: [0, 4, 0],
        uv: {
            front: [8, 8, 16, 16],
            back: [24, 8, 32, 16],
            right: [0, 8, 8, 16],
            left: [16, 8, 24, 16],
            top: [8, 0, 16, 8],
            bottom: [16, 0, 24, 8]
        }
    },
    left_arm: {
        title: 'Hans Left Arm',
        suffix: 'left_arm',
        icon: 'pan_tool',
        origin: [6, 12, 0],
        position: [0, 0, 0],
        size: [4, 12, 4],
        offset: [0, -6, 0],
        uv: {
            front: [36, 52, 40, 64],
            back: [44, 52, 48, 64],
            right: [32, 52, 36, 64],
            left: [40, 52, 44, 64],
            top: [36, 48, 40, 52],
            bottom: [40, 48, 44, 52]
        }
    },
    right_arm: {
        title: 'Hans Right Arm',
        suffix: 'right_arm',
        icon: 'pan_tool',
        origin: [-6, 12, 0],
        position: [0, 0, 0],
        size: [4, 12, 4],
        offset: [0, -6, 0],
        uv: {
            front: [44, 20, 48, 32],
            back: [52, 20, 56, 32],
            right: [40, 20, 44, 32],
            left: [48, 20, 52, 32],
            top: [44, 16, 48, 20],
            bottom: [48, 16, 52, 20]
        }
    },
    left_leg: {
        title: 'Hans Left Leg',
        suffix: 'left_leg',
        icon: 'directions_walk',
        origin: [2, 12, 0],
        position: [0, 0, 0],
        size: [4, 12, 4],
        offset: [0, -6, 0],
        uv: {
            front: [20, 52, 24, 64],
            back: [28, 52, 32, 64],
            right: [16, 52, 20, 64],
            left: [24, 52, 28, 64],
            top: [20, 48, 24, 52],
            bottom: [24, 48, 28, 52]
        }
    },
    right_leg: {
        title: 'Hans Right Leg',
        suffix: 'right_leg',
        icon: 'directions_walk',
        origin: [-2, 12, 0],
        position: [0, 0, 0],
        size: [4, 12, 4],
        offset: [0, -6, 0],
        uv: {
            front: [4, 20, 8, 32],
            back: [12, 20, 16, 32],
            right: [0, 20, 4, 32],
            left: [8, 20, 12, 32],
            top: [4, 16, 8, 20],
            bottom: [8, 16, 12, 20]
        }
    }
};

const PART_OVERLAY_UVS = {
    body: {
        front: [20, 36, 28, 48],
        back: [32, 36, 40, 48],
        right: [16, 36, 20, 48],
        left: [28, 36, 32, 48],
        top: [20, 32, 28, 36],
        bottom: [28, 32, 36, 36]
    },
    head: {
        front: [40, 8, 48, 16],
        back: [56, 8, 64, 16],
        right: [32, 8, 40, 16],
        left: [48, 8, 56, 16],
        top: [40, 0, 48, 8],
        bottom: [48, 0, 56, 8]
    },
    left_arm: {
        front: [52, 52, 56, 64],
        back: [60, 52, 64, 64],
        right: [48, 52, 52, 64],
        left: [56, 52, 60, 64],
        top: [52, 48, 56, 52],
        bottom: [56, 48, 60, 52]
    },
    right_arm: {
        front: [44, 36, 48, 48],
        back: [52, 36, 56, 48],
        right: [40, 36, 44, 48],
        left: [48, 36, 52, 48],
        top: [44, 32, 48, 36],
        bottom: [48, 32, 52, 36]
    },
    left_leg: {
        front: [4, 52, 8, 64],
        back: [12, 52, 16, 64],
        right: [0, 52, 4, 64],
        left: [8, 52, 12, 64],
        top: [4, 48, 8, 52],
        bottom: [8, 48, 12, 52]
    },
    right_leg: {
        front: [4, 36, 8, 48],
        back: [12, 36, 16, 48],
        right: [0, 36, 4, 48],
        left: [8, 36, 12, 48],
        top: [4, 32, 8, 36],
        bottom: [8, 32, 12, 36]
    }
};

function getPreset(key) {
    return HANS_PRESETS[key] || HANS_PRESETS.default;
}

function getPresetOptions() {
    const options = {};
    Object.keys(HANS_PRESETS).forEach(key => options[key] = HANS_PRESETS[key].name);
    return options;
}

function getPartDef(kind) {
    return PART_DEFS[kind] || PART_DEFS.body;
}

function getOverlayUv(kind) {
    return PART_OVERLAY_UVS[kind] || null;
}

function getOverlayInflation(kind) {
    return kind === 'head' ? 0.5 : 0.25;
}

function cloneArray(value) {
    return Array.isArray(value) ? value.slice() : value;
}

function vec3Sum(a, b) {
    return [
        (a?.[0] || 0) + (b?.[0] || 0),
        (a?.[1] || 0) + (b?.[1] || 0),
        (a?.[2] || 0) + (b?.[2] || 0)
    ];
}

function normalisePartName(value) {
    return String(value || '')
        .replace(/^.*[:/\\]/, '')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[\s-]+/g, '_')
        .toLowerCase();
}


function getPartKindFromModelName(value) {
    const key = normalisePartName(value);
    if (PART_DEFS[key]) return key;

    // Accept names such as "hans_body", "pilot_left_arm", or Blender-exported
    // object names that keep a prefix. Check longer names first to avoid matching
    // "arm"-like suffixes incorrectly.
    return PART_ORDER
        .slice()
        .sort((a, b) => b.length - a.length)
        .find(kind => key.endsWith('_' + kind)) || null;
}

function uvCorner(x, y) {
    // The internal THREE texture is used without flipY, so skin-space V can be used directly.
    // Previous code inverted this value, which made the Minecraft skin appear upside-down.
    return [x / SKIN_SIZE, y / SKIN_SIZE];
}

function pushQuad(vertices, normals, uvs, indices, corners, normal, rect) {
    const start = vertices.length / 3;
    const [x1, y1, x2, y2] = rect;
    const quadUvs = [
        uvCorner(x1, y2),
        uvCorner(x2, y2),
        uvCorner(x2, y1),
        uvCorner(x1, y1)
    ];

    corners.forEach((corner, index) => {
        vertices.push(corner[0], corner[1], corner[2]);
        normals.push(normal[0], normal[1], normal[2]);
        uvs.push(quadUvs[index][0], quadUvs[index][1]);
    });
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function createTexturedBoxGeometry(size, offset, uv, inflate = 0) {
    const hw = size[0] / 2 + inflate;
    const hh = size[1] / 2 + inflate;
    const hd = size[2] / 2 + inflate;
    const ox = offset[0];
    const oy = offset[1];
    const oz = offset[2];

    const x0 = ox - hw, x1 = ox + hw;
    const y0 = oy - hh, y1 = oy + hh;
    const z0 = oz - hd, z1 = oz + hd;

    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    // Preview convention: local +Z is the Minecraft skin front.
    // The old mapping assigned front/back to the opposite Z faces.
    pushQuad(vertices, normals, uvs, indices, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], uv.back);
    pushQuad(vertices, normals, uvs, indices, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], uv.front);
    pushQuad(vertices, normals, uvs, indices, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], uv.right);
    pushQuad(vertices, normals, uvs, indices, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], uv.left);
    pushQuad(vertices, normals, uvs, indices, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], uv.top);
    pushQuad(vertices, normals, uvs, indices, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], uv.bottom);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

function loadPresetTexture(presetKey) {
    const preset = getPreset(presetKey);
    const cacheKey = preset.texture;
    if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);

    const promise = new Promise(resolve => {
        new THREE.TextureLoader().load(HANS_ASSET_BASE + preset.texture, texture => {
            resolve(applyHansTextureSettings(texture));
        }, undefined, error => {
            console.warn(`Failed to load Hans skin "${preset.texture}":`, error);
            if (presetKey !== 'default') {
                textureCache.delete(cacheKey);
                resolve(loadPresetTexture('default'));
            } else {
                resolve(null);
            }
        });
    });

    textureCache.set(cacheKey, promise);
    return promise;
}

function applyHansTextureSettings(texture) {
    return normalizeIIPreviewTexture(texture);
}

function preparePresetTexture(texture) {
    return applyHansTextureSettings(texture);
}

function makeHansPreviewMaterial(options = {}) {
    return createIIPreviewMaterial({}, {
        name: options.name || 'hans_preview_material',
        map: options.map || null,
        color: options.color || new THREE.Color(0xffffff),
        transparent: !!options.transparent,
        opacity: options.opacity !== undefined ? options.opacity : 1,
        alphaTest: options.alphaTest || 0,
        side: options.side !== undefined ? options.side : THREE.FrontSide,
        noExport: true
    });
}

function preparePresetModel(model) {
    if (!model) return model;
    model.traverse(node => {
        node.no_export = true;
        if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
        }
    });
    return model;
}

function extractPresetParts(model) {
    const parts = {};
    model.traverse(node => {
        const key = getPartKindFromModelName(node.name);
        if (key && !parts[key]) {
            parts[key] = node;
        }
    });
    return parts;
}

function loadPresetModel(presetKey) {
    const preset = getPreset(presetKey);
    if (!preset.model) return Promise.resolve(null);
    if (presetModelCache.has(presetKey)) return presetModelCache.get(presetKey);

    const promise = loadIIGLBModel(HANS_ASSET_BASE + preset.model, {
        cacheKey: 'hans:' + preset.model,
        noExport: true,
        clone: true
    }).then(scene => extractPresetParts(preparePresetModel(scene))).catch(error => {
        console.warn(`Failed to load Hans preset model "${preset.model}":`, error);
        return null;
    });

    presetModelCache.set(presetKey, promise);
    return promise;
}

function makeHansMaterial(texture, presetKey, overlay = false) {
    return makeHansPreviewMaterial({
        name: `hans_${presetKey}_${overlay ? 'overlay' : 'skin'}`,
        map: texture || null,
        transparent: overlay,
        alphaTest: overlay ? 0.1 : 0,
        side: THREE.FrontSide
    });
}

function getOrCreateGeometryContainer(object) {
    let container = object.getObjectByName('hans_geometry');
    if (!container) {
        container = new THREE.Group();
        container.name = 'hans_geometry';
        container.no_export = true;
        object.add(container);
    }
    return container;
}

function clearGeometryContainer(container) {
    while (container.children.length) {
        const child = container.children[container.children.length - 1];
        container.remove(child);
        child.traverse(node => {
            if (node.userData?.hansOwnedGeometry && node.geometry?.dispose) node.geometry.dispose();
            if (node.userData?.hansOwnedMaterial) {
                if (Array.isArray(node.material)) node.material.forEach(material => material?.dispose?.());
                else node.material?.dispose?.();
            }
        });
    }
}

function refreshDescendantTransforms(element) {
    if (!element.children) return;
    element.children.forEach(child => {
        if (child instanceof HansPart && child.mesh) {
            HansPart.preview_controller.updateTransform(child);
        }
    });
}

function findHansPart(root, kind) {
    if (!root || !root.children) return null;
    let found = null;
    root.forEachChild(child => {
        if (!found && child instanceof HansPart && child.partKind === kind) found = child;
    }, HansPart, false);
    return found;
}

function getPartDisplayName(hansName, kind) {
    return `${hansName}_${getPartDef(kind).suffix}`;
}

function resetPartPose(part) {
    const def = getPartDef(part.partKind);
    part.origin = cloneArray(def.origin);
    part.position = cloneArray(def.position);
    part.rotation = [0, 0, 0];
}

function createHansPart(kind) {
    const def = getPartDef(kind);
    const part = new HansPart({partKind: kind, name: def.suffix}).init();
    resetPartPose(part);
    return part;
}

function getHansParent(element) {
    let parent = element.parent;
    while (parent instanceof OutlinerNode) {
        if (parent instanceof Hans) return parent;
        parent = parent.parent;
    }
    return null;
}

function selectAnimatorFor(element) {
    if (Animator.open && Animation.selected) {
        Animation.selected.getBoneAnimator(element)?.select(true);
    }
}

function applyPivotedTransform(element, object, fallbackToModel = true, animatedPosition = null, animatedRotation = null) {
    object.rotation.order = Format.euler_order || 'ZYX';
    object.position.fromArray(vec3Sum(element.origin, animatedPosition || element.position));
    object.rotation.setFromDegreeArray(animatedRotation || element.rotation || [0, 0, 0]);
    object.scale.set(1, 1, 1);
    attachPreviewObject(element, object, fallbackToModel);
    object.updateMatrixWorld(true);
    return object;
}

function numberOr(value, fallback) {
    const parsed = typeof value === 'string' ? parseFloat(value) : value;
    return Number.isFinite(parsed) ? parsed : fallback;
}

function vectorFromInterpolation(value, fallback) {
    if (value === false || value === undefined || value === null) return fallback.slice();
    if (Array.isArray(value)) {
        return [
            numberOr(value[0], fallback[0]),
            numberOr(value[1], fallback[1]),
            numberOr(value[2], fallback[2])
        ];
    }
    if (typeof value === 'object') {
        return [
            numberOr(value.x, fallback[0]),
            numberOr(value.y, fallback[1]),
            numberOr(value.z, fallback[2])
        ];
    }
    return fallback.slice();
}

function rememberHansStaticPose(element) {
    if (!element || element._hansStaticPose) return element?._hansStaticPose || null;
    element._hansStaticPose = {
        origin: cloneArray(element.origin || [0, 0, 0]),
        position: cloneArray(element.position || [0, 0, 0]),
        rotation: cloneArray(element.rotation || [0, 0, 0])
    };
    return element._hansStaticPose;
}

function restoreHansStaticPose(element) {
    const pose = element?._hansStaticPose;
    if (!element || !pose) return false;
    element.origin = cloneArray(pose.origin);
    element.position = cloneArray(pose.position);
    element.rotation = cloneArray(pose.rotation);
    delete element._hansStaticPose;
    delete element._hansAnimationPreviewActive;
    if (element instanceof HansPart) HansPart.preview_controller.updateTransform(element);
    else if (element instanceof Hans) Hans.preview_controller.updateTransform(element);
    return true;
}

function applyHansAnimatedTransform(element, animatedPosition = null, animatedRotation = null) {
    if (!element || !element.mesh) return;
    element._hansAnimationPreviewActive = true;
    applyPivotedTransform(element, element.mesh, !(element instanceof HansPart), animatedPosition, animatedRotation);
    refreshDescendantTransforms(element);
}

function forEachHansElement(callback) {
    if (typeof Outliner === 'undefined' || !Outliner.elements) return;
    Outliner.elements.forEach(element => {
        if (element instanceof Hans || element instanceof HansPart) callback(element);
    });
}

function resetHansAnimationPreviewTransforms() {
    let changed = false;
    forEachHansElement(element => {
        if (element._hansAnimationPreviewActive || element._hansStaticPose) {
            changed = restoreHansStaticPose(element) || changed;
        }
    });
    if (changed && typeof Canvas !== 'undefined' && Canvas.updateAll) Canvas.updateAll();
}

function updateHansPresetGeometry(hans) {
    if (!hans) return;
    hans.getAllParts().forEach(part => HansPart.preview_controller.updateGeometry(part));
}

// ----------------------------------------------------------------------
// Hans root element
// ----------------------------------------------------------------------
export class Hans extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetElementProperties(this, Hans);
        this.name = 'hans1';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = true;
        this.visibility = true;
        this.preset = 'default';
        this.showOverlay = true;

        if (typeof data === 'object') this.extend(data);
        else if (typeof data === 'string') this.name = data;
    }

    extend(object) {
        const oldName = this.name;
        mergeElementProperties(this, Hans, object);
        if (!HANS_PRESETS[this.preset]) this.preset = 'default';
        if (oldName !== this.name) this.syncPartNames();
        return this;
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) Hans.preview_controller.setup(this);
        this.syncPartNames();
        return this;
    }

    updateElement() {
        if (typeof OutlinerElement.prototype.updateElement === 'function') {
            OutlinerElement.prototype.updateElement.call(this);
        }
        this.syncPartNames();
        return this;
    }

    select(event, isOutlinerClick) {
        const result = super.select(event, isOutlinerClick);
        if (result === false) return false;
        this.syncPartNames();
        selectAnimatorFor(this);
        return this;
    }

    markAsSelected(descendants) {
        Outliner.selected.safePush(this);
        this.selected = true;
        if (descendants) this.children.forEach(child => child.markAsSelected(true));
        TickUpdates.selection = true;
        return this;
    }

    openUp() {
        this.isOpen = true;
        this.updateElement();
        if (this.parent && this.parent !== 'root') this.parent.openUp();
        return this;
    }

    getWorldCenter() {
        return this.mesh ? THREE.fastWorldPosition(this.mesh, new THREE.Vector3()) : new THREE.Vector3();
    }

    flip(axis, center) {
        const base = vec3Sum(this.origin, this.position);
        const offset = base[axis] - center;
        this.position[axis] = center - offset - (this.origin?.[axis] || 0);
        this.rotation.forEach((value, index) => {
            if (index !== axis) this.rotation[index] = -value;
        });
        flipNameOnAxis(this, axis);
        this.createUniqueName();
        Hans.preview_controller.updateTransform(this);
        return this;
    }

    forEachChild(callback, type, forSelf) {
        if (forSelf) callback(this);
        for (const child of this.children) {
            if (!type || (Array.isArray(type) ? type.some(candidate => child instanceof candidate) : child instanceof type)) {
                callback(child);
            }
            if (child.forEachChild) child.forEachChild(callback, type);
        }
    }

    getAllParts() {
        const parts = [];
        this.forEachChild(child => {
            if (child instanceof HansPart) parts.push(child);
        }, HansPart, false);
        return parts.sort((a, b) => PART_ORDER.indexOf(a.partKind) - PART_ORDER.indexOf(b.partKind));
    }

    syncPartNames() {
        if (!this.children) return this;
        this.getAllParts().forEach(part => {
            const expected = getPartDisplayName(this.name, part.partKind);
            if (part.name !== expected) {
                part.name = expected;
                if (typeof part.updateElement === 'function') part.updateElement();
            }
        });
        return this;
    }

    ensureRig(resetPose = false) {
        let body = findHansPart(this, 'body');
        if (!body) {
            body = createHansPart('body');
            body.addTo(this);
        } else if (!(body.parent instanceof Hans)) {
            body.addTo(this);
        }
        if (resetPose) resetPartPose(body);

        CHILDREN_OF_BODY.forEach(kind => {
            let part = findHansPart(this, kind);
            if (!part) {
                part = createHansPart(kind);
                part.addTo(body);
            } else if (part.parent !== body) {
                part.addTo(body);
            }
            if (resetPose) resetPartPose(part);
        });

        ['right_leg', 'left_leg'].forEach(kind => {
            let part = findHansPart(this, kind);
            if (!part) {
                part = createHansPart(kind);
                part.addTo(this);
            } else if (!(part.parent instanceof Hans)) {
                part.addTo(this);
            }
            if (resetPose) resetPartPose(part);
        });

        this.syncPartNames();
        return this;
    }

    getSaveCopy() {
        this.syncPartNames();
        return makeSaveCopy(this, Hans);
    }

    getUndoCopy() {
        this.syncPartNames();
        return makeSaveCopy(this, Hans);
    }

    getChildlessCopy(keepUuid = false) {
        return makeChildlessCopy(this, Hans, keepUuid);
    }

    static behavior = {
        unique_name: true,
        movable: true,
        rotatable: true,
        resizable: false,
        scalable: false,
        parent: true,
        child_types: ['hans_part'],
        select_children: 'self_first',
        hide_in_screenshot: false
    };

    static preview_controller;
}

Hans.prototype.title = 'Hans';
Hans.prototype.type = 'hans';
Hans.prototype.icon = 'accessibility_new';
Hans.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
Hans.prototype.menu = new Menu([
    'rebuild_hans_rig',
    ...Outliner.control_menu_group,
    new MenuSeparator('settings'),
    new MenuSeparator('manage'),
    'rename',
    'delete'
]);

OutlinerElement.registerType(Hans, 'hans');

new Property(Hans, 'string', 'name', {
    default: 'hans1',
    inputs: {
        element_panel: {
            input: {label: 'Name', type: 'text'},
            onChange() {
                Hans.selected.forEach(hans => hans.syncPartNames());
            }
        }
    }
});
new Property(Hans, 'vector', 'origin', {default: [0, 0, 0]});
new Property(Hans, 'vector', 'position', {default: [0, 0, 0]});
new Property(Hans, 'vector', 'rotation');
new Property(Hans, 'string', 'preset', {
    default: 'default',
    inputs: {
        element_panel: {
            input: {
                label: 'Preset',
                type: 'select',
                options: getPresetOptions()
            },
            onChange() {
                Hans.selected.forEach(hans => updateHansPresetGeometry(hans));
            }
        }
    }
});
new Property(Hans, 'boolean', 'showOverlay', {
    default: true,
    inputs: {
        element_panel: {
            input: {
                label: 'Show Skin Overlay',
                type: 'checkbox'
            },
            onChange() {
                Hans.selected.forEach(hans => updateHansPresetGeometry(hans));
            }
        }
    }
});
new Property(Hans, 'boolean', 'visibility', {default: true});

new NodePreviewController(Hans, {
    setup(element) {
        createPreviewObject3D(element, {group: true});
        this.updateTransform(element);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        element.syncPartNames();
        applyPivotedTransform(element, element.mesh);
        refreshDescendantTransforms(element);
        this.dispatchEvent('update_transform', {element});
    },

    updateVisibility(element) {
        setPreviewVisibility(element);
        this.dispatchEvent('update_visibility', {element});
    },

    updateSelection(element) {
        this.dispatchEvent('update_selection', {element});
    }
});

// ----------------------------------------------------------------------
// Hans body-part element
// ----------------------------------------------------------------------
export class HansPart extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetElementProperties(this, HansPart);
        this.name = 'hans_part';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;
        this.partKind = 'body';

        if (typeof data === 'object') this.extend(data);
        else if (typeof data === 'string') this.name = data;
    }

    extend(object) {
        mergeElementProperties(this, HansPart, object);
        Merge.string(this, object, 'partKind');
        if (!PART_DEFS[this.partKind]) this.partKind = 'body';
        if (!Array.isArray(this.position)) this.position = [0, 0, 0];
        return this;
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) HansPart.preview_controller.setup(this);
        return this;
    }

    select(event, isOutlinerClick) {
        const result = super.select(event, isOutlinerClick);
        if (result === false) return false;
        selectAnimatorFor(this);
        return this;
    }

    markAsSelected(descendants) {
        Outliner.selected.safePush(this);
        this.selected = true;
        if (descendants) this.children.forEach(child => child.markAsSelected(true));
        TickUpdates.selection = true;
        return this;
    }

    openUp() {
        this.isOpen = true;
        this.updateElement();
        if (this.parent && this.parent !== 'root') this.parent.openUp();
        return this;
    }

    getHans() {
        return getHansParent(this);
    }

    getWorldCenter() {
        return this.mesh ? THREE.fastWorldPosition(this.mesh, new THREE.Vector3()) : new THREE.Vector3();
    }

    flip(axis, center) {
        const base = vec3Sum(this.origin, this.position);
        const offset = base[axis] - center;
        this.position[axis] = center - offset - (this.origin?.[axis] || 0);
        this.rotation.forEach((value, index) => {
            if (index !== axis) this.rotation[index] = -value;
        });
        flipNameOnAxis(this, axis);
        this.createUniqueName();
        HansPart.preview_controller.updateTransform(this);
        return this;
    }

    forEachChild(callback, type, forSelf) {
        if (forSelf) callback(this);
        for (const child of this.children) {
            if (!type || (Array.isArray(type) ? type.some(candidate => child instanceof candidate) : child instanceof type)) {
                callback(child);
            }
            if (child.forEachChild) child.forEachChild(callback, type);
        }
    }

    getSaveCopy() {
        const hans = this.getHans();
        if (hans) hans.syncPartNames();
        return makeSaveCopy(this, HansPart);
    }

    getUndoCopy() {
        return makeSaveCopy(this, HansPart);
    }

    getChildlessCopy(keepUuid = false) {
        const copy = makeChildlessCopy(this, HansPart, keepUuid);
        copy.origin.V3_set(this.origin);
        copy.position.V3_set(this.position || [0, 0, 0]);
        copy.rotation.V3_set(this.rotation);
        copy.partKind = this.partKind;
        return copy;
    }

    static behavior = {
        unique_name: false,
        movable: true,
        rotatable: true,
        resizable: false,
        scalable: false,
        parent: true,
        child_types: ['hans_part'],
        parent_types: ['hans', 'hans_part'],
        select_children: 'self_first',
        hide_in_screenshot: false
    };

    static preview_controller;
}

HansPart.prototype.title = 'Hans Body Part';
HansPart.prototype.type = 'hans_part';
HansPart.prototype.icon = 'accessibility_new';
HansPart.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
HansPart.prototype.menu = new Menu([
    ...Outliner.control_menu_group,
    new MenuSeparator('manage'),
    'delete'
]);

OutlinerElement.registerType(HansPart, 'hans_part');

new Property(HansPart, 'string', 'name', {default: 'hans_part'});
new Property(HansPart, 'string', 'partKind', {
    default: 'body',
    inputs: {
        element_panel: {
            input: {label: 'Part', type: 'text', readonly: true}
        }
    }
});
new Property(HansPart, 'vector', 'origin', {default: [0, 0, 0]});
new Property(HansPart, 'vector', 'position', {default: [0, 0, 0]});
new Property(HansPart, 'vector', 'rotation');
new Property(HansPart, 'boolean', 'visibility', {default: true});

new NodePreviewController(HansPart, {
    setup(element) {
        createPreviewObject3D(element, {group: true});
        this.updateTransform(element);
        this.updateGeometry(element);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        applyPivotedTransform(element, element.mesh, false);
        refreshDescendantTransforms(element);
        this.dispatchEvent('update_transform', {element});
    },

    async updateGeometry(element) {
        const object = element.mesh;
        if (!object) return;

        const updateToken = element._hansGeometryUpdateToken = (element._hansGeometryUpdateToken || 0) + 1;
        const hans = element.getHans();
        const presetKey = hans?.preset || 'default';
        const def = getPartDef(element.partKind);
        const container = getOrCreateGeometryContainer(object);

        const [skinTexture, presetParts] = await Promise.all([
            loadPresetTexture(presetKey),
            loadPresetModel(presetKey)
        ]);
        if (updateToken !== element._hansGeometryUpdateToken) return;

        clearGeometryContainer(container);

        const geometry = createTexturedBoxGeometry(def.size, def.offset, def.uv);
        const material = makeHansMaterial(skinTexture, presetKey);
        const baseMesh = new THREE.Mesh(geometry, material);
        baseMesh.name = `${element.partKind}_base`;
        baseMesh.castShadow = true;
        baseMesh.receiveShadow = true;
        baseMesh.userData.hansOwnedGeometry = true;
        baseMesh.userData.hansOwnedMaterial = true;
        container.add(baseMesh);

        const overlayUv = getOverlayUv(element.partKind);
        if (hans?.showOverlay && overlayUv) {
            const overlayGeometry = createTexturedBoxGeometry(def.size, def.offset, overlayUv, getOverlayInflation(element.partKind));
            const overlayMaterial = makeHansMaterial(skinTexture, presetKey, true);
            const overlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterial);
            overlayMesh.name = `${element.partKind}_overlay`;
            overlayMesh.castShadow = true;
            overlayMesh.receiveShadow = true;
            overlayMesh.userData.hansOwnedGeometry = true;
            overlayMesh.userData.hansOwnedMaterial = true;
            container.add(overlayMesh);
        }

        const addition = presetParts?.[element.partKind];
        if (addition) {
            const clone = addition.clone(true);
            clone.name = `${element.partKind}_preset_addition`;
            clone.no_export = true;
            preparePresetModel(clone);
            container.add(clone);
        }

        this.dispatchEvent('update_geometry', {element});
    },

    updateVisibility(element) {
        setPreviewVisibility(element);
        this.dispatchEvent('update_visibility', {element});
    },

    updateSelection(element) {
        this.dispatchEvent('update_selection', {element});
    }
});

// Hans uses Blockbench-compatible bone channels, but applies them through the
// pivoted preview transform so Animate mode shows the same local offsets that the
// AMT biped adapter will later consume.
export class HansAnimator extends BoneAnimator {
    getElement() {
        this.element = OutlinerNode.uuids[this.uuid];
        return this.element;
    }

    displayFrame(multiplier = 1) {
        const element = this.getElement();
        if (!element || !element.mesh) return;

        const staticPose = rememberHansStaticPose(element) || {};
        const basePosition = Array.isArray(staticPose.position) ? staticPose.position : (Array.isArray(element.position) ? element.position : [0, 0, 0]);
        const baseRotation = Array.isArray(staticPose.rotation) ? staticPose.rotation : (Array.isArray(element.rotation) ? element.rotation : [0, 0, 0]);

        const animatedPosition = this.muted?.position
            ? basePosition.slice()
            : vectorFromInterpolation(this.interpolate('position', true), basePosition);
        const animatedRotation = this.muted?.rotation
            ? baseRotation.slice()
            : vectorFromInterpolation(this.interpolate('rotation', true), baseRotation);

        applyHansAnimatedTransform(element, animatedPosition, animatedRotation);
    }
}
HansAnimator.prototype.type = 'hans';

export class HansPartAnimator extends HansAnimator {}
HansPartAnimator.prototype.type = 'hans_part';

Hans.animator = HansAnimator;
HansPart.animator = HansPartAnimator;

// ----------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------
function createHansHierarchy(hans) {
    hans.ensureRig(true);
    hans.openUp();
    const body = findHansPart(hans, 'body');
    if (body) body.openUp();
    updateHansPresetGeometry(hans);
    return hans;
}

function registerHansPreviewCleanupHooks() {
    if (typeof Blockbench === 'undefined' || typeof Blockbench.on !== 'function') return;
    const scheduleReset = () => setTimeout(() => {
        if (typeof Modes === 'undefined' || !Modes.animate) resetHansAnimationPreviewTransforms();
    }, 0);
    ['select_mode', 'unselect_project', 'new_project'].forEach(eventName => {
        const hook = Blockbench.on(eventName, scheduleReset);
        if (hook && typeof hook.delete === 'function') deletables.push(hook);
    });
}

function createActions() {
    addHansAction = new Action('add_hans', {
        name: 'Add Hans',
        icon: 'accessibility_new',
        category: 'edit',
        condition: () => Modes.edit,
        click() {
            Undo.initEdit({outliner: true, elements: [], selection: true});

            const hans = new Hans().init();
            const group = getCurrentGroup();
            hans.addTo(group);
            hans.createUniqueName();
            createHansHierarchy(hans);
            hans.syncPartNames();

            unselectAll();
            hans.select();
            Undo.finishEdit('Add Hans', {outliner: true, elements: selected, selection: true});
            Blockbench.dispatchEvent('add_hans', {object: hans});
            return hans;
        }
    });

    rebuildHansAction = new Action('rebuild_hans_rig', {
        name: 'Rebuild Hans Body Parts',
        icon: 'restore',
        category: 'edit',
        condition: () => Modes.edit && Hans.hasSelected(),
        click() {
            const hansElements = Hans.selected.slice();
            Undo.initEdit({outliner: true, elements: hansElements, selection: true});
            hansElements.forEach(hans => {
                hans.ensureRig(false);
                hans.syncPartNames();
                Hans.preview_controller.updateTransform(hans);
                updateHansPresetGeometry(hans);
            });
            Undo.finishEdit('Rebuild Hans Body Parts', {outliner: true, elements: hansElements, selection: true});
        }
    });

    deletables.push(addHansAction, rebuildHansAction);
}

// ----------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------
export function registerHans() {
    if (registered) return;
    createActions();

    BarItems.add_element.side_menu.addAction(addHansAction);
    registerHansPreviewCleanupHooks();

    window.Hans = Hans;
    window.HansPart = HansPart;
    registered = true;
}

export function unregisterHansActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
    registered = false;
}
