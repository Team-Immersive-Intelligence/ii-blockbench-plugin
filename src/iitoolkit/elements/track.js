import '../GLTFLoader';

const ASSET_BASE = 'https://assets.iiteam.net/model/track/';

let deletables = [];
let registered = false;

const modelCache = new Map();
const segmentFileMap = {
    "motor_belt_cloth.glb": "Cloth Motor Belt",
    "motor_belt_rubber.glb": "Rubber Motor Belt",
    "tracks_heavy_14.glb": "Heavy Tracks (14px)",
    "tracks_light_8.glb": "Light Tracks (8px)"
};

// ----------------------------------------------------------------------
// TrackNode – defines a path node with position and rotation.
// ----------------------------------------------------------------------
export class TrackNode extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        for (let key in TrackNode.properties) {
            TrackNode.properties[key].reset(this);
        }
        this.name = 'node';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;

        if (typeof data === 'object') {
            this.extend(data);
        } else if (typeof data === 'string') {
            this.name = data;
        }
    }

    get position() {
        return this.origin;
    }

    extend(object) {
        for (let key in TrackNode.properties) {
            TrackNode.properties[key].merge(this, object);
        }
        Merge.string(this, object, 'name');
        this.sanitizeName();
        Merge.boolean(this, object, 'export');
        Merge.boolean(this, object, 'locked');
        Merge.boolean(this, object, 'visibility');
        return this;
    }

    getTrack() {
        let parent = this.parent;
        while (parent instanceof Track === false && parent instanceof OutlinerNode) {
            parent = parent.parent;
        }
        return parent instanceof Track ? parent : null;
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) {
            TrackNode.preview_controller.setup(this);
        }
        return this;
    }

    select(event, isOutlinerClick) {
        let result = super.select(event, isOutlinerClick);
        if (result == false) return false;
        if (Animator.open && Animation.selected) {
            Animation.selected.getBoneAnimator(this)?.select(true);
        }
        return this;
    }

    markAsSelected(descendants) {
        Outliner.selected.safePush(this);
        this.selected = true;
        if (descendants) {
            this.children.forEach(child => child.markAsSelected(true));
        }
        TickUpdates.selection = true;
        return this;
    }

    openUp() {
        this.isOpen = true;
        this.updateElement();
        if (this.parent && this.parent !== 'root') {
            this.parent.openUp();
        }
        return this;
    }

    getWorldCenter() {
        return THREE.fastWorldPosition(this.mesh, new THREE.Vector3());
    }

    flip(axis, center) {
        let offset = this.position[axis] - center;
        this.position[axis] = center - offset;
        this.rotation.forEach((n, i) => {
            if (i != axis) this.rotation[i] = -n;
        });
        flipNameOnAxis(this, axis);
        this.createUniqueName();
        TrackNode.preview_controller.updateTransform(this);
        return this;
    }

    getSaveCopy() {
        let copy = {
            isOpen: this.isOpen,
            uuid: this.uuid,
            type: this.type,
            name: this.name,
            children: this.children.map(c => c.uuid),
        };
        for (let key in TrackNode.properties) {
            TrackNode.properties[key].merge(copy, this);
        }
        return copy;
    }

    getUndoCopy() {
        let copy = {
            isOpen: this.isOpen,
            uuid: this.uuid,
            type: this.type,
            name: this.name,
            children: this.children.map(c => c.uuid),
        };
        for (let key in TrackNode.properties) {
            TrackNode.properties[key].merge(copy, this);
        }
        return copy;
    }

    getChildlessCopy(keep_uuid = false) {
        let base_node = new TrackNode({name: this.name}, keep_uuid ? this.uuid : null);
        for (let key in TrackNode.properties) {
            TrackNode.properties[key].copy(this, base_node);
        }
        base_node.name = this.name;
        base_node.origin.V3_set(this.origin);
        base_node.rotation.V3_set(this.rotation);
        base_node.locked = this.locked;
        base_node.visibility = this.visibility;
        base_node.export = this.export;
        base_node.isOpen = this.isOpen;
        return base_node;
    }

    forEachChild(cb, type, forSelf) {
        let i = 0;
        if (forSelf) cb(this);
        while (i < this.children.length) {
            if (!type || (type instanceof Array ? type.find(t2 => this.children[i] instanceof t2) : this.children[i] instanceof type)) {
                cb(this.children[i]);
            }
            if (this.children[i].forEachChild) {
                this.children[i].forEachChild(cb, type);
            }
            i++;
        }
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

TrackNode.prototype.title = 'Track Node';
TrackNode.prototype.type = 'track_node';
TrackNode.prototype.icon = 'link';
TrackNode.prototype.buttons = [
    Outliner.buttons.locked,
    Outliner.buttons.visibility,
];
TrackNode.prototype.menu = new Menu([
    'rename',
    'delete'
]);

OutlinerElement.registerType(TrackNode, 'track_node');

new Property(TrackNode, 'vector', 'origin', {default: [0, 0, 0]});
new Property(TrackNode, 'vector', 'rotation');
new Property(TrackNode, 'boolean', 'visibility', {default: true});

new NodePreviewController(TrackNode, {
    setup(element) {
        let object_3d = new THREE.Object3D();
        object_3d.rotation.order = 'ZYX';
        object_3d.uuid = element.uuid.toUpperCase();
        object_3d.name = element.name;
        object_3d.isElement = true;
        object_3d.no_export = true;
        Project.nodes_3d[element.uuid] = object_3d;

        // Visual representation: sphere at origin, arrow pointing forward (+Z)
        const sphereGeom = new THREE.SphereGeometry(0.3, 8, 8);
        const sphereMat = new THREE.MeshStandardMaterial({
            color: 0x44aaff,
            emissive: new THREE.Color(0x224466),
            emissiveIntensity: 0.5
        });
        const sphere = new THREE.Mesh(sphereGeom, sphereMat);
        object_3d.add(sphere);

        const arrowGeom = new THREE.ConeGeometry(0.2, 0.8, 8);
        const arrowMat = new THREE.MeshStandardMaterial({color: 0xffaa00});
        const arrow = new THREE.Mesh(arrowGeom, arrowMat);
        arrow.position.z = 0.6;
        arrow.rotation.x = Math.PI / 2;
        object_3d.add(arrow);

        this.updateTransform(element);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        let obj = element.mesh;
        obj.rotation.order = Format.euler_order;
        obj.rotation.setFromDegreeArray(element.rotation);
        obj.position.fromArray(element.origin);
        obj.scale.set(1, 1, 1);

        if (element.parent instanceof OutlinerNode) {
            element.parent.scene_object.add(obj);
        } else if (obj.parent) {
            obj.parent.remove(obj);
        }
        obj.updateMatrixWorld();

        if (element.parent instanceof Track) {
            Track.preview_controller.updateGeometry(element.parent);
        }

        this.dispatchEvent('update_transform', {element});
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
// Track – contains TrackNodes and draws repeating segment models.
// ----------------------------------------------------------------------
export class Track extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        for (let key in Track.properties) {
            Track.properties[key].reset(this);
        }
        this.name = 'track';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;
        this.origin = [0, 0, 0];
        this.progress = 0;  // 0 to 1

        if (typeof data === 'object') {
            this.extend(data);
        } else if (typeof data === 'string') {
            this.name = data;
        }
    }

    extend(object) {
        for (let key in Track.properties) {
            Track.properties[key].merge(this, object);
        }
        Merge.string(this, object, 'name');
        this.sanitizeName();
        Merge.boolean(this, object, 'export');
        Merge.boolean(this, object, 'locked');
        Merge.boolean(this, object, 'visibility');
        return this;
    }

    getMesh() {
        return this.mesh;
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) {
            Track.preview_controller.setup(this);
        }
        return this;
    }

    markAsSelected(descendants) {
        Outliner.selected.safePush(this);
        this.selected = true;
        if (descendants) {
            this.children.forEach(child => child.markAsSelected(true));
        }
        TickUpdates.selection = true;
        return this;
    }

    openUp() {
        this.isOpen = true;
        this.updateElement();
        if (this.parent && this.parent !== 'root') {
            this.parent.openUp();
        }
        return this;
    }

    getSaveCopy() {
        let copy = {
            isOpen: this.isOpen,
            uuid: this.uuid,
            type: this.type,
            name: this.name,
            children: this.children.map(c => c.uuid),
        };
        for (let key in Track.properties) {
            Track.properties[key].merge(copy, this);
        }
        return copy;
    }

    getUndoCopy() {
        let copy = {
            isOpen: this.isOpen,
            uuid: this.uuid,
            type: this.type,
            name: this.name,
            children: this.children.map(c => c.uuid),
        };
        for (let key in Track.properties) {
            Track.properties[key].merge(copy, this);
        }
        return copy;
    }

    getChildlessCopy(keep_uuid = false) {
        let base_track = new Track({name: this.name}, keep_uuid ? this.uuid : null);
        for (let key in Track.properties) {
            Track.properties[key].copy(this, base_track);
        }
        base_track.name = this.name;
        base_track.locked = this.locked;
        base_track.visibility = this.visibility;
        base_track.export = this.export;
        base_track.isOpen = this.isOpen;
        return base_track;
    }

    forEachChild(cb, type, forSelf) {
        let i = 0;
        if (forSelf) cb(this);
        while (i < this.children.length) {
            if (!type || (type instanceof Array ? type.find(t2 => this.children[i] instanceof t2) : this.children[i] instanceof type)) {
                cb(this.children[i]);
            }
            if (this.children[i].forEachChild) {
                this.children[i].forEachChild(cb, type);
            }
            i++;
        }
    }

    getAllNodes() {
        let nodes = [];
        this.forEachChild(child => {
            if (child instanceof TrackNode) nodes.push(child);
        });
        return nodes;
    }

    static behavior = {
        unique_name: false,
        movable: true,
        rotatable: true,
        parent: true,
        child_types: ['track_node'],
    };

    static preview_controller;
}

Track.prototype.title = 'Track';
Track.prototype.type = 'track';
Track.prototype.icon = 'orthopedics';
Track.prototype.buttons = [
    Outliner.buttons.locked,
    Outliner.buttons.visibility,
];
Track.prototype.menu = new Menu([
    'add_track_node',
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
            input: {
                label: 'Segment Model',
                type: 'select',
                options: segmentFileMap
            },
            onChange() {
                Track.selected.forEach(el => Track.preview_controller.updateGeometry(el));
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
                Track.selected.forEach(el => Track.preview_controller.updateGeometry(el));
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
            input: {
                label: 'Progress',
                type: 'num_slider',
                min: 0.0,
                max: 1.0,
                step: 0.01
            },
            onChange() {
                Track.selected.forEach(el => Track.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Track, 'boolean', 'visibility', {default: true});

// ----------------------------------------------------------------------
// Model loading and helpers
// ----------------------------------------------------------------------
async function loadSegmentModel(filename) {
    if (modelCache.has(filename)) {
        return modelCache.get(filename).clone();
    }
    const url = ASSET_BASE + filename;
    return new Promise((resolve, reject) => {
        new THREE.GLTFLoader().load(url,
            (gltf) => {
                const model = gltf.scene;
                model.traverse(node => {
                    if (node.isMesh && node.material) {
                        node.receiveShadow = true;
                        const materials = Array.isArray(node.material) ? node.material : [node.material];
                        materials.forEach(mat => {
                            mat.roughness = 1.0;
                            mat.metalness = 0.0;
                            mat.emissive = new THREE.Color(0x7f7f7f);
                            mat.emissiveIntensity = 0.125 * 3;
                        });
                    }
                });
                modelCache.set(filename, model.clone(true));
                resolve(model);
            },
            undefined,
            reject
        );
    });
}

function getSegmentLength(model) {
    let minX = Infinity, maxX = -Infinity;
    model.traverse(node => {
        if (node.isMesh) {
            const bbox = new THREE.Box3().setFromObject(node);
            if (!bbox.isEmpty()) {
                minX = Math.min(minX, bbox.min.x);
                maxX = Math.max(maxX, bbox.max.x);
            }
        }
    });
    return maxX - minX;
}

function getSortedNodes(track) {
    return track.getAllNodes()
        .filter(n => n.visibility)
        .sort((a, b) => {
            const numA = parseInt(a.name.match(/\d+$/)?.[0] || '0');
            const numB = parseInt(b.name.match(/\d+$/)?.[0] || '0');
            return numA - numB;
        });
}

// ----------------------------------------------------------------------
// Track Preview Controller
// ----------------------------------------------------------------------
new NodePreviewController(Track, {
    async setup(element) {
        let object_3d = new THREE.Object3D();
        object_3d.rotation.order = 'ZYX';
        object_3d.uuid = element.uuid.toUpperCase();
        object_3d.name = element.name;
        object_3d.isElement = true;
        object_3d.no_export = true;
        Project.nodes_3d[element.uuid] = object_3d;

        this.updateTransform(element);
        await this.updateGeometry(element);

        this.dispatchEvent('setup', { element });
    },

    updateTransform(element) {
        let obj = element.mesh;
        obj.position.fromArray(element.position);
        obj.rotation.setFromDegreeArray(element.rotation);
        obj.scale.fromArray(element.scale);

        if (element.parent instanceof OutlinerNode) {
            element.parent.scene_object.add(obj);
        } else if (obj.parent !== Project.model_3d) {
            Project.model_3d.add(obj);
        }

        obj.updateMatrixWorld();
        this.updateGeometry(element);
        this.dispatchEvent('update_transform', { element });
    },

    async updateGeometry(element) {
        const group = element.mesh;
        let segmentContainer = group.getObjectByName('track_segments');
        if (!segmentContainer) {
            segmentContainer = new THREE.Group();
            segmentContainer.name = 'track_segments';
            group.add(segmentContainer);
        }
        while (segmentContainer.children.length) {
            segmentContainer.remove(segmentContainer.children[0]);
        }

        const nodes = getSortedNodes(element);
        if (nodes.length < 2) return;

        let segmentModel;
        try {
            segmentModel = await loadSegmentModel(element.segmentModel);
        } catch (e) {
            console.warn(`Failed to load segment model "${element.segmentModel}":`, e);
            const geom = new THREE.BoxGeometry(1, 0.3, 0.3);
            const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
            segmentContainer.add(new THREE.Mesh(geom, mat));
            return;
        }

        const segmentLength = getSegmentLength(segmentModel);
        if (segmentLength <= 0) {
            console.warn('Segment model has zero length');
            return;
        }

        // Collect positions and node pitch values
        const points = [];
        const nodePitches = [];
        const direction = element.trackDirection || 'z';

        for (const node of nodes) {
            const pos = new THREE.Vector3(node.origin[0], node.origin[1], node.origin[2]);
            points.push(pos);

            // Pitch from node rotation (Z for X direction, X for Z direction)
            let pitchDeg = (direction === 'x') ? node.rotation[2] : node.rotation[0];
            nodePitches.push(pitchDeg * Math.PI / 180);
        }

        // Duplicate first point to close the loop
        const loopPoints = points.concat(points[0]);
        const loopPitches = nodePitches.concat(nodePitches[0]);

        // Compute cumulative distances
        const distances = [0];
        let totalDist = 0;
        for (let i = 1; i < loopPoints.length; i++) {
            const dist = loopPoints[i].distanceTo(loopPoints[i-1]);
            totalDist += dist;
            distances.push(totalDist);
        }

        if (totalDist <= 0) return;

        const numSegments = Math.max(1, Math.floor(totalDist / segmentLength));
        const step = totalDist / numSegments;

        // Progress offset (0 to 1)
        const progress = element.progress || 0;

        const sampleAtDistance = (d) => {
            d = (d + progress * totalDist) % totalDist;
            // Find segment
            let i = 1;
            while (i < distances.length && distances[i] < d) i++;

            const t = (d - distances[i-1]) / (distances[i] - distances[i-1]);

            // Interpolate position
            const p1 = loopPoints[i-1];
            const p2 = loopPoints[i];
            const pos = new THREE.Vector3().lerpVectors(p1, p2, t);

            // Compute direction vector (tangent)
            const dir = new THREE.Vector3().subVectors(p2, p1).normalize();

            // Compute incline pitch from height difference
            let inclinePitch;
            if (direction === 'x') {
                inclinePitch = Math.atan2(dir.y, dir.x);
            } else {
                inclinePitch = Math.atan2(dir.y, dir.z);
            }

            // Interpolate node pitch
            const pitch1 = loopPitches[i-1];
            const pitch2 = loopPitches[i];
            const nodePitch = (1 - t) * pitch1 + t * pitch2;

            const totalPitch = inclinePitch + nodePitch;

            // Build quaternion
            const quat = new THREE.Quaternion();

            if (direction === 'x') {
                // Rotate around Z by totalPitch
                quat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), totalPitch);
            } else {
                // Direction Z: first rotate +90° around Y, then apply pitch around X
                const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
                const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), totalPitch);
                quat.multiplyQuaternions(yawQuat, pitchQuat);
            }

            return { pos, quat };
        };

        // Place segment instances
        for (let i = 0; i < numSegments; i++) {
            const d = i * step;
            const { pos, quat } = sampleAtDistance(d);

            const instance = segmentModel.clone(true);
            instance.position.copy(pos);
            instance.quaternion.copy(quat);

            segmentContainer.add(instance);
        }

        this.dispatchEvent('update_geometry', { element });
    },

    updateVisibility(element) {
        element.mesh.visible = element.visibility;
        this.dispatchEvent('update_visibility', { element });
    },

    updateSelection(element) {
        this.dispatchEvent('update_selection', { element });
    }
});

// ----------------------------------------------------------------------
// Track Animator (timeline support) - revised without KeyframeDataPoint.types
// ----------------------------------------------------------------------
export class TrackAnimator extends GeneralAnimator {
    constructor(uuid, animation) {
        super(uuid, animation);
        this.name = this.getElement()?.name || 'Track';
        this.progress = [];
    }

    getElement() {
        this.element = OutlinerNode.uuids[this.uuid];
        return this.element;
    }

    select(element_is_selected) {
        if (!this.getElement()) {
            unselectAllElements();
            return this;
        }
        if (this.getElement().locked) return;

        if (element_is_selected !== true && this.element) {
            this.element.select();
        }
        GeneralAnimator.prototype.select.call(this);

        if (this[Toolbox.selected.animation_channel] && (Timeline.selected.length == 0 || Timeline.selected[0].animator != this)) {
            let nearest;
            this.progress.forEach(kf => {
                if (Math.abs(kf.time - Timeline.time) < 0.002) {
                    nearest = kf;
                }
            });
            if (nearest) nearest.select();
        }

        if (this.element && this.element.parent && this.element.parent !== 'root') {
            this.element.parent.openUp();
        }
        return this;
    }

    doRender() {
        return this.getElement() && this.element.mesh;
    }

    displayFrame(multiplier = 1) {
        if (!this.doRender()) return;
        const element = this.getElement();
        if (this.muted.progress) return;

        const progressValue = this.interpolate('progress');
        if (progressValue !== false) {
            element.progress = progressValue;
            Track.preview_controller.updateGeometry(element);
        }
    }

    interpolate(channel, allow_expression, axis) {
        if (channel !== 'progress') return super.interpolate(channel, allow_expression, axis);

        let time = this.animation.time;
        let before = null;
        let after = null;
        let before_time = 0;
        let after_time = 0;
        const epsilon = 1/1200;

        for (let keyframe of this.progress) {
            if (keyframe.time < time) {
                if (!before || keyframe.time > before_time) {
                    before = keyframe;
                    before_time = before.time;
                }
            } else {
                if (!after || keyframe.time < after_time) {
                    after = keyframe;
                    after_time = after.time;
                }
            }
        }

        // Loop wrapping
        if (Format.animation_loop_wrapping && this.animation.loop == 'loop' && this.progress.length >= 2) {
            let anim_length = this.animation.length;
            if (!before) {
                before = this.progress.findHighest(kf => kf.time);
                before_time = before.time - anim_length;
            }
            if (!after) {
                after = this.progress.findHighest(kf => -kf.time);
                after_time = after.time + anim_length;
            }
        }

        if (before && Math.epsilon(before_time, time, epsilon)) {
            return before.data_points[0]?.value ?? 0;
        } else if (after && Math.epsilon(after_time, time, epsilon)) {
            return after.data_points[0]?.value ?? 0;
        } else if (before && !after) {
            return before.data_points[0]?.value ?? 0;
        } else if (after && !before) {
            return after.data_points[0]?.value ?? 0;
        } else if (before && after) {
            const alpha = Math.getLerp(before_time, after_time, time);
            if (before.interpolation == 'step') {
                return before.data_points[0]?.value ?? 0;
            } else {
                const val1 = before.data_points[0]?.value ?? 0;
                const val2 = after.data_points[0]?.value ?? 0;
                return (1 - alpha) * val1 + alpha * val2;
            }
        }
        return 0;
    }

    createKeyframe(value, time, channel, undo, select) {
        if (channel !== 'progress') return super.createKeyframe(value, time, channel, undo, select);

        if (typeof time !== 'number') time = Timeline.time;
        let keyframes = [];
        if (undo) Undo.initEdit({keyframes});

        let keyframe = new Keyframe({
            channel: 'progress',
            time: time,
            interpolation: settings.default_keyframe_interpolation.value,
        }, null, this);
        keyframes.push(keyframe);

        // Initialize data point with numeric value
        keyframe.data_points = [{
            value: (value && typeof value === 'object' && 'value' in value) ? value.value : 0
        }];

        keyframe.time = Timeline.snapTime(time);
        this.progress.push(keyframe);
        keyframe.animator = this;

        if (select !== false) keyframe.select();

        let deleted = [];
        delete keyframe.time_before;
        keyframe.replaceOthers(deleted);
        if (deleted.length && Undo.current_save) {
            Undo.addKeyframeCasualties(deleted);
        }
        Animation.selected.setLength();

        if (undo) Undo.finishEdit('Add keyframe');
        return keyframe;
    }
}
TrackAnimator.prototype.type = 'track';
TrackAnimator.prototype.channels = {
    progress: { name: 'Progress', mutable: true, transform: false, max_data_points: 1 }
};
Track.animator = TrackAnimator;

// Remove the KeyframeDataPoint.types assignment and Keyframe prototype overrides.
// Instead, we rely on the fact that Keyframe already stores arbitrary data in data_points.

// ----------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------
let addTrackAction, addTrackNodeAction;

function createActions() {
    addTrackAction = new Action('add_track', {
        name: 'Add Track',
        icon: 'orthopedics',
        category: 'edit',
        condition: () => Modes.edit,
        click() {
            Undo.initEdit({outliner: true, elements: [], selection: true});
            let track = new Track().init();
            let group = getCurrentGroup();
            track.addTo(group);
            track.createUniqueName();
            unselectAll();
            track.select();
            Undo.finishEdit('Add Track', {outliner: true, elements: selected, selection: true});
            Blockbench.dispatchEvent('add_track', {object: track});
            return track;
        }
    });

    addTrackNodeAction = new Action('add_track_node', {
        name: 'Add Track Node',
        icon: 'link',
        category: 'edit',
        condition: () => Modes.edit && Track.hasSelected(),
        click() {
            const track = Track.selected[0];
            Undo.initEdit({outliner: true, elements: [], selection: true});
            let node = new TrackNode().init();
            node.addTo(track);
            // Place slightly offset along chosen direction
            const offset = track.trackDirection === 'x' ? [2, 0, 0] : [0, 0, 2];
            node.origin = offset;
            node.createUniqueName();
            unselectAll();
            node.select();
            Undo.finishEdit('Add Track Node', {outliner: true, elements: selected, selection: true});
            Blockbench.dispatchEvent('add_track_node', {object: node});
            return node;
        }
    });

    deletables.push(addTrackAction, addTrackNodeAction);
}

// ----------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------
export function registerTrack() {
    if (registered) return;
    createActions();

    let add_element_menu = BarItems.add_element.side_menu;
    add_element_menu.addAction(addTrackAction);

    window.Track = Track;
    window.TrackNode = TrackNode;
    window.TrackAnimator = TrackAnimator;
    registered = true;
}

export function unregisterTrackActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
    registered = false;
}