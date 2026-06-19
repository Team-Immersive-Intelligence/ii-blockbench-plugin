import '../GLTFLoader';
import {
    createPreviewObject3D,
    mergeElementProperties,
    resetElementProperties,
    setPreviewVisibility,
    updatePreviewTransform
} from './common';
import { createIIPreviewMaterial, loadIIGLBModel } from '../utils';

const ASSET_BASE = 'https://assets.iiteam.net/model/';
const WAREHOUSE_URL = ASSET_BASE + 'warehouse.json';

let deletables = [];
let registered = false;
let warehouseData = [];

// ----------------------------------------------------------------------
// Load warehouse data in background
// ----------------------------------------------------------------------
async function fetchWarehouseData() {
    try {
        const resp = await fetch(WAREHOUSE_URL);
        if (resp.ok) {
            warehouseData = await resp.json();
            console.log(`Loaded ${warehouseData.length} warehouse items.`);
        }
    } catch (e) {
        console.error('Failed to load warehouse data:', e);
    }
}

fetchWarehouseData();

// ----------------------------------------------------------------------
// Utility: apply Three.js node transform to Blockbench element
// ----------------------------------------------------------------------
function applyNodeTransform(element, node) {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    // GLTF nodes often keep their local transform in matrix form. Decompose that
    // matrix directly so imported Embedded elements match the GLB hierarchy.
    node.updateMatrix();
    node.matrix.decompose(position, quaternion, scale);

    const euler = new THREE.Euler().setFromQuaternion(quaternion, Format.euler_order || 'ZYX');
    element.origin = [position.x, position.y, position.z];
    element.rotation = [
        THREE.MathUtils.radToDeg(euler.x),
        THREE.MathUtils.radToDeg(euler.y),
        THREE.MathUtils.radToDeg(euler.z)
    ];
    element.scale = [scale.x, scale.y, scale.z];
}

function cloneMaterial(material) {
    if (Array.isArray(material)) {
        return material.map(mat => createIIPreviewMaterial(mat, {noExport: true}));
    }
    return createIIPreviewMaterial(material, {noExport: true});
}

function clearThreeChildren(object) {
    while (object.children.length) {
        const child = object.children[object.children.length - 1];
        object.remove(child);
        child.traverse(node => {
            node.geometry?.dispose?.();
            if (Array.isArray(node.material)) node.material.forEach(material => material?.dispose?.());
            else node.material?.dispose?.();
        });
    }
}

function rebuildEmbeddedMeshPreview(element) {
    if (!element.mesh) return;
    clearThreeChildren(element.mesh);

    if (element._geometry && element._material) {
        const mesh = new THREE.Mesh(element._geometry, cloneMaterial(element._material));
        mesh.name = element.name || 'embedded_mesh';
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        element.mesh.add(mesh);
    }
}

// ----------------------------------------------------------------------
// EmbeddedMesh – an imported mesh that is not user‑editable
// ----------------------------------------------------------------------
class EmbeddedMesh extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetElementProperties(this, EmbeddedMesh);
        this.name = 'embedded_mesh';
        this.children = [];
        this.selected = false;
        this.isOpen = false;
        this.locked = true;
        this.export = true;
        this.parent = 'root';
        this.visibility = true;
        this._geometry = null;
        this._material = null;

        if (data && typeof data === 'object') this.extend(data);
    }

    extend(object) {
        return mergeElementProperties(this, EmbeddedMesh, object);
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) EmbeddedMesh.preview_controller.setup(this);
        return this;
    }
}

EmbeddedMesh.prototype.title = 'Embedded Mesh';
EmbeddedMesh.prototype.type = 'embedded_mesh';
EmbeddedMesh.prototype.icon = 'grid_3x3';
EmbeddedMesh.prototype.locked = true;
EmbeddedMesh.prototype.movable = false;
EmbeddedMesh.prototype.rotatable = false;
EmbeddedMesh.prototype.scalable = false;
EmbeddedMesh.prototype.buttons = [];
EmbeddedMesh.prototype.menu = new Menu([]);

OutlinerElement.registerType(EmbeddedMesh, 'embedded_mesh');

new Property(EmbeddedMesh, 'vector', 'origin', {default: [0, 0, 0]});
new Property(EmbeddedMesh, 'vector', 'rotation');
new Property(EmbeddedMesh, 'vector', 'scale', {default: [1, 1, 1]});
new Property(EmbeddedMesh, 'boolean', 'visibility', {default: true});

new NodePreviewController(EmbeddedMesh, {
    setup(element) {
        createPreviewObject3D(element);
        rebuildEmbeddedMeshPreview(element);
        this.updateTransform(element);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        updatePreviewTransform(element, {positionKey: 'origin'});
        this.dispatchEvent('update_transform', {element});
    },

    updateGeometry(element) {
        rebuildEmbeddedMeshPreview(element);
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

// ----------------------------------------------------------------------
// EmbeddedGroup – an imported group that is not user‑editable
// ----------------------------------------------------------------------
class EmbeddedGroup extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetElementProperties(this, EmbeddedGroup);
        this.name = 'embedded_group';
        this.children = [];
        this.selected = false;
        this.locked = true;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;

        if (data && typeof data === 'object') this.extend(data);
    }

    extend(object) {
        return mergeElementProperties(this, EmbeddedGroup, object);
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) EmbeddedGroup.preview_controller.setup(this);
        return this;
    }

    static behavior = {
        unique_name: false,
        movable: false,
        rotatable: false,
        parent: true,
        child_types: ['embedded_group', 'embedded_mesh', 'group', 'cube', 'mesh', 'locator', 'null_obj']
    };
}

EmbeddedGroup.prototype.title = 'Embedded Group';
EmbeddedGroup.prototype.type = 'embedded_group';
EmbeddedGroup.prototype.icon = 'folder';
EmbeddedGroup.prototype.locked = true;
EmbeddedGroup.prototype.movable = false;
EmbeddedGroup.prototype.rotatable = false;
EmbeddedGroup.prototype.scalable = false;
EmbeddedGroup.prototype.buttons = [];
EmbeddedGroup.prototype.menu = new Menu([]);
OutlinerElement.registerType(EmbeddedGroup, 'embedded_group');

new Property(EmbeddedGroup, 'vector', 'origin', {default: [0, 0, 0]});
new Property(EmbeddedGroup, 'vector', 'rotation');
new Property(EmbeddedGroup, 'vector', 'scale', {default: [1, 1, 1]});
new Property(EmbeddedGroup, 'boolean', 'visibility', {default: true});

new NodePreviewController(EmbeddedGroup, {
    setup(element) {
        createPreviewObject3D(element, { group: true });
        this.updateTransform(element);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        updatePreviewTransform(element, {positionKey: 'origin'});
        this.dispatchEvent('update_transform', {element});
    },

    updateVisibility(element) {
        setPreviewVisibility(element);
        this.dispatchEvent('update_visibility', {element});
    },

    updateSelection(element) {
        this.dispatchEvent('update_selection', {element});
    }
});

// ----------------------------------------------------------------------
// EmbeddedPart – the root element of an imported component
// ----------------------------------------------------------------------
export class EmbeddedPart extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        for (let key in EmbeddedPart.properties) {
            EmbeddedPart.properties[key].reset(this);
        }
        this.name = 'embedded_part';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;

        if (typeof data === 'object') {
            this.extend(data);
        }
    }

    extend(object) {
        for (let key in EmbeddedPart.properties) {
            EmbeddedPart.properties[key].merge(this, object);
        }
        Merge.string(this, object, 'name');
        this.sanitizeName();
        Merge.boolean(this, object, 'export');
        Merge.boolean(this, object, 'locked');
        Merge.boolean(this, object, 'visibility');
        return this;
    }

    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) {
            EmbeddedPart.preview_controller.setup(this);
        }
        return this;
    }

    static behavior = {
        unique_name: false,
        movable: true,
        rotatable: true,
        parent: true,
        child_types: ['embedded_group', 'embedded_mesh', 'group', 'cube', 'mesh', 'locator', 'null_obj']
    };
}

EmbeddedPart.prototype.title = 'Embedded Part';
EmbeddedPart.prototype.type = 'embedded_part';
EmbeddedPart.prototype.icon = 'extension';
EmbeddedPart.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
EmbeddedPart.prototype.menu = new Menu([
    'update_embedded_part',
    ...Outliner.control_menu_group,
    new MenuSeparator('manage'),
    'rename',
    'delete'
]);

OutlinerElement.registerType(EmbeddedPart, 'embedded_part');

new Property(EmbeddedPart, 'string', 'name', {default: 'embedded_part'});
new Property(EmbeddedPart, 'vector', 'position');
new Property(EmbeddedPart, 'vector', 'rotation');
new Property(EmbeddedPart, 'vector', 'scale', {default: [1, 1, 1]});
new Property(EmbeddedPart, 'string', 'componentId', {
    default: '',
    inputs: {
        element_panel: {
            input: {label: 'Component ID', type: 'text', readonly: true}
        }
    }
});
new Property(EmbeddedPart, 'string', 'version', {
    default: '',
    inputs: {
        element_panel: {
            input: {label: 'Version', type: 'text', readonly: true}
        }
    }
});
new Property(EmbeddedPart, 'boolean', 'visibility', {default: true});

new NodePreviewController(EmbeddedPart, {
    setup(element) {
        createPreviewObject3D(element, { group: true });
        this.updateTransform(element);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        updatePreviewTransform(element);
        this.dispatchEvent('update_transform', {element});
    },

    updateVisibility(element) {
        setPreviewVisibility(element);
        this.dispatchEvent('update_visibility', {element});
    },

    updateSelection(element) {
        this.dispatchEvent('update_selection', {element});
    }
});

// ----------------------------------------------------------------------
// Model loading & parsing helpers
// ----------------------------------------------------------------------
function clearEmbeddedChildren(part) {
    const toRemove = (part.children || []).filter(c => c instanceof EmbeddedGroup || c instanceof EmbeddedMesh);
    toRemove.forEach(c => c.remove());
}

function createEmbeddedElementsFromModel(model, parentElement) {
    model.updateMatrixWorld(true);

    for (const child of model.children) {
        if (child.isMesh) {
            const elem = new EmbeddedMesh({name: child.name || 'embedded_mesh'});
            elem._geometry = child.geometry?.clone ? child.geometry.clone() : child.geometry;
            elem._material = cloneMaterial(child.material);
            applyNodeTransform(elem, child);
            elem.init();
            elem.addTo(parentElement);
            EmbeddedMesh.preview_controller.updateTransform(elem);
            EmbeddedMesh.preview_controller.updateGeometry(elem);
        } else if (child.isGroup || child.isObject3D) {
            // Avoid creating empty wrapper groups for anonymous GLTF scene roots;
            // import their useful children directly below the requested parent.
            const anonymousRoot = !child.name || child.name === 'Scene';
            if (anonymousRoot && parentElement instanceof EmbeddedPart) {
                createEmbeddedElementsFromModel(child, parentElement);
                continue;
            }

            const elem = new EmbeddedGroup({name: child.name || 'embedded_group'});
            applyNodeTransform(elem, child);
            elem.init();
            elem.addTo(parentElement);
            EmbeddedGroup.preview_controller.updateTransform(elem);
            createEmbeddedElementsFromModel(child, elem);
        }
    }
}

async function loadModelForPart(part) {
    const entry = warehouseData.find(e => e.id === part.componentId);
    if (!entry) throw new Error('Unknown component');

    const url = entry.model;
    return loadIIGLBModel(url, {
        cacheKey: 'warehouse:' + url,
        noExport: true
    });
}

// ----------------------------------------------------------------------
// Warehouse Browser Dialog (Vue‑based)
// ----------------------------------------------------------------------
function openWarehouseBrowser() {
    if (!warehouseData.length) {
        Blockbench.showMessageBox({
            title: 'No Data',
            message: 'Warehouse data is still loading or unavailable.',
            icon: 'warning'
        });
        return;
    }

    const categories = {};
    warehouseData.forEach(item => {
        const cat = item.category || 'Uncategorized';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(item);
    });

    const dialog = new Dialog({
        id: 'warehouse_browser',
        title: 'Parts Warehouse',
        width: 800,
        buttons: [],
        lines: [
            `<style>
                #warehouse_browser .dialog_content {
                    margin: 0;
                    height: 100%;
                }
                #warehouse_browser .dialog_wrapper {
                    height: 100%;
                }
                .warehouse-card:hover {
                    transform: translateY(-3px) !important;
                    box-shadow: 0 6px 16px rgba(0,0,0,0.4) !important;
                }
            </style>`
        ],
        component: {
            data() {
                return { categories };
            },
            methods: {
                importItem(item) {
                    dialog.close();
                    importPart(item.id);
                }
            },
            template: `
              <div style="display:flex;flex-direction:column;height:100%;">
                <div style="flex:1;overflow-y:auto;padding:12px;">
                  <div v-for="(items, cat) in categories" style="margin-bottom:20px;">
                    <h3 style="margin:0 0 8px;">{{ cat }}</h3>
                    <div style="display:flex;flex-wrap:wrap;gap:10px;">
                      <div v-for="item in items" :key="item.id" class="warehouse-card" @click="importItem(item)"
                           style="width:200px;background:var(--color-surface);border-radius:8px;overflow:hidden;cursor:pointer;
                                            box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:transform 0.2s,box-shadow 0.2s;">
                        <img :src="item.preview"
                             style="width:100%;height:120px;object-fit:contain;background:var(--color-background);">
                        <div style="padding:8px;">
                          <div style="font-weight:bold;font-size:14px;margin-bottom:4px;">{{ item.name }}</div>
                          <div
                              style="font-size:12px;color:var(--color-text-secondary);max-height:40px;overflow:hidden;">
                            {{ item.description }}
                          </div>
                          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
                            <span style="font-size:10px;color:var(--color-accent);">{{ item.author }}</span>
                            <span
                                style="font-size:10px;background:var(--color-primary);color:#fff;padding:2px 6px;border-radius:4px;">{{ item.category }}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            `
        },
        onBuild() {
            this.object.style.height = "512px";
        }
    });
    dialog.show();
}

function getEmbeddedPartImportParent() {
    const selected = Outliner.selected?.[0];
    if (selected && (selected.type === 'track_suspender' || selected.type === 'track_wheel')) {
        return selected;
    }
    return getCurrentGroup();
}

async function importPart(componentId) {
    const entry = warehouseData.find(e => e.id === componentId);
    if (!entry) return;

    Undo.initEdit({outliner: true, elements: [], selection: true});

    let part = new EmbeddedPart().init();
    part.componentId = componentId;
    part.version = entry.version || '1.0';
    part.name = entry.name;
    part.createUniqueName();

    part.addTo(getEmbeddedPartImportParent());

    try {
        const model = await loadModelForPart(part);
        clearEmbeddedChildren(part);
        createEmbeddedElementsFromModel(model, part);
    } catch (e) {
        console.error('Failed to load part model:', e);
        Blockbench.showQuickMessage('Failed to load part model', 'error');
    }

    unselectAll();
    part.select();
    Undo.finishEdit('Import Embedded Part', {outliner: true, elements: selected, selection: true});
    Blockbench.dispatchEvent('import_embedded_part', {object: part});
}

// ----------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------
function createActions() {
    const addAction = new Action('import_embedded_part', {
        name: 'Import Embedded Part',
        icon: 'extension',
        category: 'edit',
        condition: () => Modes.edit && warehouseData.length > 0,
        click() {
            openWarehouseBrowser();
        }
    });
    deletables.push(addAction);
    BarItems.add_element.side_menu?.addAction(addAction);

    const updateAction = new Action('update_embedded_part', {
        name: 'Update Part from Warehouse',
        icon: 'refresh',
        condition: () => EmbeddedPart.hasSelected(),
        async click() {
            const part = EmbeddedPart.selected[0];
            Undo.initEdit({outliner: true, elements: [part], selection: true});
            try {
                const model = await loadModelForPart(part);
                clearEmbeddedChildren(part);
                createEmbeddedElementsFromModel(model, part);
                Undo.finishEdit('Update Embedded Part');
            } catch (e) {
                console.error(e);
                Blockbench.showQuickMessage('Update failed', 'error');
            }
        }
    });
    deletables.push(updateAction);
}

// ----------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------
export function registerEmbeddedPart() {
    if (registered) return;
    createActions();
    window.EmbeddedPart = EmbeddedPart;
    window.EmbeddedGroup = EmbeddedGroup;
    window.EmbeddedMesh = EmbeddedMesh;
    registered = true;
}

export function unregisterEmbeddedPartActions() {
    deletables.forEach(a => a.delete());
    deletables.length = 0;
    registered = false;
}