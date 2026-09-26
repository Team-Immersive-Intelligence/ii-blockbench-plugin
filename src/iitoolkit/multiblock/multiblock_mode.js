/* global Clipbench, Keybind, ModelProject, Mode, Panel, Panels, Preview, Property, THREE, Tool, Toolbars, Toolbox, Transformer, TransformerModule, canvasGridSize, scene, unselectAll */
import {
    MULTIBLOCK_PROJECT_PROPERTY,
    ROTATIONS,
    blockKey,
    cloneData,
    createDefaultMultiblockData,
    getBillOfMaterials,
    getMultiblockData,
    isAirBlock,
    nextDuplicateName,
    nextName,
    normaliseBounds,
    parseBlockKey,
    removeOutsideBounds,
    toPreviewBounds,
    toPreviewPosition
} from './multiblock_data';
import {
    displayAirAABB,
    displayMultiblockMaster,
    setDisplayAirAABB,
    setDisplayMultiblockMaster
} from '../settings/display_settings';

const state = {
    selectedBound: '',
    selectedPOI: '',
    selectedDirection: '',
    activeBoundKey: ''
};

const TOOL_IDS = Object.freeze({
    paint: 'ii_multiblock_paint_tool',
    select: 'ii_multiblock_select_tool',
    moveAll: 'ii_multiblock_move_all_tool',
    move: 'ii_multiblock_move_tool',
    expandAll: 'ii_multiblock_expand_all_tool',
    expand: 'ii_multiblock_expand_tool'
});
const TRANSFORM_TOOLS = [TOOL_IDS.moveAll, TOOL_IDS.move, TOOL_IDS.expandAll, TOOL_IDS.expand];
let geometryClipboard = null;
let transformSession = null;
let selectReturnTool = TOOL_IDS.paint;

const ROTATION_LABELS = {
    none: 'Forward',
    clockwise_90: 'Clockwise 90°',
    clockwise_180: '180°',
    counterclockwise_90: 'Counter-clockwise 90°'
};

const deletables = [];
const previewListeners = new Map();
let overlayRoot = null;
let styleHandle = null;

function track(...items) {
    items.flat().filter(Boolean).forEach(item => deletables.push(item));
}

function modeActive() {
    return !!(Project && Modes.multiblock && Format?.id === 'free');
}

function selectedTool() {
    return Toolbox?.selected?.id || '';
}

function isTransformTool(tool = selectedTool()) {
    return TRANSFORM_TOOLS.includes(tool);
}

function boundKeys(data, name) {
    return Object.keys(data.positions).filter(key => data.positions[key].includes(name));
}

function ensureActiveBoundKey(data = getMultiblockData()) {
    const keys = state.selectedBound ? boundKeys(data, state.selectedBound) : [];
    if (!keys.includes(state.activeBoundKey)) state.activeBoundKey = keys[0] || '';
    return state.activeBoundKey;
}

function assignmentCount(data, name) {
    return boundKeys(data, name).length;
}

function placementCentre(data, name, key) {
    const bounds = toPreviewBounds(data.bounds[name]);
    const position = parseBlockKey(key);
    if (!bounds || !position) return null;
    const preview = toPreviewPosition(position);
    return new THREE.Vector3(
        preview[0] * 16 + (bounds[0] + bounds[3]) / 2,
        preview[1] * 16 + (bounds[1] + bounds[4]) / 2,
        preview[2] * 16 + (bounds[2] + bounds[5]) / 2
    ).add(new THREE.Vector3().fromArray(data.translation));
}

function updatePanels() {
    ['ii_multiblock_settings', 'ii_multiblock_bounds', 'ii_multiblock_poi', 'ii_multiblock_directions',
        'ii_multiblock_materials']
        .forEach(id => {
            const panel = Panels[id]?.vue;
            if (!panel) return;
            panel.revision++;
            panel.$forceUpdate();
        });
}

function disposeObject(object) {
    object.traverse(child => {
        child.geometry?.dispose?.();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.filter(Boolean).forEach(material => {
            material.map?.dispose?.();
            material.dispose?.();
        });
    });
    if (object.parent) object.parent.remove(object);
}

function clearOverlay() {
    if (overlayRoot) disposeObject(overlayRoot);
    overlayRoot = null;
}

function previewLocalToWorld(position) {
    const root = Project?.model_3d;
    if (!root) return position;
    position.x *= -1;
    root.updateMatrixWorld(true);
    return root.localToWorld(position);
}

function previewWorldToLocal(position) {
    const root = Project?.model_3d;
    if (!root) return position;
    root.updateMatrixWorld(true);
    root.worldToLocal(position);
    position.x *= -1;
    return position;
}

function leaveMultiblockPreview() {
    clearOverlay();
}

function lineSegments(vertices, colour, opacity = 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.LineBasicMaterial({
        color: colour,
        transparent: opacity < 1,
        opacity,
        depthTest: opacity >= 1
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = opacity < 1 ? 40 : 10;
    return lines;
}

function boxVertices(minX, minY, minZ, maxX, maxY, maxZ) {
    return [
        minX, minY, minZ, maxX, minY, minZ, maxX, minY, minZ, maxX, minY, maxZ,
        maxX, minY, maxZ, minX, minY, maxZ, minX, minY, maxZ, minX, minY, minZ,
        minX, maxY, minZ, maxX, maxY, minZ, maxX, maxY, minZ, maxX, maxY, maxZ,
        maxX, maxY, maxZ, minX, maxY, maxZ, minX, maxY, maxZ, minX, maxY, minZ,
        minX, minY, minZ, minX, maxY, minZ, maxX, minY, minZ, maxX, maxY, minZ,
        maxX, minY, maxZ, maxX, maxY, maxZ, minX, minY, maxZ, minX, maxY, maxZ
    ];
}

function boundHitbox(minX, minY, minZ, maxX, maxY, maxZ, key, name) {
    const size = new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ);
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01)),
        new THREE.MeshBasicMaterial({transparent: true, opacity: 0, depthWrite: false})
    );
    mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    mesh.userData.iiMultiblockBound = {key, name};
    return mesh;
}

function floorGrid(size, y) {
    const vertices = [];
    for (let x = 0; x <= size[0]; x++) {
        vertices.push(x * 16, y, 0, x * 16, y, size[2] * 16);
    }
    for (let z = 0; z <= size[2]; z++) {
        vertices.push(0, y, z * 16, size[0] * 16, y, z * 16);
    }
    return lineSegments(vertices, 0x7b8a99, 0.75);
}

function numberPlane(number, x, y, z) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 128, 128);
    context.fillStyle = 'rgba(12, 18, 24, 0.62)';
    context.fillRect(12, 28, 104, 72);
    context.strokeStyle = 'rgba(190, 220, 235, 0.8)';
    context.lineWidth = 3;
    context.strokeRect(12, 28, 104, 72);
    context.fillStyle = '#e7f1f7';
    context.font = 'bold 42px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(number), 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide});
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), material);
    plane.rotation.set(-Math.PI / 2, 0, Math.PI);
    // Keep editor annotations readable inside the mirrored preview root.
    plane.scale.x = -1;
    plane.position.set(x, y + 0.03, z);
    plane.renderOrder = 30;
    return plane;
}

function presetColour(name, selected) {
    if (selected) return 0xffd75c;
    let hash = 0;
    for (let index = 0; index < name.length; index++) hash = ((hash << 5) - hash + name.charCodeAt(index)) | 0;
    return new THREE.Color().setHSL(Math.abs(hash % 360) / 360, 0.68, 0.58).getHex();
}

function poiColour(name, selected) {
    return selected ? 0xff66cc : presetColour(`poi:${name}`, false);
}

function directionVector(rotation) {
    let vector;
    switch (rotation) {
        case 'clockwise_90': vector = new THREE.Vector3(1, 0, 0); break;
        case 'clockwise_180': vector = new THREE.Vector3(0, 0, 1); break;
        case 'counterclockwise_90': vector = new THREE.Vector3(-1, 0, 0); break;
        case 'none':
        default: vector = new THREE.Vector3(0, 0, -1);
    }
    return vector;
}

export function refreshMultiblockPreview() {
    clearOverlay();
    if (!modeActive()) return;

    const data = getMultiblockData();
    overlayRoot = new THREE.Group();
    overlayRoot.name = 'ii_multiblock_preview';
    overlayRoot.position.set(-data.translation[0], data.translation[1], data.translation[2]);
    overlayRoot.scale.x = -1;
    Project.model_3d.add(overlayRoot);

    const allLayers = data.layer >= data.size[1];
    const showMaster = displayMultiblockMaster();
    const floorLayer = allLayers ? 0 : data.layer;
    const floorY = floorLayer * 16 + 0.02;
    overlayRoot.add(floorGrid(data.size, floorY));
    for (let z = 0; z < data.size[2]; z++) {
        for (let x = 0; x < data.size[0]; x++) {
            const id = floorLayer * data.size[2] * data.size[0] + z * data.size[0] + x;
            const isMaster = showMaster && data.master[0] === x && data.master[1] === floorLayer && data.master[2] === z;
            const preview = toPreviewPosition([x, floorLayer, z]);
            const air = isAirBlock(data, [x, floorLayer, z]);
            overlayRoot.add(numberPlane(isMaster ? `${id} M` : (air ? `${id} A` : id),
                preview[0] * 16 + 8, floorY, preview[2] * 16 + 8));
        }
    }

    if (showMaster && (allLayers || data.master[1] === data.layer)) {
        const [x, y, z] = toPreviewPosition(data.master);
        overlayRoot.add(lineSegments(boxVertices(x * 16 + 0.5, y * 16 + 0.5, z * 16 + 0.5,
            (x + 1) * 16 - 0.5, (y + 1) * 16 - 0.5, (z + 1) * 16 - 0.5), 0x00e5ff));
    }

    Object.entries(data.positions).forEach(([key, names]) => {
        const position = parseBlockKey(key);
        if (!position || (!allLayers && position[1] !== data.layer)) return;
        const preview = toPreviewPosition(position);
        names.forEach(name => {
            const bounds = toPreviewBounds(data.bounds[name]);
            if (!bounds) return;
            let minX = preview[0] * 16 + bounds[0];
            let minY = preview[1] * 16 + bounds[1];
            let minZ = preview[2] * 16 + bounds[2];
            let maxX = preview[0] * 16 + bounds[3];
            let maxY = preview[1] * 16 + bounds[4];
            let maxZ = preview[2] * 16 + bounds[5];
            if (displayAirAABB() && minX === maxX && minY === maxY && minZ === maxZ) {
                minX = preview[0] * 16;
                minY = preview[1] * 16;
                minZ = preview[2] * 16;
                maxX = minX + 16;
                maxY = minY + 16;
                maxZ = minZ + 16;
            }
            overlayRoot.add(lineSegments(boxVertices(minX, minY, minZ, maxX, maxY, maxZ),
                presetColour(name, state.selectedBound === name)));
            overlayRoot.add(boundHitbox(minX, minY, minZ, maxX, maxY, maxZ, key, name));
        });
    });

    Object.entries(data.poi).forEach(([name, keys]) => {
        const showPOI = !data.hidden_poi.includes(name);
        const showDirection = !!data.rotations[name] && !data.hidden_directions.includes(name);
        keys.forEach(key => {
            const position = parseBlockKey(key);
            if (!position || (!allLayers && position[1] !== data.layer)) return;
            const preview = toPreviewPosition(position);
            const minX = preview[0] * 16 + 1;
            const minY = preview[1] * 16 + 1;
            const minZ = preview[2] * 16 + 1;
            const maxX = minX + 14;
            const maxY = minY + 14;
            const maxZ = minZ + 14;
            if (showPOI) {
                overlayRoot.add(lineSegments(boxVertices(minX, minY, minZ, maxX, maxY, maxZ),
                    poiColour(name, state.selectedPOI === name), 0.88));
            }
            if (showDirection) {
                const direction = directionVector(data.rotations[name]);
                const origin = new THREE.Vector3(
                    preview[0] * 16 + 8, preview[1] * 16 + 8, preview[2] * 16 + 8);
                if (data.inwards.includes(name)) origin.addScaledVector(direction, -18);
                else origin.addScaledVector(direction, -8);
                const pointingDirection = data.inwards.includes(name) ? direction : direction.negate();
                const arrow = new THREE.ArrowHelper(pointingDirection, origin,
                    10, poiColour(name, state.selectedPOI === name), 2, 2);
                arrow.renderOrder = 45;
                overlayRoot.add(arrow);
            }
        });
    });
}

function refreshAll() {
    updatePanels();
    refreshMultiblockPreview();
    Canvas.updateView({selection: true});
    if (isTransformTool()) Transformer?.center?.();
}

function editMultiblock(label, callback) {
    if (!Project) return;
    Undo.initEdit({multiblock: true});
    callback(getMultiblockData());
    Undo.finishEdit(label, {multiblock: true});
    refreshAll();
}

function showError(message) {
    Blockbench.showMessageBox({title: 'Multiblock Editor', message, icon: 'error'});
}

function selectBound(name) {
    state.selectedBound = name;
    state.selectedPOI = '';
    state.selectedDirection = '';
    state.activeBoundKey = '';
    ensureActiveBoundKey();
    refreshAll();
}

function selectPOI(name) {
    state.selectedPOI = name;
    state.selectedBound = '';
    state.selectedDirection = '';
    state.activeBoundKey = '';
    refreshAll();
}

function selectDirection(name) {
    state.selectedDirection = name;
    state.selectedBound = '';
    state.selectedPOI = '';
    state.activeBoundKey = '';
    refreshAll();
}

function addBound() {
    const data = getMultiblockData();
    const suggested = nextName(data.bounds, 'full_block');
    new Dialog('ii_multiblock_add_bound', {
        title: 'Add AABB Preset',
        form: {
            name: {label: 'Name', type: 'text', value: suggested},
            from: {label: 'Minimum (X, Y, Z)', type: 'vector', dimensions: 3, value: [0, 0, 0]},
            to: {label: 'Maximum (X, Y, Z)', type: 'vector', dimensions: 3, value: [16, 16, 16]}
        },
        onConfirm(result) {
            const name = String(result.name || '').trim();
            if (!name || data.bounds[name]) return showError('Enter a unique preset name.');
            const bounds = normaliseBounds([...result.from, ...result.to]);
            if (!bounds) return showError('The bounds contain an invalid value.');
            editMultiblock('Add multiblock AABB preset', current => current.bounds[name] = bounds);
            selectBound(name);
        }
    }).show();
}

function editBound(name) {
    const data = getMultiblockData();
    const bounds = data.bounds[name];
    if (!bounds) return;
    new Dialog('ii_multiblock_edit_bound', {
        title: 'Edit AABB Preset',
        form: {
            name: {label: 'Name', type: 'text', value: name},
            from: {label: 'Minimum (X, Y, Z)', type: 'vector', dimensions: 3, value: bounds.slice(0, 3)},
            to: {label: 'Maximum (X, Y, Z)', type: 'vector', dimensions: 3, value: bounds.slice(3, 6)}
        },
        onConfirm(result) {
            const newName = String(result.name || '').trim();
            if (!newName || (newName !== name && data.bounds[newName])) return showError('Enter a unique preset name.');
            const nextBounds = normaliseBounds([...result.from, ...result.to]);
            if (!nextBounds) return showError('The bounds contain an invalid value.');
            editMultiblock('Edit multiblock AABB preset', current => {
                delete current.bounds[name];
                current.bounds[newName] = nextBounds;
                Object.keys(current.positions).forEach(key => {
                    current.positions[key] = current.positions[key].map(reference => reference === name ? newName : reference);
                });
            });
            selectBound(newName);
        }
    }).show();
}

function renameBound(name) {
    const data = getMultiblockData();
    if (!data.bounds[name]) return;
    Blockbench.textPrompt('Rename AABB Preset', name, value => {
        const newName = String(value || '').trim();
        if (!newName || (newName !== name && data.bounds[newName])) return showError('Enter a unique preset name.');
        if (newName === name) return;
        editMultiblock('Rename multiblock AABB preset', current => {
            current.bounds[newName] = current.bounds[name];
            delete current.bounds[name];
            Object.keys(current.positions).forEach(key => {
                current.positions[key] = current.positions[key]
                    .map(reference => reference === name ? newName : reference);
            });
        });
        selectBound(newName);
    });
}

function removeBound(name) {
    const uses = Object.values(getMultiblockData().positions).filter(names => names.includes(name)).length;
    Blockbench.showMessageBox({
        title: 'Remove AABB Preset',
        message: uses ? `Remove '${name}' and its ${uses} block assignment${uses === 1 ? '' : 's'}?` : `Remove '${name}'?`,
        buttons: ['Remove', 'Cancel'], confirm: 0, cancel: 1, icon: 'warning'
    }, result => {
        if (result !== 0) return;
        editMultiblock('Remove multiblock AABB preset', data => {
            delete data.bounds[name];
            Object.keys(data.positions).forEach(key => {
                data.positions[key] = data.positions[key].filter(reference => reference !== name);
                if (!data.positions[key].length) delete data.positions[key];
            });
        });
        if (state.selectedBound === name) state.selectedBound = '';
        refreshAll();
    });
}

function rememberGeometryClipboard(value) {
    geometryClipboard = cloneData(value);
    try { Clipbench?.setText?.(JSON.stringify(value)); } catch (ignored) { /* Internal clipboard remains available. */ }
}

async function readGeometryClipboard(type) {
    if (geometryClipboard?.type === type) return cloneData(geometryClipboard);
    try {
        const text = await navigator.clipboard?.readText?.();
        const parsed = JSON.parse(text || 'null');
        if (parsed?.format === 'iitoolkit_multiblock_geometry' && parsed.type === type) {
            geometryClipboard = parsed;
            return cloneData(parsed);
        }
    } catch (ignored) {
        // Clipboard access is optional; the session clipboard is the fallback.
    }
    return null;
}

function copyBound(name) {
    const bounds = normaliseBounds(getMultiblockData().bounds[name]);
    if (!bounds) return showError('Select an AABB preset to copy.');
    rememberGeometryClipboard({format: 'iitoolkit_multiblock_geometry', type: 'bound', name, bounds});
    Blockbench.showQuickMessage(`Copied AABB preset '${name}'`);
}

function duplicateBound(name) {
    const data = getMultiblockData();
    const bounds = normaliseBounds(data.bounds[name]);
    if (!bounds) return showError('Select an AABB preset to duplicate.');
    const duplicateName = nextDuplicateName(data.bounds, name);
    editMultiblock('Duplicate multiblock AABB preset', current => current.bounds[duplicateName] = bounds);
    selectBound(duplicateName);
}

async function pasteBound() {
    const copied = await readGeometryClipboard('bound');
    const bounds = normaliseBounds(copied?.bounds);
    if (!bounds) return showError('The clipboard does not contain an AABB preset.');
    const data = getMultiblockData();
    const name = nextDuplicateName(data.bounds, copied.name);
    editMultiblock('Paste multiblock AABB preset', current => current.bounds[name] = bounds);
    selectBound(name);
}

function addPOI() {
    const data = getMultiblockData();
    const suggested = nextName(data.poi, 'input');
    Blockbench.textPrompt('Add Point of Interest', suggested, value => {
        const name = String(value || '').trim();
        if (!name || data.poi[name]) return showError('Enter a unique POI name.');
        editMultiblock('Add multiblock POI', current => current.poi[name] = []);
        selectPOI(name);
    });
}

function renamePOI(name) {
    const data = getMultiblockData();
    const wasDirection = state.selectedDirection === name;
    Blockbench.textPrompt('Rename Point of Interest', name, value => {
        const newName = String(value || '').trim();
        if (!newName || (newName !== name && data.poi[newName])) return showError('Enter a unique POI name.');
        editMultiblock('Rename multiblock POI', current => {
            current.poi[newName] = current.poi[name];
            delete current.poi[name];
            if (current.rotations[name]) {
                current.rotations[newName] = current.rotations[name];
                delete current.rotations[name];
            }
            if (current.inwards.includes(name)) {
                current.inwards = current.inwards.filter(entry => entry !== name);
                current.inwards.push(newName);
            }
            if (current.hidden_poi.includes(name)) {
                current.hidden_poi = current.hidden_poi.filter(entry => entry !== name);
                current.hidden_poi.push(newName);
            }
            if (current.hidden_directions.includes(name)) {
                current.hidden_directions = current.hidden_directions.filter(entry => entry !== name);
                current.hidden_directions.push(newName);
            }
        });
        if (wasDirection) selectDirection(newName);
        else selectPOI(newName);
    });
}

function removePOI(name) {
    Blockbench.showMessageBox({
        title: 'Remove Point of Interest', message: `Remove '${name}' and all its assignments?`,
        buttons: ['Remove', 'Cancel'], confirm: 0, cancel: 1, icon: 'warning'
    }, result => {
        if (result !== 0) return;
        editMultiblock('Remove multiblock POI', data => {
            delete data.poi[name];
            delete data.rotations[name];
            data.inwards = data.inwards.filter(entry => entry !== name);
            data.hidden_poi = data.hidden_poi.filter(entry => entry !== name);
            data.hidden_directions = data.hidden_directions.filter(entry => entry !== name);
        });
        if (state.selectedPOI === name) state.selectedPOI = '';
        if (state.selectedDirection === name) state.selectedDirection = '';
        refreshAll();
    });
}

function copyPOI(name) {
    const data = getMultiblockData();
    if (!data.poi[name]) return showError('Select a point of interest to copy.');
    rememberGeometryClipboard({
        format: 'iitoolkit_multiblock_geometry',
        type: 'poi',
        name,
        rotation: data.rotations[name] || '',
        inward: data.inwards.includes(name)
    });
    Blockbench.showQuickMessage(`Copied POI '${name}'`);
}

async function pastePOI() {
    const copied = await readGeometryClipboard('poi');
    if (!copied) return showError('The clipboard does not contain a point of interest.');
    const data = getMultiblockData();
    const name = nextName(data.poi, `${copied.name || 'poi'}_copy`);
    editMultiblock('Paste multiblock POI', current => {
        current.poi[name] = [];
        if (ROTATIONS.includes(copied.rotation)) current.rotations[name] = copied.rotation;
        if (copied.inward && current.rotations[name]) current.inwards.push(name);
    });
    selectPOI(name);
}

function setDirection(name, rotation) {
    editMultiblock('Set multiblock POI direction', data => {
        if (data.poi[name] && ROTATIONS.includes(rotation)) data.rotations[name] = rotation;
    });
}

function setDirectionInward(name, inward) {
    editMultiblock('Set multiblock POI direction display', data => {
        data.inwards = data.inwards.filter(entry => entry !== name);
        if (inward && data.rotations[name]) data.inwards.push(name);
    });
}

function togglePOIVisibility(name) {
    editMultiblock('Toggle multiblock POI visibility', data => {
        const wasHidden = data.hidden_poi.includes(name);
        data.hidden_poi = data.hidden_poi.filter(entry => entry !== name);
        if (!wasHidden && data.poi[name]) data.hidden_poi.push(name);
    });
}

function toggleDirectionVisibility(name) {
    editMultiblock('Toggle multiblock direction visibility', data => {
        const wasHidden = data.hidden_directions.includes(name);
        data.hidden_directions = data.hidden_directions.filter(entry => entry !== name);
        if (!wasHidden && data.rotations[name]) data.hidden_directions.push(name);
    });
}

function addDirection() {
    const data = getMultiblockData();
    const available = Object.keys(data.poi).filter(name => !data.rotations[name]).sort();
    if (!available.length) {
        Blockbench.showQuickMessage(Object.keys(data.poi).length
            ? 'Every POI already has a direction'
            : 'Add a point of interest first');
        return;
    }
    const poiOptions = {};
    available.forEach(name => poiOptions[name] = name);
    new Dialog('ii_multiblock_add_direction', {
        title: 'Add POI Direction',
        form: {
            poi: {label: 'Point of Interest', type: 'select', options: poiOptions, value: available[0]},
            rotation: {label: 'Direction', type: 'select', options: ROTATION_LABELS, value: 'none'}
        },
        onConfirm(result) {
            if (!available.includes(result.poi) || !ROTATIONS.includes(result.rotation)) return;
            setDirection(result.poi, result.rotation);
            selectDirection(result.poi);
        }
    }).show();
}

function removeDirection(name) {
    editMultiblock('Remove multiblock POI direction', data => {
        delete data.rotations[name];
        data.inwards = data.inwards.filter(entry => entry !== name);
        data.hidden_directions = data.hidden_directions.filter(entry => entry !== name);
    });
    if (state.selectedDirection === name) state.selectedDirection = '';
    refreshAll();
}

function removeSelectedEntry() {
    if (state.selectedBound) removeBound(state.selectedBound);
    else if (state.selectedPOI) removePOI(state.selectedPOI);
    else if (state.selectedDirection) removeDirection(state.selectedDirection);
}

function renameSelectedEntry() {
    if (state.selectedBound) renameBound(state.selectedBound);
    else if (state.selectedPOI) renamePOI(state.selectedPOI);
    else if (state.selectedDirection) renamePOI(state.selectedDirection);
}

function registerEntryActions() {
    const removeAction = new Action('ii_multiblock_remove_selected', {
        name: 'Remove Selected Multiblock Entry', icon: 'delete', category: 'edit',
        condition: modeActive, keybind: new Keybind({key: 46}), click: removeSelectedEntry
    });
    const renameAction = new Action('ii_multiblock_rename_selected', {
        name: 'Rename Selected Multiblock Entry', icon: 'edit', category: 'edit',
        condition: modeActive, keybind: new Keybind({key: 113}), click: renameSelectedEntry
    });
    track(removeAction, renameAction);
}

function setLayer(value) {
    const data = getMultiblockData();
    data.layer = Math.min(data.size[1], Math.max(0, Math.trunc(Number(value))));
    refreshAll();
}

function setTranslation(axis, value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return updatePanels();
    editMultiblock('Set multiblock preview translation', data => data.translation[axis] = number);
}

function setMultiblockName(value) {
    const name = String(value || '').trim();
    editMultiblock('Set multiblock ID', data => data.name = name);
}

function setMultiblockModId(value) {
    const modId = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(modId)) {
        updatePanels();
        showError('The mod ID must contain only lower-case letters, numbers, underscores, dots, and hyphens.');
        return;
    }
    editMultiblock('Set multiblock mod ID', data => data.mod_id = modId);
}

function setMasterPosition(axis, value) {
    const number = Math.trunc(Number(value));
    if (!Number.isFinite(number)) return updatePanels();
    editMultiblock('Set multiblock master position', data => {
        data.master[axis] = Math.min(data.size[axis] - 1, Math.max(0, number));
    });
}

function applySize(axis, value) {
    const number = Math.max(1, Math.trunc(Number(value)));
    if (!Number.isFinite(number)) return updatePanels();
    const current = getMultiblockData();
    if (number === current.size[axis]) return;
    const nextSize = current.size.slice();
    nextSize[axis] = number;
    const preview = cloneData(current);
    const removed = removeOutsideBounds(preview, nextSize);
    const shrink = number < current.size[axis];
    const apply = () => editMultiblock('Resize multiblock editor', data => {
        const wasAll = data.layer >= data.size[1];
        data.size = nextSize;
        removeOutsideBounds(data, nextSize);
        data.master = data.master.map((coordinate, currentAxis) =>
            Math.min(coordinate, nextSize[currentAxis] - 1));
        data.layer = wasAll ? nextSize[1] : Math.min(data.layer, nextSize[1] - 1);
    });
    if (!shrink || (!removed.positions && !removed.poi)) return apply();
    const details = [];
    if (removed.positions) details.push(`${removed.positions} static AABB block${removed.positions === 1 ? '' : 's'}`);
    if (removed.poi) details.push(`${removed.poi} POI assignment${removed.poi === 1 ? '' : 's'}`);
    Blockbench.showMessageBox({
        title: 'Shrink Multiblock',
        message: `The new size removes ${details.join(' and ')} outside its bounds. Continue?`,
        buttons: ['Resize and Delete', 'Cancel'], confirm: 0, cancel: 1, icon: 'warning'
    }, result => {
        if (result === 0) apply();
        else updatePanels();
    });
}

function toggleCell(position) {
    if (!modeActive()) return;
    if (isAirBlock(getMultiblockData(), position)) {
        Blockbench.showQuickMessage('AABB and POI assignments are disabled on structure air blocks');
        return;
    }
    const key = blockKey(position);
    if (state.selectedBound) {
        editMultiblock('Toggle multiblock AABB assignment', data => {
            const references = data.positions[key] || [];
            if (references.includes(state.selectedBound)) references.splice(references.indexOf(state.selectedBound), 1);
            else references.push(state.selectedBound);
            if (references.length) data.positions[key] = references;
            else delete data.positions[key];
        });
    } else if (state.selectedPOI) {
        editMultiblock('Toggle multiblock POI assignment', data => {
            const positions = data.poi[state.selectedPOI] || (data.poi[state.selectedPOI] = []);
            if (positions.includes(key)) positions.splice(positions.indexOf(key), 1);
            else positions.push(key);
        });
    } else {
        Blockbench.showQuickMessage('Select an AABB preset or POI first');
    }
}

function previewRay(event, preview) {
    const rect = preview.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, preview.camera);
    return raycaster;
}

function selectBoundPlacement(event, preview) {
    if (!state.selectedBound || !overlayRoot) {
        Blockbench.showQuickMessage('Select an AABB preset first');
        return;
    }
    overlayRoot.updateMatrixWorld(true);
    const hit = previewRay(event, preview).intersectObjects(overlayRoot.children, true)
        .find(intersection => intersection.object.userData?.iiMultiblockBound?.name === state.selectedBound);
    if (!hit) {
        Blockbench.showQuickMessage(`Click an instance of '${state.selectedBound}'`);
        return;
    }
    state.activeBoundKey = hit.object.userData.iiMultiblockBound.key;
    refreshAll();
}

function selectBoundFromPreview(event, preview) {
    if (!overlayRoot) return;
    overlayRoot.updateMatrixWorld(true);
    const hit = previewRay(event, preview).intersectObjects(overlayRoot.children, true)
        .find(intersection => intersection.object.userData?.iiMultiblockBound);
    if (!hit) {
        Blockbench.showQuickMessage('Click an AABB instance to select its preset');
        return;
    }
    const selection = hit.object.userData.iiMultiblockBound;
    state.selectedBound = selection.name;
    state.selectedPOI = '';
    state.selectedDirection = '';
    state.activeBoundKey = selection.key;
    const returnTool = BarItems[selectReturnTool] || BarItems[TOOL_IDS.paint];
    if (returnTool?.select) returnTool.select();
    else refreshAll();
}

function previewClick(event, preview) {
    if (!modeActive() || event.button !== 0 || event.altKey) return;
    if (selectedTool() === TOOL_IDS.select) {
        selectBoundFromPreview(event, preview);
        return;
    }
    if (isTransformTool()) {
        selectBoundPlacement(event, preview);
        return;
    }
    if (selectedTool() !== TOOL_IDS.paint) return;

    const data = getMultiblockData();
    const allLayers = data.layer >= data.size[1];
    const layer = allLayers ? 0 : data.layer;
    const raycaster = previewRay(event, preview);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(data.translation[1] + layer * 16));
    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, point)) return;
    const localPoint = previewWorldToLocal(point);
    const previewX = Math.floor((localPoint.x - data.translation[0]) / 16);
    const previewZ = Math.floor((localPoint.z - data.translation[2]) / 16);
    if (previewX < 0 || previewZ < 0 || previewX >= data.size[0] || previewZ >= data.size[2]) return;
    toggleCell(toPreviewPosition([previewX, layer, previewZ]));
}

function installPreviewListeners() {
    Preview.all.forEach(preview => {
        if (previewListeners.has(preview) || !preview.canvas) return;
        const listener = event => previewClick(event, preview);
        preview.canvas.addEventListener('click', listener);
        previewListeners.set(preview, listener);
    });
}

function removePreviewListeners() {
    previewListeners.forEach((listener, preview) => preview.canvas?.removeEventListener('click', listener));
    previewListeners.clear();
}

function transformToolEditsSingle(tool) {
    return tool === TOOL_IDS.move || tool === TOOL_IDS.expand;
}

function transformToolExpands(tool) {
    return tool === TOOL_IDS.expandAll || tool === TOOL_IDS.expand;
}

function beginBoundTransform() {
    const data = getMultiblockData();
    const key = ensureActiveBoundKey(data);
    const sourceName = state.selectedBound;
    if (!sourceName || !data.bounds[sourceName] || !key) return false;

    Undo.initEdit({multiblock: true});
    let name = sourceName;
    const tool = selectedTool();
    if (transformToolEditsSingle(tool) && assignmentCount(data, sourceName) > 1) {
        name = nextDuplicateName(data.bounds, sourceName);
        data.bounds[name] = data.bounds[sourceName].slice();
        data.positions[key] = data.positions[key]
            .map(reference => reference === sourceName ? name : reference);
        state.selectedBound = name;
    }
    transformSession = {name, key, tool};
    return true;
}

function resizeBounds(bounds, context, difference) {
    const result = bounds.slice();
    const resizeAxis = (axis, direction) => {
        if (typeof axis !== 'number') return;
        if (axis === 0) direction *= -1;
        if (direction < 0) result[axis] -= difference;
        else result[axis + 3] += difference;
    };

    if (context.axis === 'e') {
        for (let axis = 0; axis < 3; axis++) {
            result[axis] -= difference / 2;
            result[axis + 3] += difference / 2;
        }
    } else {
        resizeAxis(context.axis_number, context.direction);
        if (context.second_axis) resizeAxis(context.second_axis_number, 1);
    }
    return normaliseBounds(result);
}

function updateBoundTransform(context) {
    if (!transformSession && !beginBoundTransform()) return;
    const data = getMultiblockData();
    const bounds = toPreviewBounds(data.bounds[transformSession.name]);
    if (!bounds) return;
    const difference = context.value - (this.previous_value || 0);

    if (transformToolExpands(transformSession.tool)) {
        data.bounds[transformSession.name] = toPreviewBounds(resizeBounds(bounds, context, difference));
    } else {
        bounds[context.axis_number] += difference;
        bounds[context.axis_number + 3] += difference;
        data.bounds[transformSession.name] = toPreviewBounds(bounds);
    }
    updatePanels();
    refreshMultiblockPreview();
}

function finishBoundTransform(context) {
    if (!transformSession) return;
    if (context.has_changed) {
        Undo.finishEdit(transformToolExpands(transformSession.tool)
            ? 'Expand multiblock AABB preset' : 'Move multiblock AABB preset', {multiblock: true});
    } else if (typeof Undo.cancelEdit === 'function') Undo.cancelEdit();
    transformSession = null;
    refreshAll();
}

function cancelBoundTransform(context) {
    if (!transformSession) return;
    if (context.keep_changes) {
        Undo.finishEdit(transformToolExpands(transformSession.tool)
            ? 'Expand multiblock AABB preset' : 'Move multiblock AABB preset', {multiblock: true});
    } else if (typeof Undo.cancelEdit === 'function') Undo.cancelEdit();
    transformSession = null;
    refreshAll();
}

function registerTransformModule() {
    const module = new TransformerModule('ii_multiblock_bounds', {
        priority: 10,
        condition: () => modeActive() && isTransformTool(),
        use_condition: () => modeActive() && isTransformTool() && !!state.selectedBound,
        onPointerDown() {
            if (!transformToolExpands(selectedTool())) return;
            Transformer.direction = typeof Transformer.axis === 'string' && Transformer.axis.startsWith('N')
                ? false : true;
        },
        updateGizmo() {
            const data = getMultiblockData();
            const key = ensureActiveBoundKey(data);
            const centre = placementCentre(data, state.selectedBound, key);
            if (!centre) return false;
            previewLocalToWorld(centre);
            Transformer.position.copy(centre).sub(scene.position);
            Transformer.rotation_ref = scene;
            return true;
        },
        calculateOffset(context) {
            let axis = context.axis;
            const expanding = transformToolExpands(selectedTool());
            if (expanding && context.second_axis) {
                if (axis === 'y') axis = 'z';
                else if (context.second_axis === 'y') axis = 'y';
                else if (context.second_axis === 'z') axis = 'x';
            }
            const snap = canvasGridSize(context.event.shiftKey, context.event.ctrlKey || context.event.metaKey);
            let value = axis === 'e'
                ? context.point.length() * Math.sign(context.point.y || context.point.x)
                : context.point[axis];
            if (expanding && axis !== 'e' && !context.second_axis) {
                value *= context.direction || 1;
            } else if (!expanding && axis === 'x') {
                value *= -1;
            }
            return Math.round(value / snap) * snap;
        },
        onStart() {
            beginBoundTransform();
        },
        onMove: updateBoundTransform,
        onEnd: finishBoundTransform,
        onCancel: cancelBoundTransform
    });
    track(module);
}

function prepareTool() {
    if (!state.selectedBound) {
        Blockbench.showQuickMessage('Select an AABB preset first');
    } else if (isTransformTool() && !ensureActiveBoundKey()) {
        Blockbench.showQuickMessage(`Paint '${state.selectedBound}' onto a block before transforming it`);
    }
    refreshAll();
}

function registerTools() {
    const definitions = [
        [TOOL_IDS.paint, 'Paint', 'format_paint', 'hidden', 'default', {key: 'p'}],
        [TOOL_IDS.select, 'Select', 'select_all', 'hidden', 'pointer', {key: 'c'}],
        [TOOL_IDS.moveAll, 'Move All', 'control_camera', 'translate', 'default', {key: 'v', shift: true}],
        [TOOL_IDS.move, 'Move', 'open_with', 'translate', 'default', {key: 'v'}],
        [TOOL_IDS.expandAll, 'Expand All', 'zoom_out_map', 'scale', 'default', {key: 's', shift: true}],
        [TOOL_IDS.expand, 'Expand', 'aspect_ratio', 'scale', 'default', {key: 's'}]
    ];
    definitions.forEach((definition, index) => {
        const tool = new Tool(definition[0], {
            name: definition[1], icon: definition[2], modes: ['multiblock'],
            selectElements: false, transformerMode: definition[3], cursor: definition[4],
            category: 'tools', keybind: new Keybind(definition[5]),
            onSelect() {
                if (definition[0] !== TOOL_IDS.select) {
                    selectReturnTool = definition[0];
                    prepareTool();
                } else refreshAll();
            }
        });
        const selectListener = definition[0] === TOOL_IDS.select
            ? tool.on('select', ({previous_tool}) => {
                if (previous_tool?.id && previous_tool.id !== TOOL_IDS.select) {
                    selectReturnTool = previous_tool.id;
                }
            })
            : null;
        Toolbars.tools.add(tool, index);
        track(tool, selectListener);
    });
}

function panelPosition(index, height = 190) {
    return {slot: 'right_bar', height, sidebar_index: index};
}

function registerPanels() {
    const settingsPanel = new Panel('ii_multiblock_settings', {
        name: 'Multiblock', icon: 'view_in_ar', condition: {modes: ['multiblock']},
        default_position: panelPosition(0, 410), resizable: true,
        component: {
            data() { return {revision: 0}; },
            computed: {
                data() { this.revision; return getMultiblockData(); },
                layerLabel() { return this.data.layer >= this.data.size[1] ? 'All layers' : `Layer ${this.data.layer}`; },
                showAirAABB() { this.revision; return displayAirAABB(); },
                showMasterBlock() { this.revision; return displayMultiblockMaster(); },
                activeEditor() {
                    this.revision;
                    const tool = selectedTool();
                    if (tool === TOOL_IDS.select) return 'Click an AABB instance to select its preset';
                    if (state.selectedBound && tool === TOOL_IDS.paint) return `Painting AABB: ${state.selectedBound}`;
                    if (state.selectedPOI && tool === TOOL_IDS.paint) return `Painting POI: ${state.selectedPOI}`;
                    if (state.selectedBound && isTransformTool(tool)) return `${BarItems[tool]?.name || 'Editing'}: ${state.selectedBound}`;
                    return 'Select a preset or POI, then click grid cells';
                }
            },
            methods: {
                setLayer,
                setMultiblockName,
                setMultiblockModId,
                setTranslation,
                setMasterPosition,
                applySize,
                toggleAirAABB(event) { setDisplayAirAABB(event.target.checked); },
                toggleMasterBlock(event) { setDisplayMultiblockMaster(event.target.checked); }
            },
            template: `
                <div class="ii_multiblock_panel ii_multiblock_settings">
                    <label>Vertical Layer <b>{{ layerLabel }}</b></label>
                    <input type="range" min="0" :max="data.size[1]" step="1" :value="data.layer" @input="setLayer($event.target.value)">
                    <label>Multiblock ID</label>
                    <input type="text" autocomplete="off" placeholder="II:Vulcanizer" :value="data.name" @change="setMultiblockName($event.target.value)">
                    <label>Mod ID</label>
                    <input type="text" autocomplete="off" placeholder="immersiveintelligence" :value="data.mod_id" @change="setMultiblockModId($event.target.value)">
                    <label>Multiblock Size</label>
                    <div class="ii_vector_row"><span v-for="(axis, index) in ['X','Y','Z']"><i>{{axis}}</i><input type="number" min="1" step="1" :value="data.size[index]" @change="applySize(index, $event.target.value)"></span></div>
                    <label>Master Block Position</label>
                    <div class="ii_vector_row"><span v-for="(axis, index) in ['X','Y','Z']"><i>{{axis}}</i><input type="number" min="0" :max="data.size[index] - 1" step="1" :value="data.master[index]" @change="setMasterPosition(index, $event.target.value)"></span></div>
                    <label>Preview Translation</label>
                    <div class="ii_vector_row"><span v-for="(axis, index) in ['X','Y','Z']"><i>{{axis}}</i><input type="number" step="0.25" :value="data.translation[index]" @change="setTranslation(index, $event.target.value)"></span></div>
                    <div class="ii_multiblock_display_options">
                        <label><input type="checkbox" :checked="showAirAABB" @change="toggleAirAABB($event)"><span>Display Air AABB</span></label>
                        <label><input type="checkbox" :checked="showMasterBlock" @change="toggleMasterBlock($event)"><span>Display master block in Multiblock view</span></label>
                    </div>
                    <p class="ii_multiblock_hint">{{ activeEditor }}</p>
                </div>`
        }
    });

    const boundsPanel = new Panel('ii_multiblock_bounds', {
        name: 'AABB Presets', icon: 'crop_square', condition: {modes: ['multiblock']},
        default_position: panelPosition(1), growable: true, resizable: true,
        component: {
            data() { return {revision: 0}; },
            computed: {
                bounds() { this.revision; return Object.keys(getMultiblockData().bounds).sort(); },
                selected() { this.revision; return state.selectedBound; }
            },
            methods: {selectBound, addBound, editBound, removeBound, duplicateBound, copyBound, pasteBound},
            template: `
                <div class="ii_multiblock_panel ii_list_panel">
                    <div class="ii_panel_actions">
                        <button title="Add AABB preset" aria-label="Add AABB preset" @click="addBound()"><i class="material-icons">add</i></button>
                        <button title="Duplicate selected AABB preset" aria-label="Duplicate selected AABB preset" :disabled="!selected" @click="duplicateBound(selected)"><i class="material-icons">library_add</i></button>
                        <button title="Copy selected AABB preset" aria-label="Copy selected AABB preset" :disabled="!selected" @click="copyBound(selected)"><i class="material-icons">content_copy</i></button>
                        <button title="Paste AABB preset" aria-label="Paste AABB preset" @click="pasteBound()"><i class="material-icons">content_paste</i></button>
                    </div>
                    <ul class="ii_entry_list ii_scroll_list list mobile_scrollbar">
                        <li v-for="name in bounds" :class="{selected: selected === name}" @click="selectBound(name)">
                            <span>{{name}}</span>
                            <button title="Edit AABB preset" aria-label="Edit AABB preset" @click.stop="editBound(name)"><i class="material-icons">edit</i></button>
                            <button title="Remove AABB preset" aria-label="Remove AABB preset" @click.stop="removeBound(name)"><i class="material-icons">delete</i></button>
                        </li>
                    </ul>
                </div>`
        }
    });

    const poiPanel = new Panel('ii_multiblock_poi', {
        name: 'Points of Interest', icon: 'place', condition: {modes: ['multiblock']},
        default_position: panelPosition(2), growable: true, resizable: true,
        component: {
            data() { return {revision: 0}; },
            computed: {
                poi() { this.revision; return Object.keys(getMultiblockData().poi).sort(); },
                selected() { this.revision; return state.selectedPOI; },
                data() { this.revision; return getMultiblockData(); }
            },
            methods: {selectPOI, addPOI, renamePOI, removePOI, copyPOI, pastePOI, togglePOIVisibility},
            template: `
                <div class="ii_multiblock_panel ii_list_panel">
                    <div class="ii_panel_actions">
                        <button title="Add point of interest" aria-label="Add point of interest" @click="addPOI()"><i class="material-icons">add</i></button>
                        <button title="Copy selected point of interest" aria-label="Copy selected point of interest" :disabled="!selected" @click="copyPOI(selected)"><i class="material-icons">content_copy</i></button>
                        <button title="Paste point of interest" aria-label="Paste point of interest" @click="pastePOI()"><i class="material-icons">content_paste</i></button>
                    </div>
                    <ul class="ii_entry_list ii_scroll_list list mobile_scrollbar">
                        <li v-for="name in poi" :class="{selected: selected === name}" @click="selectPOI(name)">
                            <span>{{name}} <small>{{data.poi[name].length}}</small></span>
                            <button class="ii_visibility_button" :title="data.hidden_poi.includes(name) ? 'Show POI' : 'Hide POI'" @click.stop="togglePOIVisibility(name)"><i class="material-icons">{{data.hidden_poi.includes(name) ? 'visibility_off' : 'visibility'}}</i></button>
                            <button title="Rename point of interest" aria-label="Rename point of interest" @click.stop="renamePOI(name)"><i class="material-icons">edit</i></button>
                            <button title="Remove point of interest" aria-label="Remove point of interest" @click.stop="removePOI(name)"><i class="material-icons">delete</i></button>
                        </li>
                    </ul>
                </div>`
        }
    });

    const directionsPanel = new Panel('ii_multiblock_directions', {
        name: 'Directions', icon: 'explore', condition: {modes: ['multiblock']},
        default_position: panelPosition(3, 160), growable: true, resizable: true,
        component: {
            data() { return {revision: 0}; },
            computed: {
                directions() { this.revision; return Object.keys(getMultiblockData().rotations).sort(); },
                selected() { this.revision; return state.selectedDirection; },
                data() { this.revision; return getMultiblockData(); }
            },
            methods: {selectDirection, renamePOI, setDirection, setDirectionInward, toggleDirectionVisibility, addDirection, removeDirection},
            template: `
                <div class="ii_multiblock_panel ii_list_panel">
                    <div class="ii_panel_actions"><button title="Add direction" aria-label="Add direction" @click="addDirection()"><i class="material-icons">add</i></button></div>
                    <div class="ii_scroll_list list mobile_scrollbar">
                        <div class="ii_direction_row" v-for="name in directions" :class="{selected: selected === name}" @click="selectDirection(name)">
                            <span>{{name}}</span>
                            <select :value="data.rotations[name]" @click.stop @change="setDirection(name, $event.target.value)">
                                <option value="none">Forward</option><option value="clockwise_90">Clockwise 90°</option><option value="clockwise_180">180°</option><option value="counterclockwise_90">Counter-clockwise 90°</option>
                            </select>
                            <label class="ii_inward_toggle" title="Draw the arrow on the opposite side, pointing inward" @click.stop><input type="checkbox" :checked="data.inwards.includes(name)" @change="setDirectionInward(name, $event.target.checked)"> Inward</label>
                            <button class="ii_visibility_button" :title="data.hidden_directions.includes(name) ? 'Show Direction' : 'Hide Direction'" @click.stop="toggleDirectionVisibility(name)"><i class="material-icons">{{data.hidden_directions.includes(name) ? 'visibility_off' : 'visibility'}}</i></button>
                            <button title="Rename direction POI" aria-label="Rename direction POI" @click.stop="renamePOI(name)"><i class="material-icons">edit</i></button>
                            <button title="Remove direction" aria-label="Remove direction" @click.stop="removeDirection(name)"><i class="material-icons">delete</i></button>
                        </div>
                    </div>
                </div>`
        }
    });

    const materialsPanel = new Panel('ii_multiblock_materials', {
        name: 'Bill of Materials', icon: 'format_list_bulleted', condition: {modes: ['multiblock']},
        default_position: panelPosition(4, 190), growable: true, resizable: true,
        component: {
            data() { return {revision: 0}; },
            computed: {
                materials() { this.revision; return getBillOfMaterials(getMultiblockData()); }
            },
            methods: {
                percentage(value) { return `${value.toFixed(1)}%`; }
            },
            template: `
                <div class="ii_multiblock_panel ii_list_panel ii_materials_panel">
                    <div class="ii_materials_summary" v-if="materials.total">{{materials.total}} non-air block{{materials.total === 1 ? '' : 's'}}</div>
                    <div class="ii_scroll_list list mobile_scrollbar">
                        <div class="ii_materials_empty" v-if="!materials.total">Import a Minecraft structure NBT to list its materials.</div>
                        <div class="ii_material_row ii_material_header" v-else><span>Block</span><span>Count</span><span>Share</span></div>
                        <div class="ii_material_row" v-for="entry in materials.entries" :title="entry.name">
                            <span>{{entry.name}}</span><b>{{entry.count}}</b><span>{{percentage(entry.percentage)}}</span>
                        </div>
                    </div>
                </div>`
        }
    });
    track(settingsPanel, boundsPanel, poiPanel, directionsPanel, materialsPanel);
}

export function registerMultiblockMode() {
    unregisterMultiblockMode();

    const projectProperty = new Property(ModelProject, 'object', MULTIBLOCK_PROJECT_PROPERTY, {
        default: createDefaultMultiblockData,
        condition: () => Format?.id === 'free'
    });
    track(projectProperty);

    registerTools();
    registerTransformModule();
    registerEntryActions();
    const mode = new Mode('multiblock', {
        name: 'Multiblock', icon: 'view_in_ar', default_tool: TOOL_IDS.paint,
        category: 'navigate', selectElements: false,
        hidden_node_types: ['cube', 'mesh', 'texture_mesh'],
        condition: () => Format?.id === 'free',
        onSelect() {
            unselectAll();
            installPreviewListeners();
            refreshAll();
        },
        onUnselect() {
            leaveMultiblockPreview();
        }
    });
    track(mode);
    registerPanels();

    const undoCreate = Blockbench.on('create_undo_save', ({save, aspects}) => {
        if (aspects?.multiblock && Project) save.ii_multiblock = cloneData(getMultiblockData());
    });
    const undoLoad = Blockbench.on('load_undo_save', ({save}) => {
        if (!save?.ii_multiblock || !Project) return;
        Project[MULTIBLOCK_PROJECT_PROPERTY] = cloneData(save.ii_multiblock);
        refreshAll();
    });
    const projectSelect = Blockbench.on('select_project', () => {
        clearOverlay();
        if (modeActive()) refreshAll();
    });
    const projectUnselect = Blockbench.on('unselect_project', leaveMultiblockPreview);
    const dataRefresh = Blockbench.on('ii_multiblock_refresh', refreshAll);
    const displaySettingsRefresh = Blockbench.on('ii_toolkit_display_settings_changed', refreshAll);
    const viewUpdate = Blockbench.on('update_view', installPreviewListeners);
    track(undoCreate, undoLoad, projectSelect, projectUnselect, dataRefresh, displaySettingsRefresh, viewUpdate);

    styleHandle = Blockbench.addCSS(`
        .ii_multiblock_panel { padding: 8px; overflow: auto; }
        .ii_list_panel { box-sizing: border-box; display: flex; flex: 1 1 0; flex-direction: column; min-height: 0; width: 100%; overflow: hidden; }
        .ii_list_panel > .ii_panel_actions { flex: 0 0 auto; }
        .ii_list_panel > .ii_scroll_list { flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; margin-top: 6px; padding-right: 2px; }
        .ii_multiblock_panel label { display: flex; justify-content: space-between; margin: 5px 0 3px; }
        .ii_multiblock_settings > input[type="text"] { box-sizing: border-box; width: 100%; }
        .ii_multiblock_panel input[type="range"] { width: 100%; }
        .ii_vector_row { display: flex; gap: 5px; }
        .ii_vector_row span { display: flex; min-width: 0; flex: 1; align-items: center; gap: 3px; }
        .ii_vector_row i { width: 12px; font-style: normal; color: var(--color-subtle_text); }
        .ii_vector_row input { min-width: 0; width: 100%; }
        .ii_multiblock_display_options { margin-top: 8px; }
        .ii_multiblock_display_options label { justify-content: flex-start; align-items: center; gap: 6px; margin: 4px 0; }
        .ii_multiblock_display_options input { margin: 0; }
        .ii_multiblock_hint { color: var(--color-subtle_text); margin: 8px 0; }
        .ii_panel_actions { display: flex; gap: 6px; }
        .ii_panel_actions button { display: inline-flex; flex: 0 0 30px; width: 30px; height: 28px; padding: 0; align-items: center; justify-content: center; }
        .ii_panel_actions button i, .ii_entry_list button i, .ii_direction_row button i { font-size: 18px; }
        .ii_entry_list { list-style: none; margin: 0; padding: 0; }
        .ii_entry_list li { display: flex; align-items: center; min-height: 28px; padding: 2px 4px; border-radius: 2px; cursor: pointer; }
        .ii_entry_list li:hover { background: var(--color-button); }
        .ii_entry_list li.selected { background: var(--color-accent); color: var(--color-accent_text); }
        .ii_entry_list li span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .ii_entry_list li small { opacity: .65; }
        .ii_entry_list li button { width: 25px; min-width: 25px; padding: 0; }
        .ii_visibility_button i { font-size: 18px; vertical-align: middle; }
        .ii_direction_row { display: grid; grid-template-columns: minmax(65px, 1fr) minmax(105px, 1.4fr) auto 25px 25px 25px; gap: 6px; margin-top: 5px; padding: 2px 4px; border-radius: 2px; align-items: center; cursor: pointer; }
        .ii_direction_row:hover { background: var(--color-button); }
        .ii_direction_row.selected { background: var(--color-accent); color: var(--color-accent_text); }
        .ii_direction_row select { min-width: 0; width: 100%; }
        .ii_direction_row .ii_inward_toggle { display: flex; align-items: center; gap: 3px; margin: 0; white-space: nowrap; }
        .ii_direction_row button { width: 25px; min-width: 25px; padding: 0; }
        .ii_materials_summary { flex: 0 0 auto; color: var(--color-subtle_text); margin-bottom: 4px; }
        .ii_materials_empty { color: var(--color-subtle_text); padding: 6px 2px; }
        .ii_material_row { display: grid; grid-template-columns: minmax(0, 1fr) 52px 58px; gap: 8px; min-height: 26px; padding: 3px 5px; align-items: center; }
        .ii_material_row:nth-child(odd) { background: var(--color-button); }
        .ii_material_row > :first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ii_material_row > :not(:first-child) { text-align: right; }
        .ii_material_header { position: sticky; top: 0; z-index: 1; color: var(--color-subtle_text); background: var(--color-back) !important; font-size: .9em; }
    `);
    track(styleHandle);
    installPreviewListeners();
}

export function unregisterMultiblockMode() {
    leaveMultiblockPreview();
    removePreviewListeners();
    while (deletables.length) {
        const item = deletables.pop();
        try { item?.delete?.(); } catch (ignored) { /* Blockbench may already have removed it. */ }
    }
    styleHandle = null;
    state.selectedBound = '';
    state.selectedPOI = '';
    state.selectedDirection = '';
    state.activeBoundKey = '';
    transformSession = null;
    selectReturnTool = TOOL_IDS.paint;
}
