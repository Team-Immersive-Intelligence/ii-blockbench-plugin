import './GLTFLoader';

//Functions

// ----------------------------------------------------------------------
// Shared GLB preview loading and material normalisation
// ----------------------------------------------------------------------
// Blockbench's bundled GLTFLoader can pass legacy texture/material fields such
// as "format" to MeshStandardMaterial. Three warns about those, and the GLB
// textures commonly arrive as sRGB while our generated preview cuboids use
// LinearEncoding. Keep all IIToolkit GLB previews on the same material path.
const iiGLBModelCache = new Map();

export function installIIGLBMaterialPatch() {
    const materialPrototype = THREE?.Material?.prototype;
    if (!materialPrototype || materialPrototype._iiToolkitGLBFormatPatchInstalled) return;

    const originalSetValues = materialPrototype.setValues;
    if (typeof originalSetValues !== 'function') return;

    materialPrototype.setValues = function(values) {
        if (values && Object.prototype.hasOwnProperty.call(values, 'format')) {
            values = Object.assign({}, values);
            delete values.format;
        }
        return originalSetValues.call(this, values);
    };
    materialPrototype._iiToolkitGLBFormatPatchInstalled = true;
}

export function normalizeIIPreviewTexture(texture, options = {}) {
    if (!texture) return null;

    texture.magFilter = options.magFilter || THREE.NearestFilter;
    texture.minFilter = options.minFilter || THREE.NearestFilter;
    texture.flipY = options.flipY !== undefined ? options.flipY : false;

    if (THREE.LinearEncoding !== undefined) {
        texture.encoding = THREE.LinearEncoding;
    }
    if ('colorSpace' in texture) {
        texture.colorSpace = THREE.LinearSRGBColorSpace || THREE.NoColorSpace || texture.colorSpace;
    }

    texture.needsUpdate = true;
    return texture;
}

export function createIIPreviewMaterial(sourceMaterial = {}, options = {}) {
    const source = sourceMaterial || {};
    if ('format' in source) delete source.format;

    const map = normalizeIIPreviewTexture(
        options.map !== undefined ? options.map : (source.map || source.emissiveMap || null),
        options.texture || {}
    );

    const color = options.color || (source.color?.clone ? source.color.clone() : new THREE.Color(0xffffff));
    const transparent = options.transparent !== undefined
        ? options.transparent
        : !!(source.transparent || (source.opacity !== undefined && source.opacity < 1));
    const opacity = options.opacity !== undefined
        ? options.opacity
        : (source.opacity !== undefined ? source.opacity : 1);

    const material = new THREE.MeshStandardMaterial({
        name: options.name || source.name || 'ii_glb_preview_material',
        map,
        color,
        roughness: 1,
        metalness: 0,
        transparent,
        opacity,
        alphaTest: options.alphaTest !== undefined ? options.alphaTest : (source.alphaTest || 0),
        side: options.side !== undefined ? options.side : (source.side !== undefined ? source.side : THREE.FrontSide),
        vertexColors: THREE.NoColors
    });

    material.aoMap = null;
    material.lightMap = null;
    material.normalMap = null;
    material.bumpMap = null;
    material.displacementMap = null;
    material.roughnessMap = null;
    material.metalnessMap = null;
    material.envMap = null;
    material.emissive = new THREE.Color(0x000000);
    material.emissiveIntensity = 0;
    material.no_export = options.noExport !== false;
    material.needsUpdate = true;
    return material;
}

export function normalizeIIGLBModel(model, options = {}) {
    if (!model) return model;

    model.traverse(node => {
        if (!node.isMesh || !node.material) return;

        node.castShadow = options.castShadow !== false;
        node.receiveShadow = options.receiveShadow !== false;
        node.no_export = options.noExport !== false;

        if (Array.isArray(node.material)) {
            node.material = node.material.map(material => createIIPreviewMaterial(material, options.material || {}));
        } else {
            node.material = createIIPreviewMaterial(node.material, options.material || {});
        }
    });

    return model;
}

export async function loadIIGLBModel(url, options = {}) {
    installIIGLBMaterialPatch();

    const cacheKey = options.cacheKey || url;
    if (!iiGLBModelCache.has(cacheKey)) {
        iiGLBModelCache.set(cacheKey, new Promise((resolve, reject) => {
            new THREE.GLTFLoader().load(
                url,
                gltf => {
                    resolve(normalizeIIGLBModel(gltf.scene, options));
                },
                undefined,
                reject
            );
        }));
    }

    const model = await iiGLBModelCache.get(cacheKey);
    return options.clone === false ? model : model.clone(true);
}



/**
 *
 * @param {string} file path to the texture file
 * @returns {string} minecraft resource location path of the file
 */
export function getResourceLocation(file) {
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
    return "immersiveintelligence:blocks" + file.substring(file.lastIndexOf("/"), file.length);
}

export function normalizeVector(normal) {
    normal = normal.map(n => parseFloat(n));
    let max = Math.max.apply(null, normal.map(n => Math.abs(n)));
    return normal.map(n => n / max);
}

export function getBoxLineVertices(width, height) {
    const w2 = width / 2;
    const h2 = height / 2;
    const corners = [
        [-w2, -h2, -w2], [ w2, -h2, -w2], [ w2, -h2,  w2], [-w2, -h2,  w2],
        [-w2,  h2, -w2], [ w2,  h2, -w2], [ w2,  h2,  w2], [-w2,  h2,  w2]
    ];
    const edges = [
        [0,1], [1,2], [2,3], [3,0], // bottom
        [4,5], [5,6], [6,7], [7,4], // top
        [0,4], [1,5], [2,6], [3,7]  // vertical
    ];
    const vertices = [];
    edges.forEach(edge => {
        vertices.push(...corners[edge[0]], ...corners[edge[1]]);
    });
    return vertices;
}

export function createBlockbenchShaderMaterial(texture) {
    const uniforms = {
        map: { type: 't', value: texture },
        SHADE: { value: true },
        LIGHTCOLOR: { type: 'c', value: new THREE.Color(0xffffff) },
        LIGHTSIDE: { value: 0 },
        EMISSIVE: { value: false },
        clippingPlanes: { value: null }
    };

    const vertexShader = `
        attribute float highlight;
        #include <common>
        #include <clipping_planes_pars_vertex>
        uniform bool SHADE;
        uniform int LIGHTSIDE;
        centorid varying vec2 vUv;
        varying float light;
        varying float lift;
        float AMBIENT = 0.5;
        float XFAC = -0.15;
        float ZFAC = 0.05;
        void main() {
            if (SHADE) {
                vec3 N = normalize(vec3(modelMatrix * vec4(normal, 0.0)));
                if (LIGHTSIDE == 1) {
                    float temp = N.y;
                    N.y = N.z * -1.0;
                    N.z = temp;
                }
                if (LIGHTSIDE == 2) {
                    float temp = N.y;
                    N.y = N.x;
                    N.x = temp;
                }
                if (LIGHTSIDE == 3) {
                    N.y = N.y * -1.0;
                }
                if (LIGHTSIDE == 4) {
                    float temp = N.y;
                    N.y = N.z;
                    N.z = temp;
                }
                if (LIGHTSIDE == 5) {
                    float temp = N.y;
                    N.y = N.x * -1.0;
                    N.x = temp;
                }
                float yLight = (1.0 + N.y) * 0.5;
                light = yLight * (1.0 - AMBIENT) + N.x * N.x * XFAC + N.z * N.z * ZFAC + AMBIENT;
            } else {
                light = 1.0;
            }
            if (highlight == 2.0) {
                lift = 0.22;
            } else if (highlight == 1.0) {
                lift = 0.1;
            } else {
                lift = 0.0;
            }
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            #include <clipping_planes_vertex>
            gl_Position = projectionMatrix * mvPosition;
        }
    `;

    const fragmentShader = `
        #ifdef GL_ES
        precision highp float;
        #endif
        #include <common>
        #include <clipping_planes_pars_fragment>
        uniform sampler2D map;
        uniform bool SHADE;
        uniform bool EMISSIVE;
        uniform vec3 LIGHTCOLOR;
        centorid varying vec2 vUv;
        varying float light;
        varying float lift;
        void main(void) {
            vec4 color = texture2D(map, vUv);
            if (color.a < 0.01) discard;
            if (EMISSIVE == false) {
                vec4 lit_color = vec4(lift + color.rgb * light, color.a);
                gl_FragColor = lit_color;
                gl_FragColor.r = gl_FragColor.r * LIGHTCOLOR.r;
                gl_FragColor.g = gl_FragColor.g * LIGHTCOLOR.g;
                gl_FragColor.b = gl_FragColor.b * LIGHTCOLOR.b;
            } else {
                float light_r = (light * LIGHTCOLOR.r) + (1.0 - light * LIGHTCOLOR.r) * (1.0 - color.a);
                float light_g = (light * LIGHTCOLOR.g) + (1.0 - light * LIGHTCOLOR.g) * (1.0 - color.a);
                float light_b = (light * LIGHTCOLOR.b) + (1.0 - light * LIGHTCOLOR.b) * (1.0 - color.a);
                vec4 lit_color = vec4(lift + color.r * light_r, lift + color.g * light_g, lift + color.b * light_b, 1.0);
                gl_FragColor = lit_color;
            }
            if (lift > 0.2) {
                gl_FragColor.r = gl_FragColor.r * 0.6;
                gl_FragColor.g = gl_FragColor.g * 0.7;
            }
            #include <clipping_planes_fragment>
        }
    `;

    return new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        depthTest: true,
        depthWrite: true,
        side: THREE.DoubleSide
    });
}