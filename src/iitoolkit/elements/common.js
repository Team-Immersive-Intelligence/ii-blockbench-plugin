/* global THREE, OutlinerNode, OutlinerElement, Blockbench, Modes */
// Shared helpers for IIToolkit custom Outliner elements.
// These keep the custom preview nodes closer to Blockbench's native element contract:
// Project.nodes_3d is keyed by UUID, and the THREE object name should also be the element UUID.

export function resetElementProperties(element, elementClass) {
    for (let key in elementClass.properties) {
        elementClass.properties[key].reset(element);
    }
}

export function mergeElementProperties(element, elementClass, object) {
    for (let key in elementClass.properties) {
        elementClass.properties[key].merge(element, object);
    }
    Merge.string(element, object, 'name');
    element.sanitizeName();
    Merge.boolean(element, object, 'export');
    Merge.boolean(element, object, 'locked');
    Merge.boolean(element, object, 'visibility');
    return element;
}

export function makeChildlessCopy(element, elementClass, keepUuid = false) {
    const copy = new elementClass({ name: element.name }, keepUuid ? element.uuid : null);
    for (let key in elementClass.properties) {
        elementClass.properties[key].copy(element, copy);
    }
    copy.name = element.name;
    copy.locked = element.locked;
    copy.visibility = element.visibility;
    copy.export = element.export;
    copy.isOpen = element.isOpen;
    return copy;
}

export function makeSaveCopy(element, elementClass) {
    const copy = {
        isOpen: element.isOpen,
        uuid: element.uuid,
        type: element.type,
        name: element.name,
        children: element.children ? element.children.map(c => c.uuid) : [],
    };
    for (let key in elementClass.properties) {
        elementClass.properties[key].merge(copy, element);
    }
    return copy;
}

export function createPreviewObject3D(element, options = {}) {
    const object = options.group ? new THREE.Group() : new THREE.Object3D();
    object.rotation.order = 'ZYX';
    object.uuid = element.uuid.toUpperCase();
    object.name = element.uuid;
    object.type = element.type;
    object.isElement = true;
    object.no_export = options.noExport !== false;
    object.visible = element.visibility;
    Project.nodes_3d[element.uuid] = object;
    return object;
}

export function attachPreviewObject(element, object, fallbackToModel = true) {
    if (element.parent instanceof OutlinerNode) {
        const parentObject = element.parent.scene_object || element.parent.mesh;
        if (parentObject && object.parent !== parentObject) parentObject.add(object);
    } else if (fallbackToModel) {
        if (object.parent !== Project.model_3d) {
            Project.model_3d.add(object);
        }
    } else if (object.parent) {
        object.parent.remove(object);
    }
}

export function updatePreviewTransform(element, options = {}) {
    const object = element.mesh;
    const positionKey = options.positionKey || 'position';
    const rotationKey = options.rotationKey || 'rotation';
    const scaleKey = options.scaleKey || 'scale';

    object.position.fromArray(element[positionKey] || [0, 0, 0]);
    if (options.zeroRotation) {
        object.rotation.set(0, 0, 0);
    } else if (element[rotationKey]) {
        object.rotation.setFromDegreeArray(element[rotationKey]);
    }

    if (element[scaleKey]) object.scale.fromArray(element[scaleKey]);
    else object.scale.set(1, 1, 1);

    attachPreviewObject(element, object, options.fallbackToModel !== false);
    object.updateMatrixWorld(true);
    return object;
}

export function setPreviewVisibility(element) {
    if (element.mesh) element.mesh.visible = element.visibility;
}

export function collectVisibleMeshes(root) {
    const meshes = [];
    if (!root) return meshes;
    root.updateMatrixWorld(true);
    root.traverse(child => {
        if (child instanceof THREE.Mesh && child.geometry && child.visible !== false) {
            meshes.push(child);
        }
    });
    return meshes;
}

export function getParentSceneObject(element) {
    return element.parent instanceof OutlinerNode ? element.parent.scene_object : Project.model_3d;
}

export function safeObjName(name, fallback = 'object') {
    return String(name || fallback).replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.:-]/g, '_');
}


export function numberOr(value, fallback) {
    const parsed = typeof value === 'string' ? parseFloat(value) : value;
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function vectorFromInterpolation(value, fallback) {
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

export function applyAMTAnimatedTransform(element, animatedPosition = null, animatedRotation = null, animatedScale = null) {
    if (!element || !element.mesh) return;
    const object = element.mesh;
    const position = vectorFromInterpolation(animatedPosition, element.position || [0, 0, 0]);
    const rotation = vectorFromInterpolation(animatedRotation, element.rotation || [0, 0, 0]);
    const scale = vectorFromInterpolation(animatedScale, element.scale || [1, 1, 1]);

    object.position.fromArray(position);
    object.rotation.setFromDegreeArray(rotation);
    object.scale.fromArray(scale);
    object.updateMatrixWorld(true);
}

export function bindOutlinerAnimator(animator, element = null, animation = null) {
    const resolvedByUuid = animator.uuid ? OutlinerNode.uuids[animator.uuid] : null;
    const resolved = element || resolvedByUuid || animator.element || animator.group;
    if (resolved) {
        animator.uuid = resolved.uuid;
        animator.element = resolved;
        animator.group = resolved;
        animator.name = resolved.name;
    }
    if (animation) animator.animation = animation;
    if (!animator.muted || typeof animator.muted !== 'object') animator.muted = {};
    ['position', 'rotation', 'scale'].forEach(channel => {
        if (!Array.isArray(animator[channel])) animator[channel] = [];
    });
    return resolved || null;
}

export class AMTTransformAnimator extends BoneAnimator {
    constructor(uuid, animation) {
        super(uuid, animation);
        bindOutlinerAnimator(this, null, animation);
    }

    getElement() {
        return bindOutlinerAnimator(this);
    }

    getGroup() {
        return this.getElement();
    }

    select(...args) {
        if (!bindOutlinerAnimator(this)) return this;
        return super.select(...args);
    }

    doRender() {
        const element = this.getElement();
        return element && element.mesh;
    }

    displayFrame() {
        if (!this.doRender()) return;
        const element = this.getElement();
        const basePosition = Array.isArray(element.position) ? element.position : [0, 0, 0];
        const baseRotation = Array.isArray(element.rotation) ? element.rotation : [0, 0, 0];
        const baseScale = Array.isArray(element.scale) ? element.scale : [1, 1, 1];

        const animatedPosition = this.muted?.position
            ? basePosition.slice()
            : vectorFromInterpolation(this.interpolate('position', true), basePosition);
        const animatedRotation = this.muted?.rotation
            ? baseRotation.slice()
            : vectorFromInterpolation(this.interpolate('rotation', true), baseRotation);
        const animatedScale = this.muted?.scale
            ? baseScale.slice()
            : vectorFromInterpolation(this.interpolate('scale', true), baseScale);

        applyAMTAnimatedTransform(element, animatedPosition, animatedRotation, animatedScale);
    }
}

export function makeAMTTransformAnimator(type) {
    class AMTElementAnimator extends AMTTransformAnimator {}
    AMTElementAnimator.prototype.type = type;
    return AMTElementAnimator;
}

let amtAnimationPreviewCleanupHooks = [];

function usesAMTTransformAnimator(element) {
    const AnimatorType = element?.constructor?.animator;
    return typeof AnimatorType === 'function' && (
        AnimatorType === AMTTransformAnimator ||
        AnimatorType.prototype instanceof AMTTransformAnimator
    );
}

export function resetAMTAnimationPreviewTransforms() {
    if (typeof OutlinerElement === 'undefined' || !OutlinerElement.all) return;

    OutlinerElement.all.forEach(element => {
        if (!element?.mesh || !usesAMTTransformAnimator(element)) return;

        const previewController = element.constructor.preview_controller;
        if (previewController?.updateTransform) previewController.updateTransform(element);
        else updatePreviewTransform(element);
    });
}

export function unregisterAMTAnimationPreviewCleanupHooks() {
    resetAMTAnimationPreviewTransforms();
    amtAnimationPreviewCleanupHooks.forEach(hook => hook?.delete?.());
    amtAnimationPreviewCleanupHooks = [];
}

export function registerAMTAnimationPreviewCleanupHooks() {
    unregisterAMTAnimationPreviewCleanupHooks();
    if (typeof Blockbench === 'undefined' || typeof Blockbench.on !== 'function') return;

    const scheduleReset = () => setTimeout(() => {
        if (typeof Modes === 'undefined' || !Modes.animate) resetAMTAnimationPreviewTransforms();
    }, 0);

    ['select_mode', 'unselect_project', 'new_project'].forEach(eventName => {
        const hook = Blockbench.on(eventName, scheduleReset);
        if (hook) amtAnimationPreviewCleanupHooks.push(hook);
    });
}
