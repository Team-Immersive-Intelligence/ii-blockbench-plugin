import '../GLTFLoader';

const ASSET_BASE = 'https://assets.iiteam.net/model/bullet/';

let deletables = [];

const modelCache = new Map();
// Map type to filename
const fileMap = {
    "1bcal_submachinegun.glb": "1bCal Short Cartridge",
    "2bcal_rifle.glb": "2bCal Long Cartridge",
    "3bCal_shotgun.glb": "3bCal Shotgun",
    "3bcal_autocannon.glb": "3bCal Autocannon",
    "4bcal_railgun_grenade.glb": "4bCal Railgun Grenade",
    "4bcal_light_gun.glb": "4bCal Light Gun",
    "6bcal_mortar.glb": "6bCal Mortar Shell",
    "6bcal_light_artillery.glb": "6bCal Light Artillery",
    "6bcal_medium_artillery.glb": "6bCal Medium Artillery",
    "8bcal_heavy_artillery.glb": "8bcal Heavy Artillery",
    "10bcal_torpedo.glb": "10bCal Torpedo",
    "6bcal_rocket.glb": "6bCal Light Rocket",
    "10bcal_rocket.glb": "10bCal Heavy Rocket",
    "6bcal_missile_guided.glb": "6bCal Guided Missile",
    "24bcal_ballistic_missile.glb": "24bCal Short-Range Ballistic Missile",
    "32bcal_ballistic_missile.glb": "32bCal Long-Range Ballistic Missile",
    "4bcal_firebomb.glb": "4bCal Firebomb",
    "5bcal_grenade.glb": "5bCal Hand Grenade",
    "landmine.glb": "Landmine",
    "tripmine.glb": "Tripmine",
    "naval_mine.glb": "Naval Mine",
    "radio_explosives.glb": "Radio Explosives"
};

// Model cache to avoid reloading same file
async function loadModel(type) {

    if (modelCache.has(type)) {
        console.log("Loading cached: " + type)
        return modelCache.get(type).clone();
    }

    console.log("Loading: " + type)
    if (!fileMap[type])
        return null;

    const url = ASSET_BASE + type;

    return new Promise((resolve, reject) => {
        new THREE.GLTFLoader().load(url,
            (gltf) => {
                const model = gltf.scene;
                model.traverse(node => {
                    if (node.isMesh && node.material) {
                        console.log("model node:")
                        console.log(node)
                        node.receiveShadow = true;
                        const materials = Array.isArray(node.material) ? node.material : [node.material];
                        materials.forEach(mat => {
                            console.log("model material: ");
                            console.log(mat);

                            const originalMap = mat.map;
                            mat.roughness = 1.0;
                            mat.metalness = 0.0;
                            //Slight self-illumination
                            mat.emissive = new THREE.Color(0x7f7f7f);
                            mat.emissiveIntensity = 0.125 * 3;
                        });
                    }
                });

                modelCache.set(type, model.clone(true));
                resolve(model);
            },
            undefined,
            reject
        );
    });
}

// Scan model for part groups and return mapping
function scanModelParts(model) {
    const parts = {casing: null, paint: null, cores: []};
    model.traverse(obj => {
        if (!obj.isMesh && !obj.isGroup) return;
        const name = obj.name.toLowerCase();
        if (name === 'casing') parts.casing = obj;
        else if (name === 'paint') parts.paint = obj;
        else if (name.startsWith('core_')) parts.cores.push({name: obj.name, object: obj});
    });
    return parts;
}

/**
 * Bullet element class - displays a 3D model of a bullet.
 */
export class Bullet extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        for (let key in Bullet.properties) {
            Bullet.properties[key].reset(this);
        }
        if (data && typeof data === 'object') this.extend(data);
    }

    get origin() {
        return this.position;
    }

    getWorldCenter() {
        return THREE.fastWorldPosition(this.mesh, Reusable.vec2);
    }

    extend(object) {
        for (let key in Bullet.properties) Bullet.properties[key].merge(this, object);
        this.sanitizeName();
        return this;
    }

    getUndoCopy() {
        let copy = new Bullet(this);
        copy.uuid = this.uuid;
        delete copy.parent;
        return copy;
    }

    getSaveCopy() {
        let el = {};
        for (let key in Bullet.properties) Bullet.properties[key].copy(this, el);
        el.type = 'bullet';
        el.uuid = this.uuid;
        return el;
    }

    select(event, isOutlinerClick) {
        super.select(event, isOutlinerClick);
        if (Animator.open && Animation.selected) Animation.selected.getBoneAnimator(this).select(true);
        return this;
    }

    unselect(...args) {
        super.unselect(...args);
        if (Animator.open && Timeline.selected_animator && Timeline.selected_animator.element == this)
            Timeline.selected_animator.selected = false;
    }

    static behavior = {
        unique_name: true,
        movable: true,
        rotatable: true,
        scalable: true
    };
}

// Prototype assignments
Bullet.prototype.title = 'Bullet';
Bullet.prototype.type = 'bullet';
Bullet.prototype.icon = 'label';
Bullet.prototype.movable = true;
Bullet.prototype.rotatable = true;
Bullet.prototype.scalable = true;
Bullet.prototype.needsUniqueName = true;
Bullet.prototype.menu = new Menu([
    'bullet_to_view',
    'edit_bullet_properties',
    '_',
    ...Outliner.control_menu_group,
    '_',
    'rename',
    'delete'
]);
Bullet.prototype.buttons = [
    Outliner.buttons.locked,
    Outliner.buttons.visibility,
];

// ----- Properties -----
new Property(Bullet, 'string', 'name', {default: 'bullet'});
new Property(Bullet, 'vector', 'position');
new Property(Bullet, 'vector', 'rotation');
new Property(Bullet, 'vector', 'scale', {default: [1, 1, 1]});
new Property(Bullet, 'string', 'bulletType', {
    default: Object.keys(fileMap)[0],
    inputs: {
        element_panel: {
            input: {
                label: 'Bullet Type',
                type: 'select',
                options: fileMap
            },
            onChange() {
                Bullet.selected.forEach(el => Bullet.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Bullet, 'boolean', 'showCasing', {
    default: true,
    inputs: {
        element_panel: {
            input: {label: 'Show Casing', type: 'checkbox'},
            onChange() {
                Bullet.selected.forEach(el => Bullet.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Bullet, 'boolean', 'showPaint', {
    default: true,
    inputs: {
        element_panel: {
            input: {label: 'Show Paint', type: 'checkbox'},
            onChange() {
                Bullet.selected.forEach(el => Bullet.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Bullet, 'boolean', 'showJetFlame', {
    default: true,
    inputs: {
        element_panel: {
            input: {label: 'Show Jet Flame', type: 'checkbox'},
            onChange() {
                Bullet.selected.forEach(el => Bullet.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Bullet, 'string', 'coreType', {
    default: 'core_piercing',
    inputs: {
        element_panel: {
            input: {
                label: 'Core Type',
                type: 'select',
                options: {
                    "core_softpoint": "Soft Point",
                    "core_shaped": "Shaped",
                    "core_shaped_sabot": "Shaped Fin-Stabilized",
                    "core_piercing": "Armor-Piercing",
                    "core_piercing_sabot": "Sabot",
                    "core_canister": "Canister",
                    "core_cluster": "Cluster"
                },
                value: Bullet.selected.coreType
            },
            onChange() {
                Bullet.selected.forEach(el => Bullet.preview_controller.updateGeometry(el));
            }
        }
    }
});
new Property(Bullet, 'boolean', 'visibility', {default: true});

function addPlaceholder(group) {
    // Simple magenta cube to indicate missing model
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({color: 0xff00ff, wireframe: true});
    const cube = new THREE.Mesh(geom, mat);
    group.add(cube);
}

// ----- Preview Controller -----
new NodePreviewController(Bullet, {
    async setup(element) {
        const group = new THREE.Group();
        Project.nodes_3d[element.uuid] = group;
        group.name = element.uuid;
        group.type = element.type;
        group.isElement = true;
        group.visible = element.visibility;

        if (!element.bulletType) {
            element.bulletType = '1bCal Revolver';
        }

        try {
            const model = await loadModel(element.bulletType);
            if (model) {
                group.add(model);
            }
        } catch (e) {
            console.warn(`Failed to load bullet model "${element.bulletType}":`, e);
            addPlaceholder(group);
        }

        this.updateTransform(element);
        this.updateGeometry(element);
        this.dispatchEvent('setup', {element});
    },

    updateTransform(element) {
        NodePreviewController.prototype.updateTransform.call(this, element);
        this.dispatchEvent('update_transform', {element});
    },

    async updateGeometry(element) {
        const group = element.mesh;
        if (!group) return;

        while (group.children.length)
            group.remove(group.children[0]);

        try {
            const model = await loadModel(element.bulletType);
            console.log(model);
            if (model) {
                group.add(model);
                model.children.forEach(child => {
                    switch (child.name) {
                        case "paint":
                            child.visible = element.showPaint;
                            break;
                        case "casing":
                            child.visible = element.showCasing;
                            break;
                        case "jet_flame":
                            child.visible = element.showJetFlame;
                            break;
                        case element.coreType:
                        case element.coreType.replace('core_', ''):
                            child.visible = true;
                            break;
                        default:
                            child.visible = false;
                            break;
                    }
                });
            }
        } catch (e) {
            console.warn(`Failed to reload bullet model "${element.bulletType}":`, e);
            addPlaceholder(group);
        }
        this.dispatchEvent('update_geometry', {element});
    },

    updateSelection(element) {
        this.dispatchEvent('update_selection', {element});
    }
});

// Override property merges to trigger visibility update after changes
['showCasing', 'showPaint', 'coreType'].forEach(propName => {
    const originalMerge = Bullet.properties[propName].merge;
    Bullet.properties[propName].merge = function (instance, data) {
        originalMerge.call(this, instance, data);
        if (instance.mesh)
            Bullet.preview_controller.updateGeometry(instance);
    };
});

// Also trigger when bulletType changes (since model reloads)
const originalBulletTypeMerge = Bullet.properties.bulletType.merge;
Bullet.properties.bulletType.merge = function (instance, data) {
    const old = instance.bulletType;
    originalBulletTypeMerge.call(this, instance, data);
    if (old !== instance.bulletType && instance.mesh) {
        Bullet.preview_controller.updateGeometry(instance);
    }
};

// Override property change handler for bulletType to trigger model reload
const originalMerge = Bullet.properties.bulletType.merge;
Bullet.properties.bulletType.merge = function (instance, data) {
    const oldValue = instance.bulletType;
    originalMerge.call(this, instance, data);
    if (oldValue !== instance.bulletType && instance.mesh) {
        Bullet.preview_controller.updateGeometry(instance);
    }
};

// ----- Actions -----
let addAction;

function createActions() {
    addAction = new Action('add_bullet', {
        name: 'Add Bullet',
        icon: 'label',
        category: 'edit',
        condition: () => Modes.edit,
        click() {
            Undo.initEdit({outliner: true, elements: [], selection: true});
            let bullet = new Bullet().init();
            let group = getCurrentGroup();
            bullet.addTo(group);

            if (Format.bone_rig && group) {
                let pos = group.origin.slice();
                bullet.extend({position: pos});
            }

            unselectAll();
            bullet.select();
            Undo.finishEdit('Add Bullet', {outliner: true, elements: selected, selection: true});
            Blockbench.dispatchEvent('add_bullet', {object: bullet});
            return bullet;
        }
    });

    deletables.push(addAction);
}

// ----- Registration functions -----

/**
 * Register the Bullet element type, actions, and menu entries.
 * Call this once when the plugin/script loads.
 */
export function registerBullet() {
    OutlinerElement.registerType(Bullet, 'bullet');
    createActions();

    let add_element_menu = BarItems.add_element.side_menu;
    add_element_menu.addAction(addAction);

    // Add to global if needed
    window.Bullet = Bullet;
}

/**
 * Unregister the Bullet element type and remove actions.
 * Call this when the plugin unloads.
 */
export function unregisterBulletActions() {
    // Remove actions from menus
    deletables.forEach(action => action.delete());
    deletables.length = 0;
}