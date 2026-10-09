/* global Texture, globalThis, requireNativeModule */

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);
let action = null;
let running = false;

function nativeModules() {
    const nativeRequire = typeof requireNativeModule === 'function' ? requireNativeModule
        : (typeof window.require === 'function' ? window.require : null);
    const fs = globalThis.fs || nativeRequire?.('fs', {
        message: 'IIToolkit needs read access to find and relink missing project textures.'
    });
    const path = globalThis.PathModule || nativeRequire?.('path');
    if (!fs || !path) throw new Error('Filesystem access is unavailable. Run Re-Source Textures in Blockbench Desktop and allow filesystem access when prompted.');
    return {fs, path};
}

export function pickerPath(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return pickerPath(value[0]);
    return value && typeof value === 'object'
        ? pickerPath(value.path || value.filePath || value.directory || value.value || value.uri) : '';
}

function basename(value) {
    return String(value || '').replace(/\\/g, '/').split('/').pop();
}

export function textureFileNames(texture) {
    const names = [texture.name, texture.path, texture.relative_path].map(basename).filter(Boolean);
    const oldExtension = (basename(texture.path).match(/\.([^.]+)$/) || [])[1];
    return [...new Set(names.map(name => {
        if (!/\.[^.]+$/.test(name)) name += `.${oldExtension || 'png'}`;
        return name.toLowerCase();
    }))];
}

export function texturePixelSize(texture) {
    // Error textures have a placeholder img/canvas: never use those dimensions.
    const width = Number(texture.width);
    const height = Number(texture.height);
    return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
        ? [width, height] : null;
}

export function isMissingTexture(texture, fs) {
    if (texture.error) return true;
    // A healthy embedded bitmap may retain an obsolete path as provenance.
    if (texture.internal === true || texture.mode === 'bitmap' || String(texture.source || '').startsWith('data:')) return false;
    if (!texture.path) return false;
    try {
        return !fs.statSync(texture.path).isFile();
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return true;
        // Permission failures are not evidence that a texture is missing.
        throw error;
    }
}

export function isReSourceCandidate(texture, fs) {
    // Embedded textures can render correctly but still need an external source.
    // Include legacy bitmaps and data URLs, even when an old path still exists.
    return texture.internal === true || texture.mode === 'bitmap'
        || String(texture.source || '').startsWith('data:') || isMissingTexture(texture, fs);
}

function yieldToEditor() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

export async function scanTextureFiles(root, names, fs, path, stillActive = () => true) {
    if (!fs.statSync(root).isDirectory()) throw new Error('Please select a texture directory.');
    const files = [];
    const unreadable = [];
    const pending = [root];
    let visited = 0;
    while (pending.length) {
        if (!stillActive()) throw new Error('The project changed; no textures were relinked.');
        const directory = pending.pop();
        let entries;
        try {
            entries = fs.readdirSync(directory, {withFileTypes: true});
        } catch (error) {
            unreadable.push(directory);
            continue;
        }
        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            // Do not follow symlinks/junctions, which can form recursive loops.
            if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(entryPath);
            else if (entry.isFile() && names.has(entry.name.toLowerCase())) files.push(entryPath);
            if (++visited % 100 === 0) await yieldToEditor();
        }
    }
    return {files: files.sort(), unreadable};
}

export function pngPixelSize(bytes) {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)
        || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? [width, height] : null;
}

async function imagePixelSize(file, fs) {
    const bytes = fs.readFileSync(file);
    const png = pngPixelSize(bytes);
    if (png) return png;
    const extension = basename(file).split('.').pop().toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) return null;
    return new Promise(resolve => {
        const image = new Image();
        const timer = setTimeout(() => finish(null), 10000);

        function finish(size) {
            clearTimeout(timer);
            image.onload = image.onerror = null;
            resolve(size);
        }

        image.onload = () => finish([image.naturalWidth, image.naturalHeight]);
        image.onerror = () => finish(null);
        image.src = `data:image/${extension === 'jpg' ? 'jpeg' : extension};base64,${bytes.toString('base64')}`;
    });
}

export function matchTextureFiles(texture, candidates) {
    const size = texturePixelSize(texture);
    if (!size) return [];
    const names = new Set(textureFileNames(texture));
    return candidates.filter(candidate => names.has(basename(candidate.path).toLowerCase())
        && candidate.size?.[0] === size[0] && candidate.size?.[1] === size[1]);
}

function projectUnchanged(project, textures) {
    return Project === project && textures.every(texture => Texture.all.includes(texture));
}

export function relinkTexture(texture, path) {
    // Content-only loading avoids fromPath's same-name replacement/merging behaviour.
    // Keep UV settings, resource namespace/folder, IDs, and face assignments intact.
    return new Promise((resolve, reject) => {
        const previousCallback = texture.load_callback;
        const timer = setTimeout(() => finish(new Error(`Texture did not finish loading: ${path}`)), 15000);

        function finish(error) {
            clearTimeout(timer);
            if (texture.load_callback === onLoad) texture.load_callback = previousCallback;
            error ? reject(error) : resolve();
        }

        function onLoad(...args) {
            try {
                previousCallback?.apply(texture, args);
            } finally {
                finish(texture.error ? new Error(`Could not load texture: ${path}`) : null);
            }
        }

        texture.load_callback = onLoad;
        try {
            texture.stopWatcher?.();
            texture.loadContentFromPath(path);
            texture.path = path;
            texture.internal = false;
            delete texture.relative_path;
            texture.saved = true;
            texture.startWatcher?.();
            Blockbench.dispatchEvent('change_texture_path', {texture});
        } catch (error) {
            finish(error);
        }
    });
}

function report(summary) {
    const lines = [
        `Relinked: ${summary.relinked}`,
        `Left unchanged / not re-sourced: ${summary.missing.length}`,
        `Unreadable folders/files: ${summary.unreadable}`
    ];
    if (summary.missing.length) lines.push('', ...summary.missing.map(name =>
        String(name).replace(/[\\`*_<>[\]]/g, '\\$&')));
    Blockbench.showMessageBox({title: 'Re-Source Textures', message: lines.join('\n'), icon: 'image_search'});
}

async function applyMatches(project, textures, matches, unreadable) {
    if (!projectUnchanged(project, textures)) throw new Error('The project changed; no textures were relinked.');
    // Recheck sources immediately before editing: a user may have repaired one meanwhile.
    const {fs} = nativeModules();
    const selected = matches.filter(match => isReSourceCandidate(match.texture, fs));
    const resolved = new Set(matches.filter(match => !selected.includes(match)).map(match => match.texture));
    if (selected.length) {
        const undo = project.undo || Undo;
        undo.initEdit({textures: selected.map(match => match.texture), bitmap: true});
        try {
            await Promise.all(selected.map(async match => {
                try {
                    await relinkTexture(match.texture, match.path);
                    resolved.add(match.texture);
                } catch (error) {
                    unreadable++;
                }
            }));
        } finally {
            undo.finishEdit('Re-Source Textures');
        }
        if (Project === project) Canvas.updateAll?.();
    }
    report({
        relinked: selected.filter(match => resolved.has(match.texture)).length,
        missing: textures.filter(texture => !resolved.has(texture))
            .map(texture => `${texture.name || basename(texture.path)} (${texturePixelSize(texture)?.join(' × ') || 'unknown size'})`),
        unreadable
    });
}

async function findTextureSources() {
    const project = Project;
    const {fs, path} = nativeModules();
    const textures = Texture.all.filter(texture => isReSourceCandidate(texture, fs));
    if (!textures.length) {
        Blockbench.showQuickMessage('No embedded or missing project textures to re-source');
        return;
    }
    const chosen = await Promise.resolve(Blockbench.pickDirectory({
        title: 'Re-Source Textures - Select Search Directory', resource_id: 'ii_re_source_textures'
    }));
    const folder = pickerPath(chosen).replace(/^file:\/\/\/([a-z]:)/i, '$1').replace(/^file:\/\//i, '');
    if (!folder) return;
    if (!projectUnchanged(project, textures)) throw new Error('The project changed; no textures were relinked.');
    Blockbench.showQuickMessage('Searching for sources of embedded and missing textures…');
    const names = new Set(textures.flatMap(textureFileNames));
    const scan = await scanTextureFiles(folder, names, fs, path, () => projectUnchanged(project, textures));
    const candidates = [];
    let unreadable = scan.unreadable.length;
    for (const file of scan.files) {
        if (!projectUnchanged(project, textures)) throw new Error('The project changed; no textures were relinked.');
        try {
            const size = await imagePixelSize(file, fs);
            if (size) candidates.push({path: file, size});
            else unreadable++;
        } catch (error) {
            unreadable++;
        }
        await yieldToEditor();
    }
    if (!projectUnchanged(project, textures)) throw new Error('The project changed; no textures were relinked.');
    const matches = [];
    const ambiguous = [];
    textures.forEach(texture => {
        const found = matchTextureFiles(texture, candidates);
        if (found.length === 1) matches.push({texture, path: found[0].path});
        else if (found.length > 1) ambiguous.push({texture, candidates: found});
    });
    if (!ambiguous.length) {
        await applyMatches(project, textures, matches, unreadable);
        return;
    }
    const form = {
        explanation: {
            type: 'info',
            text: 'Several files have the same name and dimensions. Select a source for each ambiguous texture, or leave it unchanged.'
        }
    };
    ambiguous.forEach((match, index) => {
        const options = {skip: 'Leave unchanged'};
        match.candidates.forEach((candidate, i) => options[`file_${i}`] = path.relative(folder, candidate.path));
        form[`texture_${index}`] = {
            label: `${match.texture.name} (${texturePixelSize(match.texture).join(' × ')})`,
            type: 'select', options, value: 'skip'
        };
    });
    await new Promise(resolve => new Dialog('ii_re_source_texture_matches', {
        title: 'Re-Source Textures - Ambiguous Matches', width: 700, form,
        async onConfirm(result) {
            this.hide();
            ambiguous.forEach((match, index) => {
                const value = result[`texture_${index}`];
                const selected = /^file_\d+$/.test(value) ? match.candidates[Number(value.slice(5))] : null;
                if (selected) matches.push({texture: match.texture, path: selected.path});
            });
            try {
                await applyMatches(project, textures, matches, unreadable);
            } catch (error) {
                showError(error);
            } finally {
                resolve();
            }
        },
        onCancel() {
            resolve();
        }
    }).show());
}

function showError(error) {
    Blockbench.showMessageBox({title: 'Re-Source Textures', message: error.message, icon: 'error'});
}

export function registerReSourceTexturesAction() {
    unregisterReSourceTexturesAction();
    action = new Action('ii_re_source_textures', {
        name: 'Re-Source Textures', icon: 'image_search', category: 'textures',
        description: 'Re-source embedded and missing project textures recursively by filename and pixel dimensions.',
        condition: () => !!Project && !running,
        async click() {
            if (Blockbench.isWeb || typeof Blockbench.pickDirectory !== 'function') {
                showError(new Error('Re-Source Textures requires Blockbench Desktop.'));
                return;
            }
            running = true;
            try {
                await findTextureSources();
            } catch (error) {
                showError(error);
            } finally {
                running = false;
            }
        }
    });
    return action;
}

export function unregisterReSourceTexturesAction() {
    action?.delete();
    action = null;
}
