import '../GLTFLoader';

const ASSET_BASE = 'https://assets.iiteam.net/model/';

let deletables = [];
let registered = false;

const textureCache = new Map();

// ----------------------------------------------------------------------
// FluidNode – defines a layer with sizeX and sizeZ.
// ----------------------------------------------------------------------
export class FluidNode extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        for (let key in FluidNode.properties) {
            FluidNode.properties[key].reset(this);
        }
        this.name = 'layer';
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
        for (let key in FluidNode.properties) {
            FluidNode.properties[key].merge(this, object);
        }
        Merge.string(this, object, 'name');
        this.sanitizeName();
        Merge.boolean(this, object, 'export');
        Merge.boolean(this, object, 'locked');
        Merge.boolean(this, object, 'visibility');
        return this;
    }

    getFluid() {
        let parent = this.parent;
        while (parent instanceof Fluid === false && parent instanceof OutlinerNode) {
            parent = parent.parent;
        }
        return parent instanceof Fluid ? parent : null;
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) {
            FluidNode.preview_controller.setup(this);
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
        FluidNode.preview_controller.updateTransform(this);
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
        for (let key in FluidNode.properties) {
            FluidNode.properties[key].merge(copy, this);
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
        for (let key in FluidNode.properties) {
            FluidNode.properties[key].merge(copy, this);
        }
        return copy;
    }

    getChildlessCopy(keep_uuid = false) {
        let base_node = new FluidNode({name: this.name}, keep_uuid ? this.uuid : null);
        for (let key in FluidNode.properties) {
            FluidNode.properties[key].copy(this, base_node);
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
        parent_types: ['fluid'],
        select_children: 'self_first',
        hide_in_screenshot: false,
    };

    static preview_controller;
}

FluidNode.prototype.title = 'Fluid Layer';
FluidNode.prototype.type = 'fluid_node';
FluidNode.prototype.icon = 'layers';
FluidNode.prototype.buttons = [
    Outliner.buttons.locked,
    Outliner.buttons.visibility,
];
FluidNode.prototype.menu = new Menu([
    'rename',
    'delete'
]);

OutlinerElement.registerType(FluidNode, 'fluid_node');

new Property(FluidNode, 'vector', 'origin', {default: [0, 0, 0]});
new Property(FluidNode, 'vector', 'rotation'); // not used
new Property(FluidNode, 'number', 'sizeX', {
    default: 16,
    min: 0.1,
    max: 1024,
    step: 1,
    inputs: {
        element_panel: {
            input: {label: 'Width (X)', type: 'number'},
            onChange() {
                FluidNode.selected.forEach(n => FluidNode.preview_controller.updateGeometry(n));
            }
        }
    }
});
new Property(FluidNode, 'number', 'sizeZ', {
    default: 16,
    min: 0.1,
    max: 1024,
    step: 1,
    inputs: {
        element_panel: {
            input: {label: 'Depth (Z)', type: 'number'},
            onChange() {
                FluidNode.selected.forEach(n => FluidNode.preview_controller.updateGeometry(n));
            }
        }
    }
});
new Property(FluidNode, 'boolean', 'visibility', {default: true});

new NodePreviewController(FluidNode, {
    setup(element) {
        let object_3d = new THREE.Object3D();
        object_3d.rotation.order = 'ZYX';
        object_3d.uuid = element.uuid.toUpperCase();
        object_3d.name = element.name;
        object_3d.isElement = true;
        object_3d.no_export = true;
        Project.nodes_3d[element.uuid] = object_3d;

        // Visual: transparent box outline
        const w = element.sizeX;
        const d = element.sizeZ;
        const geom = new THREE.BoxGeometry(w, 1, d).translate(w/2, 0, d/2);
        const edges = new THREE.EdgesGeometry(geom);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({color: 0x44aaff}));
        line.visible = false;
        line.position.y = 0.5;
        object_3d.add(line);

        this.updateTransform(element);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        let obj = element.mesh;
        // Position is relative to parent Fluid
        obj.position.fromArray(element.origin);
        obj.scale.set(1, 1, 1);
        obj.rotation.set(0, 0, 0);

        if (element.parent instanceof OutlinerNode) {
            element.parent.scene_object.add(obj);
        } else if (obj.parent) {
            obj.parent.remove(obj);
        }
        obj.updateMatrixWorld();

        if (element.parent instanceof Fluid) {
            Fluid.preview_controller.updateGeometry(element.parent);
        }

        this.dispatchEvent('update_transform', {element});
    },

    updateGeometry(element) {
        // Update the visual box size when size properties change
        const obj = element.mesh;
        const line = obj.children.find(c => c.isLineSegments);
        if (line) {
            const w = element.sizeX;
            const d = element.sizeZ;
            const geom = new THREE.BoxGeometry(w, 1, d).translate(w/2, 0, d/2);
            line.geometry.dispose();
            line.geometry = new THREE.EdgesGeometry(geom);
        }
        // Trigger parent fluid update
        if (element.parent instanceof Fluid) {
            Fluid.preview_controller.updateGeometry(element.parent);
        }
        this.dispatchEvent('update_geometry', {element});
    },

    updateVisibility(element) {
        element.mesh.visible = element.visibility;
        this.dispatchEvent('update_visibility', {element});
    },

    updateSelection(element) {
        const obj = element.mesh;
        const line = obj.children.find(c => c.isLineSegments);
        if (line) line.visible = element.selected;
        this.dispatchEvent('update_selection', {element});
    }
});

// ----------------------------------------------------------------------
// Fluid – main element with layers, draws a textured fluid volume.
// ----------------------------------------------------------------------
export class Fluid extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        for (let key in Fluid.properties) {
            Fluid.properties[key].reset(this);
        }
        this.name = 'fluid';
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
        for (let key in Fluid.properties) {
            Fluid.properties[key].merge(this, object);
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
            Fluid.preview_controller.setup(this);
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
        for (let key in Fluid.properties) {
            Fluid.properties[key].merge(copy, this);
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
        for (let key in Fluid.properties) {
            Fluid.properties[key].merge(copy, this);
        }
        return copy;
    }

    getChildlessCopy(keep_uuid = false) {
        let base_fluid = new Fluid({name: this.name}, keep_uuid ? this.uuid : null);
        for (let key in Fluid.properties) {
            Fluid.properties[key].copy(this, base_fluid);
        }
        base_fluid.name = this.name;
        base_fluid.locked = this.locked;
        base_fluid.visibility = this.visibility;
        base_fluid.export = this.export;
        base_fluid.isOpen = this.isOpen;
        return base_fluid;
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

    getLayers() {
        let layers = [];
        this.forEachChild(child => {
            if (child instanceof FluidNode) layers.push(child);
        });
        // Sort by Y coordinate (relative to fluid origin)
        const origin = this.mesh ? this.mesh.position : new THREE.Vector3();
        layers.sort((a, b) => {
            const yA = a.origin[1] - origin.y;
            const yB = b.origin[1] - origin.y;
            return yA - yB;
        });
        return layers;
    }

    static behavior = {
        unique_name: false,
        movable: true,
        rotatable: false,
        parent: true,
        child_types: ['fluid_node'],
    };

    static preview_controller;
}

Fluid.prototype.title = 'Fluid';
Fluid.prototype.type = 'fluid';
Fluid.prototype.icon = 'water_drop';
Fluid.prototype.buttons = [
    Outliner.buttons.locked,
    Outliner.buttons.visibility,
];
Fluid.prototype.menu = new Menu([
    'add_fluid_layer',
    ...Outliner.control_menu_group,
    new MenuSeparator('settings'),
    new MenuSeparator('manage'),
    'rename',
    'delete'
]);

OutlinerElement.registerType(Fluid, 'fluid');

new Property(Fluid, 'string', 'name', {default: 'fluid'});
new Property(Fluid, 'vector', 'position');
new Property(Fluid, 'vector', 'rotation');
new Property(Fluid, 'vector', 'scale', {default: [1, 1, 1]});
new Property(Fluid, 'string', 'kind', {
    default: 'still',
    inputs: {
        element_panel: {
            input: {
                label: 'Fluid Kind',
                type: 'select',
                options: {
                    still: 'Still',
                    flowing: 'Flowing'
                }
            },
            onChange() {
                Fluid.selected.forEach(el => Fluid.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Fluid, 'string', 'color', {
    default: '#ffffff',
    inputs: {
        element_panel: {
            input: {label: 'Fluid Color', type: 'color'},
            onChange() {
                Fluid.selected.forEach(el => Fluid.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Fluid, 'number', 'fillLevel', {
    default: 1.0,
    min: 0.0,
    max: 1.0,
    step: 0.01,
    inputs: {
        element_panel: {
            input: {
                label: 'Fill Level',
                type: 'num_slider',
                min: 0.0,
                max: 1.0,
                step: 0.01
            },
            onChange() {
                Fluid.selected.forEach(el => Fluid.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Fluid, 'boolean', 'visibility', {default: true});

// ----------------------------------------------------------------------
// Texture loading
// ----------------------------------------------------------------------
function getFluidTexture(kind) {
    const url = ASSET_BASE + kind + '.png';
    if (!textureCache.has(url)) {
        const tex = new THREE.TextureLoader().load(url);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        textureCache.set(url, tex);
    }
    return textureCache.get(url);
}

// ----------------------------------------------------------------------
// Fluid Preview Controller
// ----------------------------------------------------------------------
new NodePreviewController(Fluid, {
    setup(element) {
        let object_3d = new THREE.Object3D();
        object_3d.rotation.order = 'ZYX';
        object_3d.uuid = element.uuid.toUpperCase();
        object_3d.name = element.name;
        object_3d.isElement = true;
        object_3d.no_export = true;
        Project.nodes_3d[element.uuid] = object_3d;

        this.updateTransform(element);
        this.updateGeometry(element);

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

    updateGeometry(element) {
        const group = element.mesh;
        // Remove old fluid mesh
        let fluidMesh = group.getObjectByName('fluid_mesh');
        if (fluidMesh) group.remove(fluidMesh);

        const layers = element.getLayers();
        if (layers.length < 2) return;

        const fillLevel = Math.min(1, Math.max(0, element.fillLevel));
        if (fillLevel <= 0) return;

        const color = new THREE.Color(element.color);
        const texture = getFluidTexture(element.kind);

        // Compute relative coordinates and total height
        const origin = group.position;
        const layerData = layers.map(l => ({
            y: l.origin[1] - origin.y,
            x: l.origin[0] - origin.x,
            z: l.origin[2] - origin.z,
            sizeX: l.sizeX,
            sizeZ: l.sizeZ
        }));

        const totalHeight = Math.max(...layerData.map(l => l.y));
        const targetHeight = totalHeight * fillLevel;
        if (targetHeight <= 0) return;

        // Geometry building
        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];

        let vertexCount = 0;
        const addVertex = (x, y, z, nx, ny, nz, u, v) => {
            positions.push(x, y, z);
            normals.push(nx, ny, nz);
            uvs.push(u, v);
            return vertexCount++;
        };

        const addQuad = (v0, v1, v2, v3, nx, ny, nz) => {
            const base = vertexCount;
            addVertex(v0.x, v0.y, v0.z, nx, ny, nz, v0.u, v0.v);
            addVertex(v1.x, v1.y, v1.z, nx, ny, nz, v1.u, v1.v);
            addVertex(v2.x, v2.y, v2.z, nx, ny, nz, v2.u, v2.v);
            addVertex(v3.x, v3.y, v3.z, nx, ny, nz, v3.u, v3.v);
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        };

        // Interpolate between layers up to targetHeight
        let heightDrawn = 0;
        for (let i = 0; i < layerData.length - 1 && heightDrawn < targetHeight; i++) {
            const lower = layerData[i];
            const upper = layerData[i + 1];
            const segmentHeight = upper.y - lower.y;
            if (segmentHeight <= 0) continue;

            const layerFill = Math.min(segmentHeight, targetHeight - heightDrawn);
            const fraction = layerFill / segmentHeight;

            // Interpolated upper dimensions at fill height
            const topX = lower.x + (upper.x - lower.x) * fraction;
            const topZ = lower.z + (upper.z - lower.z) * fraction;
            const topSizeX = lower.sizeX + (upper.sizeX - lower.sizeX) * fraction;
            const topSizeZ = lower.sizeZ + (upper.sizeZ - lower.sizeZ) * fraction;

            const y0 = lower.y;
            const y1 = lower.y + layerFill;

            // Corners
            const x0 = lower.x;
            const z0 = lower.z;
            const x1b = lower.x + lower.sizeX;
            const z1b = lower.z + lower.sizeZ;

            const tx0 = topX;
            const tz0 = topZ;
            const tx1 = topX + topSizeX;
            const tz1 = topZ + topSizeZ;

            // UV scaling: repeat every 16 units
            const uScale = 1 / 16;
            const vScale = 1 / 16;

            // Helper to create vertex with proper UVs based on orientation
            const vtxWall = (x, y, z, nx, ny, nz, lengthCoord, heightCoord) => ({
                x, y, z,
                u: lengthCoord / 16,
                v: heightCoord / 16
            });

// Inside the loop for each segment:

// -Z (north) wall: length along X, height Y
            addQuad(
                vtxWall(x0, y0, z0, 0, 0, -1, x0, y0),
                vtxWall(tx0, y1, tz0, 0, 0, -1, tx0, y1),
                vtxWall(tx1, y1, tz0, 0, 0, -1, tx1, y1),
                vtxWall(x1b, y0, z0, 0, 0, -1, x1b, y0),
                0, 0, -1
            );
// +Z (south) wall: length along X
            addQuad(
                vtxWall(x1b, y0, z1b, 0, 0, 1, x1b, y0),
                vtxWall(tx1, y1, tz1, 0, 0, 1, tx1, y1),
                vtxWall(tx0, y1, tz1, 0, 0, 1, tx0, y1),
                vtxWall(x0, y0, z1b, 0, 0, 1, x0, y0),
                0, 0, 1
            );
// -X (west) wall: length along Z
            addQuad(
                vtxWall(x0, y0, z1b, -1, 0, 0, z1b, y0),
                vtxWall(tx0, y1, tz1, -1, 0, 0, tz1, y1),
                vtxWall(tx0, y1, tz0, -1, 0, 0, tz0, y1),
                vtxWall(x0, y0, z0, -1, 0, 0, z0, y0),
                -1, 0, 0
            );
// +X (east) wall: length along Z
            addQuad(
                vtxWall(x1b, y0, z0, 1, 0, 0, z0, y0),
                vtxWall(tx1, y1, tz0, 1, 0, 0, tz0, y1),
                vtxWall(tx1, y1, tz1, 1, 0, 0, tz1, y1),
                vtxWall(x1b, y0, z1b, 1, 0, 0, z1b, y0),
                1, 0, 0
            );

            heightDrawn += layerFill;
        }

        // Top face at final fill height
        if (heightDrawn > 0) {
            // Interpolate top layer dimensions at targetHeight
            let i = 0;
            while (i < layerData.length - 1 && layerData[i + 1].y < targetHeight) i++;
            const lower = layerData[i];
            const upper = layerData[i + 1];
            const segmentHeight = upper.y - lower.y;
            let fraction = 0;
            if (segmentHeight > 0) {
                fraction = (targetHeight - lower.y) / segmentHeight;
            }
            const topX = lower.x + (upper.x - lower.x) * fraction;
            const topZ = lower.z + (upper.z - lower.z) * fraction;
            const topSizeX = lower.sizeX + (upper.sizeX - lower.sizeX) * fraction;
            const topSizeZ = lower.sizeZ + (upper.sizeZ - lower.sizeZ) * fraction;

            const y = targetHeight;
            const xMin = topX;
            const zMin = topZ;
            const xMax = topX + topSizeX;
            const zMax = topZ + topSizeZ;

            // Tile the top face with 16x16 quads
            const tileSize = 16;
            for (let x = xMin; x < xMax; x += tileSize) {
                for (let z = zMin; z < zMax; z += tileSize) {
                    const x2 = Math.min(x + tileSize, xMax);
                    const z2 = Math.min(z + tileSize, zMax);
                    const u0 = x / 16;
                    const v0 = z / 16;
                    const u1 = x2 / 16;
                    const v1 = z2 / 16;

                    const v0p = {x, y, z, u: u0, v: v0};
                    const v1p = {x, y, z: z2, u: u0, v: v1};
                    const v2p = {x: x2, y, z: z2, u: u1, v: v1};
                    const v3p = {x: x2, y, z, u: u1, v: v0};

                    addQuad(v0p, v1p, v2p, v3p, 0, 1, 0);
                }
            }
        }

        if (positions.length === 0) return;

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geom.setIndex(indices);

        const material = new THREE.MeshStandardMaterial({
            color: color,
            map: texture,
            side: THREE.DoubleSide,
            transparent: true,
            roughness: 0.3,
            metalness: 0.0,
            emissive: new THREE.Color(0x222222),
            emissiveIntensity: 0.1
        });

        const mesh = new THREE.Mesh(geom, material);
        mesh.name = 'fluid_mesh';
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
let addFluidAction, addFluidNodeAction;

function createActions() {
    addFluidAction = new Action('add_fluid', {
        name: 'Add Fluid',
        icon: 'water_drop',
        category: 'edit',
        condition: () => Modes.edit,
        click() {
            Undo.initEdit({outliner: true, elements: [], selection: true});
            let fluid = new Fluid().init();
            let group = getCurrentGroup();
            fluid.addTo(group);
            fluid.createUniqueName();
            // Add two default layers
            let layer1 = new FluidNode({name: 'layer_bottom'}).init();
            layer1.addTo(fluid);
            layer1.origin = [0, 0, 0];
            layer1.sizeX = 16;
            layer1.sizeZ = 16;
            layer1.createUniqueName();

            let layer2 = new FluidNode({name: 'layer_top'}).init();
            layer2.addTo(fluid);
            layer2.origin = [0, 16, 0];
            layer2.sizeX = 16;
            layer2.sizeZ = 16;
            layer2.createUniqueName();

            unselectAll();
            fluid.select();
            Undo.finishEdit('Add Fluid', {outliner: true, elements: selected, selection: true});
            Blockbench.dispatchEvent('add_fluid', {object: fluid});
            return fluid;
        }
    });

    addFluidNodeAction = new Action('add_fluid_layer', {
        name: 'Add Fluid Layer',
        icon: 'layers',
        category: 'edit',
        condition: () => Modes.edit && Fluid.hasSelected(),
        click() {
            const fluid = Fluid.selected[0];
            Undo.initEdit({outliner: true, elements: [], selection: true});
            let node = new FluidNode().init();
            node.addTo(fluid);
            // Place above highest layer
            const layers = fluid.getLayers();
            const maxY = layers.length ? Math.max(...layers.map(l => l.origin[1])) : 0;
            node.origin = [0, maxY + 16, 0];
            node.sizeX = 16;
            node.sizeZ = 16;
            node.createUniqueName();
            unselectAll();
            node.select();
            Undo.finishEdit('Add Fluid Layer', {outliner: true, elements: selected, selection: true});
            Blockbench.dispatchEvent('add_fluid_layer', {object: node});
            return node;
        }
    });

    deletables.push(addFluidAction, addFluidNodeAction);
}

// ----------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------
export function registerFluid() {
    if (registered) return;
    createActions();

    let add_element_menu = BarItems.add_element.side_menu;
    add_element_menu.addAction(addFluidAction);

    window.Fluid = Fluid;
    window.FluidNode = FluidNode;
    registered = true;
}

export function unregisterFluidActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
    registered = false;
}