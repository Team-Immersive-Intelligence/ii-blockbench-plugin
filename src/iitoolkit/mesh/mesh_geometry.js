const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(...a);
const normal = p => cross(sub(p[1], p[0]), sub(p[2], p[0]));
const unit = a => a.map(v => v / length(a));
const edgeKey = (a, b) => JSON.stringify([a, b].sort());
const validPoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

function ordered(face) {
    return (face.getSortedVertices ? face.getSortedVertices() : face.vertices).slice();
}

function metadata(face) {
    const data = face.getSaveCopy ? face.getSaveCopy() : {texture: face.texture};
    return Object.keys(data).filter(key => key !== 'vertices' && key !== 'uv').sort()
        .map(key => [key, data[key]]);
}

function affineUV(points, uv) {
    const e1 = sub(points[1], points[0]), e2 = sub(points[2], points[0]), e3 = sub(points[3], points[0]);
    const a = dot(e1, e1), b = dot(e1, e2), c = dot(e2, e2);
    const denominator = a * c - b * b;
    const u = (dot(e3, e1) * c - dot(e3, e2) * b) / denominator;
    const v = (dot(e3, e2) * a - dot(e3, e1) * b) / denominator;
    return [0, 1].every(axis => Math.abs(uv[3][axis] - (uv[0][axis]
        + u * (uv[1][axis] - uv[0][axis]) + v * (uv[2][axis] - uv[0][axis]))) < 1e-5);
}

// Plan disjoint pairs without touching the mesh. Shared vertex IDs are required:
// unwelded triangles are deliberately not welded as a side effect of Quadify.
export function planQuads(mesh) {
    const edges = new Map();
    const faces = Object.entries(mesh.faces).map(([key, face]) => ({key, face, vertices: ordered(face)}));
    for (const entry of faces) {
        const v = entry.vertices;
        for (let i = 0; i < v.length; i++) {
            const key = edgeKey(v[i], v[(i + 1) % v.length]);
            if (!edges.has(key)) edges.set(key, []);
            edges.get(key).push(entry);
        }
    }
    const candidates = [];
    for (const entries of edges.values()) {
        if (entries.length !== 2) continue;
        const [a, b] = entries;
        if (a.vertices.length !== 3 || b.vertices.length !== 3 || a.face.texture === null || b.face.texture === null) continue;
        const shared = a.vertices.filter(v => b.vertices.includes(v));
        if (shared.length !== 2 || new Set([...a.vertices, ...b.vertices]).size !== 4) continue;
        if (mesh.getSeam?.(shared) === 'divide') continue;
        if (JSON.stringify(metadata(a.face)) !== JSON.stringify(metadata(b.face))) continue;
        if (shared.some(v => !a.face.uv[v] || !b.face.uv[v]
            || a.face.uv[v].some((value, axis) => Math.abs(value - b.face.uv[v][axis]) > 1e-6))) continue;
        const i = a.vertices.findIndex((v, index) => shared.includes(v) && shared.includes(a.vertices[(index + 1) % 3]));
        const s0 = a.vertices[i], s1 = a.vertices[(i + 1) % 3];
        const j = b.vertices.indexOf(s1);
        if (b.vertices[(j + 1) % 3] !== s0) continue; // Opposite edge traversal preserves winding.
        const vertices = [s1, a.vertices[(i + 2) % 3], s0, b.vertices[(j + 2) % 3]];
        const points = vertices.map(v => mesh.vertices[v]);
        if (!points.every(validPoint)) continue;
        const scale = Math.max(...points.map(p => length(sub(p, points[0]))));
        const n1 = normal(a.vertices.map(v => mesh.vertices[v])), n2 = normal(b.vertices.map(v => mesh.vertices[v]));
        if (!scale || length(n1) <= scale * scale * 1e-12 || length(n2) <= scale * scale * 1e-12) continue;
        const n = unit(n1);
        if (dot(n, unit(n2)) < 1 - 1e-8 || Math.abs(dot(sub(points[3], points[0]), n)) > scale * 1e-6) continue;
        if (!points.every((p, k) => dot(cross(sub(points[(k + 1) % 4], p),
            sub(points[(k + 2) % 4], points[(k + 1) % 4])), n) > scale * scale * 1e-12)) continue;
        const uv = {};
        vertices.forEach(v => uv[v] = (a.face.uv[v] || b.face.uv[v] || []).slice());
        if (!vertices.every(v => uv[v].length === 2 && uv[v].every(Number.isFinite))) continue;
        // Prefer rounder quads. Greedy matching is deterministic, not globally optimal.
        const sides = points.map((p, k) => length(sub(points[(k + 1) % 4], p)));
        candidates.push({first: a.key, second: b.key, vertices, uv, shared, normal: n,
            affineUV: affineUV(points, vertices.map(v => uv[v])), quality: Math.min(...sides) / Math.max(...sides)});
    }
    candidates.sort((a, b) => b.quality - a.quality || a.first.localeCompare(b.first) || a.second.localeCompare(b.second));
    const used = new Set();
    return candidates.filter(pair => {
        if (used.has(pair.first) || used.has(pair.second)) return false;
        used.add(pair.first); used.add(pair.second);
        return true;
    });
}

function trianglesOf(mesh) {
    const triangles = [], preserved = new Set();
    for (const [key, face] of Object.entries(mesh.faces)) {
        const v = ordered(face), points = v.map(id => mesh.vertices[id]?.slice());
        if (face.texture === null || v.length < 3 || v.length > 4 || !points.every(validPoint)) {
            preserved.add(key); continue;
        }
        // Blockbench renders sorted quads with the 0--2 diagonal.
        const indices = v.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
        const parts = indices.map(ids => ids.map(i => points[i]));
        if (parts.some(p => length(normal(p)) === 0)) { preserved.add(key); continue; }
        parts.forEach(p => triangles.push({key, p, n: unit(normal(p)),
            min: [0, 1, 2].map(i => Math.min(...p.map(v => v[i]))),
            max: [0, 1, 2].map(i => Math.max(...p.map(v => v[i])))}));
    }
    return {triangles, preserved};
}

function buildBVH(triangles) {
    if (!triangles.length) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    triangles.forEach(t => {
        for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], t.min[i]); max[i] = Math.max(max[i], t.max[i]); }
    });
    if (triangles.length <= 8) return {min, max, triangles};
    const spans = sub(max, min), axis = spans.indexOf(Math.max(...spans));
    triangles.sort((a, b) => (a.min[axis] + a.max[axis]) - (b.min[axis] + b.max[axis]));
    const middle = Math.floor(triangles.length / 2);
    return {min, max, left: buildBVH(triangles.slice(0, middle)), right: buildBVH(triangles.slice(middle))};
}

function hitsBox(origin, direction, node, epsilon) {
    let near = epsilon, far = Infinity;
    for (let i = 0; i < 3; i++) {
        if (Math.abs(direction[i]) < 1e-15) {
            if (origin[i] < node.min[i] - epsilon || origin[i] > node.max[i] + epsilon) return false;
        } else {
            const a = (node.min[i] - epsilon - origin[i]) / direction[i];
            const b = (node.max[i] + epsilon - origin[i]) / direction[i];
            near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
            if (far < near) return false;
        }
    }
    return true;
}

function hitsTriangle(origin, direction, triangle, epsilon) {
    const [a, b, c] = triangle.p, e1 = sub(b, a), e2 = sub(c, a);
    const h = cross(direction, e2), determinant = dot(e1, h);
    if (Math.abs(determinant) < length(e1) * length(e2) * 1e-12) return false;
    const s = sub(origin, a), u = dot(s, h) / determinant;
    if (u < -1e-9 || u > 1 + 1e-9) return false;
    const q = cross(s, e1), v = dot(direction, q) / determinant;
    if (v < -1e-9 || u + v > 1 + 1e-9) return false;
    return dot(e2, q) / determinant > epsilon;
}

function blocked(origin, direction, node, face, epsilon) {
    if (!node || !hitsBox(origin, direction, node, epsilon)) return false;
    if (node.triangles) return node.triangles.some(t => t.key !== face && hitsTriangle(origin, direction, t, epsilon));
    return blocked(origin, direction, node.left, face, epsilon) || blocked(origin, direction, node.right, face, epsilon);
}

function sphereDirections(count) {
    const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const angle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
        const y = 1 - 2 * (i + 0.5) / count, r = Math.sqrt(1 - y * y);
        directions.push([r * Math.cos(i * angle), y, r * Math.sin(i * angle)]);
    }
    return directions;
}

function samplePoints(triangle, density) {
    const weights = [[1 / 3, 1 / 3, 1 / 3]];
    for (let i = 0; i <= density; i++) for (let j = 0; j <= density - i; j++) {
        // Slightly inset edge/vertex samples to avoid shared-edge escape artefacts.
        weights.push([i, j, density - i - j].map(w => (w / density + 0.001) / 1.003));
    }
    return weights.map(w => [0, 1, 2].map(axis => triangle.p.reduce((sum, p, i) => sum + p[axis] * w[i], 0)));
}

// A ray escaping from a surface point is equivalent to an outside ray hitting
// that face first. This avoids a projected grid missing small exterior faces.
// Double-sided opaque occlusion, in mesh space; no camera or scene dependency.
export async function findInnerFaces(mesh, options = {}) {
    const count = Math.max(16, Math.min(1024, Math.round(Number(options.directions) || 128)));
    const density = Math.max(1, Math.min(8, Math.round(Number(options.samples) || 3)));
    const {triangles, preserved} = trianglesOf(mesh);
    const tree = buildBVH(triangles.slice());
    if (!tree) return [];
    const epsilon = Math.max(length(sub(tree.max, tree.min)) * 1e-10, Number.EPSILON * 16);
    const directions = sphereDirections(count), groups = new Map();
    triangles.forEach(t => {
        if (!groups.has(t.key)) groups.set(t.key, []);
        groups.get(t.key).push(t);
    });
    const hidden = [];
    let completed = 0, lastYield = Date.now();
    for (const [key, parts] of groups) {
        if (options.cancelled?.()) return null;
        let visible = false;
        for (const triangle of parts) {
            const rays = [triangle.n, triangle.n.map(v => -v), ...directions];
            for (const point of samplePoints(triangle, density)) {
                if (rays.some(direction => !blocked(point, direction, tree, key, epsilon))) { visible = true; break; }
                if (Date.now() - lastYield > 16) {
                    await new Promise(resolve => setTimeout(resolve, 0)); lastYield = Date.now();
                    if (options.cancelled?.()) return null;
                }
            }
            if (visible) break;
        }
        if (!visible && !preserved.has(key)) hidden.push(key);
        options.progress?.(++completed / groups.size);
        if (Date.now() - lastYield > 16) {
            await new Promise(resolve => setTimeout(resolve, 0)); lastYield = Date.now();
        }
    }
    return options.cancelled?.() ? null : hidden;
}
