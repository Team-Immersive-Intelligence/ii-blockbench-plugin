//-- Export Dialogue --//
import './../utils'

export var exportOptions = {
    export_mode: "mode_groups",
    blacklist: false,
    blacklisted_groups: "",
    new_format: "",
    scale: 0.0625,
    offset: [-0.5, 0, -0.5]
};

export var exportAMTModel = new Action('export_amt_model', {
    name: 'Export AMT Model',
    description: 'Export an AMT Model',
    icon: 'icon-objects',
    click: function () {
        const form = {};

        form["export_mode"] = {
            label: "Generation Mode", type: "select", options: {
                mode_groups: "Export groups as separate models",
                mode_mixed: "Export group \'main\' and other groups (merged as a single model) separately",
                mode_single: "Export all as single model",
                mode_parts: "Export single model with parts as separate objects (instead of groups)"
            }, value: exportOptions.export_mode
        }

        form["offset"] = {label: "Model offset", type: 'vector', value: exportOptions.offset};
        form["scale"] = {label: "Scale", type: 'number', value: exportOptions.scale};

        form["blacklist"] = {label: "Blacklist groups", type: 'checkbox', value: exportOptions.blacklist};
        form["blacklisted_groups"] = {
            label: "Blacklisted",
            type: 'textarea',
            text: exportOptions.blacklisted_groups,
            description: 'Separate group names with comma',
            condition: () => exportOptions.blacklist
        };

        form["new_format"] = {
            label: "Use experimental joint .amt format",
            type: 'checkbox',
            value: exportOptions.new_format
        };
        form["obj_amt"] = {
            label: "Export .obj.amt properties",
            type: 'checkbox',
            value: !exportOptions.new_format,
            readonly: exportOptions.new_format
        };
        form["obj_mtl"] = {
            label: "Export .mtl properties",
            type: 'checkbox',
            value: !exportOptions.new_format,
            readonly: exportOptions.new_format
        };

        const dialog = new Dialog({
            id: 'animation_export',
            title: 'Export AMT Model',
            form,
            onFormChange(form_result) {
                let bList = form_result["blacklist"];
                let nFormat = form_result["new_format"];
                exportOptions.blacklisted_groups = form_result["blacklisted_groups"];

                if (bList != exportOptions.blacklist) {
                    exportOptions.blacklist = bList;
                    dialog.setFormValues(form_result);
                }
                if (nFormat != exportOptions.new_format) {
                    exportOptions.new_format = nFormat;
                    if (nFormat)
                        form_result["obj_amt"] = form_result["obj_mtl"] = false;
                }

            },
            onConfirm(form_result) {
                exportOptions = form_result;
                dialog.hide();

                //Export 3D Geometry
                switch (form_result["export_mode"]) {
                    case "mode_groups":

                        break;
                    case "mode_mixed":

                        break;
                    case "mode_single":
                        objCodec.export();
                        break;
                    case "mode_parts":

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
    name: "II OBJ",
    extension: "obj.ie",
    remember: false,
    compile(options) {
        return compileModel();
    }
});

export var mtlCodec = new Codec("mtl", {
    name: "II MTL",
    extension: "mtl",
    remember: false,
    compile(options) {
        return compileMaterial();
    }
});

function compileModel() {
    let compiled = [], textures = [], texture_names = [];

    compiled.push("# " + Settings.get("credit"));
    compiled.push(`mtllib ${Project.name}.mtl\n`);

    Texture.all.forEach(t => {
        textures[t.uuid] = t;
        texture_names[t.uuid] = t.name.replaceAll(".png", "")
    });

    let vertice_id = 1, face_id = 1;
    for (let element of Outliner.elements) {
        //o -> v -> vt -> vn -> usemtl / f

        compiled.push("o " + element.name);
        if (element instanceof Cube) {

        } else if (element instanceof Mesh) {
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
                    compiled.push(`vt ${uv[0] / width} ${uv[1] / height}`);
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
                if (lastMaterial != face.texture) {
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