/* global Mesh, MeshFace */
import {findInnerFaces, planQuads} from './mesh_geometry';

let actions = [], activeScan = null, generation = 0;

function selectedMesh() {
    return typeof Mesh !== 'undefined' && Mesh.selected.length === 1
        && Outliner.selected.length === 1 ? Mesh.selected[0] : null;
}

function signature(mesh) {
    return JSON.stringify({vertices: mesh.vertices, faces: Object.entries(mesh.faces)
        .map(([key, face]) => [key, face.getSaveCopy(), face.vertices]), seams: mesh.seams});
}

function unchanged(project, mesh, snapshot) {
    return Project === project && selectedMesh() === mesh && Mesh.all.includes(mesh) && signature(mesh) === snapshot;
}

function refresh(mesh) {
    const selection = mesh.getSelectedFaces(true);
    selection.splice(0, selection.length, ...selection.filter(key => mesh.faces[key]));
    const edges = mesh.getSelectedEdges?.(true);
    if (edges) {
        const valid = new Set();
        Object.values(mesh.faces).forEach(face => {
            const vertices = face.getSortedVertices();
            vertices.forEach((v, i) => valid.add(JSON.stringify([v, vertices[(i + 1) % vertices.length]].sort())));
        });
        edges.splice(0, edges.length, ...edges.filter(edge => valid.has(JSON.stringify(edge.slice().sort()))));
    }
    Canvas.updateView({elements: [mesh], element_aspects: {geometry: true, uv: true, faces: true}, selection: true});
}

function error(message) {
    Blockbench.showMessageBox({title: 'IIToolkit Mesh Tools', message, icon: 'error'});
}

export function quadifyMesh(mesh, options = {}) {
    const undo = options.undo !== false, notify = options.notify !== false;
    const plans = planQuads(mesh).map(plan => {
        const face = new MeshFace(mesh, mesh.faces[plan.first]);
        face.extend({vertices: plan.vertices, uv: plan.uv});
        const n = face.getNormal(true);
        if (n.reduce((sum, v, i) => sum + v * plan.normal[i], 0) < 0) face.invert();
        const sorted = face.getSortedVertices();
        // Blockbench may choose another quad diagonal. Only allow that if the
        // UV map is affine, so changing the diagonal cannot alter interpolation.
        if (!plan.affineUV && !(plan.shared.includes(sorted[0]) && plan.shared.includes(sorted[2]))) return null;
        if (!(face.getNormal(true).reduce((sum, v, i) => sum + v * plan.normal[i], 0) > 0.99999)) return null;
        return {plan, face};
    }).filter(Boolean);
    if (!plans.length) { if (notify) Blockbench.showQuickMessage('No compatible triangle pairs found'); return 0; }
    if (undo) Undo.initEdit({elements: [mesh], selection: true});
    const selection = mesh.getSelectedFaces(true);
    plans.forEach(({plan, face}) => {
        const wasSelected = selection.includes(plan.first) || selection.includes(plan.second);
        // Retain the first face ID so external references and selection remain stable.
        mesh.faces[plan.first] = face;
        delete mesh.faces[plan.second];
        if (wasSelected && !selection.includes(plan.first)) selection.push(plan.first);
        mesh.setSeam?.(plan.shared, null);
    });
    if (options.refresh !== false) refresh(mesh);
    if (undo) Undo.finishEdit('Quadify');
    if (notify) Blockbench.showQuickMessage(`Merged ${plans.length * 2} triangles into ${plans.length} quads`);
    return plans.length;
}

async function removeInnerFaces(mesh, settings) {
    const project = Project, snapshot = signature(mesh), runGeneration = generation;
    const scan = {cancelled: false};
    activeScan = scan;
    const progress = new Dialog('ii_inner_faces_progress', {
        title: 'Remove Inner Faces — Checking Visibility', progress_bar: {progress: 0},
        buttons: ['Cancel'], cancel_on_click_outside: false,
        onConfirm() { scan.cancelled = true; }, onCancel() { scan.cancelled = true; }
    });
    progress.show();
    try {
        const hidden = await findInnerFaces(mesh, {...settings,
            cancelled: () => scan.cancelled || Project !== project || !Mesh.all.includes(mesh),
            progress: value => progress.progress_bar?.setProgress?.(value)});
        progress.hide();
        if (!hidden) return;
        if (generation !== runGeneration || !unchanged(project, mesh, snapshot)) { error('The mesh or project changed; no faces were removed.'); return; }
        if (!hidden.length) { Blockbench.showQuickMessage('No inner faces found at this sampling density'); return; }
        Blockbench.showMessageBox({title: 'Remove Inner Faces', icon: 'warning',
            message: `${hidden.length} faces were hidden from every sampled view. Remove them?\n\nThis is an approximation: narrow openings or curved passages can hide legitimate faces. Texture transparency is not considered. Review the result; Undo restores all removed faces. Vertices are kept.`,
            buttons: ['Remove Faces', 'Cancel'], confirm: 0, cancel: 1
        }, result => {
            if (result !== 0 || generation !== runGeneration) return;
            if (!unchanged(project, mesh, snapshot)) { error('The mesh or project changed; no faces were removed.'); return; }
            Undo.initEdit({elements: [mesh], selection: true});
            hidden.forEach(key => delete mesh.faces[key]);
            refresh(mesh);
            Undo.finishEdit('Remove Inner Faces');
            Blockbench.showQuickMessage(`Removed ${hidden.length} inner faces (Undo to restore)`);
        });
    } catch (exception) { error(exception.message); }
    finally {
        progress.hide();
        if (activeScan === scan) activeScan = null;
    }
}

export function registerMeshActions() {
    unregisterMeshActions();
    const registeredGeneration = generation;
    const condition = {modes: ['edit'], features: ['meshes'], method: () => !!selectedMesh() && !activeScan};
    const remove = new Action('ii_remove_inner_faces', {
        name: 'Remove Inner Faces', icon: 'visibility_off', category: 'edit', condition,
        description: 'Remove faces hidden from all sampled outside views of one selected mesh.',
        click() {
            const mesh = selectedMesh();
            if (!mesh || activeScan || generation !== registeredGeneration) return;
            new Dialog('ii_remove_inner_faces_options', {
                title: 'Remove Inner Faces', form: {
                    help: {type: 'info', text: 'Checks the entire selected mesh, ignoring other objects. Higher densities improve coverage but take longer. Faces are treated as opaque and double-sided. Narrow openings can be missed; deletion requires confirmation and supports Undo.'},
                    directions: {label: 'View Directions', type: 'select', value: '128', options: {'64': '64 — Fast', '128': '128 — Standard', '256': '256 — Detailed', '512': '512 — Very Detailed'}},
                    samples: {label: 'Surface Sampling Density', type: 'number', min: 1, max: 8, step: 1, value: 3,
                        description: 'Per-triangle subdivision density; always includes the centre and near-corner samples.'}
                },
                onConfirm(settings) {
                    this.hide();
                    if (generation === registeredGeneration && selectedMesh() === mesh && !activeScan) return removeInnerFaces(mesh, settings);
                }
            }).show();
        }
    });
    const quadify = new Action('ii_quadify', {
        name: 'Quadify', icon: 'crop_square', category: 'edit', condition,
        description: 'Merge compatible coplanar triangle pairs across the entire selected mesh; preserve UV seams and materials.',
        click() { const mesh = selectedMesh(); if (mesh && !activeScan && generation === registeredGeneration) quadifyMesh(mesh); }
    });
    actions = [remove, quadify];
    return actions;
}

export function unregisterMeshActions() {
    generation++;
    if (activeScan) activeScan.cancelled = true;
    actions.forEach(action => action.delete());
    actions = [];
}
