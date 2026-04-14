import {getBoxLineVertices} from '../utils';

export class AABB extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);

        //Initialize properties with defaults
        for (let key in AABB.properties) {
            AABB.properties[key].reset(this);
        }
        if (data && typeof data === 'object') {
            this.extend(data);
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
        unique_name: true,
        movable: true,
        rotatable: false,   //AABB cannot be rotated
        scalable: false
    };
}

let deletables = [];


//----- AABB Element Class -----
//Assign prototype properties
AABB.prototype.title = 'AABB';
AABB.prototype.type = 'aabb';
AABB.prototype.icon = 'fas fa-cube';
AABB.prototype.movable = true;
AABB.prototype.rotatable = false;
AABB.prototype.needsUniqueName = true;
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
//No rotation property needed, but we keep it for compatibility? Actually we omit rotation.
new Property(AABB, 'vector2', 'size', {
    default: [2, 2], //width (x and z) and height
    inputs: {
        element_panel: {
            input: { label: 'Size', type: 'vector', dimensions: 2 },
            onChange() {
                Canvas.updateView({ elements: AABB.selected, element_aspects: { transform: true } });
            }
        }
    }
});
new Property(AABB, 'boolean', 'visibility', { default: true });

OutlinerElement.registerType(AABB, 'aabb');

//----- Preview Controller -----
new NodePreviewController(AABB, {
    setup(element) {
        // Create line segments only (no fill)
        const vertices = getBoxLineVertices(element.size[0], element.size[1]);
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
        const vertices = getBoxLineVertices(element.size[0], element.size[1]);
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

export function registerAABBActions() {
    //Add AABB
    let addAction = new Action('add_aabb', {
        name: 'Add AABB',
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
        name: 'AABB Properties...',
        icon: 'settings',
        category: 'edit',
        condition: () => AABB.selected.length,
        click() {
            new Dialog('edit_aabb_properties', {
                title: 'Edit AABB Properties',
                form: {
                    size: {
                        label: 'Size (Width, Height)',
                        value: AABB.selected[0]?.size,
                        type: 'vector',
                        dimensions: 2,
                        min: 0.01
                    }
                },
                onConfirm(form) {
                    Undo.initEdit({ elements: AABB.selected });
                    AABB.selected.forEach(aabb => {
                        aabb.size.replace(form.size);
                        AABB.preview_controller.updateTransform(aabb);
                        AABB.preview_controller.updateGeometry(aabb);
                    });
                    Undo.finishEdit('Change AABB size');
                }
            }).show();
        }
    });
    deletables.push(propsAction);

    //Make class globally available if needed
    window.AABB = AABB;
}

export function unregisterAABBActions() {
    deletables.forEach(action => action.delete());
    deletables.length = 0;
}