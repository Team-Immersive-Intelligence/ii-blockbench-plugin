//Functions

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