/* global THREE, OutlinerElement, Menu, MenuSeparator, Property, NodePreviewController, getCurrentGroup, unselectAll, selected */
import '../GLTFLoader';
import {
    createPreviewObject3D,
    makeChildlessCopy,
    makeSaveCopy,
    mergeElementProperties,
    resetElementProperties,
    setPreviewVisibility,
    updatePreviewTransform,
    makeAMTTransformAnimator
} from './common';
import {loadIIGLBModel, normalizeIIPreviewTexture} from '../utils';

let deletables = [];
let addAction;

const MODEL_ASSET_BASE = 'https://assets.iiteam.net/model/';
const ITEM_TEXTURE_SIZE = 16;
const ITEM_PIXEL_DEPTH = 1;
const PREVIEW_MODEL_SIZE = 16;

const ITEM_OPTIONS = {
    empty: {
        name: 'Empty',
        type: 'item',
        stackId: 'minecraft:air'
    },
    iron_ingot: {
        name: 'Iron Ingot',
        type: 'item',
        texture: 'https://assets.iiteam.net/model/item/iron_ingot.png',
        stackId: 'minecraft:iron_ingot'
    },
    electronic_circuit: {
        name: 'Processor Circuit Board',
        type: 'item',
        texture: 'https://assets.iiteam.net/model/item/processor_circuit_board.png',
        stackId: 'immersiveintelligence:material'
    },
    wrench: {
        name: 'Wrench',
        type: 'item',
        texture: 'https://assets.iiteam.net/model/item/wrench.png',
        stackId: 'immersiveengineering:wrench'
    },
    hammer: {
        name: 'Hammer',
        type: 'item',
        texture: 'https://assets.iiteam.net/model/item/hammer.png',
        stackId: 'immersiveengineering:tool'
    },
    wooden_planks: {
        name: 'Wooden Planks',
        type: 'block',
        texture: 'https://assets.iiteam.net/model/item/oak_planks.png',
        stackId: 'minecraft:planks'
    },
    wooden_crate: {
        name: 'Wooden Crate',
        type: 'block',
        texture: 'https://assets.iiteam.net/model/item/wooden_crate.png',
        stackId: 'immersiveengineering:wooden_device0'
    },
    reinforced_crate: {
        name: 'Reinforced Crate',
        type: 'block',
        texture: 'https://assets.iiteam.net/model/item/reinforced_crate.png',
        stackId: 'immersiveengineering:wooden_device0'
    },
    metal_crate: {
        name: 'Metal Crate',
        type: 'block',
        texture: 'https://assets.iiteam.net/model/item/metal_crate.png',
        stackId: 'immersiveengineering:metal_crate'
    },
    rifle: {
        name: 'Rifle',
        type: 'model',
        model: 'item/rifle.glb',
        stackId: 'immersiveintelligence:rifle'
    },
    submachine_gun: {
        name: 'Submachine Gun',
        type: 'model',
        model: 'item/submachine_gun.glb',
        stackId: 'immersiveintelligence:submachinegun'
    },
    assault_rifle: {
        name: 'Assault Rifle',
        type: 'model',
        model: 'item/assault_rifle.glb',
        stackId: 'immersiveintelligence:assault_rifle'
    },
    electric_hammer: {
        name: 'Electric Hammer',
        type: 'model',
        model: 'item/electric_hammer.glb',
        stackId: 'immersiveintelligence:electric_hammer'
    },
    electric_wrench: {
        name: 'Electric Wrench',
        type: 'model',
        model: 'item/electric_wrench.glb',
        stackId: 'immersiveintelligence:electric_wrench'
    },
    electric_wirecutters: {
        name: 'Electric Wire Cutters',
        type: 'model',
        model: 'item/electric_wirecutters.glb',
        stackId: 'immersiveintelligence:electric_wirecutters'
    },
};

const ITEM_SELECT_OPTIONS = Object.fromEntries(
    Object.entries(ITEM_OPTIONS).map(([key, value]) => [key, value.name])
);

const textureCache = new Map();
const imageDataCache = new Map();
const modelCache = new Map();

function getDefinition(element) {
    return ITEM_OPTIONS[element.itemKey] || ITEM_OPTIONS.empty;
}

function clearChildren(object) {
    if (!object) return;
    while (object.children.length) {
        const child = object.children[object.children.length - 1];
        object.remove(child);
        child.traverse?.(node => {
            if (node.userData?.iiOwnedGeometry && node.geometry?.dispose) node.geometry.dispose();
            if (node.userData?.iiOwnedMaterial) {
                if (Array.isArray(node.material)) node.material.forEach(material => material?.dispose?.());
                else node.material?.dispose?.();
            }
        });
    }
}

function markOwned(node) {
    node.no_export = true;
    node.userData = Object.assign({}, node.userData, {iiOwnedGeometry: true});
    return node;
}

function markOwnedMaterial(material) {
    material.no_export = true;
    material.userData = Object.assign({}, material.userData, {iiOwnedMaterial: true});
    return material;
}

function makeBasicMaterial(options = {}) {
    return markOwnedMaterial(new THREE.MeshBasicMaterial({
        map: options.map || null,
        color: options.color || new THREE.Color(0xffffff),
        transparent: options.transparent !== undefined ? options.transparent : !!options.map,
        opacity: options.opacity !== undefined ? options.opacity : 1,
        alphaTest: options.alphaTest !== undefined ? options.alphaTest : 0.15,
        side: options.side !== undefined ? options.side : THREE.DoubleSide
    }));
}

function makeLineMaterial(color = 0xffffff, opacity = 0.9) {
    return markOwnedMaterial(new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity
    }));
}

function makeStackNBT(element) {
    const definition = getDefinition(element);
    const id = String(definition.stackId || 'minecraft:air');
    if (id === 'minecraft:air') return {id: 'minecraft:air', Count: 0, Damage: 0};
    return {
        id,
        Count: Math.max(1, Math.round(Number(element.count) || 1)),
        Damage: Math.max(0, Math.round(Number(element.damage) || 0))
    };
}

async function loadPreviewTexture(url) {
    if (!url) return null;
    if (!textureCache.has(url)) {
        textureCache.set(url, new Promise((resolve, reject) => {
            new THREE.TextureLoader().load(
                url,
                texture => resolve(normalizeIIPreviewTexture(texture, {flipY: false})),
                undefined,
                reject
            );
        }));
    }
    return textureCache.get(url);
}

async function loadPreviewImageData(url) {
    if (!url) return null;
    if (!imageDataCache.has(url)) {
        imageDataCache.set(url, new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = ITEM_TEXTURE_SIZE;
                canvas.height = ITEM_TEXTURE_SIZE;
                const ctx = canvas.getContext('2d', {willReadFrequently: true});
                ctx.imageSmoothingEnabled = false;
                ctx.clearRect(0, 0, ITEM_TEXTURE_SIZE, ITEM_TEXTURE_SIZE);
                ctx.drawImage(image, 0, 0, ITEM_TEXTURE_SIZE, ITEM_TEXTURE_SIZE);
                const imageData = ctx.getImageData(0, 0, ITEM_TEXTURE_SIZE, ITEM_TEXTURE_SIZE);
                resolve(imageData);
            };
            image.onerror = reject;
            image.src = url;
        }));
    }
    return imageDataCache.get(url);
}

async function loadPreviewModel(path) {
    if (!path) return null;
    const url = /^https?:\/\//.test(path) ? path : `${MODEL_ASSET_BASE}${String(path).replace(/^\/+/, '')}`;
    if (!modelCache.has(url)) {
        modelCache.set(url, loadIIGLBModel(url, {cacheKey: `ii_item_${url}`}));
    }
    const loaded = await modelCache.get(url);
    return loaded ? loaded.clone(true) : null;
}

function normalizeMeshOwnership(root) {
    if (!root) return root;
    root.traverse(node => {
        node.no_export = true;
        if (node.geometry) node.userData = Object.assign({}, node.userData, {iiOwnedGeometry: true});
        if (Array.isArray(node.material)) node.material.forEach(material => material && markOwnedMaterial(material));
        else if (node.material) markOwnedMaterial(node.material);
    });
    return root;
}

function createTextureBox(width, height, depth, texture) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    markOwned(geometry);
    const material = makeBasicMaterial({map: texture, transparent: true, alphaTest: 0.2});
    const mesh = new THREE.Mesh(geometry, material);
    mesh.no_export = true;
    return mesh;
}

function isSolidPixel(imageData, x, y) {
    if (!imageData || x < 0 || y < 0 || x >= ITEM_TEXTURE_SIZE || y >= ITEM_TEXTURE_SIZE) return false;
    return imageData.data[(y * ITEM_TEXTURE_SIZE + x) * 4 + 3] > 8;
}

function getPixelColor(imageData, x, y) {
    const offset = (y * ITEM_TEXTURE_SIZE + x) * 4;
    return [
        imageData.data[offset] / 255,
        imageData.data[offset + 1] / 255,
        imageData.data[offset + 2] / 255
    ];
}

function addVoxelFace(vertices, normals, colors, indices, normal, color, corners) {
    const index = vertices.length / 3;
    corners.forEach(corner => {
        vertices.push(corner[0], corner[1], corner[2]);
        normals.push(normal[0], normal[1], normal[2]);
        colors.push(color[0], color[1], color[2]);
    });
    indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
}

function createVoxelItemGeometry(imageData) {
    const vertices = [];
    const normals = [];
    const colors = [];
    const indices = [];
    const z0 = -ITEM_PIXEL_DEPTH / 2;
    const z1 = ITEM_PIXEL_DEPTH / 2;

    for (let y = 0; y < ITEM_TEXTURE_SIZE; y++) {
        for (let x = 0; x < ITEM_TEXTURE_SIZE; x++) {
            if (!isSolidPixel(imageData, x, y)) continue;
            const color = getPixelColor(imageData, x, y);
            const x0 = x - ITEM_TEXTURE_SIZE / 2;
            const x1 = x0 + 1;
            const y1 = ITEM_TEXTURE_SIZE / 2 - y;
            const y0 = y1 - 1;

            addVoxelFace(vertices, normals, colors, indices, [0, 0, 1], color, [
                [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
            ]);
            addVoxelFace(vertices, normals, colors, indices, [0, 0, -1], color, [
                [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]
            ]);
            if (!isSolidPixel(imageData, x - 1, y)) {
                addVoxelFace(vertices, normals, colors, indices, [-1, 0, 0], color, [
                    [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]
                ]);
            }
            if (!isSolidPixel(imageData, x + 1, y)) {
                addVoxelFace(vertices, normals, colors, indices, [1, 0, 0], color, [
                    [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]
                ]);
            }
            if (!isSolidPixel(imageData, x, y - 1)) {
                addVoxelFace(vertices, normals, colors, indices, [0, 1, 0], color, [
                    [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]
                ]);
            }
            if (!isSolidPixel(imageData, x, y + 1)) {
                addVoxelFace(vertices, normals, colors, indices, [0, -1, 0], color, [
                    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]
                ]);
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    markOwned(geometry);
    return geometry;
}

function createItemPreviewObject(imageData) {
    const group = new THREE.Group();
    group.name = 'item_preview_item';
    group.no_export = true;

    const geometry = createVoxelItemGeometry(imageData);
    const material = makeBasicMaterial({transparent: false, alphaTest: 0});
    material.vertexColors = THREE.VertexColors !== undefined ? THREE.VertexColors : true;
    material.needsUpdate = true;

    const itemMesh = new THREE.Mesh(geometry, material);
    itemMesh.name = 'voxelized_item';
    itemMesh.no_export = true;
    group.add(itemMesh);

    return group;
}

function createBlockPreviewObject(texture) {
    const group = new THREE.Group();
    group.name = 'item_preview_block';
    group.no_export = true;

    const blockMesh = createTextureBox(16, 16, 16, texture);
    group.add(blockMesh);

    return group;
}

function fitObjectToUnitCube(object, targetSize = PREVIEW_MODEL_SIZE) {
    if (!object) return object;
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return object;

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDimension = Math.max(size.x || 0, size.y || 0, size.z || 0, 1e-6);
    const scale = targetSize / maxDimension;
    object.scale.multiplyScalar(scale);
    object.position.sub(center.multiplyScalar(scale));
    object.updateMatrixWorld(true);
    return object;
}

async function createModelPreviewObject(definition) {
    const loaded = await loadPreviewModel(definition.model);
    if (!loaded) return null;
    const group = new THREE.Group();
    group.name = 'item_preview_model';
    group.no_export = true;
    normalizeMeshOwnership(loaded);
    fitObjectToUnitCube(loaded, PREVIEW_MODEL_SIZE);
    group.add(loaded);
    return group;
}

function makeBlueprintFromObject(object) {
    const group = new THREE.Group();
    group.name = 'item_blueprint_preview';
    group.no_export = true;

    const lineMaterial = makeLineMaterial(0xffffff, 0.95);
    const shadeMaterial = makeLineMaterial(0x9fd3ff, 0.75);

    object.updateMatrixWorld(true);
    let added = false;
    object.traverse(node => {
        if (!(node instanceof THREE.Mesh) || !node.geometry) return;
        const edgesGeometry = new THREE.EdgesGeometry(node.geometry, 30);
        markOwned(edgesGeometry);
        const edgeLines = new THREE.LineSegments(edgesGeometry, lineMaterial);
        edgeLines.position.copy(node.position);
        edgeLines.rotation.copy(node.rotation);
        edgeLines.scale.copy(node.scale);
        edgeLines.no_export = true;
        group.add(edgeLines);
        added = true;
    });

    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) {
        const size = new THREE.Vector3();
        box.getSize(size);
        const min = box.min.clone();
        const max = box.max.clone();
        const z = max.z + 0.01;
        const stripes = Math.max(4, Math.min(10, Math.round(size.x * 8)));
        const stripePositions = [];
        for (let i = 0; i <= stripes; i++) {
            const t = i / stripes;
            const x = min.x + (max.x - min.x) * t;
            stripePositions.push(x, min.y, z, x, max.y, z);
        }
        const shadeGeometry = new THREE.BufferGeometry();
        shadeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stripePositions, 3));
        markOwned(shadeGeometry);
        group.add(new THREE.LineSegments(shadeGeometry, shadeMaterial));
        added = true;
    }

    return added ? group : null;
}

async function createBasePreviewObject(definition) {
    switch (definition.type) {
        case 'item': {
            const imageData = await loadPreviewImageData(definition.texture);
            return imageData ? createItemPreviewObject(imageData) : null;
        }
        case 'block': {
            const texture = await loadPreviewTexture(definition.texture);
            return texture ? createBlockPreviewObject(texture) : null;
        }
        case 'model':
            return createModelPreviewObject(definition);
        default:
            return null;
    }
}

function clonePreviewObject(object) {
    const clone = object.clone(true);
    normalizeMeshOwnership(clone);
    return clone;
}

async function rebuildItemPreview(element) {
    if (!element.mesh) return;
    const buildToken = (element._iiItemPreviewBuildToken || 0) + 1;
    element._iiItemPreviewBuildToken = buildToken;

    const group = element.mesh;
    clearChildren(group);

    const definition = getDefinition(element);
    if (!definition || (definition.stackId === 'minecraft:air' && !definition.texture && !definition.model)) return;

    const basePreview = await createBasePreviewObject(definition);
    if (!basePreview || element._iiItemPreviewBuildToken !== buildToken) return;

    const previewRoot = new THREE.Group();
    previewRoot.no_export = true;
    const amount = element.displayMode === 'stacked'
        ? Math.min(8, Math.max(1, Math.round(Number(element.count) || 1)))
        : 1;

    const stackYOffset = definition.type === 'block' ? 2.25 : 1.25;
    const stackZOffset = definition.type === 'model' ? 1.0 : 0.75;

    for (let i = 0; i < amount; i++) {
        const instance = i === 0 ? basePreview : clonePreviewObject(basePreview);
        instance.position.set(0, i * stackYOffset, i * stackZOffset);
        previewRoot.add(instance);
    }

    if (element.displayMode === 'schematic') {
        const blueprint = makeBlueprintFromObject(previewRoot);
        if (blueprint) group.add(blueprint);
        return;
    }

    group.add(previewRoot);
}

function updateGeometryForSelected(elementClass) {
    const selectedElements = Array.isArray(elementClass.selected) ? elementClass.selected : [];
    selectedElements.forEach(element => elementClass.preview_controller.updateGeometry(element));
}

function selectAnimatorFor(element) {
    if (Animator.open && Animation.selected) Animation.selected.getBoneAnimator(element)?.select(true);
}

function getCurrentOutlinerGroup() {
    if (typeof getCurrentGroup === 'function') return getCurrentGroup();
    return Group.selected || null;
}

function addElement() {
    Undo.initEdit({outliner: true, elements: [], selection: true});
    const element = new AMTItemElement().init();
    element.addTo(getCurrentOutlinerGroup());
    element.createUniqueName();
    unselectAll();
    element.select();
    Undo.finishEdit('Add AMT Item', {outliner: true, elements: selected, selection: true});
    Blockbench.dispatchEvent('add_ii_item', {object: element});
    return element;
}

export class AMTItemElement extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetElementProperties(this, AMTItemElement);
        this.name = 'item';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;
        if (data && typeof data === 'object') this.extend(data);
    }

    get origin() {
        return this.position;
    }

    extend(object) { return mergeElementProperties(this, AMTItemElement, object); }
    init() { super.init(); if (!this.mesh || !this.mesh.parent) AMTItemElement.preview_controller.setup(this); return this; }
    select(event, isOutlinerClick) { const result = super.select(event, isOutlinerClick); if (result !== false) selectAnimatorFor(this); return result; }
    unselect(...args) {
        super.unselect(...args);
        if (Animator.open && Timeline.selected_animator && Timeline.selected_animator.element == this) {
            Timeline.selected_animator.selected = false;
        }
    }

    getWorldCenter() { return this.mesh ? THREE.fastWorldPosition(this.mesh, new THREE.Vector3()) : new THREE.Vector3(); }
    getSaveCopy() { return makeSaveCopy(this, AMTItemElement); }
    getUndoCopy() { return makeSaveCopy(this, AMTItemElement); }
    getChildlessCopy(keepUuid = false) { return makeChildlessCopy(this, AMTItemElement, keepUuid); }
}

const AMTItem = AMTItemElement;

AMTItem.behavior = {unique_name: true, movable: true, rotatable: true, scalable: true};
AMTItem.preview_controller = null;

AMTItem.prototype.title = 'Item';
AMTItem.prototype.type = 'item';
AMTItem.prototype.icon = 'widgets';
AMTItem.prototype.movable = true;
AMTItem.prototype.rotatable = true;
AMTItem.prototype.scalable = true;
AMTItem.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
AMTItem.prototype.menu = new Menu([...Outliner.control_menu_group, new MenuSeparator('manage'), 'rename', 'delete']);

OutlinerElement.registerType(AMTItem, 'item');

new Property(AMTItem, 'string', 'name', {default: 'item'});
new Property(AMTItem, 'vector', 'position');
new Property(AMTItem, 'vector', 'rotation');
new Property(AMTItem, 'vector', 'scale', {default: [1, 1, 1]});
new Property(AMTItem, 'string', 'itemKey', {
    default: 'iron_ingot',
    inputs: {
        element_panel: {
            input: {
                label: 'Preview Item',
                type: 'select',
                options: ITEM_SELECT_OPTIONS
            },
            onChange() {
                updateGeometryForSelected(AMTItem);
            }
        }
    }
});
new Property(AMTItem, 'number', 'damage', {
    default: 0,
    min: 0,
    step: 1,
    inputs: {
        element_panel: {
            input: {
                label: 'Damage',
                type: 'number',
                min: 0,
                step: 1
            },
            onChange() {
                updateGeometryForSelected(AMTItem);
            }
        }
    }
});
new Property(AMTItem, 'number', 'count', {
    default: 1,
    min: 1,
    max: 64,
    step: 1,
    inputs: {
        element_panel: {
            input: {
                label: 'Count',
                type: 'number',
                min: 1,
                max: 64,
                step: 1
            },
            onChange() {
                updateGeometryForSelected(AMTItem);
            }
        }
    }
});
new Property(AMTItem, 'string', 'displayMode', {
    default: 'normal',
    inputs: {
        element_panel: {
            input: {
                label: 'Display Mode',
                type: 'select',
                options: {
                    normal: 'Normal',
                    stacked: 'Stacked',
                    schematic: 'Schematic'
                }
            },
            onChange() {
                updateGeometryForSelected(AMTItem);
            }
        }
    }
});
new Property(AMTItem, 'boolean', 'visibility', {default: true});

new NodePreviewController(AMTItem, {
    setup(element) {
        createPreviewObject3D(element, {group: true});
        this.updateTransform(element);
        this.updateGeometry(element);
        this.dispatchEvent('setup', {element});
    },
    updateTransform(element) {
        updatePreviewTransform(element);
        this.dispatchEvent('update_transform', {element});
    },
    updateGeometry(element) {
        rebuildItemPreview(element);
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

AMTItem.animator = makeAMTTransformAnimator('item');

export function registerItem() {
    addAction = new Action('add_ii_item', {
        name: 'AMT Item',
        description: 'Add an AMT item renderer element',
        icon: 'widgets',
        category: 'edit',
        condition: () => Modes.edit,
        click: addElement
    });
    deletables.push(addAction);
    BarItems.add_element.side_menu.addAction(addAction);
    window.IIItemElement = AMTItem;
    window.IIItemElementMakeStackNBT = makeStackNBT;
}

export function unregisterItemActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
}

export function getItemElementProperties(element) {
    return {
        stack: makeStackNBT(element),
        drawStacked: element.displayMode === 'stacked',
        schematic: element.displayMode === 'schematic'
    };
}
