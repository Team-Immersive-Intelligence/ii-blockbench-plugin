/* global THREE, OutlinerElement, Menu, MenuSeparator, Property, NodePreviewController, getCurrentGroup, unselectAll, selected */
/* eslint-disable no-console */
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
import {normalizeIIPreviewTexture} from '../utils';

const HANS_TEXTURE_URL = 'https://assets.iiteam.net/model/hans/hans.png';
const SKIN_SIZE = 64;

let deletables = [];
let addAction;
let hansTexturePromise = null;

const HAND_UV = {
    front: [48, 32, 44, 20],
    back: [56, 32, 52, 20],
    right: [44, 32, 40, 20],
    left: [52, 32, 48, 20],
    top: [48, 16, 52, 20],
    bottom: [44, 16, 48, 20]
};

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

function makeBasicMaterial(options = {}) {
    const material = new THREE.MeshBasicMaterial({
        map: options.map || null,
        color: options.color || new THREE.Color(0xffffff),
        transparent: options.transparent !== undefined ? options.transparent : !!options.map,
        opacity: options.opacity !== undefined ? options.opacity : 1,
        alphaTest: options.alphaTest !== undefined ? options.alphaTest : 0.05,
        side: options.side !== undefined ? options.side : THREE.FrontSide
    });
    material.no_export = true;
    material.userData = {iiOwnedMaterial: true};
    return material;
}

function uvCorner(x, y, size = SKIN_SIZE) {
    return [x / size, y / size];
}

function pushQuad(vertices, normals, uvs, indices, corners, normal, rect, textureSize = SKIN_SIZE) {
    const start = vertices.length / 3;
    const [x1, y1, x2, y2] = rect;
    const quadUvs = [
        uvCorner(x1, y2, textureSize),
        uvCorner(x2, y2, textureSize),
        uvCorner(x2, y1, textureSize),
        uvCorner(x1, y1, textureSize)
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
    geometry.userData = {iiOwnedGeometry: true};
    return geometry;
}

function getHansTexture() {
    if (hansTexturePromise) return hansTexturePromise;
    hansTexturePromise = new Promise(resolve => {
        new THREE.TextureLoader().load(HANS_TEXTURE_URL, texture => {
            resolve(normalizeIIPreviewTexture(texture));
        }, undefined, error => {
            console.warn(`Failed to load texture "${HANS_TEXTURE_URL}":`, error);
            resolve(null);
        });
    });
    return hansTexturePromise;
}

async function rebuildHandPreview(element) {
    if (!element.mesh) return;
    const group = element.mesh;
    const token = element._handUpdateToken = (element._handUpdateToken || 0) + 1;
    clearChildren(group);
    const texture = await getHansTexture();
    if (token !== element._handUpdateToken || !element.mesh) return;

    const material = makeBasicMaterial({map: texture, transparent: true, side: THREE.FrontSide});
    const geometry = createTexturedBoxGeometry([4, 12, 4], [0, -4, 0], HAND_UV);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'hand_preview';
    mesh.no_export = true;
    if (element.hand === 'off_hand') mesh.scale.x = -1;
    group.add(mesh);
}

function updateGeometryForSelected(elementClass) {
    const selected = Array.isArray(elementClass.selected) ? elementClass.selected : [];
    selected.forEach(element => elementClass.preview_controller.updateGeometry(element));
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
    const element = new AMTHand().init();
    element.addTo(getCurrentOutlinerGroup());
    element.createUniqueName();
    unselectAll();
    element.select();
    Undo.finishEdit('Add AMT Hand', {outliner: true, elements: selected, selection: true});
    Blockbench.dispatchEvent('add_ii_hand', {object: element});
    return element;
}

export class AMTHandElement extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetElementProperties(this, AMTHandElement);
        this.name = 'hand';
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

    extend(object) { return mergeElementProperties(this, AMTHandElement, object); }
    init() { super.init(); if (!this.mesh || !this.mesh.parent) AMTHandElement.preview_controller.setup(this); return this; }
    select(event, isOutlinerClick) { const result = super.select(event, isOutlinerClick); if (result !== false) selectAnimatorFor(this); return result; }
    unselect(...args) {
        super.unselect(...args);
        if (Animator.open && Timeline.selected_animator && Timeline.selected_animator.element == this) {
            Timeline.selected_animator.selected = false;
        }
    }

    getWorldCenter() { return this.mesh ? THREE.fastWorldPosition(this.mesh, new THREE.Vector3()) : new THREE.Vector3(); }
    getSaveCopy() { return makeSaveCopy(this, AMTHandElement); }
    getUndoCopy() { return makeSaveCopy(this, AMTHandElement); }
    getChildlessCopy(keepUuid = false) { return makeChildlessCopy(this, AMTHandElement, keepUuid); }

}

const AMTHand = AMTHandElement;

AMTHand.behavior = {unique_name: true, movable: true, rotatable: true, scalable: true};
AMTHand.preview_controller = null;

AMTHand.prototype.title = 'Hand';
AMTHand.prototype.type = 'hand';
AMTHand.prototype.icon = 'pan_tool';
AMTHand.prototype.movable = true;
AMTHand.prototype.rotatable = true;
AMTHand.prototype.scalable = true;
AMTHand.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
AMTHand.prototype.menu = new Menu([...Outliner.control_menu_group, new MenuSeparator('manage'), 'rename', 'delete']);

OutlinerElement.registerType(AMTHand, 'hand');

new Property(AMTHand, 'string', 'name', {default: 'hand'});
new Property(AMTHand, 'vector', 'position');
new Property(AMTHand, 'vector', 'rotation');
new Property(AMTHand, 'vector', 'scale', {default: [1, 1, 1]});
new Property(AMTHand, 'string', 'hand', {
    default: 'main_hand',
    inputs: {
        element_panel: {
            input: {
                label: 'Hand',
                type: 'select',
                options: {
                    main_hand: 'Main Hand',
                    off_hand: 'Off Hand'
                }
            },
            onChange() {
                updateGeometryForSelected(AMTHand);
            }
        }
    }
});
new Property(AMTHand, 'boolean', 'visibility', {default: true});

new NodePreviewController(AMTHand, {
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
        rebuildHandPreview(element);
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

AMTHand.animator = makeAMTTransformAnimator('hand');

export function registerHand() {
    addAction = new Action('add_ii_hand', {
        name: 'AMT Hand',
        description: 'Add an AMT first-person hand renderer element',
        icon: 'pan_tool',
        category: 'edit',
        condition: () => Modes.edit,
        click: addElement
    });
    deletables.push(addAction);
    BarItems.add_element.side_menu.addAction(addAction);
    window.IIHandElement = AMTHand;
}

export function unregisterHandActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
}

export function getHandElementProperties(element) {
    return {hand: element.hand || 'main_hand'};
}
