import '../GLTFLoader';

const ASSET_BASE = 'https://assets.iiteam.net/model/pipe/';

let deletables = [];
let registered = false;

const modelCache = new Map();

// Pipe type definitions – each entry maps to a GLB file and provides display name.
const pipeTypes = {
    "pipe_8_iron.glb": "Iron Fluid Pipe (8x)",
    "pipe_8_steel.glb": "Steel Fluid Pipe (8x)",
    "pipe_6_iron.glb": "Iron Fluid Pipe (6x)",
    "pipe_6_steel.glb": "Steel Fluid Pipe (6x)",
    "pipe_4_iron.glb": "Iron Fluid Pipe (4x)",
    "pipe_4_steel.glb": "Steel Fluid Pipe (4x)",
    "pipe_3_iron.glb": "Iron Fluid Pipe (3x)",
    "pipe_3_steel.glb": "Steel Fluid Pipe (3x)",
    "pipe_2_iron.glb": "Iron Fluid Pipe (2x)",
    "pipe_2_steel.glb": "Steel Fluid Pipe (2x)",
    "cable_4.glb": "Copper Cable (4x)",
    "cable_3.glb": "Copper Cable (3x)",
    "cable_2.glb": "Copper Cable (2x)"
};

// Termination options for start/end
const capOptions = {
    "none": "None",
    "endpoint": "Endpoint",
    "3way": "T-Junction",
    "4way": "Cross Junction"
};

// ----------------------------------------------------------------------
// PipeNode – a locator defining a path vertex.
// ----------------------------------------------------------------------
export class PipeNode extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        for (let key in PipeNode.properties) {
            PipeNode.properties[key].reset(this);
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
        for (let key in PipeNode.properties) {
            PipeNode.properties[key].merge(this, object);
        }
        Merge.string(this, object, 'name');
        this.sanitizeName();
        Merge.boolean(this, object, 'export');
        Merge.boolean(this, object, 'locked');
        Merge.boolean(this, object, 'visibility');
        return this;
    }

    getPipe() {
        let parent = this.parent;
        while (parent instanceof Pipe === false && parent instanceof OutlinerNode) {
            parent = parent.parent;
        }
        return parent instanceof Pipe ? parent : null;
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) {
            PipeNode.preview_controller.setup(this);
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
        PipeNode.preview_controller.updateTransform(this);
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
        for (let key in PipeNode.properties) {
            PipeNode.properties[key].merge(copy, this);
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
        for (let key in PipeNode.properties) {
            PipeNode.properties[key].merge(copy, this);
        }
        return copy;
    }

    getChildlessCopy(keep_uuid = false) {
        let base_node = new PipeNode({ name: this.name }, keep_uuid ? this.uuid : null);
        for (let key in PipeNode.properties) {
            PipeNode.properties[key].copy(this, base_node);
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
        rotatable: false,
        resizable: false,
        child_types: [],
        parent_types: ['pipe'],
        select_children: 'self_first',
        hide_in_screenshot: false,
    };

    static preview_controller;
}

PipeNode.prototype.title = 'Pipe Node';
PipeNode.prototype.type = 'pipe_node';
PipeNode.prototype.icon = 'fiber_manual_record';
PipeNode.prototype.buttons = [
    Outliner.buttons.locked,
    Outliner.buttons.visibility,
];
PipeNode.prototype.menu = new Menu(['rename', 'delete']);

OutlinerElement.registerType(PipeNode, 'pipe_node');

new Property(PipeNode, 'vector', 'origin', { default: [0, 0, 0] });
new Property(PipeNode, 'vector', 'rotation');
new Property(PipeNode, 'boolean', 'visibility', { default: true });

new NodePreviewController(PipeNode, {
    setup(element) {
        let object_3d = new THREE.Object3D();
        object_3d.rotation.order = 'ZYX';
        object_3d.uuid = element.uuid.toUpperCase();
        object_3d.name = element.name;
        object_3d.isElement = true;
        object_3d.no_export = true;
        Project.nodes_3d[element.uuid] = object_3d;

        const sphereGeom = new THREE.SphereGeometry(0.2, 8, 8);
        const sphereMat = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
        const sphere = new THREE.Mesh(sphereGeom, sphereMat);
        object_3d.add(sphere);

        this.updateTransform(element);
        this.dispatchEvent('setup', { element });
    },

    updateTransform(element) {
        let obj = element.mesh;
        obj.position.fromArray(element.origin);
        obj.scale.set(1, 1, 1);
        obj.rotation.set(0, 0, 0);

        if (element.parent instanceof OutlinerNode) {
            element.parent.scene_object.add(obj);
        } else if (obj.parent) {
            obj.parent.remove(obj);
        }
        obj.updateMatrixWorld();

        if (element.parent instanceof Pipe) {
            Pipe.preview_controller.updateGeometry(element.parent);
        }

        this.dispatchEvent('update_transform', { element });
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
// Pipe – main element containing PipeNodes and assembled from model parts.
// ----------------------------------------------------------------------
export class Pipe extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        for (let key in Pipe.properties) {
            Pipe.properties[key].reset(this);
        }
        this.name = 'pipe';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;
        this.origin = [0, 0, 0];

        if (typeof data === 'object') {
            this.extend(data);
        } else if (typeof data === 'string') {
            this.name = data;
        }
    }

    extend(object) {
        for (let key in Pipe.properties) {
            Pipe.properties[key].merge(this, object);
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
            Pipe.preview_controller.setup(this);
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
        for (let key in Pipe.properties) {
            Pipe.properties[key].merge(copy, this);
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
        for (let key in Pipe.properties) {
            Pipe.properties[key].merge(copy, this);
        }
        return copy;
    }

    getChildlessCopy(keep_uuid = false) {
        let base_pipe = new Pipe({ name: this.name }, keep_uuid ? this.uuid : null);
        for (let key in Pipe.properties) {
            Pipe.properties[key].copy(this, base_pipe);
        }
        base_pipe.name = this.name;
        base_pipe.locked = this.locked;
        base_pipe.visibility = this.visibility;
        base_pipe.export = this.export;
        base_pipe.isOpen = this.isOpen;
        return base_pipe;
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
            if (child instanceof PipeNode) nodes.push(child);
        });
        return nodes;
    }

    static behavior = {
        unique_name: false,
        movable: true,
        rotatable: true,
        parent: true,
        child_types: ['pipe_node'],
    };

    static preview_controller;
}

Pipe.prototype.title = 'Pipe';
Pipe.prototype.type = 'pipe';
Pipe.prototype.icon = 'cable';
Pipe.prototype.buttons = [
    Outliner.buttons.locked,
    Outliner.buttons.visibility,
];
Pipe.prototype.menu = new Menu([
    'add_pipe_node',
    ...Outliner.control_menu_group,
    new MenuSeparator('settings'),
    new MenuSeparator('manage'),
    'rename',
    'delete'
]);

OutlinerElement.registerType(Pipe, 'pipe');

new Property(Pipe, 'string', 'name', { default: 'pipe' });
new Property(Pipe, 'vector', 'position');
new Property(Pipe, 'vector', 'rotation');
new Property(Pipe, 'vector', 'scale', { default: [1, 1, 1] });
new Property(Pipe, 'string', 'pipeType', {
    default: Object.keys(pipeTypes)[0],
    inputs: {
        element_panel: {
            input: {
                label: 'Pipe Type',
                type: 'select',
                options: pipeTypes
            },
            onChange() {
                Pipe.selected.forEach(el => Pipe.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Pipe, 'string', 'startCap', {
    default: 'none',
    inputs: {
        element_panel: {
            input: {
                label: 'Start Cap',
                type: 'select',
                options: capOptions
            },
            onChange() {
                Pipe.selected.forEach(el => Pipe.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Pipe, 'string', 'endCap', {
    default: 'none',
    inputs: {
        element_panel: {
            input: {
                label: 'End Cap',
                type: 'select',
                options: capOptions
            },
            onChange() {
                Pipe.selected.forEach(el => Pipe.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Pipe, 'boolean', 'visibility', { default: true });

// ----------------------------------------------------------------------
// Model loading and part extraction
// ----------------------------------------------------------------------
async function loadPipeModel(typeKey) {
    if (modelCache.has(typeKey)) {
        return modelCache.get(typeKey).clone(true);
    }
    const url = ASSET_BASE + typeKey;
    return new Promise((resolve, reject) => {
        new THREE.GLTFLoader().load(url,
            (gltf) => {
                const model = gltf.scene;
                model.traverse(node => {
                    if (node.isMesh && node.material) {
                        node.receiveShadow = true;
                        node.castShadow = true;
                        const materials = Array.isArray(node.material) ? node.material : [node.material];
                        materials.forEach(mat => {
                            const originalMap = mat.map;
                            mat.roughness = 1.0;
                            mat.metalness = 0.0;
                            //Slight self-illumination
                            mat.emissive = new THREE.Color(0x7f7f7f);
                            mat.emissiveIntensity = 0.125 * 1.5;
                        });
                    }
                });
                modelCache.set(typeKey, model.clone(true));
                resolve(model);
            },
            undefined,
            reject
        );
    });
}

function extractParts(model) {
    const parts = {
        straight: null,
        corner: null,
        endpoint: null,
        junction_3: null,
        junction_4: null
    };
    model.traverse(obj => {
        if (obj.isGroup || obj.isObject3D) {
            const name = obj.name.toLowerCase();
            if (name === 'straight' || name === 'base') parts.straight = obj;
            else if (name === 'corner') parts.corner = obj;
            else if (name === 'endpoint') parts.endpoint = obj;
            else if (name === '3_way' || name === 'junction_3') parts.junction_3 = obj;
            else if (name === '4_way' || name === 'junction_4') parts.junction_4 = obj;
        }
    });
    return parts;
}

function getPipeDimensions(straightPart, cornerPart) {
    let straightLength = 1.0;
    let cornerSize = 1.0;
    if (straightPart) {
        const bbox = new THREE.Box3().setFromObject(straightPart);
        straightLength = bbox.max.y - bbox.min.y;
    }
    if (cornerPart) {
        const bbox = new THREE.Box3().setFromObject(cornerPart);
        cornerSize = Math.max(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z) / 2;
    }
    return { straightLength, cornerSize };
}

function quatFromUpToDir(dir) {
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    if (dir.length() < 0.001) return quat;
    const normalizedDir = dir.clone().normalize();
    if (Math.abs(normalizedDir.dot(up)) > 0.999) {
        if (normalizedDir.y < 0) quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    } else {
        quat.setFromUnitVectors(up, normalizedDir);
    }
    return quat;
}

// ----------------------------------------------------------------------
// Helper: Cut a straight mesh to a target length (0 to targetLength)
// ----------------------------------------------------------------------
function cutStraightMesh(sourceMesh, targetLength) {
    const fullLength = 16;
    if (targetLength >= fullLength - 0.001) {
        return sourceMesh.clone(true);
    }

    const geometry = sourceMesh.geometry;
    if (!geometry) return sourceMesh.clone(true);

    const newGeo = geometry.clone();
    const positions = newGeo.attributes.position.array;
    const uvs = newGeo.attributes.uv?.array;
    const vertexCount = positions.length / 3;

    if (!uvs) return sourceMesh.clone(true);

    // Find V values at min and max Y to determine mapping direction
    let bottomV = 0, topV = 0;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < vertexCount; i++) {
        const y = positions[i * 3 + 1];
        const v = uvs[i * 2 + 1];
        if (y < minY) { minY = y; bottomV = v; }
        if (y > maxY) { maxY = y; topV = v; }
    }

    const cutRatio = targetLength / fullLength;
    // Interpolate V for the new top
    const newTopV = bottomV + (topV - bottomV) * cutRatio;

    for (let i = 0; i < vertexCount; i++) {
        const idx = i * 3;
        const y = positions[idx + 1];
        if (y > targetLength) {
            positions[idx + 1] = targetLength;
            uvs[i * 2 + 1] = newTopV;
        }
    }

    newGeo.computeVertexNormals();
    newGeo.computeBoundingBox();
    newGeo.computeBoundingSphere();

    const newMesh = new THREE.Mesh(newGeo, sourceMesh.material.clone());
    newMesh.name = sourceMesh.name;
    newMesh.receiveShadow = sourceMesh.receiveShadow;
    newMesh.castShadow = sourceMesh.castShadow;
    return newMesh;
}

// ----------------------------------------------------------------------
// Pipe Preview Controller
// ----------------------------------------------------------------------
new NodePreviewController(Pipe, {
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
        let pipeContainer = group.getObjectByName('pipe_assembly');
        if (pipeContainer) group.remove(pipeContainer);
        pipeContainer = new THREE.Group();
        pipeContainer.name = 'pipe_assembly';
        group.add(pipeContainer);

        const nodes = element.getAllNodes().filter(n => n.visibility);
        if (nodes.length < 2) return;

        let model;
        try {
            model = await loadPipeModel(element.pipeType);
        } catch (e) {
            console.warn(`Failed to load pipe model "${element.pipeType}":`, e);
            return;
        }
        const parts = extractParts(model);
        if (!parts.straight || !parts.corner) {
            console.warn('Pipe model missing required "straight" or "corner" groups');
            return;
        }

        // Straight part is 16px tall (Y axis). Corner size equals diameter.
        const STRAIGHT_FULL_LENGTH = 16;
        const { cornerSize } = getPipeDimensions(parts.straight, parts.corner);

        const points = nodes.map(n => n.mesh.position.clone());

        // Helper: add multiple straight segments to fill a required length
        // Helper to add straight segment(s) using cutting
        function addStraightSegments(startPos, dir, length) {
            const fullSegments = Math.floor(length / STRAIGHT_FULL_LENGTH);
            const remainder = length % STRAIGHT_FULL_LENGTH;
            const step = dir.clone().multiplyScalar(STRAIGHT_FULL_LENGTH);
            let currentPos = startPos.clone();

            for (let i = 0; i < fullSegments; i++) {
                const instance = parts.straight.clone(true); // full length
                instance.position.copy(currentPos);
                instance.quaternion.copy(quatFromUpToDir(dir));
                pipeContainer.add(instance);
                currentPos.add(step);
            }

            if (remainder > 0.001) {
                // Create cut version
                const cutGroup = new THREE.Group();
                parts.straight.traverse(node => {
                    if (node.isMesh) {
                        const cutMesh = cutStraightMesh(node, remainder);
                        cutGroup.add(cutMesh);
                    }
                });
                cutGroup.position.copy(currentPos);
                cutGroup.quaternion.copy(quatFromUpToDir(dir));
                pipeContainer.add(cutGroup);
            }
        }

        function addCorner(pos, dirIn, dirOut) {
            const instance = parts.corner.clone(true);
            instance.position.copy(pos);
            const targetY = dirIn.clone().normalize().negate();
            const targetX = dirOut.clone().normalize();
            const rotMatrix = new THREE.Matrix4();
            const zAxis = new THREE.Vector3().crossVectors(targetX, targetY).normalize();
            const correctedY = new THREE.Vector3().crossVectors(zAxis, targetX).normalize();
            rotMatrix.makeBasis(targetX, correctedY, zAxis);
            instance.quaternion.setFromRotationMatrix(rotMatrix);
            pipeContainer.add(instance);
        }

        function addCap(pos, dirOut, capType) {
            let capPart = null;
            if (capType === 'endpoint') capPart = parts.endpoint;
            else if (capType === '3_way') capPart = parts.junction_3;
            else if (capType === '4_way') capPart = parts.junction_4;
            if (!capPart) return;

            const instance = capPart.clone(true);
            instance.position.copy(pos);
            instance.quaternion.copy(quatFromUpToDir(dirOut));
            pipeContainer.add(instance);
        }

        for (let i = 0; i < points.length - 1; i++) {
            const start = points[i];
            const end = points[i+1];
            const dir = new THREE.Vector3().subVectors(end, start);
            const totalLen = dir.length();
            const normDir = dir.clone().normalize();

            let startOffset = 0;
            let endOffset = 0;

            // Handle start cap / corner offset
            if (i === 0) {
                startOffset = 0;
            } else {
                startOffset = cornerSize;
            }

            // Handle end cap / corner offset
            if (i === points.length - 2) {
                if (element.endCap !== 'none') {
                    addCap(end, normDir.clone(), element.endCap);
                    endOffset = cornerSize;
                }
            } else {
                endOffset = cornerSize;
            }

            const usedLen = totalLen - startOffset - endOffset;
            if (usedLen <= 0.001) continue;

            const startPos = start.clone().add(normDir.clone().multiplyScalar(startOffset));
            addStraightSegments(startPos, normDir, usedLen);
        }

        for (let i = 1; i < points.length - 1; i++) {
            const prevDir = new THREE.Vector3().subVectors(points[i], points[i-1]).normalize();
            const nextDir = new THREE.Vector3().subVectors(points[i+1], points[i]).normalize();
            addCorner(points[i], prevDir, nextDir);
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
// Actions
// ----------------------------------------------------------------------
let addPipeAction, addPipeNodeAction;

function createActions() {
    addPipeAction = new Action('add_pipe', {
        name: 'Add Pipe',
        icon: 'cable',
        category: 'edit',
        condition: () => Modes.edit,
        click() {
            Undo.initEdit({ outliner: true, elements: [], selection: true });
            let pipe = new Pipe().init();
            let group = getCurrentGroup();
            pipe.addTo(group);
            pipe.createUniqueName();
            unselectAll();
            pipe.select();
            Undo.finishEdit('Add Pipe', { outliner: true, elements: selected, selection: true });
            Blockbench.dispatchEvent('add_pipe', { object: pipe });
            return pipe;
        }
    });

    addPipeNodeAction = new Action('add_pipe_node', {
        name: 'Add Pipe Node',
        icon: 'fiber_manual_record',
        category: 'edit',
        condition: () => Modes.edit && Pipe.hasSelected(),
        click() {
            const pipe = Pipe.selected[0];
            Undo.initEdit({ outliner: true, elements: [], selection: true });
            let node = new PipeNode().init();
            node.addTo(pipe);
            const nodes = pipe.getAllNodes();
            if (nodes.length === 0) {
                node.origin = [0, 0, 0];
            } else {
                const last = nodes[nodes.length-1];
                node.origin = [last.origin[0] + 2, last.origin[1], last.origin[2]];
            }
            node.createUniqueName();
            unselectAll();
            node.select();
            Undo.finishEdit('Add Pipe Node', { outliner: true, elements: selected, selection: true });
            Blockbench.dispatchEvent('add_pipe_node', { object: node });
            return node;
        }
    });

    deletables.push(addPipeAction, addPipeNodeAction);
}

// ----------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------
export function registerPipe() {
    if (registered) return;
    createActions();

    let add_element_menu = BarItems.add_element.side_menu;
    add_element_menu.addAction(addPipeAction);

    window.Pipe = Pipe;
    window.PipeNode = PipeNode;
    registered = true;
}

export function unregisterPipeActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
    registered = false;
}