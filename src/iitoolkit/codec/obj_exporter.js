//-- Export Dialogue --//
import {getResourceLocation, normalizeVector} from '../utils'

export var exportOptions = {
    export_mode: "obj",
    obj_amt: true,
    obj_mtl: true,
    scale: 0.0625,
    offset: [-0.5, 0, -0.5]
};

export var exportAMTModel = new Action('export_amt_model', {
    name: 'Export AMT Model',
    description: 'Export an AMT Model',
    icon: 'icon-objects',
    click: function () {
        const form = {};

        form["offset"] = {label: "Model offset", type: 'vector', value: exportOptions.offset};
        form["scale"] = {label: "Scale", type: 'number', value: exportOptions.scale};

        form["export_mode"] = {
            label: "Export Format", type: "select", options: {
                none: "None",
                obj: "Static OBJ Model",
                obj_ie: "Dynamic OBJ Model"
            }, value: exportOptions.export_mode
        }
        form["obj_amt"] = {
            label: "Export .obj.amt properties",
            type: 'checkbox',
            value: exportOptions.obj_amt,
            readonly: exportOptions.obj_amt
        };
        form["obj_mtl"] = {
            label: "Export .mtl properties",
            type: 'checkbox',
            value: exportOptions.obj_mtl,
            readonly: exportOptions.obj_mtl
        };

        const dialog = new Dialog({
            id: 'animation_export',
            title: 'Export AMT Model',
            form,
            onFormChange(form_result) {
                let bList = form_result["blacklist"];
                let nFormat = form_result["new_format"];
                exportOptions.blacklisted_groups = form_result["blacklisted_groups"];
            },
            onConfirm(form_result) {
                exportOptions = form_result;
                dialog.hide();

                console.log("Exporting II model in mode " + form_result["export_mode"] + "...");
                //Export 3D Geometry
                switch (form_result["export_mode"]) {
                    case "none":
                        break
                    case "obj":
                        objCodec.export();
                        break;
                    case "obj_ie":
                        objIECodec.export();
                        break;
                }

                //Export Materials
                if (form_result["obj_mtl"])
                    mtlCodec.export();

                //Export Hierarchy for Animations
                if (form_result["obj_amt"])
                    Blockbench.export({
                        resource_id: 'amt',
                        type: 'AMT Data',
                        extensions: ['amt'],
                        name: Project.name + ".obj" + ".amt",
                        content: autoStringify(compileAMT()),
                    });
            }
        });
        dialog.show();
    }
});

export var exportOBJStaticAction = new Action("export_obj_static", {
    name: "Export Static OBJ",
    description: "Export a static OBJ model using II Toolkit",
    icon: "icon-gltf",
    category: "file",
    condition: {
        modes: ['edit'],
        method: () => Format?.meshes,
    },
    click: function () {
        objCodec.export();
    }
});

export var exportOBJDynamicAction = new Action("export_obj_dynamic", {
    name: "Export Dynamic OBJ",
    description: "Export a dynamic OBJ model using II Toolkit",
    icon: "icon-gltf",
    category: "file",
    condition: {
        modes: ['edit'],
        method: () => Format?.meshes,
    },
    click: function () {
        objIECodec.export();
    }
});

//-- Dirty Work --//

function compileAMT() {
    const amt_file = {};

    const pos = {};
    const hierarchy = {};

    Project.groups.forEach(
        function (p) {
            pos[p.name] = p.origin;
            if (typeof p.parent == "object")
                hierarchy[p.name] = p.parent.name;
        }
    )

    Project.elements.forEach(
        function (p) {
            if (p instanceof Locator) {
                pos[p.name] = p.origin;
                if (typeof p.parent == "object")
                    hierarchy[p.name] = p.parent.name;
            }
        }
    )

    amt_file.origins = pos;
    amt_file.hierarchy = hierarchy;
    return amt_file;
}

export var objCodec = new Codec("ii_obj", {
    name: "II Static OBJ",
    support_partial_export: true,
    extension: "obj",
    remember: true,
    export_action: exportOBJStaticAction,

    compile(options) {
        return compileModel(options);
    },

    async exportCollection(collection) {
        this.context = collection;
        try {
            await this.export({attachment: collection});
            if ("saved" in collection) collection.saved = true;
        } finally {
            this.context = null;
        }
    },

    async writeCollection(collection) {
        this.context = collection;
        try {
            this.write(this.compile({attachment: collection}), collection.export_path);
            if ("saved" in collection) collection.saved = true;
        } finally {
            this.context = null;
        }
    }
});

export var objIECodec = new Codec("ii_obj_ie", {
    name: "II Dynamic OBJ",
    support_partial_export: true,
    extension: "obj.ie",
    remember: true,
    export_action: exportOBJDynamicAction,

    compile(options) {
        return compileModel(options);
    },

    async exportCollection(collection) {
        this.context = collection;
        try {
            await this.export({attachment: collection});
            if ("saved" in collection)
                collection.saved = true;
        } finally {
            this.context = null;
        }
    },

    async writeCollection(collection) {
        this.context = collection;
        try {
            const exportPath = String(collection.export_path ?? "").replace(/(\.obj\.ie|\.obj|\.ie)+$/i, "") + ".obj.ie";
            this.write(this.compile({attachment: collection}), exportPath);
            collection.export_path = exportPath;
            if ("saved" in collection)
                collection.saved = true;
        } finally {
            this.context = null;
        }
    }
});

export var mtlCodec = new Codec("mtl", {
    name: "II MTL",
    extension: "mtl",
    remember: false,

    compile(options) {
        return compileMaterial(options);
    }
});

function compileModel(options) {
    let compiled = [], textures = [], texture_names = [];
    let exportElements = getExportElements(options);

    compiled.push("# " + Settings.get("credit"));
    compiled.push(`mtllib ${Project.name}.mtl\n`);

    Texture.all.forEach(t => {
        textures[t.uuid] = t;
        texture_names[t.uuid] = t.name.replaceAll(".png", "")
    });

    let vertice_id = 1, face_id = 1;
    for (let element of exportElements) {
        //o -> v -> vt -> vn -> usemtl / f

        if (element instanceof Cube) {
            compiled.push("o " + element.name);

        } else if (element instanceof Mesh) {
            compiled.push("o " + element.name);
            let verticesMap = Object.keys(element.vertices);
            let verticesList = element.vertice_list;
            let facesList = [];
            element.forAllFaces(f => facesList.push(f));

            for (let vert of verticesList) {
                //Apply scale and offset to the vertex
                let correctedVert = [
                    parseFloat(vert[0] * exportOptions.scale + exportOptions.offset[0]),
                    parseFloat(vert[1] * exportOptions.scale + exportOptions.offset[1]),
                    parseFloat(vert[2] * exportOptions.scale + exportOptions.offset[2])
                ]
                //v vx vy vz
                compiled.push(`v ${correctedVert[0]} ${correctedVert[1]} ${correctedVert[2]}`)
            }

            //vt
            for (let face of facesList) {
                let width = parseFloat(textures[face.texture].width),
                    height = parseFloat(textures[face.texture].height);

                for (let vert of face.getSortedVertices()) {
                    let uv = face.uv[vert].map(n => parseFloat(n));
                    compiled.push(`vt ${Math.clamp(uv[0] / width, 0, 1)} ${Math.clamp(uv[1] / height, 0, 1)}`);
                }
            }

            //vn
            for (let face of facesList) {
                //Apply scale and offset to the vertex
                let norm = normalizeVector(face.getNormal());
                compiled.push(`vn ${norm[0]} ${norm[1]} ${norm[2]}`)
            }

            let lastMaterial = null;
            for (let face of facesList) {
                if (lastMaterial !== face.texture) {
                    lastMaterial = face.texture;
                    compiled.push("usemtl " + texture_names[face.texture]);
                }
                let faceVertices = (face.getSortedVertices()).map(f => verticesMap.indexOf(f) + vertice_id),
                    verticeString = "";

                verticeString += `${faceVertices[3]}/${faceVertices[0]}/${face_id} `;
                verticeString += `${faceVertices[0]}/${faceVertices[1]}/${face_id} `;
                verticeString += `${faceVertices[1]}/${faceVertices[2]}/${face_id} `;
                verticeString += `${faceVertices[2]}/${faceVertices[3]}/${face_id}`;

                compiled.push("f " + verticeString);
                face_id++;
            }

            vertice_id += verticesList.length;
        }
    }

    return compiled.join("\n");
}

function getExportElements(options) {
    let attachment = options && options.attachment;
    if (!attachment)
        return Outliner.elements;
    return options.attachment.getAllChildren();
}

function compileMaterial() {
    let compiled = [];
    compiled.push("# " + Settings.get("credit"));
    compiled.push("");

    for (let texture of Texture.all) {
        let name = (String)(texture.name).replace(".png", "").toLowerCase();
        compiled.push("newmtl " + name);
        compiled.push("map_Kd " + getResourceLocation(texture.path.toLowerCase()));
    }

    return compiled.join("\n");
}