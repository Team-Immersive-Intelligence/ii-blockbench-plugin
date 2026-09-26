import {getBoxLineVertices} from '../utils';
import {AMTTransformAnimator, vectorFromInterpolation} from './common';
import {displayAirAABB} from '../settings/display_settings';

const FULL_BLOCK_AABB_VERTICES = getBoxLineVertices(16, 16, 16)
    .map(coordinate => coordinate + 8);

export class AABB extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);

        const legacySize = Array.isArray(data?.size) ? data.size.slice() : null;

        //Initialize properties with defaults
        for (let key in AABB.properties) {
            AABB.properties[key].reset(this);
        }
        if (data && typeof data === 'object') {
            this.extend(data);
        }
        // IIToolkit 0.7 and older stored tactile boxes as [horizontal, vertical].
        if (legacySize) {
            this.width = nonNegativeNumber(legacySize[0], this.width);
            this.height = nonNegativeNumber(legacySize[1], this.height);
            this.depth = this.width;
        }
    }

    get origin() {
        return this.position;
    }

    getWorldCenter() {
        return THREE.fastWorldPosition(this.mesh, Reusable.vec2);
    }

    extend(object) {
        for (let key in AABB.properties) {
            AABB.properties[key].merge(this, object);
        }
        this.sanitizeName();
        return this;
    }

    getUndoCopy() {
        let copy = new AABB(this);
        copy.uuid = this.uuid;
        delete copy.parent;
        return copy;
    }

    getSaveCopy() {
        let el = {};
        for (let key in AABB.properties) {
            AABB.properties[key].copy(this, el);
        }
        el.type = 'aabb';
        el.uuid = this.uuid;
        return el;
    }

    select(event, isOutlinerClick) {
        super.select(event, isOutlinerClick);
        if (Animator.open && Animation.selected) {
            Animation.selected.getBoneAnimator(this).select(true);
        }
        return this;
    }

    unselect(...args) {
        super.unselect(...args);
        if (Animator.open && Timeline.selected_animator && Timeline.selected_animator.element == this) {
            Timeline.selected_animator.selected = false;
        }
    }

    //Static behavior flags
    static behavior = {
        // AABB names are template names and are intentionally reusable.
        unique_name: false,
        movable: true,
        rotatable: false,   //AABB cannot be rotated
        scalable: false
    };
}

let deletables = [];


//----- AABB Element Class -----
//Assign prototype properties
AABB.prototype.title = 'Tactile AABB';
AABB.prototype.type = 'aabb';
AABB.prototype.icon = 'fas fa-cube';
AABB.prototype.movable = true;
AABB.prototype.rotatable = false;
AABB.prototype.needsUniqueName = false;
AABB.prototype.menu = new Menu([
    'edit_aabb_properties',
    '_',
    ...Outliner.control_menu_group,
    '_',
    'rename',
    'delete'
]);
AABB.prototype.buttons = [
    Outliner.buttons.locked,
    Outliner.buttons.visibility,
];

//----- Properties -----
new Property(AABB, 'string', 'name', { default: 'aabb' });
new Property(AABB, 'vector', 'position');
new Property(AABB, 'number', 'width', {
    default: 2,
    min: 0,
    inputs: {
        element_panel: {
            input: { label: 'X Size', type: 'number', min: 0 },
            onChange: updateSelectedAABBGeometry
        }
    }
});
new Property(AABB, 'number', 'height', {
    default: 2,
    min: 0,
    inputs: {
        element_panel: {
            input: { label: 'Y Size', type: 'number', min: 0 },
            onChange: updateSelectedAABBGeometry
        }
    }
});
new Property(AABB, 'number', 'depth', {
    default: 2,
    min: 0,
    inputs: {
        element_panel: {
            input: { label: 'Z Size', type: 'number', min: 0 },
            onChange: updateSelectedAABBGeometry
        }
    }
});
new Property(AABB, 'boolean', 'visibility', { default: true });

OutlinerElement.registerType(AABB, 'aabb');

//----- Preview Controller -----
new NodePreviewController(AABB, {
    setup(element) {
        // Create line segments only (no fill)
        const vertices = getAABBVertices(element);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

        const material = new THREE.LineBasicMaterial({ color: gizmo_colors.grid });
        const lines = new THREE.LineSegments(geometry, material);

        Project.nodes_3d[element.uuid] = lines;
        lines.name = element.uuid;
        lines.type = element.type;
        lines.isElement = true;
        lines.visible = element.visibility;

        // No scaling; geometry will be updated on size change
        this.updateTransform(element);
        this.dispatchEvent('setup', { element });
    },

    updateTransform(element) {
        // Base method sets position and rotation from properties
        NodePreviewController.prototype.updateTransform.call(this, element);
        const mesh = element.mesh;

        // Force rotation to zero (AABB cannot rotate)
        mesh.rotation.set(0, 0, 0);

        // Regenerate geometry to match current size
        this.updateGeometry(element);

        this.dispatchEvent('update_transform', { element });
    },

    updateGeometry(element) {
        const vertices = getAABBVertices(element);
        element.mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        this.dispatchEvent('update_geometry', { element });
    },

    updateSelection(element) {
        const mesh = element.mesh;
        const color = element.selected ? gizmo_colors.outline : gizmo_colors.grid;
        mesh.material.color.set(color);
        this.dispatchEvent('update_selection', { element });
    }
});

class AABBAnimator extends AMTTransformAnimator {
    displayFrame(multiplier = 1) {
        if (!this.doRender()) return;

        const element = this.getElement();
        // Restore the normal preview transform first. Besides attaching the mesh,
        // this converts the element's absolute position to an offset from its
        // parent origin, so the parent rotates the AABB centre correctly.
        NodePreviewController.prototype.updateTransform.call(AABB.preview_controller, element);
        const mesh = element.mesh;
        mesh.rotation.set(0, 0, 0);

        if (!this.muted?.position) {
            const offset = vectorFromInterpolation(this.interpolate('position', true), [0, 0, 0]);
            mesh.position.x += offset[0] * multiplier;
            mesh.position.y += offset[1] * multiplier;
            mesh.position.z += offset[2] * multiplier;
        }

        // Cancel inherited orientation only. Position remains local to the
        // parent and therefore still follows its translation and rotation.
        if (mesh.parent) {
            mesh.parent.updateMatrixWorld(true);
            mesh.quaternion.copy(mesh.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
        }
        mesh.updateMatrixWorld(true);
    }
}
AABBAnimator.prototype.type = 'aabb';
AABB.animator = AABBAnimator;

export function registerAABBActions() {
    const displaySettingsListener = Blockbench.on('ii_toolkit_display_settings_changed', () => {
        const elements = OutlinerElement.all.filter(element => element instanceof AABB);
        elements.forEach(element => AABB.preview_controller.updateGeometry(element));
        Canvas.updateView({elements, element_aspects: {geometry: true}});
    });
    deletables.push(displaySettingsListener);

    //Add AABB
    let addAction = new Action('add_aabb', {
        name: 'Add Tactile AABB',
        icon: 'crop_square',
        category: 'edit',
        condition: () => Modes.edit,
        click() {
            Undo.initEdit({ outliner: true, elements: [], selection: true });
            let aabb = new AABB().init();
            let group = getCurrentGroup();
            aabb.addTo(group);

            if (Format.bone_rig && group) {
                let pos = group.origin.slice();
                aabb.extend({ position: pos });
            }

            unselectAll();
            aabb.select();
            Undo.finishEdit('Add AABB', { outliner: true, elements: selected, selection: true });
            Blockbench.dispatchEvent('add_aabb', { object: aabb });
            return aabb;
        }
    });
    let add_element_menu = BarItems.add_element.side_menu;
    add_element_menu.addAction(addAction);
    deletables.push(addAction);

    //Edit properties dialog
    let propsAction = new Action('edit_aabb_properties', {
        name: 'Tactile AABB Properties...',
        icon: 'settings',
        category: 'edit',
        condition: () => AABB.selected.length,
        click() {
            new Dialog('edit_aabb_properties', {
                title: 'Edit Tactile AABB Properties',
                form: {
                    width: {
                        label: 'X Size',
                        value: AABB.selected[0]?.width,
                        type: 'number',
                        min: 0
                    },
                    height: {
                        label: 'Y Size',
                        value: AABB.selected[0]?.height,
                        type: 'number',
                        min: 0
                    },
                    depth: {
                        label: 'Z Size',
                        value: AABB.selected[0]?.depth,
                        type: 'number',
                        min: 0
                    }
                },
                onConfirm(form) {
                    Undo.initEdit({ elements: AABB.selected });
                    AABB.selected.forEach(aabb => {
                        aabb.width = nonNegativeNumber(form.width, aabb.width);
                        aabb.height = nonNegativeNumber(form.height, aabb.height);
                        aabb.depth = nonNegativeNumber(form.depth, aabb.depth);
                        AABB.preview_controller.updateTransform(aabb);
                    });
                    Undo.finishEdit('Change AABB properties');
                }
            }).show();
        }
    });
    deletables.push(propsAction);

    //Make class globally available if needed
    window.AABB = AABB;
}

function nonNegativeNumber(value, fallback = 2) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function getAABBVertices(element) {
    const isAirAABB = element.width === 0 && element.height === 0 && element.depth === 0;
    if (isAirAABB && displayAirAABB()) return FULL_BLOCK_AABB_VERTICES;
    return getBoxLineVertices(element.width, element.height, element.depth);
}

function updateSelectedAABBGeometry() {
    AABB.selected.forEach(aabb => {
        AABB.preview_controller.updateGeometry(aabb);
    });
    Canvas.updateView({ elements: AABB.selected, element_aspects: { transform: true } });
}

export function unregisterAABBActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
}
