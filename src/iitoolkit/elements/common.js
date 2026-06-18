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
        element.parent.scene_object.add(object);
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
