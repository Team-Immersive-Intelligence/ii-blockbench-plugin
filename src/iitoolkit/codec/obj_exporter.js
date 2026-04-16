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
    remember: false,
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
    remember: false,
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
    const exportScale = Settings.get('model_export_scale');
    let indexVertex = 0, indexVertexUvs = 0, indexNormals = 0;
    const vertex = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const uv = new THREE.Vector2();

    // Save and reset scene position (as in obj.js)
    const oldScenePos = new THREE.Vector3().copy(scene.position);
    scene.position.set(0, 0, 0);

    // Author and mtl reference
    compiled.push("# " + Settings.get("credit"));
    compiled.push("# Exported with IIToolkit Plugin on " + new Date().toLocaleDateString());
    compiled.push(`mtllib ${Project.name}.mtl\n`);

    Texture.all.forEach(t => {
        textures[t.uuid] = t;
        texture_names[t.uuid] = t.name.replace(/\.png$/i, '').toLowerCase();
    });

    // Traverse the scene
    scene.traverse(mesh => {
        if (mesh instanceof THREE.Mesh) {
            let nbVertex = 0;
            let nbVertexUvs = 0;
            let nbNormals = 0;

            const geometry = mesh.geometry;
            const element = OutlinerNode.uuids[mesh.name];
            const normalMatrixWorld = new THREE.Matrix3();
            normalMatrixWorld.getNormalMatrix(mesh.matrixWorld);

            if (!element || !element.faces || element.export === false || !exportElements.includes(element.name))
                return;

            if (element instanceof Mesh) {
                // Temporary storage for this mesh
                const verticesOut = [];
                const uvsOut = [];
                const normalsOut = [];
                const facesOut = [];

                const smoothVertexNormals = element.shading === 'smooth' ? element.calculateNormals() : null;
                const vertexKeys = [];
                const vertexNormalMap = new Map(); // for smooth: vkey -> normal index

                // ---- 1. Collect vertices and smooth normals ----
                for (let vkey in element.vertices) {
                    const coords = element.vertices[vkey];
                    vertex.set(coords[0], coords[1], coords[2]);
                    vertex.applyMatrix4(mesh.matrixWorld).divideScalar(exportScale);
                    verticesOut.push(`v ${Math.round(vertex.x * 10000) / 10000} ${Math.round(vertex.y * 10000) / 10000} ${Math.round(vertex.z * 10000) / 10000}`);
                    nbVertex++;
                    vertexKeys.push(vkey);

                    if (smoothVertexNormals) {
                        normal.fromArray(smoothVertexNormals[vkey]);
                        normal.applyMatrix3(normalMatrixWorld).normalize();
                        const normStr = `vn ${Math.round(normal.x * 100) / 100} ${Math.round(normal.y * 100) / 100} ${Math.round(normal.z * 100) / 100}`;
                        vertexNormalMap.set(vkey, normalsOut.length); // store index (0-based)
                        normalsOut.push(normStr);
                        nbNormals++;
                    }
                }

                // ---- 2. Collect UVs and (for flat faces) normals, and build face strings ----
                const faceEntries = [];
                for (let key in element.faces) {
                    const face = element.faces[key];
                    if (face.texture !== null && face.vertices.length >= 3) {
                        faceEntries.push(face);
                    }
                }

                let mtlCurrent = null;
                let faceCounter = 0;
                for (let face of faceEntries) {
                    const texture = face.getTexture();
                    const uvSize = [Project.getUVWidth(texture), Project.getUVHeight(texture)];
                    const sortedVerts = face.getSortedVertices();

                    // UVs for this face
                    const faceUVs = [];
                    for (let vkey of sortedVerts) {
                        const u = Math.clamp(face.uv[vkey][0] / uvSize[0], 0, 1);
                        const v = Math.clamp(1 - face.uv[vkey][1] / uvSize[1], 0, 1);
                        const uvStr = `vt ${Math.round(u * 10000) / 10000} ${Math.round(v * 10000) / 10000}`;
                        faceUVs.push(uvStr);
                        uvsOut.push(uvStr);
                        nbVertexUvs++;
                    }

                    // Flat normal if needed (one per face)
                    let flatNormalIndex = -1;
                    if (element.shading === 'flat') {
                        normal.fromArray(face.getNormal(true));
                        normal.applyMatrix3(normalMatrixWorld).normalize();
                        const normStr = `vn ${Math.round(normal.x * 100) / 100} ${Math.round(normal.y * 100) / 100} ${Math.round(normal.z * 100) / 100}`;
                        normalsOut.push(normStr);
                        flatNormalIndex = normalsOut.length - 1;
                        nbNormals++;
                    }

                    const mtlName = texture_names[texture.uuid];
                    if (mtlName !== mtlCurrent) {
                        mtlCurrent = mtlName;
                        facesOut.push(`usemtl ${mtlCurrent}`);
                    }

                    // Build face indices (using the collected UVs and normals)
                    let verts = sortedVerts.slice();
                    if (verts.length === 3) verts.push(verts[0]); // quads expected

                    const triplets = [];
                    for (let vi = 0; vi < verts.length; vi++) {
                        const vkey = verts[vi];
                        const vIdx = vertexKeys.indexOf(vkey) + 1 + indexVertex;
                        const uvIdx = uvsOut.length - verts.length + vi + 1 + indexVertexUvs;
                        let nIdx;
                        if (element.shading === 'smooth') {
                            nIdx = indexNormals + 1 + vertexNormalMap.get(vkey);
                        } else {
                            nIdx = indexNormals + 1 + flatNormalIndex;
                        }
                        triplets.push(`${vIdx}/${uvIdx}/${nIdx}`);
                    }
                    facesOut.push(`f ${triplets.join(' ')}`);
                    faceCounter++;
                }

                // ---- 3. Output in order: o, v, vt, vn, f ----
                compiled.push(`o ${element.name || 'mesh'}`);
                compiled.push(...verticesOut);
                compiled.push(...uvsOut);
                compiled.push(...normalsOut);
                compiled.push(...facesOut);
            }

            // Update global indices
            indexVertex += nbVertex;
            indexVertexUvs += nbVertexUvs;
            indexNormals += nbNormals;
        }
    });

    // Restore scene position
    scene.position.copy(oldScenePos);

    // Return only the OBJ string (as expected by the old codec)
    return compiled.join('\n');
}

function getExportElements(options) {
    const attachment = options && options.attachment;
    const elements = attachment ? attachment.getAllChildren() : Outliner.elements;
    return [...new Set(elements.map(element => element?.name).filter(Boolean))];
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