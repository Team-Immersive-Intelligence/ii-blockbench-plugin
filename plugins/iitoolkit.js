/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, { enumerable: true, get: getter });
/******/ 		}
/******/ 	};
/******/
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = function(exports) {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/
/******/ 	// create a fake namespace object
/******/ 	// mode & 1: value is a module id, require it
/******/ 	// mode & 2: merge all properties of value into the ns
/******/ 	// mode & 4: return value when already ns object
/******/ 	// mode & 8|1: behave like require
/******/ 	__webpack_require__.t = function(value, mode) {
/******/ 		if(mode & 1) value = __webpack_require__(value);
/******/ 		if(mode & 8) return value;
/******/ 		if((mode & 4) && typeof value === 'object' && value && value.__esModule) return value;
/******/ 		var ns = Object.create(null);
/******/ 		__webpack_require__.r(ns);
/******/ 		Object.defineProperty(ns, 'default', { enumerable: true, value: value });
/******/ 		if(mode & 2 && typeof value != 'string') for(var key in value) __webpack_require__.d(ns, key, function(key) { return value[key]; }.bind(null, key));
/******/ 		return ns;
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = "./main.js");
/******/ })
/************************************************************************/
/******/ ({

/***/ "./codec/aabb_exporter.js":
/*!********************************!*\
  !*** ./codec/aabb_exporter.js ***!
  \********************************/
/*! exports provided: exportAABB */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "exportAABB", function() { return exportAABB; });
var exportAABB = new Action('export_aabb', {
    name: 'Export AABB',
    description: 'Export Axis-Aligned Bounding Boxes for collision detection',
    icon: 'icon-objects',
    click: function () {
        const form = {};

        form["export_mode"] = {
            label: "Generation Mode", type: "select", options: {
                mode_groups: "Export groups as separate models",
                mode_mixed: "Export group \'main\' and other groups (merged as a single model) separately"
            }
        }

        const dialog = new Dialog({
            id: 'animation_export',
            title: 'Export Stakan',
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

            }
        });
        dialog.show();
    }
});

/***/ }),

/***/ "./codec/amt_animation_exporter.js":
/*!*****************************************!*\
  !*** ./codec/amt_animation_exporter.js ***!
  \*****************************************/
/*! exports provided: lastAnimationState, lastAMTState, exportAnimationAMT */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "lastAnimationState", function() { return lastAnimationState; });
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "lastAMTState", function() { return lastAMTState; });
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "exportAnimationAMT", function() { return exportAnimationAMT; });
var lastAnimationState = true, lastAMTState = true;

var exportAnimationAMT = new Action('export_animation_amt', {
    name: 'Export AMT Animation...',
    description: 'Export a selection of animations as AMT',
    icon: 'movie',
    click: function () {
        const animations = Animation.all.slice()
        let keys = [];
        let form = {};
        let lines = [];
        if (Format.animation_files) {
            animations.sort((a1, a2) => a1.path.hashCode() - a2.path.hashCode())
        }

        //html
        lines.push("<style>pre {\n" +
            "                display: inline;\n" +
            "                margin: 0;\n" +
            "            }</style>");
        lines.push("Select animations to be exported as <pre>.json</pre>  AMT Animation files.<br>");
        lines.push("Select Export AMT to export a <pre>.obj.amt</pre>  metadata file.");
        lines.push("<hr>");

        //form
        form["0_animations"] = {label: "Export Animations", type: 'checkbox', value: lastAnimationState};

        animations.forEach(animation => {
            const key = animation.name;
            keys.push(key);
            form["1_" + key.hashCode()] = {
                label: " " + key + "",
                type: 'checkbox',
                value: lastAnimationState
            };
        })

        form["2_amt"] = {label: "Export AMT Metadata", type: 'checkbox', value: lastAMTState};

        const dialog = new Dialog({
            id: 'animation_export',
            title: 'dialog.animation_export.title',
            form: form, lines: lines,
            onFormChange(form_result) {
                let allowAnimations = form_result["0_animations"];

                //animation toggle
                if (allowAnimations != lastAnimationState) {
                    let newValues = {};
                    animations.forEach(animation => {
                        newValues["1_" + animation.name.hashCode()] = allowAnimations;
                    });
                    //to prevent infinite looping

                    newValues["0_animations"] = lastAnimationState = allowAnimations;
                    newValues["2_amt"] = form_result["2_amt"];

                    dialog.setFormValues(newValues);
                }

            },
            onConfirm(form_result) {

                dialog.hide();
                console.log(form_result);

                keys = keys.filter(key => form_result["1_" + key.hashCode()])

                Animator.animations.forEach(function (animation) {
                    if (keys.includes(animation.name)) {
                        Blockbench.export({
                            resource_id: 'animation',
                            type: 'JSON Animation',
                            extensions: ['json'],
                            name: animation.name,
                            content: autoStringify(compileAnimation(animation)),
                        });

                    }
                })

                lastAMTState = form_result["2_amt"];

                if (form_result["2_amt"])
                    Blockbench.export({
                        resource_id: 'amt',
                        type: 'AMT Data',
                        extensions: ['amt'],
                        name: Project.name + ".obj" + ".amt",
                        content: autoStringify(compileAMT()),
                    });

            }
        })
        dialog.show();
    }
});

function compileAnimation(animation) {
    const amt_file = {};
    const maxlength = animation.getMaxLength();

    const animators = animation.animators;
    const groups = {};

    for (const uuid in animators) {
        const animator = animators[uuid];
        if (animator instanceof BoneAnimator) {
            const keyframes = animator.keyframes;
            if (keyframes.length) {
                const group = animator.getGroup();
                const part = groups[group ? group.name : animator.name] = {};

                /*const origin = group.origin;
                part["origin"] = origin;*/

                const channels = {};
                keyframes.forEach(function (kf) {
                    const channel = kf.channel;
                    if (!channels[channel]) {
                        channels[channel] = {};
                    }
                    if (kf.transform) {
                        let keyframe;
                        const timecodeString = kf.getTimecodeString();

                        let arr = kf.getArray();
                        //rotation Y should be flipped
                        //bad solution for a self-made problem
                        if (channel == 'rotation')
                            arr = [arr[0], -arr[1], arr[2]];

                        keyframe = {
                            time: parseFloat(timecodeString) / maxlength,
                            transform: arr
                        }

                        channels[channel][timecodeString] = keyframe;
                    }
                })
                for (const channel in Animator.possible_channels) {
                    const timecodes = channels[channel];
                    if (timecodes) {
                        Object.keys(timecodes).sort((a, b) => parseFloat(a) - parseFloat(b)).forEach((timecode) => {
                            if (!part[channel]) {
                                part[channel] = [];
                            }
                            part[channel].push(timecodes[timecode]);
                        })
                    }
                }
            }
        }
    }

    amt_file.comment = Settings.get("credit");
    if (Object.keys(groups).length > 0) {
        amt_file.groups = groups;
    }
    return amt_file;
}

/***/ }),

/***/ "./codec/obj_exporter.js":
/*!*******************************!*\
  !*** ./codec/obj_exporter.js ***!
  \*******************************/
/*! exports provided: exportOptions, exportAMTModel, objCodec, mtlCodec */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "exportOptions", function() { return exportOptions; });
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "exportAMTModel", function() { return exportAMTModel; });
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "objCodec", function() { return objCodec; });
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "mtlCodec", function() { return mtlCodec; });
/* harmony import */ var _utils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./../utils */ "./utils.js");
/* harmony import */ var _utils__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_utils__WEBPACK_IMPORTED_MODULE_0__);
//-- Export Dialogue --//


var exportOptions = {
    export_mode: "mode_groups",
    blacklist: false,
    blacklisted_groups: "",
    new_format: "",
    scale: 0.0625,
    offset: [-0.5, 0, -0.5]
};

var exportAMTModel = new Action('export_amt_model', {
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

var objCodec = new Codec("ii_obj", {
    name: "II OBJ",
    extension: "obj.ie",
    remember: false,
    compile(options) {
        return compileModel();
    }
});

var mtlCodec = new Codec("mtl", {
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

/***/ }),

/***/ "./elements/aabb.js":
/*!**************************!*\
  !*** ./elements/aabb.js ***!
  \**************************/
/*! exports provided: AABB, registerAABB */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "AABB", function() { return AABB; });
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "registerAABB", function() { return registerAABB; });
class AABB extends OutlinerElement {
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


function registerAABB() {
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

/***/ }),

/***/ "./elements/amt_text.js":
/*!******************************!*\
  !*** ./elements/amt_text.js ***!
  \******************************/
/*! no static exports found */
/***/ (function(module, exports) {



/***/ }),

/***/ "./main.js":
/*!*****************!*\
  !*** ./main.js ***!
  \*****************/
/*! no exports provided */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _utils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./utils */ "./utils.js");
/* harmony import */ var _utils__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_utils__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _elements_aabb__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./elements/aabb */ "./elements/aabb.js");
/* harmony import */ var _elements_amt_text__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./elements/amt_text */ "./elements/amt_text.js");
/* harmony import */ var _elements_amt_text__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_elements_amt_text__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _codec_aabb_exporter__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./codec/aabb_exporter */ "./codec/aabb_exporter.js");
/* harmony import */ var _codec_obj_exporter__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./codec/obj_exporter */ "./codec/obj_exporter.js");
/* harmony import */ var _codec_amt_animation_exporter__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./codec/amt_animation_exporter */ "./codec/amt_animation_exporter.js");
/* harmony import */ var _misc_actions__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./misc_actions */ "./misc_actions.js");
// import helloWorld from './hello_world'




// import registerWire from './elements/amt_wire'











var iiBarMenu = null;

const plugin = Plugin.register('iitoolkit', {
	title: 'Immersive Intelligence Toolkit',
	author: 'Pabilo8',
	icon: 'icon-format_java',
	description: 'Utility plugin for Immersive Intelligence mod models. https://github.com/Pabilo8/ImmersiveIntelligence',
	about: 'Go to Animation -> Export AMT...',
	tags: ["Minecraft: Java Edition"],
	version: '0.3.0',
	min_version: '4.0.0',
	variant: 'both',
	onload() {
		Object(_elements_aabb__WEBPACK_IMPORTED_MODULE_1__["registerAABB"])();

		iiBarMenu = new BarMenu("iitoolkit", [_misc_actions__WEBPACK_IMPORTED_MODULE_6__["ungroup"], _codec_amt_animation_exporter__WEBPACK_IMPORTED_MODULE_5__["exportAnimationAMT"], _codec_obj_exporter__WEBPACK_IMPORTED_MODULE_4__["exportAMTModel"], _codec_aabb_exporter__WEBPACK_IMPORTED_MODULE_3__["exportAABB"]]);
		MenuBar.addAction(_codec_obj_exporter__WEBPACK_IMPORTED_MODULE_4__["exportAMTModel"], 'file.export.0');
	},
	onunload() {
		_codec_amt_animation_exporter__WEBPACK_IMPORTED_MODULE_5__["exportAnimationAMT"].delete();
		_codec_obj_exporter__WEBPACK_IMPORTED_MODULE_4__["exportAMTModel"].delete();
		_codec_aabb_exporter__WEBPACK_IMPORTED_MODULE_3__["exportAABB"].delete();
		_misc_actions__WEBPACK_IMPORTED_MODULE_6__["ungroup"].delete();
	}
});


/***/ }),

/***/ "./misc_actions.js":
/*!*************************!*\
  !*** ./misc_actions.js ***!
  \*************************/
/*! exports provided: ungroup */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "ungroup", function() { return ungroup; });
var ungroup = new Action('ungroup', {
    name: 'Ungroup',
    description: 'Removes all groups',
    icon: 'fas.fa-fire-extinguisher',
    click: function () {
        while (Project.groups.length > 0)
            Project.groups.forEach(g => g.resolve());
    }
});

/***/ }),

/***/ "./utils.js":
/*!******************!*\
  !*** ./utils.js ***!
  \******************/
/*! no static exports found */
/***/ (function(module, exports) {

//Functions

/**
 *
 * @param {string} file path to the texture file
 * @returns {string} minecraft resource location path of the file
 */
function getResourceLocation(file) {
    //trim
    file = file.substring(0, file.includes(".") ? file.lastIndexOf('.') : file.length);
    file = file.replaceAll("\\", "/");

    //attempt looking for a resource location in path
    if (file.includes("assets") && file.includes("textures")) {
        file = file.substring(file.indexOf("assets") + ("assets/".length));
        let domain = file.substring(0, file.indexOf("/textures"));
        file = file.substring(file.indexOf("/textures") + "/textures/".length, file.length);
        return `${domain}:${file}`;
    }
    //no resource location in path
    if (!file.includes("/"))
        return file;
    return "immersiveintelligence:block" + file.substring(file.lastIndexOf("/"), file.length);
}

function normalizeVector(normal) {
    normal = normal.map(n => parseFloat(n));
    let max = Math.max.apply(null, normal.map(n => Math.abs(n)));
    return normal.map(n => n / max);
}


/***/ })

/******/ });