import { loadIIGLBModel } from '../utils';

const ASSET_BASE = 'https://assets.iiteam.net/model/track/';
const EPSILON = 1e-6;
const TWO_PI = Math.PI * 2;
const MAX_ARC_STEP = Math.PI / 12;
const MAX_CONTACT_ARC = Math.PI + 1e-4;

let deletables = [];
let registered = false;

const modelCache = new Map();
const segmentLengthCache = new Map();
const segmentFileMap = {
    'motor_belt_cloth.glb': 'Cloth Motor Belt',
    'motor_belt_rubber.glb': 'Rubber Motor Belt',
    'tracks_heavy_14.glb': 'Heavy Tracks (14px)',
    'tracks_light_8.glb': 'Light Tracks (8px)'
};

// ----------------------------------------------------------------------
// Shared custom-element helpers
// ----------------------------------------------------------------------
function resetProperties(element, type) {
    for (const key in type.properties) {
        type.properties[key].reset(element);
    }
}

function mergeProperties(element, type, object) {
    for (const key in type.properties) {
        type.properties[key].merge(element, object);
    }
    Merge.string(element, object, 'name');
    element.sanitizeName();
    Merge.boolean(element, object, 'export');
    Merge.boolean(element, object, 'locked');
    Merge.boolean(element, object, 'visibility');
    return element;
}

function makeSaveCopy(element, type) {
    const copy = {
        isOpen: element.isOpen,
        uuid: element.uuid,
        type: element.type,
        name: element.name,
        children: element.children.map(child => child.uuid),
    };
    for (const key in type.properties) {
        type.properties[key].merge(copy, element);
    }
    return copy;
}

function makeChildlessCopy(element, type, keepUuid = false) {
    const copy = new type({name: element.name}, keepUuid ? element.uuid : null);
    for (const key in type.properties) {
        type.properties[key].copy(element, copy);
    }
    copy.name = element.name;
    copy.locked = element.locked;
    copy.visibility = element.visibility;
    copy.export = element.export;
    copy.isOpen = element.isOpen;
    return copy;
}

function createPreviewObject(element) {
    const object = new THREE.Object3D();
    object.rotation.order = 'ZYX';
    object.uuid = element.uuid.toUpperCase();
    object.name = element.uuid;
    object.type = element.type;
    object.isElement = true;
    object.visible = element.visibility;
    object.no_export = true;
    Project.nodes_3d[element.uuid] = object;
    return object;
}

function attachPreviewObject(element, rootFallback = true) {
    const object = element.mesh;
    if (!object) return;

    if (element.parent instanceof OutlinerNode) {
        const parentObject = element.parent.scene_object || element.parent.mesh;
        if (parentObject && object.parent !== parentObject) parentObject.add(object);
    } else if (rootFallback && object.parent !== Project.model_3d) {
        Project.model_3d.add(object);
    } else if (!rootFallback && object.parent) {
        object.parent.remove(object);
    }
    object.updateMatrixWorld();
}

function forEachChild(element, callback, type, forSelf) {
    if (forSelf) callback(element);
    for (const child of element.children) {
        if (!type || (Array.isArray(type) ? type.some(candidate => child instanceof candidate) : child instanceof type)) {
            callback(child);
        }
        if (child.forEachChild) child.forEachChild(callback, type);
    }
}

function selectAnimatorFor(element) {
    if (!Animator.open || !Animation.selected || !element.constructor.animator) return;
    Animation.selected.getBoneAnimator(element)?.select(true);
}

function clamp01(value) {
    return Math.clamp(Number(value) || 0, 0, 1);
}

function disposeObjectChildren(object, disposeResources = true) {
    if (!object) return;
    while (object.children.length) {
        const child = object.children[object.children.length - 1];
        object.remove(child);
        if (!disposeResources) continue;
        child.traverse(node => {
            if (node.geometry?.dispose) node.geometry.dispose();
            if (Array.isArray(node.material)) node.material.forEach(material => material?.dispose?.());
            else node.material?.dispose?.();
        });
    }
}

// ----------------------------------------------------------------------
// TrackLink – legacy TrackNode, now explicitly the path-link node.
// The serialized type remains track_node for backwards compatibility.
// ----------------------------------------------------------------------
export class TrackLink extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetProperties(this, TrackLink);
        this.name = 'link';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;

        if (typeof data === 'object') this.extend(data);
        else if (typeof data === 'string') this.name = data;
    }

    get position() {
        return this.origin;
    }

    extend(object) {
        return mergeProperties(this, TrackLink, object);
    }

    getTrack() {
        let parent = this.parent;
        while (!(parent instanceof Track) && parent instanceof OutlinerNode) parent = parent.parent;
        return parent instanceof Track ? parent : null;
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) TrackLink.preview_controller.setup(this);
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
        return THREE.fastWorldPosition(this.mesh, new THREE.Vector3());
    }

    flip(axis, center) {
        const offset = this.position[axis] - center;
        this.position[axis] = center - offset;
        this.rotation.forEach((value, index) => {
            if (index !== axis) this.rotation[index] = -value;
        });
        flipNameOnAxis(this, axis);
        this.createUniqueName();
        TrackLink.preview_controller.updateTransform(this);
        return this;
    }

    getSaveCopy() {
        return makeSaveCopy(this, TrackLink);
    }

    getUndoCopy() {
        return makeSaveCopy(this, TrackLink);
    }

    getChildlessCopy(keepUuid = false) {
        const copy = makeChildlessCopy(this, TrackLink, keepUuid);
        copy.origin.V3_set(this.origin);
        copy.rotation.V3_set(this.rotation);
        return copy;
    }

    forEachChild(callback, type, forSelf) {
        forEachChild(this, callback, type, forSelf);
    }

    static behavior = {
        unique_name: false,
        parent: false,
        movable: true,
        rotatable: true,
        resizable: false,
        child_types: [],
        parent_types: ['track'],
        select_children: 'self_first',
        hide_in_screenshot: false,
    };

    static preview_controller;
}

TrackLink.prototype.title = 'Track Link';
TrackLink.prototype.type = 'track_node';
TrackLink.prototype.icon = 'timeline';
TrackLink.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
TrackLink.prototype.menu = new Menu(['rename', 'delete']);

OutlinerElement.registerType(TrackLink, 'track_node');

new Property(TrackLink, 'vector', 'origin', {default: [0, 0, 0]});
new Property(TrackLink, 'vector', 'rotation');
new Property(TrackLink, 'boolean', 'visibility', {default: true});


function getTrackAxisSign(track) {
    return track?.axisDirection === 'negative' ? -1 : 1;
}

function getTrackForwardVector(track) {
    const sign = getTrackAxisSign(track);
    return track?.trackDirection === 'x'
        ? new THREE.Vector3(sign, 0, 0)
        : new THREE.Vector3(0, 0, sign);
}

function rebuildTrackLinkVisual(element) {
    const object = element.mesh;
    if (!object) return;

    let visual = object.getObjectByName('track_link_visual');
    if (!visual) {
        visual = new THREE.Group();
        visual.name = 'track_link_visual';
        object.add(visual);
    }

    const track = element.getTrack();
    const direction = track?.trackDirection || 'z';
    const axisDirection = track?.axisDirection || 'positive';
    const geometryKey = `${direction}:${axisDirection}`;
    if (visual.userData.geometryKey !== geometryKey) {
        disposeObjectChildren(visual);

        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 8, 8),
            new THREE.MeshStandardMaterial({
                color: 0x44aaff,
                emissive: new THREE.Color(0x224466),
                emissiveIntensity: 0.5
            })
        );
        visual.add(sphere);

        const forward = getTrackForwardVector(track);
        const arrow = new THREE.Mesh(
            new THREE.ConeGeometry(0.2, 0.8, 8),
            new THREE.MeshStandardMaterial({color: 0xffaa00})
        );
        arrow.position.copy(forward).multiplyScalar(0.6);
        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
        visual.add(arrow);
        visual.userData.geometryKey = geometryKey;
    }
    visual.visible = track?.showDebugMarkers !== false;
}

new NodePreviewController(TrackLink, {
    setup(element) {
        createPreviewObject(element);
        rebuildTrackLinkVisual(element);
        this.updateTransform(element);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        const object = element.mesh;
        object.rotation.order = Format.euler_order;
        object.rotation.setFromDegreeArray(element.rotation);
        object.position.fromArray(element.origin);
        object.scale.set(1, 1, 1);
        attachPreviewObject(element, false);
        rebuildTrackLinkVisual(element);

        const track = element.getTrack();
        if (track) Track.preview_controller.updateGeometry(track);
        this.dispatchEvent('update_transform', {element});
    },

    updateVisibility(element) {
        element.mesh.visible = element.visibility;
        const track = element.getTrack();
        if (track) Track.preview_controller.updateGeometry(track);
        this.dispatchEvent('update_visibility', {element});
    },

    updateSelection(element) {
        this.dispatchEvent('update_selection', {element});
    }
});

// Legacy import name retained for the rest of IIToolkit and older integrations.
export const TrackNode = TrackLink;

// ----------------------------------------------------------------------
// TrackSuspender – a suspension constraint that owns one wheel.
// Fixed suspension visuals are children of this node; the wheel subtree
// alone is translated by compression.
// ----------------------------------------------------------------------
export class TrackSuspender extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetProperties(this, TrackSuspender);
        this.name = 'suspender';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;

        if (typeof data === 'object') this.extend(data);
        else if (typeof data === 'string') this.name = data;
    }

    get position() {
        return this.origin;
    }

    extend(object) {
        return mergeProperties(this, TrackSuspender, object);
    }

    getTrack() {
        let parent = this.parent;
        while (!(parent instanceof Track) && parent instanceof OutlinerNode) parent = parent.parent;
        return parent instanceof Track ? parent : null;
    }

    getWheel() {
        return this.children.find(child => child instanceof TrackWheel) || null;
    }

    getCompressionOffset() {
        return Math.max(0, Number(this.maxCompression) || 0) * clamp01(this.compression);
    }

    getCompressedWheelOrigin() {
        const wheel = this.getWheel();
        const wheelOrigin = wheel?.origin || [0, 0, 0];
        return [
            this.origin[0] + wheelOrigin[0],
            this.origin[1] + wheelOrigin[1] + this.getCompressionOffset(),
            this.origin[2] + wheelOrigin[2]
        ];
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) TrackSuspender.preview_controller.setup(this);
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

    getWorldCenter() {
        return THREE.fastWorldPosition(this.mesh, new THREE.Vector3());
    }

    flip(axis, center) {
        const offset = this.position[axis] - center;
        this.position[axis] = center - offset;
        flipNameOnAxis(this, axis);
        this.createUniqueName();
        TrackSuspender.preview_controller.updateTransform(this);
        return this;
    }

    getSaveCopy() {
        return makeSaveCopy(this, TrackSuspender);
    }

    getUndoCopy() {
        return makeSaveCopy(this, TrackSuspender);
    }

    getChildlessCopy(keepUuid = false) {
        const copy = makeChildlessCopy(this, TrackSuspender, keepUuid);
        copy.origin.V3_set(this.origin);
        return copy;
    }

    forEachChild(callback, type, forSelf) {
        forEachChild(this, callback, type, forSelf);
    }

    static behavior = {
        unique_name: false,
        parent: true,
        movable: true,
        rotatable: false,
        resizable: false,
        child_types: ['track_wheel', 'mesh', 'embedded_part'],
        parent_types: ['track'],
        select_children: 'self_first',
        hide_in_screenshot: false,
    };

    static preview_controller;
}

TrackSuspender.prototype.title = 'Track Suspender';
TrackSuspender.prototype.type = 'track_suspender';
TrackSuspender.prototype.icon = 'vertical_align_center';
TrackSuspender.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
TrackSuspender.prototype.menu = new Menu([
    'add_track_wheel',
    'add_track_visual_mesh',
    'import_embedded_part',
    ...Outliner.control_menu_group,
    new MenuSeparator('manage'),
    'rename',
    'delete'
]);

OutlinerElement.registerType(TrackSuspender, 'track_suspender');

new Property(TrackSuspender, 'vector', 'origin', {default: [0, 0, 0]});
new Property(TrackSuspender, 'number', 'maxCompression', {
    default: 0,
    min: 0,
    step: 0.1,
    inputs: {
        element_panel: {
            input: {label: 'Maximum Compression', type: 'number', min: 0, step: 0.1},
            onChange() {
                TrackSuspender.selected.forEach(element => TrackSuspender.preview_controller.updateGeometry(element));
            }
        }
    }
});
new Property(TrackSuspender, 'number', 'compression', {
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    inputs: {
        element_panel: {
            input: {label: 'Compression', type: 'num_slider', min: 0, max: 1, step: 0.01},
            onChange() {
                TrackSuspender.selected.forEach(element => {
                    element.compression = clamp01(element.compression);
                    keyframeScalarProperty(element, 'compression', element.compression);
                    TrackSuspender.preview_controller.updateGeometry(element);
                });
            }
        }
    }
});
new Property(TrackSuspender, 'boolean', 'visibility', {default: true});

function rebuildSuspenderVisual(element) {
    const object = element.mesh;
    if (!object) return;

    let visual = object.getObjectByName('track_suspender_debug');
    if (!visual) {
        visual = new THREE.Group();
        visual.name = 'track_suspender_debug';
        object.add(visual);
    }

    const maxCompression = Math.max(0, Number(element.maxCompression) || 0);
    const geometryKey = String(maxCompression);
    if (visual.userData.geometryKey !== geometryKey) {
        disposeObjectChildren(visual);

        const marker = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.28, 0),
            new THREE.MeshStandardMaterial({
                color: 0x66dd88,
                emissive: new THREE.Color(0x163b24),
                emissiveIntensity: 0.45
            })
        );
        visual.add(marker);

        if (maxCompression > EPSILON) {
            const guide = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(0, 0, 0),
                    new THREE.Vector3(0, maxCompression, 0)
                ]),
                new THREE.LineBasicMaterial({color: 0x66dd88, transparent: true, opacity: 0.7})
            );
            visual.add(guide);
        }
        visual.userData.geometryKey = geometryKey;
    }
    visual.visible = element.getTrack()?.showDebugMarkers !== false;
}

function updateSuspenderWheelTransform(element) {
    const wheel = element.getWheel();
    if (wheel) applyWheelPreviewTransform(wheel);
}

new NodePreviewController(TrackSuspender, {
    setup(element) {
        createPreviewObject(element);
        this.updateTransform(element);
        this.updateGeometry(element);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        const object = element.mesh;
        object.rotation.set(0, 0, 0);
        object.position.fromArray(element.origin);
        object.scale.set(1, 1, 1);
        attachPreviewObject(element, false);
        rebuildSuspenderVisual(element);
        updateSuspenderWheelTransform(element);

        const track = element.getTrack();
        if (track) Track.preview_controller.updateGeometry(track);
        this.dispatchEvent('update_transform', {element});
    },

    updateGeometry(element) {
        rebuildSuspenderVisual(element);
        updateSuspenderWheelTransform(element);
        const track = element.getTrack();
        if (track) Track.preview_controller.updateGeometry(track);
        this.dispatchEvent('update_geometry', {element});
    },

    updateVisibility(element) {
        element.mesh.visible = element.visibility;
        const track = element.getTrack();
        if (track) Track.preview_controller.updateGeometry(track);
        this.dispatchEvent('update_visibility', {element});
    },

    updateSelection(element) {
        this.dispatchEvent('update_selection', {element});
    }
});

// ----------------------------------------------------------------------
// TrackWheel – wheel radius and rotating visual subtree.
// ----------------------------------------------------------------------
export class TrackWheel extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetProperties(this, TrackWheel);
        this.name = 'wheel';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;

        if (typeof data === 'object') this.extend(data);
        else if (typeof data === 'string') this.name = data;
    }

    get position() {
        return this.origin;
    }

    extend(object) {
        return mergeProperties(this, TrackWheel, object);
    }

    getSuspender() {
        return this.parent instanceof TrackSuspender ? this.parent : null;
    }

    getTrack() {
        let parent = this.parent;
        while (!(parent instanceof Track) && parent instanceof OutlinerNode) parent = parent.parent;
        return parent instanceof Track ? parent : null;
    }

    // Compatibility for wheel nodes authored by the previous IIToolkit build.
    getLegacyCompressionOffset() {
        return Math.max(0, Number(this.maxCompression) || 0) * clamp01(this.compression);
    }

    getEffectiveOrigin() {
        const suspender = this.getSuspender();
        if (suspender) return suspender.getCompressedWheelOrigin();
        return [this.origin[0], this.origin[1] + this.getLegacyCompressionOffset(), this.origin[2]];
    }

    addTo(target) {
        if (target instanceof TrackSuspender) {
            const existing = target.getWheel();
            if (existing && existing !== this) {
                Blockbench.showQuickMessage('A Track Suspender can contain only one wheel', 'error');
                return this;
            }
        }
        return super.addTo(target);
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) TrackWheel.preview_controller.setup(this);
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

    getWorldCenter() {
        return THREE.fastWorldPosition(this.mesh, new THREE.Vector3());
    }

    getSaveCopy() {
        return makeSaveCopy(this, TrackWheel);
    }

    getUndoCopy() {
        return makeSaveCopy(this, TrackWheel);
    }

    getChildlessCopy(keepUuid = false) {
        const copy = makeChildlessCopy(this, TrackWheel, keepUuid);
        copy.origin.V3_set(this.origin);
        return copy;
    }

    forEachChild(callback, type, forSelf) {
        forEachChild(this, callback, type, forSelf);
    }

    static behavior = {
        unique_name: false,
        parent: true,
        movable: true,
        rotatable: false,
        resizable: false,
        child_types: ['mesh', 'embedded_part'],
        // Wheels may either be fixed constraints directly below a Track or
        // suspended constraints below a TrackSuspender.
        parent_types: ['track_suspender', 'track'],
        select_children: 'self_first',
        hide_in_screenshot: false,
    };

    static preview_controller;
}

TrackWheel.prototype.title = 'Track Wheel';
TrackWheel.prototype.type = 'track_wheel';
TrackWheel.prototype.icon = 'radio_button_unchecked';
TrackWheel.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
TrackWheel.prototype.menu = new Menu([
    'add_track_visual_mesh',
    'import_embedded_part',
    ...Outliner.control_menu_group,
    new MenuSeparator('manage'),
    'rename',
    'delete'
]);

OutlinerElement.registerType(TrackWheel, 'track_wheel');

new Property(TrackWheel, 'vector', 'origin', {default: [0, 0, 0]});
new Property(TrackWheel, 'number', 'radius', {
    default: 2,
    min: 0.01,
    step: 0.1,
    inputs: {
        element_panel: {
            input: {label: 'Radius', type: 'number', min: 0.01, step: 0.1},
            onChange() {
                TrackWheel.selected.forEach(element => TrackWheel.preview_controller.updateGeometry(element));
            }
        }
    }
});
new Property(TrackWheel, 'number', 'wheelRotation', {
    default: 0,
    step: 1,
    inputs: {
        element_panel: {
            input: {label: 'Rotation', type: 'number', step: 1},
            onChange() {
                TrackWheel.selected.forEach(element => {
                    keyframeScalarProperty(element, 'rotation', element.wheelRotation);
                    applyWheelRotation(element);
                });
            }
        }
    }
});
// Retain the old serialised fields silently so earlier wheel nodes still load.
new Property(TrackWheel, 'number', 'maxCompression', {default: 0, min: 0});
new Property(TrackWheel, 'number', 'compression', {default: 0, min: 0, max: 1});
new Property(TrackWheel, 'boolean', 'visibility', {default: true});

function getWheelRotationRadians(element) {
    const track = element.getTrack();
    const sign = getTrackAxisSign(track);
    const radians = (Number(element.wheelRotation) || 0) * Math.PI / 180;
    return track?.trackDirection === 'x' ? sign * radians : -sign * radians;
}

function applyWheelRotation(element) {
    const object = element.mesh;
    if (!object) return;
    object.rotation.set(0, 0, 0);
    const wheelAngle = getWheelRotationRadians(element);
    if (element.getTrack()?.trackDirection === 'x') object.rotation.z = wheelAngle;
    else object.rotation.x = wheelAngle;
    object.updateMatrixWorld();
}

function applyWheelPreviewTransform(element) {
    const object = element.mesh;
    if (!object) return;
    const suspender = element.getSuspender();
    const compressionOffset = suspender ? suspender.getCompressionOffset() : element.getLegacyCompressionOffset();
    object.position.set(element.origin[0], element.origin[1] + compressionOffset, element.origin[2]);
    object.scale.set(1, 1, 1);
    applyWheelRotation(element);
    attachPreviewObject(element, false);
    rebuildWheelVisual(element);
}

function rebuildWheelVisual(element) {
    const object = element.mesh;
    if (!object) return;

    let visual = object.getObjectByName('track_wheel_debug');
    if (!visual) {
        visual = new THREE.Group();
        visual.name = 'track_wheel_debug';
        object.add(visual);
    }

    const track = element.getTrack();
    const direction = track?.trackDirection || 'z';
    const radius = Math.max(0.01, Number(element.radius) || 0.01);
    const geometryKey = `${radius}:${direction}`;

    if (visual.userData.geometryKey !== geometryKey) {
        disposeObjectChildren(visual);

        const tyreMaterial = new THREE.MeshStandardMaterial({
            color: 0x556270,
            emissive: new THREE.Color(0x17212b),
            emissiveIntensity: 0.35,
            roughness: 0.9,
            metalness: 0.05
        });
        const hubMaterial = new THREE.MeshStandardMaterial({
            color: 0xc99a3d,
            emissive: new THREE.Color(0x4a3512),
            emissiveIntensity: 0.25,
            roughness: 0.65,
            metalness: 0.25
        });

        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(radius, Math.max(0.06, Math.min(0.18, radius * 0.06)), 8, 32),
            tyreMaterial
        );
        if (direction === 'z') ring.rotation.y = Math.PI / 2;
        visual.add(ring);

        const hub = new THREE.Mesh(
            new THREE.CylinderGeometry(Math.max(0.08, radius * 0.12), Math.max(0.08, radius * 0.12), 0.18, 12),
            hubMaterial
        );
        if (direction === 'x') hub.rotation.x = Math.PI / 2;
        else hub.rotation.z = Math.PI / 2;
        visual.add(hub);

        const spokeLength = Math.max(0.01, radius * 1.55);
        for (let index = 0; index < 4; index++) {
            const spoke = new THREE.Mesh(
                new THREE.BoxGeometry(spokeLength, Math.max(0.035, radius * 0.025), Math.max(0.035, radius * 0.025)),
                hubMaterial.clone()
            );
            spoke.rotation.z = index * Math.PI / 4;
            if (direction === 'z') spoke.rotation.y = Math.PI / 2;
            visual.add(spoke);
        }
        visual.userData.geometryKey = geometryKey;
    }
    visual.visible = track?.showDebugMarkers !== false;
}

new NodePreviewController(TrackWheel, {
    setup(element) {
        createPreviewObject(element);
        this.updateTransform(element);
        this.updateGeometry(element);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        applyWheelPreviewTransform(element);
        const track = element.getTrack();
        if (track) Track.preview_controller.updateGeometry(track);
        this.dispatchEvent('update_transform', {element});
    },

    updateGeometry(element) {
        rebuildWheelVisual(element);
        const track = element.getTrack();
        if (track) Track.preview_controller.updateGeometry(track);
        this.dispatchEvent('update_geometry', {element});
    },

    updateVisibility(element) {
        element.mesh.visible = element.visibility;
        const track = element.getTrack();
        if (track) Track.preview_controller.updateGeometry(track);
        this.dispatchEvent('update_visibility', {element});
    },

    updateSelection(element) {
        this.dispatchEvent('update_selection', {element});
    }
});

// ----------------------------------------------------------------------
// Track – contains TrackLinks and TrackSuspenders and draws repeating segments.
// ----------------------------------------------------------------------
export class Track extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetProperties(this, Track);
        this.name = 'track';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;
        this.origin = [0, 0, 0];

        if (typeof data === 'object') this.extend(data);
        else if (typeof data === 'string') this.name = data;
    }

    extend(object) {
        return mergeProperties(this, Track, object);
    }

    getMesh() {
        return this.mesh;
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) Track.preview_controller.setup(this);
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

    getSaveCopy() {
        return makeSaveCopy(this, Track);
    }

    getUndoCopy() {
        return makeSaveCopy(this, Track);
    }

    getChildlessCopy(keepUuid = false) {
        return makeChildlessCopy(this, Track, keepUuid);
    }

    forEachChild(callback, type, forSelf) {
        forEachChild(this, callback, type, forSelf);
    }

    getPathNodes() {
        // Only direct Track children define the closed path. A Suspender
        // contributes its child Wheel as one compressed constraint, while a
        // direct Wheel contributes itself as a fixed wheel constraint.
        return this.children.filter(child => {
            if (!child.visibility) return false;
            if (child instanceof TrackLink) return true;
            if (child instanceof TrackSuspender) {
                const wheel = child.getWheel();
                return !!wheel && wheel.visibility;
            }
            return child instanceof TrackWheel;
        });
    }

    getAllNodes() {
        return this.getPathNodes();
    }

    static behavior = {
        unique_name: false,
        movable: true,
        rotatable: true,
        parent: true,
        child_types: ['track_node', 'track_suspender', 'track_wheel'],
    };

    static preview_controller;
}

Track.prototype.title = 'Track';
Track.prototype.type = 'track';
Track.prototype.icon = 'orthopedics';
Track.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
Track.prototype.menu = new Menu([
    'add_track_node',
    'add_track_wheel',
    'add_track_suspender',
    ...Outliner.control_menu_group,
    new MenuSeparator('settings'),
    new MenuSeparator('manage'),
    'rename',
    'delete'
]);

OutlinerElement.registerType(Track, 'track');

new Property(Track, 'string', 'name', {default: 'track'});
new Property(Track, 'vector', 'position');
new Property(Track, 'vector', 'rotation');
new Property(Track, 'vector', 'scale', {default: [1, 1, 1]});
new Property(Track, 'string', 'segmentModel', {
    default: Object.keys(segmentFileMap)[0],
    inputs: {
        element_panel: {
            input: {label: 'Segment Model', type: 'select', options: segmentFileMap},
            onChange() {
                Track.selected.forEach(element => Track.preview_controller.updateGeometry(element, true));
            }
        }
    }
});
new Property(Track, 'string', 'trackDirection', {
    default: 'z',
    inputs: {
        element_panel: {
            input: {
                label: 'Track Direction',
                type: 'select',
                options: {'x': 'X Axis', 'z': 'Z Axis'}
            },
            onChange() {
                Track.selected.forEach(element => {
                    refreshTrackChildPreviews(element);
                    Track.preview_controller.updateGeometry(element, true);
                });
            }
        }
    }
});
new Property(Track, 'string', 'axisDirection', {
    default: 'positive',
    inputs: {
        element_panel: {
            input: {
                label: 'Forward Direction',
                type: 'select',
                options: {'positive': 'Positive Axis', 'negative': 'Negative Axis'}
            },
            onChange() {
                Track.selected.forEach(element => {
                    refreshTrackChildPreviews(element);
                    Track.preview_controller.updateGeometry(element, true);
                });
            }
        }
    }
});
new Property(Track, 'number', 'progress', {
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    inputs: {
        element_panel: {
            input: {label: 'Progress', type: 'num_slider', min: 0, max: 1, step: 0.01},
            onChange() {
                Track.selected.forEach(element => {
                    element.progress = clamp01(element.progress);
                    keyframeScalarProperty(element, 'progress', element.progress);
                    Track.preview_controller.updateGeometry(element);
                });
            }
        }
    }
});
new Property(Track, 'boolean', 'showDebugMarkers', {
    default: true,
    inputs: {
        element_panel: {
            input: {label: 'Show Debug Markers', type: 'checkbox'},
            onChange() {
                Track.selected.forEach(element => refreshTrackDebugMarkers(element));
            }
        }
    }
});
new Property(Track, 'boolean', 'visibility', {default: true});

function refreshTrackDebugMarkers(track) {
    track.forEachChild(child => {
        if (child instanceof TrackLink) rebuildTrackLinkVisual(child);
        else if (child instanceof TrackSuspender) rebuildSuspenderVisual(child);
        else if (child instanceof TrackWheel) rebuildWheelVisual(child);
    });
}

function refreshTrackChildPreviews(track) {
    track.forEachChild(child => {
        if (child instanceof TrackLink) rebuildTrackLinkVisual(child);
        else if (child instanceof TrackSuspender) {
            rebuildSuspenderVisual(child);
            updateSuspenderWheelTransform(child);
        } else if (child instanceof TrackWheel) {
            TrackWheel.preview_controller.updateTransform(child);
        }
    });
}

// ----------------------------------------------------------------------
// Model loading
// ----------------------------------------------------------------------
async function loadSegmentModel(filename) {
    if (modelCache.has(filename)) {
        return modelCache.get(filename).clone(true);
    }

    const model = await loadIIGLBModel(ASSET_BASE + filename, {
        cacheKey: 'track:' + filename,
        noExport: true,
        castShadow: true,
        receiveShadow: true
    });
    modelCache.set(filename, model.clone(true));
    return model;
}

function getSegmentLength(filename, model) {
    if (segmentLengthCache.has(filename)) return segmentLengthCache.get(filename);

    let minX = Infinity;
    let maxX = -Infinity;
    model.updateMatrixWorld(true);
    model.traverse(node => {
        if (!node.isMesh) return;
        const box = new THREE.Box3().setFromObject(node);
        if (!box.isEmpty()) {
            minX = Math.min(minX, box.min.x);
            maxX = Math.max(maxX, box.max.x);
        }
    });
    const length = maxX - minX;
    segmentLengthCache.set(filename, length);
    return length;
}

// ----------------------------------------------------------------------
// Wheel-aware path construction
// ----------------------------------------------------------------------
function getPlaneNode(element, direction) {
    let origin = element.origin;
    let radius = 0;

    if (element instanceof TrackSuspender) {
        const wheel = element.getWheel();
        origin = element.getCompressedWheelOrigin();
        radius = wheel ? Math.max(0.01, Number(wheel.radius) || 0.01) : 0;
    } else if (element instanceof TrackWheel) {
        // Direct wheels are fixed constraints; legacy compression fields remain
        // honoured for backwards-compatible project loading.
        origin = element.getEffectiveOrigin();
        radius = Math.max(0.01, Number(element.radius) || 0.01);
    }

    const horizontal = direction === 'x' ? origin[0] : origin[2];
    const cross = direction === 'x' ? origin[2] : origin[0];
    const rotationOffset = element instanceof TrackLink
        ? ((direction === 'x' ? element.rotation[2] : element.rotation[0]) || 0) * Math.PI / 180
        : 0;

    return {
        element,
        horizontal,
        vertical: origin[1],
        cross,
        radius,
        rotationOffset
    };
}

function planeToWorld(horizontal, vertical, cross, direction) {
    return direction === 'x'
        ? new THREE.Vector3(horizontal, vertical, cross)
        : new THREE.Vector3(cross, vertical, horizontal);
}

function planeVectorToWorld(horizontal, vertical, cross, direction) {
    return direction === 'x'
        ? new THREE.Vector3(horizontal, vertical, cross)
        : new THREE.Vector3(cross, vertical, horizontal);
}

function calculateSignedArea(nodes) {
    if (nodes.length < 3) return 0;
    let signedArea = 0;
    for (let index = 0; index < nodes.length; index++) {
        const current = nodes[index];
        const next = nodes[(index + 1) % nodes.length];
        signedArea += current.horizontal * next.vertical - next.horizontal * current.vertical;
    }
    return signedArea;
}

function calculateWinding(nodes) {
    const signedArea = calculateSignedArea(nodes);
    return Math.abs(signedArea) <= EPSILON ? -1 : (signedArea > 0 ? 1 : -1);
}

function rotateCycle(nodes, startIndex) {
    if (startIndex <= 0) return nodes.slice();
    return nodes.slice(startIndex).concat(nodes.slice(0, startIndex));
}

function reverseCycleKeepingFirst(nodes) {
    return nodes.length < 3 ? nodes.slice() : [nodes[0], ...nodes.slice(1).reverse()];
}

function canonicaliseWheelOrder(track, sourceNodes) {
    let nodes = sourceNodes.slice();
    const firstWheelIndex = nodes.findIndex(node => node.radius > EPSILON);
    if (firstWheelIndex < 0) return nodes;

    nodes = rotateCycle(nodes, firstWheelIndex);
    if (nodes.length > 2) {
        const first = nodes[0];
        const forwardSign = getTrackAxisSign(track);
        const nextDistinct = nodes.slice(1).find(node => Math.abs(node.horizontal - first.horizontal) > EPSILON);
        // Convention: the first wheel is the front wheel and the cycle proceeds rearwards from
        // it along the lower run. This fixes traversal independently of the wheel centres' area.
        if (nextDistinct && (nextDistinct.horizontal - first.horizontal) * forwardSign > EPSILON) {
            nodes = reverseCycleKeepingFirst(nodes);
        }
    }
    return nodes;
}

function calculateExternalTangent(first, second, side) {
    const dx = second.horizontal - first.horizontal;
    const dy = second.vertical - first.vertical;
    const distanceSquared = dx * dx + dy * dy;
    const radiusDifference = first.radius - second.radius;
    const tangentSquared = distanceSquared - radiusDifference * radiusDifference;

    if (distanceSquared <= EPSILON || tangentSquared <= EPSILON) {
        return {valid: false, spanLength: 0};
    }

    const tangentLength = Math.sqrt(tangentSquared);
    const normalX = (dx * radiusDifference - dy * tangentLength * side) / distanceSquared;
    const normalY = (dy * radiusDifference + dx * tangentLength * side) / distanceSquared;

    return {
        valid: true,
        spanLength: tangentLength,
        start: {
            x: first.horizontal + normalX * first.radius,
            y: first.vertical + normalY * first.radius
        },
        end: {
            x: second.horizontal + normalX * second.radius,
            y: second.vertical + normalY * second.radius
        }
    };
}

function getWheelArcDelta(node, incoming, outgoing, winding) {
    const startAngle = Math.atan2(incoming.y - node.vertical, incoming.x - node.horizontal);
    const endAngle = Math.atan2(outgoing.y - node.vertical, outgoing.x - node.horizontal);
    let delta = endAngle - startAngle;
    if (winding > 0) while (delta < 0) delta += TWO_PI;
    else while (delta > 0) delta -= TWO_PI;
    return {startAngle, delta};
}

function chooseDegenerateNode(nodes, edgeIndex) {
    const nextIndex = (edgeIndex + 1) % nodes.length;
    const first = nodes[edgeIndex];
    const second = nodes[nextIndex];

    if (first.radius <= EPSILON && second.radius <= EPSILON) return nextIndex;
    if (first.radius <= EPSILON) return edgeIndex;
    if (second.radius <= EPSILON) return nextIndex;

    // Index zero is the declared front wheel and remains the orientation anchor.
    if (edgeIndex === 0) return nextIndex;
    if (nextIndex === 0) return edgeIndex;
    if (Math.abs(first.radius - second.radius) > EPSILON) {
        return first.radius < second.radius ? edgeIndex : nextIndex;
    }
    return nextIndex;
}

function solveTrackEnvelope(track, sourceNodes) {
    let nodes = canonicaliseWheelOrder(track, sourceNodes);
    const maximumIterations = Math.max(1, nodes.length * 2);

    for (let iteration = 0; iteration < maximumIterations && nodes.length >= 2; iteration++) {
        const hasWheel = nodes.some(node => node.radius > EPSILON);
        const winding = hasWheel ? -1 : calculateWinding(nodes);
        const tangentSide = -winding;
        const tangents = nodes.map((node, index) =>
            calculateExternalTangent(node, nodes[(index + 1) % nodes.length], tangentSide)
        );

        const invalidEdge = tangents.findIndex(tangent => !tangent.valid || tangent.spanLength <= EPSILON);
        if (invalidEdge >= 0) {
            if (nodes.length <= 2) return null;
            nodes.splice(chooseDegenerateNode(nodes, invalidEdge), 1);
            nodes = canonicaliseWheelOrder(track, nodes);
            continue;
        }

        let rejectedWheel = -1;
        let rejectedSweep = MAX_CONTACT_ARC;
        for (let index = 0; index < nodes.length; index++) {
            const node = nodes[index];
            if (node.radius <= EPSILON) continue;
            const incoming = tangents[(index - 1 + nodes.length) % nodes.length].end;
            const outgoing = tangents[index].start;
            const {delta} = getWheelArcDelta(node, incoming, outgoing, winding);
            const sweep = Math.abs(delta);
            // A wheel demanding more than half a turn is inside the current envelope. Select
            // the worst offender rather than the first one: neighbouring sprockets can also be
            // pulled slightly over PI by the bad idler, but the idler has the largest sweep.
            if (sweep > rejectedSweep && (index !== 0 || rejectedWheel < 0)) {
                rejectedWheel = index;
                rejectedSweep = sweep;
            }
        }
        // Preserve the declared front wheel when another invalid wheel can be removed instead.
        if (rejectedWheel === 0) {
            for (let index = 1; index < nodes.length; index++) {
                const node = nodes[index];
                if (node.radius <= EPSILON) continue;
                const incoming = tangents[(index - 1 + nodes.length) % nodes.length].end;
                const outgoing = tangents[index].start;
                const sweep = Math.abs(getWheelArcDelta(node, incoming, outgoing, winding).delta);
                if (sweep > MAX_CONTACT_ARC && sweep >= rejectedSweep - 1e-4) {
                    rejectedWheel = index;
                    rejectedSweep = sweep;
                }
            }
        }
        if (rejectedWheel >= 0) {
            if (nodes.length <= 2) return null;
            nodes.splice(rejectedWheel, 1);
            nodes = canonicaliseWheelOrder(track, nodes);
            continue;
        }

        return {nodes, tangents, winding};
    }
    return null;
}

function addPathPoint(path, point) {
    const previous = path[path.length - 1];
    if (previous && previous.position.distanceToSquared(point.position) <= EPSILON * EPSILON) {
        previous.rotationOffset = point.rotationOffset;
        return;
    }
    path.push(point);
}

function appendWheelArc(path, node, incoming, outgoing, winding, direction, segmentLength) {
    const {startAngle, delta} = getWheelArcDelta(node, incoming, outgoing, winding);
    if (Math.abs(delta) <= EPSILON || Math.abs(delta) > MAX_CONTACT_ARC) return;

    const preferredStepLength = Math.max(segmentLength * 0.5, 1 / 64);
    const byAngle = Math.ceil(Math.abs(delta) / MAX_ARC_STEP);
    const byLength = Math.ceil(Math.abs(delta) * node.radius / preferredStepLength);
    const steps = Math.clamp(Math.max(2, byAngle, byLength), 2, 96);

    for (let step = 0; step <= steps; step++) {
        const angle = startAngle + delta * (step / steps);
        addPathPoint(path, {
            position: planeToWorld(
                node.horizontal + Math.cos(angle) * node.radius,
                node.vertical + Math.sin(angle) * node.radius,
                node.cross,
                direction
            ),
            rotationOffset: 0
        });
    }
}

function buildTrackPath(track, segmentLength) {
    const direction = track.trackDirection || 'z';
    const sourceNodes = track.getPathNodes();
    if (sourceNodes.length < 2) return null;

    const planeNodes = sourceNodes.map(node => getPlaneNode(node, direction));
    const solution = solveTrackEnvelope(track, planeNodes);
    if (!solution) return null;
    const {nodes, tangents, winding} = solution;

    const points = [];
    nodes.forEach((node, index) => {
        if (node.radius <= EPSILON) {
            addPathPoint(points, {
                position: planeToWorld(node.horizontal, node.vertical, node.cross, direction),
                rotationOffset: node.rotationOffset
            });
            return;
        }

        const incoming = tangents[(index - 1 + nodes.length) % nodes.length].end;
        const outgoing = tangents[index].start;
        appendWheelArc(points, node, incoming, outgoing, winding, direction, segmentLength);
    });

    if (points.length > 2 && points[0].position.distanceToSquared(points[points.length - 1].position) <= EPSILON * EPSILON) {
        points.pop();
    }
    if (points.length < 2) return null;

    const distances = [0];
    let totalDistance = 0;
    for (let index = 1; index <= points.length; index++) {
        const previous = points[index - 1].position;
        const current = points[index % points.length].position;
        const fragmentLength = previous.distanceTo(current);
        if (fragmentLength <= EPSILON) continue;
        totalDistance += fragmentLength;
        distances.push(totalDistance);
    }
    if (totalDistance <= EPSILON || distances.length !== points.length + 1) return null;

    return {
        points,
        distances,
        totalDistance,
        segmentCount: Math.max(1, Math.floor(totalDistance / segmentLength)),
        direction,
        winding
    };
}

function findDistanceSegment(distances, distance) {
    let low = 1;
    let high = distances.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (distances[middle] < distance) low = middle + 1;
        else high = middle;
    }
    return low;
}

function sampleTrackPath(path, distance) {
    const wrapped = ((distance % path.totalDistance) + path.totalDistance) % path.totalDistance;
    const distanceIndex = findDistanceSegment(path.distances, wrapped);
    const pointIndex = distanceIndex - 1;
    const nextIndex = distanceIndex % path.points.length;
    const startDistance = path.distances[distanceIndex - 1];
    const endDistance = path.distances[distanceIndex];
    const length = Math.max(EPSILON, endDistance - startDistance);
    const factor = Math.clamp((wrapped - startDistance) / length, 0, 1);

    const start = path.points[pointIndex];
    const end = path.points[nextIndex];
    const position = new THREE.Vector3().lerpVectors(start.position, end.position, factor);
    const tangent = new THREE.Vector3().subVectors(end.position, start.position).normalize();
    const rotationOffset = THREE.MathUtils.lerp(start.rotationOffset || 0, end.rotationOffset || 0, factor);

    const horizontalTangent = path.direction === 'x' ? tangent.x : tangent.z;
    const verticalTangent = tangent.y;
    const outwardHorizontal = path.winding < 0 ? -verticalTangent : verticalTangent;
    const outwardVertical = path.winding < 0 ? horizontalTangent : -horizontalTangent;

    const localX = tangent;
    const localY = planeVectorToWorld(outwardHorizontal, outwardVertical, 0, path.direction).normalize();
    const localZ = new THREE.Vector3().crossVectors(localX, localY).normalize();
    localY.crossVectors(localZ, localX).normalize();

    const basis = new THREE.Matrix4().makeBasis(localX, localY, localZ);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
    if (Math.abs(rotationOffset) > EPSILON) {
        quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotationOffset));
    }
    return {position, quaternion};
}

function resetTrackPreviewCache(element) {
    const cache = element._trackPreviewCache;
    if (cache?.container) {
        cache.container.parent?.remove(cache.container);
        // Segment clones share geometry and materials with the cached GLTF model.
        // Remove them without disposing those shared resources.
        disposeObjectChildren(cache.container, false);
    }
    element._trackPreviewCache = null;
}

function ensureSegmentInstances(element, segmentModel, filename, count, forceRebuild) {
    let cache = element._trackPreviewCache;
    const mustRebuild = forceRebuild || !cache || cache.filename !== filename || cache.count !== count;
    if (!mustRebuild) return cache;

    resetTrackPreviewCache(element);
    const container = new THREE.Group();
    container.name = 'track_segments';
    element.mesh.add(container);

    const instances = [];
    for (let index = 0; index < count; index++) {
        const instance = segmentModel.clone(true);
        instance.matrixAutoUpdate = true;
        container.add(instance);
        instances.push(instance);
    }

    cache = {filename, count, container, instances};
    element._trackPreviewCache = cache;
    return cache;
}

// ----------------------------------------------------------------------
// Track preview controller
// ----------------------------------------------------------------------
new NodePreviewController(Track, {
    async setup(element) {
        createPreviewObject(element);
        this.updateTransform(element);
        await this.updateGeometry(element, true);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        const object = element.mesh;
        object.position.fromArray(element.position);
        object.rotation.setFromDegreeArray(element.rotation);
        object.scale.fromArray(element.scale);
        attachPreviewObject(element, true);
        this.updateGeometry(element);
        this.dispatchEvent('update_transform', {element});
    },

    async updateGeometry(element, forceRebuild = false) {
        const updateToken = element._trackGeometryUpdateToken = (element._trackGeometryUpdateToken || 0) + 1;
        if (!element.mesh || element.getPathNodes().length < 2) {
            resetTrackPreviewCache(element);
            return;
        }

        let segmentModel;
        try {
            segmentModel = await loadSegmentModel(element.segmentModel);
        } catch (error) {
            console.warn(`Failed to load track segment model "${element.segmentModel}":`, error);
            return;
        }
        if (updateToken !== element._trackGeometryUpdateToken) return;

        const segmentLength = getSegmentLength(element.segmentModel, segmentModel);
        if (!(segmentLength > EPSILON)) {
            console.warn(`Track segment model "${element.segmentModel}" has zero length`);
            return;
        }

        const path = buildTrackPath(element, segmentLength);
        if (!path) {
            resetTrackPreviewCache(element);
            return;
        }

        const cache = ensureSegmentInstances(
            element,
            segmentModel,
            element.segmentModel,
            path.segmentCount,
            forceRebuild
        );
        const step = path.totalDistance / path.segmentCount;
        const progressOffset = -clamp01(element.progress) * path.totalDistance;

        cache.instances.forEach((instance, index) => {
            const sample = sampleTrackPath(path, index * step + progressOffset);
            instance.position.copy(sample.position);
            instance.quaternion.copy(sample.quaternion);
            instance.updateMatrix();
        });

        element._compiledTrackPath = path;
        this.dispatchEvent('update_geometry', {element});
    },

    updateVisibility(element) {
        element.mesh.visible = element.visibility;
        this.dispatchEvent('update_visibility', {element});
    },

    updateSelection(element) {
        this.dispatchEvent('update_selection', {element});
    }
});

// ----------------------------------------------------------------------
// Scalar animation support
// ----------------------------------------------------------------------
let scalarKeyframeProperties = [];

function registerScalarKeyframeProperties() {
    if (typeof KeyframeDataPoint === 'undefined') return;

    if (!KeyframeDataPoint.properties.ii_track_progress) {
        scalarKeyframeProperties.push(new Property(KeyframeDataPoint, 'molang', 'ii_track_progress', {
            label: 'Progress',
            default: '0',
            condition: point => point.keyframe.channel === 'progress'
        }));
    }
    if (!KeyframeDataPoint.properties.ii_track_compression) {
        scalarKeyframeProperties.push(new Property(KeyframeDataPoint, 'molang', 'ii_track_compression', {
            label: 'Compression',
            default: '0',
            condition: point => point.keyframe.channel === 'compression'
        }));
    }
    if (!KeyframeDataPoint.properties.ii_track_rotation) {
        scalarKeyframeProperties.push(new Property(KeyframeDataPoint, 'molang', 'ii_track_rotation', {
            label: 'Rotation',
            default: '0',
            condition: point => point.keyframe.channel === 'rotation'
        }));
    }
}

function getScalarPropertyName(channel) {
    if (channel === 'compression') return 'ii_track_compression';
    if (channel === 'rotation') return 'ii_track_rotation';
    return 'ii_track_progress';
}

function normaliseScalarValue(channel, value) {
    const number = Number(value) || 0;
    return channel === 'rotation' ? number : clamp01(number);
}

function getElementScalarValue(element, channel) {
    return channel === 'rotation' ? (Number(element?.wheelRotation) || 0) : (Number(element?.[channel]) || 0);
}

function keyframeScalarProperty(element, channel, value) {
    if (!Modes.animate || !Animator.open || !Animation.selected || !element.constructor.animator) return;
    const animator = Animation.selected.getBoneAnimator(element);
    if (!animator || !animator.channels?.[channel]) return;

    const result = animator.getOrMakeKeyframe(channel)?.result;
    if (!result) return;
    result.set(getScalarPropertyName(channel), normaliseScalarValue(channel, value));
    Animation.selected.setLength();
    Animator.preview();
}

function readScalarKeyframe(keyframe) {
    if (!keyframe) return 0;
    const property = getScalarPropertyName(keyframe.channel);
    const point = keyframe.data_points?.[0];

    // Older IIToolkit builds stored the scalar in x (or in an unregistered value field).
    // Prefer that legacy value when the new property only contains its untouched default.
    const legacyValue = point?.x ?? point?.value;
    const currentRaw = point?.[property];
    const useLegacy = legacyValue !== undefined && (currentRaw === undefined || String(currentRaw) === '0');
    const selectedProperty = useLegacy && point?.x !== undefined ? 'x' : property;

    if (typeof keyframe.calc === 'function') {
        const calculated = keyframe.calc(selectedProperty);
        if (Number.isFinite(Number(calculated))) return Number(calculated);
    }
    const value = useLegacy ? legacyValue : currentRaw;
    return Number(value) || 0;
}

class ScalarElementAnimator extends GeneralAnimator {
    constructor(uuid, animation) {
        super(uuid, animation);
        this[this.constructor.scalarChannel] = [];
        this.name = this.getElement()?.name || this.constructor.displayName;
    }

    getElement() {
        this.element = OutlinerNode.uuids[this.uuid];
        return this.element;
    }

    select(elementIsSelected) {
        if (!this.getElement()) {
            unselectAllElements();
            return this;
        }
        if (this.element.locked) return this;
        if (elementIsSelected !== true) this.element.select();
        GeneralAnimator.prototype.select.call(this);

        const channel = this.constructor.scalarChannel;
        if (this[channel] && (Timeline.selected.length === 0 || Timeline.selected[0].animator !== this)) {
            const nearest = this[channel].find(keyframe => Math.abs(keyframe.time - Timeline.time) < 0.002);
            if (nearest) nearest.select();
        }
        if (this.element.parent && this.element.parent !== 'root') this.element.parent.openUp();
        return this;
    }

    doRender() {
        return this.getElement() && this.element.mesh;
    }

    displayFrame() {
        if (!this.doRender()) return;
        const channel = this.constructor.scalarChannel;
        if (this.muted[channel]) return;
        this.constructor.applyValue(this.element, normaliseScalarValue(channel, this.interpolate(channel)));
    }

    interpolate(channel) {
        if (channel !== this.constructor.scalarChannel) return 0;
        const keyframes = this[channel];
        if (!keyframes.length) return getElementScalarValue(this.getElement(), channel);

        const time = this.animation.time;
        let before = null;
        let after = null;
        let beforeTime = 0;
        let afterTime = 0;
        for (const keyframe of keyframes) {
            if (keyframe.time <= time && (!before || keyframe.time > beforeTime)) {
                before = keyframe;
                beforeTime = keyframe.time;
            }
            if (keyframe.time >= time && (!after || keyframe.time < afterTime)) {
                after = keyframe;
                afterTime = keyframe.time;
            }
        }

        if (Format.animation_loop_wrapping && this.animation.loop === 'loop' && keyframes.length >= 2) {
            if (!before) {
                before = keyframes.reduce((result, keyframe) => !result || keyframe.time > result.time ? keyframe : result, null);
                beforeTime = before.time - this.animation.length;
            }
            if (!after) {
                after = keyframes.reduce((result, keyframe) => !result || keyframe.time < result.time ? keyframe : result, null);
                afterTime = after.time + this.animation.length;
            }
        }

        if (before && Math.abs(beforeTime - time) < 1 / 1200) return readScalarKeyframe(before);
        if (after && Math.abs(afterTime - time) < 1 / 1200) return readScalarKeyframe(after);
        if (before && !after) return readScalarKeyframe(before);
        if (after && !before) return readScalarKeyframe(after);
        if (!before || !after) return 0;
        if (before.interpolation === 'step') return readScalarKeyframe(before);

        const factor = Math.getLerp(beforeTime, afterTime, time);
        const beforeValue = readScalarKeyframe(before);
        return beforeValue + (readScalarKeyframe(after) - beforeValue) * factor;
    }

    createKeyframe(value, time, channel, undo, select) {
        if (channel !== this.constructor.scalarChannel) return super.createKeyframe(value, time, channel, undo, select);
        if (typeof time !== 'number') time = Timeline.time;

        const keyframes = [];
        if (undo) Undo.initEdit({keyframes});

        const keyframe = new Keyframe({
            channel,
            time,
            interpolation: settings.default_keyframe_interpolation.value,
        }, null, this);
        keyframes.push(keyframe);

        let scalar;
        if (typeof value === 'number') scalar = value;
        else if (value && typeof value === 'object') {
            scalar = value.x ?? value.value ?? value.data_points?.[0]?.x;
        }
        if (scalar === undefined || scalar === null || scalar === '') scalar = getElementScalarValue(this.getElement(), channel);
        keyframe.set(getScalarPropertyName(channel), normaliseScalarValue(channel, scalar));

        keyframe.channel = channel;
        keyframe.time = Timeline.snapTime(time);
        this[channel].push(keyframe);
        keyframe.animator = this;
        if (select !== false) keyframe.select();

        const deleted = [];
        delete keyframe.time_before;
        keyframe.replaceOthers(deleted);
        if (deleted.length && Undo.current_save) Undo.addKeyframeCasualties(deleted);
        Animation.selected.setLength();
        if (undo) Undo.finishEdit('Add keyframe');
        return keyframe;
    }
}

export class TrackAnimator extends ScalarElementAnimator {}
TrackAnimator.scalarChannel = 'progress';
TrackAnimator.displayName = 'Track';
TrackAnimator.applyValue = (element, value) => {
    element.progress = value;
    Track.preview_controller.updateGeometry(element);
};
TrackAnimator.prototype.type = 'track';
TrackAnimator.prototype.channels = {
    progress: {name: 'Progress', mutable: true, transform: false, max_data_points: 1}
};
Track.animator = TrackAnimator;

export class TrackSuspenderAnimator extends ScalarElementAnimator {}
TrackSuspenderAnimator.scalarChannel = 'compression';
TrackSuspenderAnimator.displayName = 'Track Suspender';
TrackSuspenderAnimator.applyValue = (element, value) => {
    element.compression = value;
    TrackSuspender.preview_controller.updateGeometry(element);
};
TrackSuspenderAnimator.prototype.type = 'track_suspender';
TrackSuspenderAnimator.prototype.channels = {
    compression: {name: 'Compression', mutable: true, transform: false, max_data_points: 1}
};
TrackSuspender.animator = TrackSuspenderAnimator;

export class TrackWheelAnimator extends ScalarElementAnimator {}
TrackWheelAnimator.scalarChannel = 'rotation';
TrackWheelAnimator.displayName = 'Track Wheel';
TrackWheelAnimator.applyValue = (element, value) => {
    element.wheelRotation = value;
    applyWheelRotation(element);
};
TrackWheelAnimator.prototype.type = 'track_wheel';
TrackWheelAnimator.prototype.channels = {
    rotation: {name: 'Rotation', mutable: true, transform: false, max_data_points: 1}
};
TrackWheel.animator = TrackWheelAnimator;

// ----------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------
let addTrackAction;
let addTrackLinkAction;
let addTrackSuspenderAction;
let addTrackWheelAction;
let addTrackVisualMeshAction;

function getSelectedTrack() {
    if (Track.hasSelected()) return Track.selected[0];
    if (TrackLink.hasSelected()) return TrackLink.selected[0].getTrack();
    if (TrackSuspender.hasSelected()) return TrackSuspender.selected[0].getTrack();
    if (TrackWheel.hasSelected()) return TrackWheel.selected[0].getTrack();
    return null;
}

function getSelectedSuspender() {
    if (TrackSuspender.hasSelected()) return TrackSuspender.selected[0];
    if (TrackWheel.hasSelected()) return TrackWheel.selected[0].getSuspender();
    return null;
}

function getSelectedVisualParent() {
    if (TrackWheel.hasSelected()) return TrackWheel.selected[0];
    if (TrackSuspender.hasSelected()) return TrackSuspender.selected[0];
    return null;
}

function nextNodeOrigin(track) {
    const nodes = track.getPathNodes();
    if (!nodes.length) return [0, 0, 0];
    const last = nodes[nodes.length - 1];
    const origin = last.origin.slice();
    const rearwardStep = -getTrackAxisSign(track) * 2;
    if (track.trackDirection === 'x') origin[0] += rearwardStep;
    else origin[2] += rearwardStep;
    return origin;
}

function createActions() {
    addTrackAction = new Action('add_track', {
        name: 'Add Track',
        icon: 'orthopedics',
        category: 'edit',
        condition: () => Modes.edit,
        click() {
            Undo.initEdit({outliner: true, elements: [], selection: true});
            const track = new Track().init();
            track.addTo(getCurrentGroup());
            track.createUniqueName();
            unselectAll();
            track.select();
            Undo.finishEdit('Add Track', {outliner: true, elements: selected, selection: true});
            Blockbench.dispatchEvent('add_track', {object: track});
            return track;
        }
    });

    // Keep the legacy action ID so existing menus and keybindings continue to work.
    addTrackLinkAction = new Action('add_track_node', {
        name: 'Add Track Link',
        icon: 'timeline',
        category: 'edit',
        condition: () => Modes.edit && !!getSelectedTrack(),
        click() {
            const track = getSelectedTrack();
            if (!track) return null;

            Undo.initEdit({outliner: true, elements: [], selection: true});
            const link = new TrackLink().init();
            link.origin = nextNodeOrigin(track);
            link.addTo(track);
            rebuildTrackLinkVisual(link);
            TrackLink.preview_controller.updateTransform(link);
            link.createUniqueName();
            unselectAll();
            link.select();
            Undo.finishEdit('Add Track Link', {outliner: true, elements: selected, selection: true});
            Track.preview_controller.updateGeometry(track);
            Blockbench.dispatchEvent('add_track_node', {object: link});
            return link;
        }
    });

    addTrackSuspenderAction = new Action('add_track_suspender', {
        name: 'Add Track Suspender',
        icon: 'vertical_align_center',
        category: 'edit',
        condition: () => Modes.edit && !!getSelectedTrack(),
        click() {
            const track = getSelectedTrack();
            if (!track) return null;

            Undo.initEdit({outliner: true, elements: [], selection: true});
            const suspender = new TrackSuspender().init();
            suspender.origin = nextNodeOrigin(track);
            suspender.addTo(track);
            TrackSuspender.preview_controller.updateTransform(suspender);
            suspender.createUniqueName();
            unselectAll();
            suspender.select();
            Undo.finishEdit('Add Track Suspender', {outliner: true, elements: selected, selection: true});
            Blockbench.dispatchEvent('add_track_suspender', {object: suspender});
            return suspender;
        }
    });

    addTrackWheelAction = new Action('add_track_wheel', {
        name: 'Add Track Wheel',
        icon: 'radio_button_unchecked',
        category: 'edit',
        condition: () => {
            if (!Modes.edit) return false;
            if (Track.hasSelected()) return true;
            const suspender = getSelectedSuspender();
            return !!suspender && !suspender.getWheel();
        },
        click() {
            const suspender = getSelectedSuspender();
            const directTrack = Track.hasSelected() ? Track.selected[0] : null;
            const parent = suspender || directTrack;
            if (!parent || (suspender && suspender.getWheel())) return null;

            const track = parent instanceof Track ? parent : parent.getTrack();
            if (!track) return null;

            Undo.initEdit({outliner: true, elements: [], selection: true});
            const wheel = new TrackWheel().init();
            if (parent instanceof Track) wheel.origin = nextNodeOrigin(track);
            wheel.addTo(parent);
            TrackWheel.preview_controller.updateTransform(wheel);
            wheel.createUniqueName();
            unselectAll();
            wheel.select();
            Undo.finishEdit('Add Track Wheel', {outliner: true, elements: selected, selection: true});
            Track.preview_controller.updateGeometry(track);
            Blockbench.dispatchEvent('add_track_wheel', {object: wheel, parent});
            return wheel;
        }
    });

    addTrackVisualMeshAction = new Action('add_track_visual_mesh', {
        name: 'Add Visual Mesh',
        icon: 'polyline',
        category: 'edit',
        condition: () => Modes.edit && !!getSelectedVisualParent(),
        click() {
            const parent = getSelectedVisualParent();
            if (!parent) return null;

            Undo.initEdit({outliner: true, elements: [], selection: true});
            const mesh = new Mesh({name: parent instanceof TrackWheel ? 'wheel_visual' : 'suspension_visual'}).init();
            mesh.addTo(parent);
            mesh.createUniqueName();
            unselectAll();
            mesh.select();
            Undo.finishEdit('Add Track Visual Mesh', {outliner: true, elements: selected, selection: true});
            Canvas.updateAll();
            return mesh;
        }
    });

    deletables.push(
        addTrackAction,
        addTrackLinkAction,
        addTrackSuspenderAction,
        addTrackWheelAction,
        addTrackVisualMeshAction
    );
}

// ----------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------
export function registerTrack() {
    if (registered) return;
    registerScalarKeyframeProperties();
    createActions();

    BarItems.add_element.side_menu.addAction(addTrackAction);

    window.Track = Track;
    window.TrackLink = TrackLink;
    window.TrackNode = TrackLink;
    window.TrackSuspender = TrackSuspender;
    window.TrackWheel = TrackWheel;
    window.TrackAnimator = TrackAnimator;
    window.TrackSuspenderAnimator = TrackSuspenderAnimator;
    window.TrackWheelAnimator = TrackWheelAnimator;
    registered = true;
}

export function unregisterTrackActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
    scalarKeyframeProperties.forEach(property => property.delete?.());
    scalarKeyframeProperties = [];
    registered = false;
}
