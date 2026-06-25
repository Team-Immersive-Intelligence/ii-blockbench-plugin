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

const FONT_ASSET_URL = 'https://assets.iiteam.net/model/font/Monocraft.ttf';
const FONT_FAMILY = 'Monocraft';

let deletables = [];
let addAction;
let minecraftFontPromise = null;
let fontFaceRegistered = false;

function parseHexColor(value, fallback = '#ffffff') {
    const raw = String(value || fallback).trim();
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
    if (/^[0-9a-f]{6}$/i.test(raw)) return '#' + raw;
    return fallback;
}

function colorToInteger(value) {
    return parseInt(parseHexColor(value).substring(1), 16) || 0xffffff;
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
            if (node.material?.map?.userData?.iiOwnedTexture && node.material.map.dispose) node.material.map.dispose();
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
        side: options.side !== undefined ? options.side : THREE.DoubleSide
    });
    material.no_export = true;
    material.userData = {iiOwnedMaterial: true};
    return material;
}

function getMinecraftFont() {
    if (minecraftFontPromise) return minecraftFontPromise;
    minecraftFontPromise = new Promise(resolve => {
        if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
            resolve(false);
            return;
        }
        const fontFace = new FontFace(FONT_FAMILY, `url(${FONT_ASSET_URL}) format('truetype')`);
        fontFace.load().then(loadedFace => {
            if (!fontFaceRegistered) {
                document.fonts.add(loadedFace);
                fontFaceRegistered = true;
            }
            return document.fonts.ready;
        }).then(() => resolve(true)).catch(error => {
            console.warn(`Failed to load TTF font "${FONT_ASSET_URL}":`, error);
            resolve(false);
        });
    });
    return minecraftFontPromise;
}

function hardenTextAlpha(context, width, height) {
    const image = context.getImageData(0, 0, width, height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] >= 128) {
            data[i + 3] = 255;
        } else {
            data[i + 3] = 0;
        }
    }
    context.putImageData(image, 0, 0);
}

function makeCanvasTextTexture(text, color, size, useMinecraftFont) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', {willReadFrequently: true});
    const fontSize = Math.max(1, Math.round(size));
    const fontFamily = useMinecraftFont ? FONT_FAMILY : 'monospace';
    const font = `${fontSize}px "${fontFamily}"`;

    context.imageSmoothingEnabled = false;
    context.font = font;
    const metrics = context.measureText(text || 'Text');
    const width = Math.max(16, Math.ceil(metrics.width + 2));
    const height = Math.max(12, Math.ceil(fontSize * 1.25 + 2));

    canvas.width = width;
    canvas.height = height;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, width, height);
    context.font = font;
    context.textBaseline = 'top';
    context.fillStyle = parseHexColor(color);
    context.fillText(text || 'Text', 1, 1);
    hardenTextAlpha(context, width, height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.userData = {iiOwnedTexture: true};
    return normalizeIIPreviewTexture(texture, {flipY: true});
}

async function rebuildTextPreview(element) {
    if (!element.mesh) return;
    const group = element.mesh;
    const token = element._textUpdateToken = (element._textUpdateToken || 0) + 1;
    clearChildren(group);

    const previewText = element.text || 'Text';
    const fontSize = Math.max(1, Number(element.fontSize) || 11);
    const fontLoaded = await getMinecraftFont();
    if (token !== element._textUpdateToken || !element.mesh) return;

    const texture = makeCanvasTextTexture(previewText, element.color, fontSize, fontLoaded);
    const width = texture.image.width;
    const height = texture.image.height;
    const geometry = new THREE.PlaneGeometry(width, height);
    geometry.userData = {iiOwnedGeometry: true};
    const material = makeBasicMaterial({map: texture, transparent: true});
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'text_preview';
    mesh.no_export = true;
    mesh.scale.set(1 / 11, 1 / 11, 1);
    mesh.position.set(width / 22, -height / 22, 0);
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
    const element = new AMTText().init();
    element.addTo(getCurrentOutlinerGroup());
    element.createUniqueName();
    unselectAll();
    element.select();
    Undo.finishEdit('Add AMT Text', {outliner: true, elements: selected, selection: true});
    Blockbench.dispatchEvent('add_ii_text', {object: element});
    return element;
}

export class AMTText extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetElementProperties(this, AMTText);
        this.name = 'text';
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

    extend(object) {
        return mergeElementProperties(this, AMTText, object);
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) AMTText.preview_controller.setup(this);
        return this;
    }

    select(event, isOutlinerClick) {
        const result = super.select(event, isOutlinerClick);
        if (result !== false) selectAnimatorFor(this);
        return result;
    }

    unselect(...args) {
        super.unselect(...args);
        if (Animator.open && Timeline.selected_animator && Timeline.selected_animator.element == this) {
            Timeline.selected_animator.selected = false;
        }
    }

    getWorldCenter() {
        return this.mesh ? THREE.fastWorldPosition(this.mesh, new THREE.Vector3()) : new THREE.Vector3();
    }

    getSaveCopy() { return makeSaveCopy(this, AMTText); }
    getUndoCopy() { return makeSaveCopy(this, AMTText); }
    getChildlessCopy(keepUuid = false) { return makeChildlessCopy(this, AMTText, keepUuid); }

}


AMTText.behavior = {unique_name: true, movable: true, rotatable: true, scalable: true};
AMTText.preview_controller = null;

AMTText.prototype.title = 'Text';
AMTText.prototype.type = 'ii_text';
AMTText.prototype.icon = 'title';
AMTText.prototype.movable = true;
AMTText.prototype.rotatable = true;
AMTText.prototype.scalable = true;
AMTText.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
AMTText.prototype.menu = new Menu([...Outliner.control_menu_group, new MenuSeparator('manage'), 'rename', 'delete']);

OutlinerElement.registerType(AMTText, 'ii_text');

new Property(AMTText, 'string', 'name', {default: 'text'});
new Property(AMTText, 'vector', 'position');
new Property(AMTText, 'vector', 'rotation');
new Property(AMTText, 'vector', 'scale', {default: [1, 1, 1]});
new Property(AMTText, 'string', 'text', {
    default: 'Text',
    inputs: {
        element_panel: {
            input: {
                label: 'Text',
                type: 'text'
            },
            onChange() {
                updateGeometryForSelected(AMTText);
            }
        }
    }
});
new Property(AMTText, 'string', 'color', {
    default: '#ffffff',
    inputs: {
        element_panel: {
            input: {
                label: 'Color',
                type: 'color'
            },
            onChange() {
                updateGeometryForSelected(AMTText);
            }
        }
    }
});
new Property(AMTText, 'number', 'fontSize', {
    default: 11,
    min: 1,
    step: 1,
    inputs: {
        element_panel: {
            input: {
                label: 'Font Size',
                type: 'number',
                min: 1,
                step: 1
            },
            onChange() {
                updateGeometryForSelected(AMTText);
            }
        }
    }
});
new Property(AMTText, 'boolean', 'visibility', {default: true});

new NodePreviewController(AMTText, {
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
        rebuildTextPreview(element);
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

AMTText.animator = makeAMTTransformAnimator('ii_text');

export function registerText() {
    addAction = new Action('add_ii_text', {
        name: 'AMT Text',
        description: 'Add an AMT text renderer element',
        icon: 'title',
        category: 'edit',
        condition: () => Modes.edit,
        click: addElement
    });
    deletables.push(addAction);
    BarItems.add_element.side_menu.addAction(addAction);
    window.IITextElement = AMTText;
}

export function unregisterTextActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
}

export function getTextElementProperties(element) {
    return {
        text: element.text || '',
        color: colorToInteger(element.color),
        fontSize: Math.round(((Number(element.fontSize) || 11) / 11) * 10000) / 10000
    };
}
