import '../GLTFLoader';
import {clearIIGLBModelCache, loadIIGLBModel} from '../utils';
import {AMTTransformAnimator} from './common';

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
    "8bcal_heavy_artillery.glb": "8bCal Heavy Artillery",
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

const ammoTypeMap = {
    "1bcal_submachinegun.glb": "smg_1bCal",
    "2bcal_rifle.glb": "mg_2bCal",
    "3bcal_autocannon.glb": "autocannon_3bCal",
    "4bcal_railgun_grenade.glb": "railgun_grenade_4bCal",
    "4bcal_light_gun.glb": "gun_4bCal",
    "6bcal_mortar.glb": "mortar_6bCal",
    "6bcal_light_artillery.glb": "artillery_6bCal",
    "6bcal_medium_artillery.glb": "artillery_6bCal_long",
    "8bcal_heavy_artillery.glb": "artillery_8bCal",
    "6bcal_rocket.glb": "rocket_6bCal",
    "10bcal_rocket.glb": "rocket_10bCal",
    "6bcal_missile_guided.glb": "missile_guided_6bCal",
    "5bcal_grenade.glb": "grenade_5bCal",
    "naval_mine.glb": "naval_mine"
};

const bulletStateMap = {
    bullet_unused: "Full",
    core: "Core Only",
    casing: "Casing Only",
    lid: "Lid"
};

export function getBulletAmmoType(type) {
    return ammoTypeMap[type] || null;
}

// Model cache to avoid reloading same file
async function loadModel(type) {
    if (!fileMap[type]) return null;

    if (!modelCache.has(type)) {
        modelCache.set(type, loadIIGLBModel(ASSET_BASE + type, {
            cacheKey: 'bullet:' + type,
            noExport: true
        }));
    }

    const model = await modelCache.get(type);
    return model.clone(true);
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
        this.children = [];
        this.isOpen = false;
        if (data && typeof data === 'object') {
            this.extend(data);
            // Preserve the old element appearance when loading projects made
            // before the state dropdown replaced showCasing.
            if (data.state === undefined && data.showCasing === false)
                this.state = 'core';
        }
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
        return this.getSaveCopy();
    }

    getSaveCopy() {
        let el = {};
        for (let key in Bullet.properties) Bullet.properties[key].copy(this, el);
        el.type = 'bullet';
        el.uuid = this.uuid;
        el.isOpen = this.isOpen;
        el.children = this.children.map(child => child.uuid);
        return el;
    }

    getChildlessCopy(keepUuid = false) {
        const copy = new Bullet({name: this.name}, keepUuid ? this.uuid : null);
        for (let key in Bullet.properties) Bullet.properties[key].copy(this, copy);
        copy.isOpen = this.isOpen;
        return copy;
    }

    markAsSelected(descendants) {
        Outliner.selected.safePush(this);
        this.selected = true;
        if (descendants) this.children.forEach(child => child.markAsSelected(true));
        TickUpdates.selection = true;
        return this;
    }

    openUp() {
        this.isOpen = true;
        this.updateElement();
        if (this.parent && this.parent !== 'root') this.parent.openUp();
        return this;
    }

    forEachChild(callback, type, forSelf) {
        if (forSelf) callback(this);
        this.children.forEach(child => {
            if (!type || (Array.isArray(type) ? type.some(entry => child instanceof entry) : child instanceof type))
                callback(child);
            if (child.forEachChild) child.forEachChild(callback, type);
        });
    }

    select(event, isOutlinerClick) {
        const result = super.select(event, isOutlinerClick);
        if (result === false) return false;
        if (Animator.open && Animation.selected) Animation.selected.getBoneAnimator(this)?.select(true);
        return this;
    }

    unselect(...args) {
        super.unselect(...args);
        if (Animator.open && Timeline.selected_animator && Timeline.selected_animator.element == this)
            Timeline.selected_animator.selected = false;
    }

    static behavior = {
        unique_name: true,
        parent: true,
        select_children: 'self_first',
        movable: true,
        rotatable: true,
        scalable: true,
        use_absolute_position: true
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
new Property(Bullet, 'string', 'state', {
    default: 'bullet_unused',
    inputs: {
        element_panel: {
            input: {
                label: 'Bullet State',
                type: 'select',
                options: bulletStateMap
            },
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
    default: false,
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
    setup(element) {
        const group = new THREE.Group();
        Project.nodes_3d[element.uuid] = group;
        group.name = element.uuid;
        group.type = element.type;
        group.isElement = true;
        group.visible = element.visibility;
        group.rotation.order = Format.euler_order;

        const previewRoot = new THREE.Group();
        previewRoot.name = `ii_bullet_preview_${element.uuid}`;
        previewRoot.no_export = true;
        group.userData.iiBulletPreviewRoot = previewRoot;
        group.add(previewRoot);

        if (!element.bulletType) {
            element.bulletType = '1bCal Revolver';
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
        let previewRoot = group.userData.iiBulletPreviewRoot;
        if (!previewRoot) {
            previewRoot = new THREE.Group();
            previewRoot.name = `ii_bullet_preview_${element.uuid}`;
            previewRoot.no_export = true;
            group.userData.iiBulletPreviewRoot = previewRoot;
            group.add(previewRoot);
        }
        const updateToken = element._bulletGeometryUpdateToken = (element._bulletGeometryUpdateToken || 0) + 1;

        try {
            const model = await loadModel(element.bulletType);
            if (updateToken !== element._bulletGeometryUpdateToken) return;

            while (previewRoot.children.length)
                previewRoot.remove(previewRoot.children[0]);

            if (model) {
                previewRoot.add(model);
                const state = element.state || 'bullet_unused';
                const showCasing = state === 'bullet_unused' || state === 'casing';
                const showCore = state === 'bullet_unused' || state === 'core';
                const showLid = state === 'bullet_unused' || state === 'lid';

                model.children.forEach(child => {
                    switch (child.name) {
                        case "paint":
                            child.visible = showCasing && element.showPaint;
                            break;
                        case "casing":
                            child.visible = showCasing;
                            break;
                        case "casing_lid":
                        case "lid":
                            child.visible = showLid;
                            break;
                        case "jet_flame":
                            child.visible = element.showJetFlame === true;
                            break;
                        case element.coreType:
                        case element.coreType.replace('core_', ''):
                            child.visible = showCore;
                            break;
                        default:
                            child.visible = false;
                            break;
                    }
                });
            }
        } catch (e) {
            if (updateToken !== element._bulletGeometryUpdateToken) return;
            console.warn(`Failed to reload bullet model "${element.bulletType}":`, e);
            while (previewRoot.children.length)
                previewRoot.remove(previewRoot.children[0]);
            addPlaceholder(previewRoot);
        }
        this.dispatchEvent('update_geometry', {element});
    },

    updateSelection(element) {
        this.dispatchEvent('update_selection', {element});
    }
});

// Override property merges to trigger visibility update after changes
['state', 'showPaint', 'showJetFlame', 'coreType'].forEach(propName => {
    const originalMerge = Bullet.properties[propName].merge;
    Bullet.properties[propName].merge = function (instance, data) {
        originalMerge.call(this, instance, data);
        if (instance.mesh)
            Bullet.preview_controller.updateGeometry(instance);
    };
});

// Trigger geometry reload when the selected ammunition model changes.
const originalBulletTypeMerge = Bullet.properties.bulletType.merge;
Bullet.properties.bulletType.merge = function (instance, data) {
    const oldValue = instance.bulletType;
    originalBulletTypeMerge.call(this, instance, data);
    if (oldValue !== instance.bulletType && instance.mesh)
        Bullet.preview_controller.updateGeometry(instance);
};

class BulletAnimator extends AMTTransformAnimator {
    displayFrame(multiplier = 1) {
        const element = this.getElement();
        if (!element?.mesh) return;

        Bullet.preview_controller.updateTransform(element);
        const mesh = element.mesh;

        if (!this.muted?.rotation) {
            const rotation = this.interpolate('rotation', true);
            if (rotation) {
                mesh.rotation.x += Math.degToRad(rotation[0]) * multiplier;
                mesh.rotation.y += Math.degToRad(rotation[1]) * multiplier;
                mesh.rotation.z += Math.degToRad(rotation[2]) * multiplier;
            }
        }
        if (!this.muted?.position) {
            const position = this.interpolate('position', true);
            if (position) {
                mesh.position.x += position[0] * multiplier;
                mesh.position.y += position[1] * multiplier;
                mesh.position.z += position[2] * multiplier;
            }
        }
        if (!this.muted?.scale) {
            const scale = this.interpolate('scale', true);
            if (scale) {
                mesh.scale.x *= (1 + (scale[0] - 1) * multiplier) || 0.00001;
                mesh.scale.y *= (1 + (scale[1] - 1) * multiplier) || 0.00001;
                mesh.scale.z *= (1 + (scale[2] - 1) * multiplier) || 0.00001;
            }
        }

        mesh.updateMatrixWorld(true);
    }
}
BulletAnimator.prototype.type = 'bullet';
Bullet.animator = BulletAnimator;

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
    modelCache.clear();
    clearIIGLBModelCache('bullet:');

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
    modelCache.clear();
    clearIIGLBModelCache('bullet:');

    // Remove actions from menus
    deletables.forEach(action => action.delete());
    deletables.length = 0;
}