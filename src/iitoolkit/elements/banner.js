/* global THREE, OutlinerElement, Menu, MenuSeparator, Property, NodePreviewController, getCurrentGroup, unselectAll, selected, KeyframeDataPoint */
/* eslint-disable no-console */
import {
    createPreviewObject3D,
    makeChildlessCopy,
    makeSaveCopy,
    mergeElementProperties,
    resetElementProperties,
    setPreviewVisibility,
    updatePreviewTransform,
    AMTTransformAnimator
} from './common';
import {normalizeIIPreviewTexture} from '../utils';

const BANNER_TEXTURE_URL = 'https://assets.iiteam.net/model/banner.png';

let deletables = [];
let addAction;
let bannerTexturePromise = null;

const BANNER_WAVE = {
    banner0: [[0, -12.5], [0.25, 0], [0.5, 12.5], [0.75, 0], [1, -12.5]],
    banner1: [[0, 12.5], [0.25, 0], [0.5, -12.5], [0.75, 0], [1, 12.5]],
    banner2: [[0, -25], [0.25, 0], [0.5, 25], [0.75, 0], [1, -25]],
    banner3: [[0, -12.5], [0.25, 0], [0.5, 12.5], [0.75, 0], [1, -12.5]]
};

function parseHexColor(value, fallback = '#ffffff') {
    const raw = String(value || fallback).trim();
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
    if (/^[0-9a-f]{6}$/i.test(raw)) return '#' + raw;
    return fallback;
}

function colorToThree(value) {
    return new THREE.Color(parseHexColor(value));
}

function colorToInteger(value) {
    return parseInt(parseHexColor(value).substring(1), 16) || 0xffffff;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
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

function getBannerTexture() {
    if (bannerTexturePromise) return bannerTexturePromise;
    bannerTexturePromise = new Promise(resolve => {
        new THREE.TextureLoader().load(BANNER_TEXTURE_URL, texture => {
            resolve(normalizeIIPreviewTexture(texture));
        }, undefined, error => {
            console.warn(`Failed to load texture "${BANNER_TEXTURE_URL}":`, error);
            resolve(null);
        });
    });
    return bannerTexturePromise;
}

function interpolateWave(segmentName, progress) {
    const frames = BANNER_WAVE[segmentName] || BANNER_WAVE.banner0;
    const p = clamp01(progress);
    for (let i = 0; i < frames.length - 1; i++) {
        const [t0, v0] = frames[i];
        const [t1, v1] = frames[i + 1];
        if (p >= t0 && p <= t1) {
            const k = (p - t0) / (t1 - t0 || 1);
            return v0 + (v1 - v0) * k;
        }
    }
    return frames[frames.length - 1][1];
}

function bannerUV(u, v) {
    return [u / 64, v / 64];
}

function pushQuad(positions, uvs, corners, faceUvs) {
    const order = [0, 1, 2, 0, 2, 3];
    order.forEach(index => {
        positions.push(...corners[index]);
        uvs.push(...faceUvs[index]);
    });
}

function makeBannerSegmentGeometry(segmentIndex) {
    const top = segmentIndex * 10;
    const bottom = top + 10;
    const positions = [];
    const uvs = [];

    const x0 = -10;
    const x1 = 10;
    const y0 = 0;
    const y1 = -10;
    const z0 = -0.5;
    const z1 = 0.5;

    const frontUvs = [bannerUV(0, top), bannerUV(20, top), bannerUV(20, bottom), bannerUV(0, bottom)];
    const backUvs = [bannerUV(20, top), bannerUV(0, top), bannerUV(0, bottom), bannerUV(20, bottom)];
    const leftUvs = [bannerUV(20, top), bannerUV(21, top), bannerUV(21, bottom), bannerUV(20, bottom)];
    const rightUvs = [bannerUV(21, top), bannerUV(20, top), bannerUV(20, bottom), bannerUV(21, bottom)];
    const topUvs = [bannerUV(0, top), bannerUV(20, top), bannerUV(20, top + 1), bannerUV(0, top + 1)];
    const bottomUvs = [bannerUV(0, bottom - 1), bannerUV(20, bottom - 1), bannerUV(20, bottom), bannerUV(0, bottom)];

    // Front and back use the standard Minecraft banner 20x40 field, split into four 20x10 strips.
    pushQuad(positions, uvs, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], frontUvs);
    pushQuad(positions, uvs, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], backUvs);

    // The remaining four faces provide the 1px banner thickness and reuse thin strips from the same texture.
    pushQuad(positions, uvs, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], leftUvs);
    pushQuad(positions, uvs, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], rightUvs);
    pushQuad(positions, uvs, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], topUvs);
    pushQuad(positions, uvs, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], bottomUvs);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData = {iiOwnedGeometry: true};
    return geometry;
}

async function rebuildBannerPreview(element) {
    if (!element.mesh) return;
    const group = element.mesh;
    const token = element._bannerUpdateToken = (element._bannerUpdateToken || 0) + 1;
    clearChildren(group);
    const texture = await getBannerTexture();
    if (token !== element._bannerUpdateToken || !element.mesh) return;

    const material = makeBasicMaterial({map: texture, color: colorToThree(element.color), transparent: true});
    const modeGroup = new THREE.Group();
    modeGroup.name = 'banner_mode';
    modeGroup.no_export = true;
    group.add(modeGroup);

    let parent = modeGroup;
    for (let i = 0; i < 4; i++) {
        const pivot = new THREE.Group();
        pivot.name = `banner${i}`;
        pivot.no_export = true;
        if (i > 0) pivot.position.y = -10;

        const mesh = new THREE.Mesh(makeBannerSegmentGeometry(i), material);
        mesh.name = `banner${i}_box`;
        mesh.no_export = true;
        pivot.add(mesh);
        parent.add(pivot);
        parent = pivot;
    }
    updateBannerWave(element);
}

function updateBannerWave(element, progressOverride = null) {
    const group = element.mesh;
    if (!group) return;
    const modeGroup = group.getObjectByName('banner_mode') || group;
    const progress = progressOverride === null ? element.progress : progressOverride;

    modeGroup.rotation.set(0, 0, 0);
    if (element.isFlag !== false) modeGroup.rotation.z = Math.PI / 2;

    for (let i = 0; i < 4; i++) {
        const segment = modeGroup.getObjectByName(`banner${i}`);
        if (segment) segment.rotation.x = THREE.MathUtils.degToRad(interpolateWave(`banner${i}`, progress));
    }
}

function updateGeometryForSelected(elementClass) {
    const selected = Array.isArray(elementClass.selected) ? elementClass.selected : [];
    selected.forEach(element => elementClass.preview_controller.updateGeometry(element));
}

function updateWaveForSelected() {
    const selected = Array.isArray(AMTBanner.selected) ? AMTBanner.selected : [];
    selected.forEach(element => updateBannerWave(element));
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
    const element = new AMTBanner().init();
    element.addTo(getCurrentOutlinerGroup());
    element.createUniqueName();
    unselectAll();
    element.select();
    Undo.finishEdit('Add AMT Banner', {outliner: true, elements: selected, selection: true});
    Blockbench.dispatchEvent('add_ii_banner', {object: element});
    return element;
}

export class AMTBannerElement extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetElementProperties(this, AMTBannerElement);
        this.name = 'banner';
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

    extend(object) { return mergeElementProperties(this, AMTBannerElement, object); }
    init() { super.init(); if (!this.mesh || !this.mesh.parent) AMTBannerElement.preview_controller.setup(this); return this; }
    select(event, isOutlinerClick) { const result = super.select(event, isOutlinerClick); if (result !== false) selectAnimatorFor(this); return result; }
    unselect(...args) {
        super.unselect(...args);
        if (Animator.open && Timeline.selected_animator && Timeline.selected_animator.element == this) {
            Timeline.selected_animator.selected = false;
        }
    }

    getWorldCenter() { return this.mesh ? THREE.fastWorldPosition(this.mesh, new THREE.Vector3()) : new THREE.Vector3(); }
    getSaveCopy() { return makeSaveCopy(this, AMTBannerElement); }
    getUndoCopy() { return makeSaveCopy(this, AMTBannerElement); }
    getChildlessCopy(keepUuid = false) { return makeChildlessCopy(this, AMTBannerElement, keepUuid); }

}

const AMTBanner = AMTBannerElement;

AMTBanner.behavior = {unique_name: true, movable: true, rotatable: true, scalable: true};
AMTBanner.preview_controller = null;

AMTBanner.prototype.title = 'Banner';
AMTBanner.prototype.type = 'banner';
AMTBanner.prototype.icon = 'flag';
AMTBanner.prototype.movable = true;
AMTBanner.prototype.rotatable = true;
AMTBanner.prototype.scalable = true;
AMTBanner.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
AMTBanner.prototype.menu = new Menu([...Outliner.control_menu_group, new MenuSeparator('manage'), 'rename', 'delete']);

OutlinerElement.registerType(AMTBanner, 'banner');

new Property(AMTBanner, 'string', 'name', {default: 'banner'});
new Property(AMTBanner, 'vector', 'position');
new Property(AMTBanner, 'vector', 'rotation');
new Property(AMTBanner, 'vector', 'scale', {default: [1, 1, 1]});
new Property(AMTBanner, 'boolean', 'isFlag', {
    default: true,
    inputs: {
        element_panel: {
            input: {
                label: 'Flag Mode',
                type: 'checkbox'
            },
            onChange() {
                updateWaveForSelected();
            }
        }
    }
});
new Property(AMTBanner, 'string', 'color', {
    default: '#ffffff',
    inputs: {
        element_panel: {
            input: {
                label: 'Color',
                type: 'color'
            },
            onChange() {
                updateGeometryForSelected(AMTBanner);
            }
        }
    }
});
new Property(AMTBanner, 'number', 'progress', {
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    inputs: {
        element_panel: {
            input: {
                label: 'Progress',
                type: 'num_slider',
                min: 0,
                max: 1,
                step: 0.01
            },
            onChange() {
                const selected = Array.isArray(AMTBanner.selected) ? AMTBanner.selected : [];
                selected.forEach(element => {
                    element.progress = clamp01(element.progress);
                    updateBannerWave(element);
                });
            }
        }
    }
});
new Property(AMTBanner, 'boolean', 'visibility', {default: true});

new NodePreviewController(AMTBanner, {
    setup(element) {
        createPreviewObject3D(element, {group: true});
        this.updateTransform(element);
        this.updateGeometry(element);
        this.dispatchEvent('setup', {element});
    },
    updateTransform(element) {
        updatePreviewTransform(element);
        updateBannerWave(element);
        this.dispatchEvent('update_transform', {element});
    },
    updateGeometry(element) {
        rebuildBannerPreview(element);
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

const BANNER_PROGRESS_KEYFRAME_PROPERTY = 'ii_banner_progress';
let bannerProgressKeyframeProperty = null;

function registerBannerKeyframeProperties() {
    if (typeof KeyframeDataPoint === 'undefined') return;
    if (!KeyframeDataPoint.properties[BANNER_PROGRESS_KEYFRAME_PROPERTY]) {
        bannerProgressKeyframeProperty = new Property(KeyframeDataPoint, 'molang', BANNER_PROGRESS_KEYFRAME_PROPERTY, {
            default: '0',
            condition(point) {
                return point.keyframe?.channel === 'progress' && point.keyframe?.animator instanceof AMTBannerAnimator;
            }
        });
    }
}

function readBannerProgressKeyframe(keyframe) {
    if (!keyframe) return 0;
    const point = keyframe.data_points?.[0];
    const raw = point?.[BANNER_PROGRESS_KEYFRAME_PROPERTY] ?? point?.x ?? point?.value ?? 0;
    if (typeof keyframe.calc === 'function') {
        const calculated = keyframe.calc(point?.[BANNER_PROGRESS_KEYFRAME_PROPERTY] !== undefined ? BANNER_PROGRESS_KEYFRAME_PROPERTY : 'x');
        if (Number.isFinite(Number(calculated))) return clamp01(calculated);
    }
    return clamp01(raw);
}

function interpolateBannerProgress(animator) {
    const keyframes = Array.isArray(animator.progress) ? animator.progress : [];
    if (!keyframes.length) return clamp01(animator.getElement()?.progress);

    const time = animator.animation.time;
    let before = null;
    let after = null;
    let beforeTime = 0;
    let afterTime = 0;

    keyframes.forEach(keyframe => {
        if (keyframe.time <= time && (!before || keyframe.time > beforeTime)) {
            before = keyframe;
            beforeTime = keyframe.time;
        }
        if (keyframe.time >= time && (!after || keyframe.time < afterTime)) {
            after = keyframe;
            afterTime = keyframe.time;
        }
    });

    if (Format.animation_loop_wrapping && animator.animation.loop === 'loop' && keyframes.length >= 2) {
        if (!before) {
            before = keyframes.reduce((result, keyframe) => !result || keyframe.time > result.time ? keyframe : result, null);
            beforeTime = before.time - animator.animation.length;
        }
        if (!after) {
            after = keyframes.reduce((result, keyframe) => !result || keyframe.time < result.time ? keyframe : result, null);
            afterTime = after.time + animator.animation.length;
        }
    }

    if (before && Math.abs(beforeTime - time) < 1 / 1200) return readBannerProgressKeyframe(before);
    if (after && Math.abs(afterTime - time) < 1 / 1200) return readBannerProgressKeyframe(after);
    if (before && !after) return readBannerProgressKeyframe(before);
    if (after && !before) return readBannerProgressKeyframe(after);
    if (!before || !after) return clamp01(animator.getElement()?.progress);
    if (before.interpolation === 'step') return readBannerProgressKeyframe(before);

    const factor = Math.getLerp(beforeTime, afterTime, time);
    return clamp01(readBannerProgressKeyframe(before) + (readBannerProgressKeyframe(after) - readBannerProgressKeyframe(before)) * factor);
}

export class AMTBannerAnimator extends AMTTransformAnimator {
    constructor(uuid, animation) {
        super(uuid, animation);
        if (!Array.isArray(this.progress)) this.progress = [];
    }

    displayFrame() {
        super.displayFrame();
        const element = this.getElement();
        if (!element || !element.mesh) return;
        const progress = this.muted?.progress ? clamp01(element.progress) : interpolateBannerProgress(this);
        updateBannerWave(element, progress);
    }

    createKeyframe(value, time, channel, undo, select) {
        if (channel !== 'progress') return super.createKeyframe(value, time, channel, undo, select);
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
        else if (value && typeof value === 'object') scalar = value.x ?? value.value ?? value.data_points?.[0]?.x;
        if (scalar === undefined || scalar === null || scalar === '') scalar = clamp01(this.getElement()?.progress);

        keyframe.set(BANNER_PROGRESS_KEYFRAME_PROPERTY, clamp01(scalar));
        keyframe.channel = channel;
        keyframe.time = Timeline.snapTime(time);
        this.progress.push(keyframe);
        keyframe.animator = this;
        if (select !== false) keyframe.select();

        const deleted = [];
        delete keyframe.time_before;
        keyframe.replaceOthers(deleted);
        if (deleted.length && Undo.current_save) Undo.addKeyframeCasualties(deleted);
        Animation.selected.setLength();
        if (undo) Undo.finishEdit('Add banner progress keyframe');
        return keyframe;
    }
}

AMTBannerAnimator.prototype.type = 'banner';
AMTBannerAnimator.prototype.channels = Object.assign({}, BoneAnimator.prototype.channels, {
    progress: {name: 'Progress', mutable: true, transform: false, max_data_points: 1}
});
AMTBanner.animator = AMTBannerAnimator;


export function registerBanner() {
    registerBannerKeyframeProperties();

    addAction = new Action('add_ii_banner', {
        name: 'AMT Banner',
        description: 'Add an AMT animated banner/flag element',
        icon: 'flag',
        category: 'edit',
        condition: () => Modes.edit,
        click: addElement
    });
    deletables.push(addAction);
    BarItems.add_element.side_menu.addAction(addAction);
    window.IIBannerElement = AMTBanner;
}

export function unregisterBannerActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
    bannerProgressKeyframeProperty?.delete?.();
    bannerProgressKeyframeProperty = null;
}

export function getBannerElementProperties(element) {
    return {
        banner: {id: 'minecraft:banner', Count: 1, Damage: 15},
        texture: 'immersiveintelligence:textures/models/banner.png',
        color: colorToInteger(element.color),
        isFlag: element.isFlag !== false,
        flag: element.isFlag !== false,
        progress: clamp01(element.progress)
    };
}
