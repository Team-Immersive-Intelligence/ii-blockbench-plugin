import {findInnerFaces} from './mesh_geometry';
import {quadifyMesh} from './mesh_actions';

export const PIPE_INNER_FACE_SETTINGS = Object.freeze({directions: 512, samples: 8});

// Match Blockbench's anchored distance groups (not transitive clustering), then
// place each group at its arithmetic mean. A spatial grid avoids an all-pairs
// search on the separate triangle vertices produced by GLB pipe conversion.
export function mergeVerticesByDistanceInCenter(mesh, distance) {
    if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid vertex merge distance');
    if (!distance) return 0;
    const cells = new Map(), groups = [], mapping = new Map();
    const cellKey = p => p.join(',');
    for (const [key, point] of Object.entries(mesh.vertices)) {
        const cell = point.map(value => Math.floor(value / distance));
        let group = null;
        for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
            for (const candidate of cells.get(cellKey([cell[0] + x, cell[1] + y, cell[2] + z])) || []) {
                if ((!group || candidate.index < group.index)
                    && Math.hypot(...point.map((value, i) => value - candidate.anchor[i])) < distance) group = candidate;
            }
        }
        if (!group) {
            group = {key, index: groups.length, anchor: point.slice(), members: [], sum: [0, 0, 0]};
            groups.push(group);
            const bucket = cellKey(cell);
            if (!cells.has(bucket)) cells.set(bucket, []);
            cells.get(bucket).push(group);
        }
        group.members.push(key);
        point.forEach((value, i) => group.sum[i] += value);
        mapping.set(key, group.key);
    }
    for (const group of groups) {
        if (group.members.length < 2) continue;
        mesh.vertices[group.key] = group.sum.map(value => value / group.members.length);
        group.members.slice(1).forEach(key => delete mesh.vertices[key]);
    }
    const duplicates = new Set();
    for (const [key, face] of Object.entries(mesh.faces)) {
        const original = face.getSortedVertices().slice(), vertices = [], uv = {}, counts = {};
        for (const old of original) {
            const target = mapping.get(old) || old;
            if (!counts[target]) { vertices.push(target); uv[target] = [0, 0]; counts[target] = 0; }
            const source = face.uv[old] || [0, 0];
            uv[target][0] += source[0]; uv[target][1] += source[1]; counts[target]++;
        }
        vertices.forEach(v => uv[v] = uv[v].map(value => value / counts[v]));
        // Pipe conversion produces surface triangles; discard collapsed surfaces.
        if (vertices.length < 3) { delete mesh.faces[key]; continue; }
        face.extend({vertices, uv});
        const polygon = JSON.stringify(vertices.slice().sort());
        // Native distance merging also removes overlapping duplicate polygons.
        if (duplicates.has(polygon)) delete mesh.faces[key]; else duplicates.add(polygon);
    }
    return mapping.size - groups.length;
}

function selectAllMeshFaces(mesh) {
    const faces = mesh.getSelectedFaces(true), vertices = mesh.getSelectedVertices(true);
    faces.splice(0, faces.length, ...Object.keys(mesh.faces));
    vertices.splice(0, vertices.length, ...Object.keys(mesh.vertices));
    const edges = mesh.getSelectedEdges?.(true);
    if (edges) edges.splice(0, edges.length);
}

// The caller owns the conversion's Undo transaction and its progress dialog.
// No standalone action clicks, extra prompts, or nested Undo edits are used.
export async function cleanupConvertedPipeMesh(mesh, options = {}) {
    if (options.cancelled?.()) return null;
    selectAllMeshFaces(mesh);
    const configuredDistance = Number(settings.vertex_merge_distance?.value);
    const distance = options.distance === undefined
        ? (Number.isFinite(configuredDistance) && configuredDistance >= 0 ? configuredDistance : 0.1) : options.distance;
    const merged = mergeVerticesByDistanceInCenter(mesh, distance);
    selectAllMeshFaces(mesh);
    const quads = quadifyMesh(mesh, {undo: false, notify: false, refresh: false});
    const hidden = await findInnerFaces(mesh, {...PIPE_INNER_FACE_SETTINGS,
        cancelled: options.cancelled, progress: options.progress});
    if (!hidden || options.cancelled?.()) return null;
    hidden.forEach(key => delete mesh.faces[key]);
    selectAllMeshFaces(mesh);
    return {merged, quads, removed: hidden.length};
}
