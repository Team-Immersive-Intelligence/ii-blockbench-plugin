export class AABB extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid)

        for (var key in AABB.properties) {
            AABB.properties[key].reset(this);
        }
        if (data && typeof data === 'object') {
            this.extend(data)
        }
    }

    get from() {
        return this.origin;
    }

    getWorldCenter() {
        return THREE.fastWorldPosition(this.mesh, Reusable.vec2);
    }

    extend(object) {
        for (var key in AABB.properties) {
            AABB.properties[key].merge(this, object)
        }
        if (typeof object.vertices == 'object') {
            for (let key in object.vertices) {
                this.vertices[key] = object.vertices[key].slice();
            }
        }
        this.sanitizeName();
        return this;
    }

    getUndoCopy() {
        var copy = new AABB(this)
        copy.uuid = this.uuid;
        delete copy.parent;
        return copy;
    }

    getSaveCopy() {
        var el = {}
        for (var key in AABB.properties) {
            AABB.properties[key].copy(this, el)
        }
        el.type = 'aabb';
        el.uuid = this.uuid
        return el;
    }
}


export function registerAABB() {
    AABB.prototype.title = tl('data.aabb');
    AABB.prototype.type = 'aabb';
    AABB.prototype.icon = 'border_outer';
    AABB.prototype.movable = true;
    AABB.prototype.scalable = true;
    AABB.prototype.rotatable = false;
    AABB.prototype.needsUniqueName = false;
    AABB.prototype.menu = new Menu([
        'group_elements',
        '_',
        'copy',
        'paste',
        'duplicate',
        '_',
        'rename',
        'toggle_visibility',
        'delete'
    ]);
    AABB.prototype.buttons = [
        Outliner.buttons.export,
        Outliner.buttons.locked,
        Outliner.buttons.visibility,
    ];

    new Property(AABB, 'string', 'name', {default: 'aabb'})
    new Property(AABB, 'vector', 'origin');
    new Property(AABB, 'vector', 'scale', {default: [16, 16, 16]});
    new Property(AABB, 'boolean', 'visibility', {default: true});
    OutlinerElement.registerType(AABB, 'aabb');

    new NodePreviewController(AABB, {
        setup(element) {

            const geometry = new THREE.BoxGeometry(element.scale[0] * 0.0625, element.scale[1] * 0.0625, element.scale[2] * 0.0625);
            const material = new THREE.MeshLambertMaterial({color: 0xff0000, transparent: true, opacity: 0.25});
            const mesh = new THREE.Mesh(geometry, material);

            Project.nodes_3d[element.uuid] = mesh;
            mesh.name = element.uuid;
            mesh.type = element.type;
            mesh.isElement = true;

            element.preview_controller.updateTransform(element);

            // Update
            this.updateTransform(element);
            mesh.visible = element.visibility;
        },
        updateGeometry(element) {
            let mesh = Project.nodes_3d[element.uuid];
            if (element.parent != 'root') {


                let rot = Project.nodes_3d[element.parent.uuid].rotation.toVector3().multiplyScalar(-1);
                mesh.rotation.setFromVector3(rot);
            } else {
                mesh.rotation.x = 0;
                mesh.rotation.y = 0;
                mesh.rotation.z = 0;
            }


        }
    })

    let add_aabb = new Action('add_aabb', {
        name: 'Add AABB',
        icon: 'border_outer',
        category: 'edit',
        keybind: new Keybind({key: 'n', ctrl: true}),
        condition: () => Modes.edit || Modes.paint,
        click: function () {

            Undo.initEdit({outliner: true, elements: [], selection: true});
            var aabb = new AABB({export: false}).init()
            var group = getCurrentGroup();
            aabb.addTo(group);

            if (Format.bone_rig) {
                if (group) {
                    var pos1 = group.origin.slice()
                    aabb.extend({
                        origin: pos1.slice()
                    })
                }
            }

            if (Group.selected) Group.selected.unselect()
            aabb.select()
            Blockbench.dispatchEvent('add_aabb', {object: aabb})

            return aabb
        }
    });
    Interface.Panels.outliner.menu.addAction(add_aabb, '3')
    MenuBar.menus.edit.addAction(add_aabb, '6')
}