import '../GLTFLoader';
import {TextureFilter} from "three/src/constants"; // Not needed for wire, but keep if shared

const ASSET_BASE = 'https://assets.iiteam.net/model/';
const WIRE_TEXTURE_URL = ASSET_BASE + 'wire.png';

let deletables = [];
let registered = false;

// Wire types with their color tints
const wireTypes = {
    lv: {name: 'LV Wire', color: 0xb36c3f},
    lv_insulated: {name: 'Insulated LV Wire', color: 0xfaf1de},
    mv: {name: 'MV Wire', color: 0xeda045},
    mv_insulated: {name: 'Insulated MV Wire', color: 0x9d857a},
    hv: {name: 'HV Wire', color: 0x6f6f6f},
    redstone: {name: 'Redstone Wire', color: 0xff2f2f},
    rope: {name: 'Rope', color: 0x967e6d},
    steel: {name: 'Steel Cable', color: 0x6f6f6f},
    data: {name: 'Data Cable', color: 0xb3d1d6}
};

// ----------------------------------------------------------------------
// WireNode – defines an endpoint of a wire.
// ----------------------------------------------------------------------
export class WireNode extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        for (let key in WireNode.properties) {
            WireNode.properties[key].reset(this);
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
        for (let key in WireNode.properties) {
            WireNode.properties[key].merge(this, object);
        }
        Merge.string(this, object, 'name');
        this.sanitizeName();
        Merge.boolean(this, object, 'export');
        Merge.boolean(this, object, 'locked');
        Merge.boolean(this, object, 'visibility');
        return this;
    }

    getWire() {
        let parent = this.parent;
        while (parent instanceof Wire === false && parent instanceof OutlinerNode) {
            parent = parent.parent;
        }
        return parent instanceof Wire ? parent : null;
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) {
            WireNode.preview_controller.setup(this);
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
        WireNode.preview_controller.updateTransform(this);
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
        for (let key in WireNode.properties) {
            WireNode.properties[key].merge(copy, this);
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
        for (let key in WireNode.properties) {
            WireNode.properties[key].merge(copy, this);
        }
        return copy;
    }

    getChildlessCopy(keep_uuid = false) {
        let base_node = new WireNode({name: this.name}, keep_uuid ? this.uuid : null);
        for (let key in WireNode.properties) {
            WireNode.properties[key].copy(this, base_node);
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
        rotatable: false, // rotation not needed for wire nodes
        resizable: false,
        child_types: [],
        parent_types: ['wire'],
        select_children: 'self_first',
        hide_in_screenshot: false,
    };

    static preview_controller;
}

WireNode.prototype.title = 'Wire Node';
WireNode.prototype.type = 'wire_node';
WireNode.prototype.icon = 'fiber_manual_record';
WireNode.prototype.buttons = [
    Outliner.buttons.locked,
    Outliner.buttons.visibility,
];
WireNode.prototype.menu = new Menu([
    'rename',
    'delete'
]);

OutlinerElement.registerType(WireNode, 'wire_node');

new Property(WireNode, 'vector', 'origin', {default: [0, 0, 0]});
new Property(WireNode, 'vector', 'rotation'); // kept for compatibility, not used
new Property(WireNode, 'boolean', 'visibility', {default: true});

new NodePreviewController(WireNode, {
    setup(element) {
        let object_3d = new THREE.Object3D();
        object_3d.rotation.order = 'ZYX';
        object_3d.uuid = element.uuid.toUpperCase();
        object_3d.name = element.name;
        object_3d.isElement = true;
        object_3d.no_export = true;
        Project.nodes_3d[element.uuid] = object_3d;

        // Visual: small sphere at node position
        const sphereGeom = new THREE.SphereGeometry(0.2, 8, 8);
        const sphereMat = new THREE.MeshStandardMaterial({
            color: 0xffaa00,
            emissive: new THREE.Color(0x553300),
            emissiveIntensity: 0.3
        });
        const sphere = new THREE.Mesh(sphereGeom, sphereMat);
        object_3d.add(sphere);

        this.updateTransform(element);
        this.dispatchEvent('setup', {element});
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

        if (element.parent instanceof Wire) {
            Wire.preview_controller.updateGeometry(element.parent);
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
// Wire – main element with two WireNodes, draws a catenary wire.
// ----------------------------------------------------------------------
export class Wire extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        for (let key in Wire.properties) {
            Wire.properties[key].reset(this);
        }
        this.name = 'wire';
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
        for (let key in Wire.properties) {
            Wire.properties[key].merge(this, object);
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
            Wire.preview_controller.setup(this);
        }
        // Ensure exactly two nodes exist
        this.ensureNodes();
        return this;
    }

    ensureNodes() {
        const nodes = this.getAllNodes();
        if (nodes.length < 2) {
            for (let i = nodes.length; i < 2; i++) {
                let node = new WireNode().init();
                node.addTo(this);
                node.origin = [i * 2, 0, 0]; // default spread
                node.createUniqueName();
            }
        } else if (nodes.length > 2) {
            // Remove extra nodes
            nodes.slice(2).forEach(n => n.remove());
        }
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
        for (let key in Wire.properties) {
            Wire.properties[key].merge(copy, this);
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
        for (let key in Wire.properties) {
            Wire.properties[key].merge(copy, this);
        }
        return copy;
    }

    getChildlessCopy(keep_uuid = false) {
        let base_wire = new Wire({name: this.name}, keep_uuid ? this.uuid : null);
        for (let key in Wire.properties) {
            Wire.properties[key].copy(this, base_wire);
        }
        base_wire.name = this.name;
        base_wire.locked = this.locked;
        base_wire.visibility = this.visibility;
        base_wire.export = this.export;
        base_wire.isOpen = this.isOpen;
        return base_wire;
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
            if (child instanceof WireNode) nodes.push(child);
        });
        return nodes;
    }

    addNodeAtEnd() {
        // Called by action? We'll enforce exactly two nodes elsewhere.
        const nodes = this.getAllNodes();
        if (nodes.length >= 2) return;
        let node = new WireNode().init();
        node.addTo(this);
        node.createUniqueName();
        return node;
    }

    static behavior = {
        unique_name: false,
        movable: true,
        rotatable: false,
        parent: true,
        child_types: ['wire_node'],
    };

    static preview_controller;
}

Wire.prototype.title = 'Wire';
Wire.prototype.type = 'wire';
Wire.prototype.icon = 'power'; // or 'cable'
Wire.prototype.buttons = [
    Outliner.buttons.locked,
    Outliner.buttons.visibility,
];
Wire.prototype.menu = new Menu([
    'add_wire_node',
    ...Outliner.control_menu_group,
    new MenuSeparator('settings'),
    new MenuSeparator('manage'),
    'rename',
    'delete'
]);

OutlinerElement.registerType(Wire, 'wire');

new Property(Wire, 'string', 'name', {default: 'wire'});
new Property(Wire, 'vector', 'position');
new Property(Wire, 'vector', 'rotation'); // not used but kept for compatibility
new Property(Wire, 'vector', 'scale', {default: [1, 1, 1]});
new Property(Wire, 'string', 'wireType', {
    default: 'lv',
    inputs: {
        element_panel: {
            input: {
                label: 'Wire Type',
                type: 'select',
                options: Object.fromEntries(Object.entries(wireTypes).map(([k, v]) => [k, v.name]))
            },
            onChange() {
                Wire.selected.forEach(el => Wire.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Wire, 'number', 'diameter', {
    default: 2,
    min: 0.1,
    max: 20,
    step: 0.1,
    inputs: {
        element_panel: {
            input: {label: 'Diameter (px)', type: 'number'},
            onChange() {
                Wire.selected.forEach(el => Wire.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Wire, 'number', 'slack', {
    default: 1.02,
    min: 1.0,
    max: 2.0,
    step: 0.01,
    inputs: {
        element_panel: {
            input: {label: 'Slack Factor', type: 'number'},
            onChange() {
                Wire.selected.forEach(el => Wire.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Wire, 'boolean', 'visibility', {default: true});

// ----------------------------------------------------------------------
// Catenary calculation (ported from Java)
// ----------------------------------------------------------------------
const VERTICES = 32; // number of segments along the wire

function getConnectionCatenary(start, end, slack) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const dw = Math.sqrt(dx * dx + dz * dz);

    // Vertical line special case
    if (dw < 0.0001) {
        const points = [];
        for (let i = 0; i <= VERTICES; i++) {
            const t = i / VERTICES;
            points.push(new THREE.Vector3(
                start.x,
                start.y + dy * t,
                start.z
            ));
        }
        return points;
    }

    const k = Math.sqrt(dx * dx + dy * dy + dz * dz) * slack;
    let l = 0;
    for (let limiter = 0; limiter < 300; limiter++) {
        l += 0.01;
        if (Math.sinh(l) / l >= Math.sqrt(k * k - dy * dy) / dw) break;
    }
    const a = dw / (2 * l);
    const offsetX = (0 + dw - a * Math.log((k + dy) / (k - dy))) * 0.5;
    const offsetY = (dy + 0 - k * Math.cosh(l) / Math.sinh(l)) * 0.5;

    const points = [];
    points.push(new THREE.Vector3(start.x, start.y, start.z));
    for (let i = 1; i < VERTICES; i++) {
        const posRelative = i / VERTICES;
        const x = dx * posRelative;
        const z = dz * posRelative;
        const y = a * Math.cosh((dw * posRelative - offsetX) / a) + offsetY;
        points.push(new THREE.Vector3(start.x + x, start.y + y, start.z + z));
    }
    points.push(new THREE.Vector3(end.x, end.y, end.z));
    return points;
}

// ----------------------------------------------------------------------
// Wire Preview Controller – builds a cross of quads along the catenary.
// ----------------------------------------------------------------------
let wireTexture = null;

function loadWireTexture() {
    if (!wireTexture) {
        wireTexture = new THREE.TextureLoader().load(WIRE_TEXTURE_URL);
        wireTexture.wrapS = THREE.RepeatWrapping;
        wireTexture.wrapT = THREE.RepeatWrapping;
        wireTexture.magFilter = THREE.NearestFilter;
        wireTexture.minFilter = THREE.NearestFilter;
    }
    return wireTexture;
}

new NodePreviewController(Wire, {
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

        this.dispatchEvent('setup', {element});
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
        this.dispatchEvent('update_transform', {element});
    },

    async updateGeometry(element) {
        const group = element.mesh;
        // Remove old wire mesh
        let wireMesh = group.getObjectByName('wire_mesh');
        if (wireMesh) group.remove(wireMesh);

        const nodes = element.getAllNodes().filter(n => n.visibility);
        if (nodes.length !== 2) return;

        const start = nodes[0].mesh.position;
        const end = nodes[1].mesh.position;

        const points = getConnectionCatenary(start, end, element.slack);
        if (points.length < 2) return;

        const diameter = element.diameter;
        const color = wireTypes[element.wireType]?.color || 0xcccccc;
        const texture = loadWireTexture();

        // Build geometry: two perpendicular quads along the curve.
        // Each segment i to i+1 produces two quads.
        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];

        let totalLength = 0;
        const segLengths = [];
        for (let i = 0; i < points.length - 1; i++) {
            const len = points[i].distanceTo(points[i + 1]);
            segLengths.push(len);
            totalLength += len;
        }

        const up = new THREE.Vector3(0, 1, 0);
        let cumLength = 0;

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const dir = new THREE.Vector3().subVectors(p2, p1).normalize();

            // Compute perpendicular vectors for the cross
            const perp1 = new THREE.Vector3().crossVectors(dir, up).normalize();
            // If dir is parallel to up, fallback
            if (perp1.length() < 0.1) {
                perp1.set(1, 0, 0);
            }
            const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();

            const half = diameter / 2;

            // Two quads: one in plane spanned by dir and perp1, other by dir and perp2
            const offsets = [
                {perp: perp1, uScale: 1},
                {perp: perp2, uScale: 1}
            ];

            const segLen = segLengths[i];
            const u1 = cumLength / diameter / 16; // repeat every diameter units
            const u2 = (cumLength + segLen) / diameter / 16;
            cumLength += segLen;

            for (let quadIdx = 0; quadIdx < 2; quadIdx++) {
                const offset = offsets[quadIdx];
                const perp = offset.perp;

                // 4 vertices for this quad
                const v0 = p1.clone().addScaledVector(perp, -half);
                const v1 = p1.clone().addScaledVector(perp, half);
                const v2 = p2.clone().addScaledVector(perp, half);
                const v3 = p2.clone().addScaledVector(perp, -half);

                const baseIdx = positions.length / 3;
                positions.push(v0.x, v0.y, v0.z);
                positions.push(v1.x, v1.y, v1.z);
                positions.push(v2.x, v2.y, v2.z);
                positions.push(v3.x, v3.y, v3.z);

                // Normals: use perp (pointing outward from wire center)
                const nx = perp.x, ny = perp.y, nz = perp.z;
                for (let j = 0; j < 4; j++) {
                    normals.push(nx, ny, nz);
                }

                // UVs: u along wire, v across width (0 to 1)
                uvs.push(u1, 0);
                uvs.push(u1, 1);
                uvs.push(u2, 1);
                uvs.push(u2, 0);

                // Two triangles
                indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
                indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
            }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geom.setIndex(indices);

        const material = new THREE.MeshStandardMaterial({
            color: color,
            map: texture,
            side: THREE.DoubleSide,
            roughness: 0.7,
            metalness: 0.1,
            emissive: new THREE.Color(0x222222),
            emissiveIntensity: 0.2
        });

        const mesh = new THREE.Mesh(geom, material);
        mesh.name = 'wire_mesh';
        mesh.receiveShadow = false;
        mesh.castShadow = true;
        group.add(mesh);

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
// Actions
// ----------------------------------------------------------------------
let addWireAction;

function createActions() {
    addWireAction = new Action('add_wire', {
        name: 'Add Wire',
        icon: 'power',
        category: 'edit',
        condition: () => Modes.edit,
        click() {
            Undo.initEdit({outliner: true, elements: [], selection: true});
            let wire = new Wire().init();
            let group = getCurrentGroup();
            wire.addTo(group);
            wire.createUniqueName();
            // Nodes are auto-created in ensureNodes()
            unselectAll();
            wire.select();
            Undo.finishEdit('Add Wire', {outliner: true, elements: selected, selection: true});
            Blockbench.dispatchEvent('add_wire', {object: wire});
            return wire;
        }
    });

    deletables.push(addWireAction);
}

// ----------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------
export function registerWire() {
    if (registered) return;
    createActions();

    let add_element_menu = BarItems.add_element.side_menu;
    add_element_menu.addAction(addWireAction);

    window.Wire = Wire;
    window.WireNode = WireNode;
    registered = true;
}

export function unregisterWireActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
    registered = false;
}