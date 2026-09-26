/* global THREE, OutlinerElement, Menu, MenuSeparator, ModelProject, Panel, Panels, Property, NodePreviewController, getCurrentGroup, unselectAll, selected, KeyframeDataPoint, globalThis, requireNativeModule */
/* eslint-disable no-console */
import {
    AMTTransformAnimator,
    createPreviewObject3D,
    makeChildlessCopy,
    makeSaveCopy,
    mergeElementProperties,
    resetElementProperties,
    setPreviewVisibility,
    updatePreviewTransform
} from './common';
import {normalizeIIPreviewTexture} from '../utils';
import {particleResourceFolder, setParticleResourceFolder} from '../settings/display_settings';

const DEFAULT_DEFINITION = Object.freeze({
    type: 'ParticleVanilla',
    size: 1,
    scale: 1,
    max_lifetime: 20,
    color: 'FFFFFFFF',
    color_secondary: 'FFFFFFFF',
    stretch: [0, 0, 0],
    textures: [],
    programs: [],
    draw_stage: 'custom'
});
const PARTICLE_LIFETIME_PROPERTY = 'ii_particle_lifetime';
const PARTICLE_CACHE_PROJECT_PROPERTY = 'ii_particle_cache';
const MAX_PARTICLE_FILES = 2500;
const PARTICLE_TIMELINE_SNAPPING = 120;
const MINECRAFT_TEXTURE_TICK_MS = 50;
const ANIMATED_TEXTURE_UPDATE_MS = 1000 / 60;

let deletables = [];
let addAction;
let loadAction;
let propertiesAction;
export let setParticleFolderAction;
let particleLifetimeKeyframeProperty = null;
const textureCache = new Map();
const animatedParticleTextures = new Set();
const editorParticleCache = new Map();
let particleFolderIndex = null;
let particleFolderIndexRoot = '';
let particleIdChangeTimer = null;
let particleCacheSyncTimer = null;
let particlePanelStyle = null;
let particleEntryMenu = null;
let animatedParticleTextureTimer = null;
let nativeFilesystem = null;
let nativePathModule = null;
let nativeFilesystemError = null;
let nativeFilesystemRequestAttempted = false;

const RESERVED_AMT_PROPERTIES = new Set(['particle', 'correct_rotation', 'property']);

function desktopRequire() {
    const legacyRequire = typeof window !== 'undefined' && typeof window.require === 'function'
        ? window.require : null;
    return typeof requireNativeModule === 'function' ? requireNativeModule : legacyRequire;
}

function desktopPathModule() {
    if (!nativePathModule) {
        nativePathModule = globalThis.PathModule || null;
        const nativeRequire = desktopRequire();
        if (!nativePathModule && nativeRequire) {
            try {
                nativePathModule = nativeRequire('path');
            } catch (ignored) {
                nativePathModule = null;
            }
        }
    }
    return nativePathModule;
}

function desktopModules() {
    const nativeRequire = desktopRequire();
    if (!nativeFilesystem && !nativeFilesystemRequestAttempted) {
        nativeFilesystemRequestAttempted = true;
        nativeFilesystem = globalThis.fs || null;
        if (!nativeFilesystem && nativeRequire) {
            try {
                nativeFilesystem = nativeRequire('fs', {
                    message: 'IIToolkit needs read access to load AMT particle definitions, textures, and OBJ models.'
                });
                nativeFilesystemError = null;
            } catch (error) {
                nativeFilesystemError = error;
                nativeFilesystem = null;
            }
        }
    }
    return {fs: nativeFilesystem, path: desktopPathModule(), error: nativeFilesystemError};
}

function retryNativeFilesystemAccess() {
    if (nativeFilesystem) return;
    nativeFilesystemRequestAttempted = false;
    nativeFilesystemError = null;
}

function filesystemUnavailableError(error) {
    const detail = error?.message ? `\n${error.message}` : '';
    if (Blockbench.isWeb)
        return new Error('AMT particle folders require Blockbench Desktop.');
    return new Error('Blockbench did not grant IIToolkit filesystem access. '
        + 'Run Set AMT Particle Folder again and allow the native filesystem permission when prompted.' + detail);
}

function normalisePath(value) {
    return String(value || '').replace(/\\/g, '/');
}

function pathFromPickerResult(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return pathFromPickerResult(value[0]);
    if (typeof value === 'object')
        return pathFromPickerResult(value.path || value.filePath || value.directory || value.value || value.uri);
    return '';
}

function nativePath(value) {
    const path = desktopPathModule();
    const source = pathFromPickerResult(value)
        .replace(/^file:\/\/\/([a-z]:)/i, '$1')
        .replace(/^file:\/\//i, '');
    if (!source) return '';
    if (!path) return source;
    return path.normalize(source.replace(/^file:\/\//i, ''));
}

function stripParticleExtension(value) {
    return String(value || '').replace(/\.fx\.amt$/i, '').replace(/^\/+|\/+$/g, '');
}

function fileNameFromPath(value) {
    const path = normalisePath(value);
    return path.substring(path.lastIndexOf('/') + 1);
}

function readTextFile(path) {
    const {fs} = desktopModules();
    if (!fs || !path) return '';
    try {
        return fs.readFileSync(path, 'utf8');
    } catch (ignored) {
        return '';
    }
}

function particleAssetContext(sourcePath, fallbackName = '') {
    const path = normalisePath(sourcePath);
    // Prefer the canonical resource-pack layout, but also accept a namespace
    // folder copied out of a pack (e.g. <folder>/<modid>/particles/...).
    const match = path.match(/^(.*\/assets)\/([^/]+)\/particles\/(.+)\.fx\.amt$/i)
        || path.match(/^(.*)\/([^/]+)\/particles\/(.+)\.fx\.amt$/i);
    if (match) {
        return {
            assetsRoot: match[1],
            namespace: match[2],
            particleId: stripParticleExtension(match[3])
        };
    }
    return {
        assetsRoot: '',
        namespace: 'immersiveintelligence',
        particleId: stripParticleExtension(fallbackName || fileNameFromPath(path))
    };
}

function splitResourceLocation(value, fallbackNamespace) {
    const resource = String(value || '').trim();
    const separator = resource.indexOf(':');
    return separator === -1
        ? [fallbackNamespace || 'immersiveintelligence', resource]
        : [resource.substring(0, separator), resource.substring(separator + 1)];
}

function particleDefinitionPath(context, particleId) {
    const {path} = desktopModules();
    if (!path || !context.assetsRoot) return '';
    const [namespace, resource] = splitResourceLocation(particleId, context.namespace);
    return path.join(context.assetsRoot, namespace, 'particles', `${stripParticleExtension(resource)}.fx.amt`);
}

function mergeParticleDefinitions(parent, child) {
    const merged = Object.assign({}, parent || {}, child || {});
    const programs = [...(Array.isArray(parent?.programs) ? parent.programs : []),
        ...(Array.isArray(child?.programs) ? child.programs : [])];
    merged.programs = [...new Set(programs.filter(program => typeof program === 'string'))];
    return merged;
}

function loadParticleDefinitionFromPath(sourcePath, seen = new Set()) {
    const normalised = normalisePath(sourcePath);
    if (!normalised || seen.has(normalised)) throw new Error('Particle parent definitions contain a cycle.');
    seen.add(normalised);
    const contents = readTextFile(sourcePath);
    if (!contents) throw new Error(`Could not read particle definition: ${fileNameFromPath(sourcePath)}`);

    let definition;
    try {
        definition = JSON.parse(contents);
    } catch (error) {
        throw new Error(`Invalid particle JSON in ${fileNameFromPath(sourcePath)}: ${error.message}`);
    }
    const context = particleAssetContext(sourcePath);
    if (typeof definition.parent === 'string' && definition.parent.trim()) {
        const parentPath = particleDefinitionPath(context, definition.parent);
        if (parentPath) definition = mergeParticleDefinitions(loadParticleDefinitionFromPath(parentPath, seen), definition);
    }
    return {definition, context};
}

export function normaliseParticleDefinition(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const definition = Object.assign({}, DEFAULT_DEFINITION, source);
    definition.type = String(definition.type || DEFAULT_DEFINITION.type);
    definition.size = Number.isFinite(Number(definition.size)) ? Number(definition.size) : 1;
    definition.scale = Number.isFinite(Number(definition.scale)) ? Number(definition.scale) : 1;
    definition.max_lifetime = Math.max(1, Math.trunc(Number(definition.max_lifetime) || 20));
    definition.stretch = [0, 1, 2].map(index => Number(definition.stretch?.[index]) || 0);
    definition.textures = Array.isArray(definition.textures)
        ? definition.textures.filter(texture => typeof texture === 'string') : [];
    definition.programs = Array.isArray(definition.programs)
        ? definition.programs.filter(program => typeof program === 'string') : [];
    definition.draw_stage = String(definition.draw_stage || 'custom').toLowerCase();
    return definition;
}

function normaliseParticleProperties(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    Object.entries(value).forEach(([key, propertyValue]) => {
        const name = String(key || '').trim().toLowerCase();
        if (!name || RESERVED_AMT_PROPERTIES.has(name) || propertyValue === undefined) return;
        result[name] = propertyValue;
    });
    return result;
}

function effectiveParticleDefinition(element) {
    return normaliseParticleDefinition(Object.assign({}, element.particleData || {},
        normaliseParticleProperties(element.particleProperties)));
}

function canonicalResourceLocation(value, fallbackNamespace = 'immersiveintelligence') {
    const [namespace, resource] = splitResourceLocation(stripParticleExtension(value), fallbackNamespace);
    return `${String(namespace || fallbackNamespace).toLowerCase()}:${String(resource || '').replace(/^\/+/, '')}`;
}

function particleCacheKey(elementOrId, fallbackNamespace = 'immersiveintelligence') {
    if (elementOrId && typeof elementOrId === 'object')
        return canonicalResourceLocation(elementOrId.particleId, elementOrId.particleNamespace || fallbackNamespace);
    return canonicalResourceLocation(elementOrId, fallbackNamespace);
}

function getProjectParticleCache() {
    if (!Project) return {};
    const value = Project[PARTICLE_CACHE_PROJECT_PROPERTY];
    if (!value || typeof value !== 'object' || Array.isArray(value))
        Project[PARTICLE_CACHE_PROJECT_PROPERTY] = {};
    return Project[PARTICLE_CACHE_PROJECT_PROPERTY];
}

function projectParticleEntry(elementOrId, fallbackNamespace) {
    const cache = getProjectParticleCache();
    return cache[particleCacheKey(elementOrId, fallbackNamespace)] || null;
}

function editorParticleEntry(elementOrId, fallbackNamespace) {
    const key = particleCacheKey(elementOrId, fallbackNamespace);
    const bare = key.substring(key.indexOf(':') + 1);
    const rawId = elementOrId && typeof elementOrId === 'object'
        ? String(elementOrId.particleId || '') : String(elementOrId || '');
    return editorParticleCache.get(key) || (!rawId.includes(':') ? editorParticleCache.get(bare) : null) || null;
}

function usedParticleElements() {
    return Array.isArray(OutlinerElement.all)
        ? OutlinerElement.all.filter(element => element instanceof AMTParticle && String(element.particleId || '').trim())
        : [];
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function floorMod(value, divisor) {
    return divisor ? ((Math.trunc(value) % divisor) + divisor) % divisor : 0;
}

function parseColour(value, fallback = 'FFFFFFFF') {
    let hex = String(value || fallback).trim().replace(/^#|^0x/i, '');
    if (/^[0-9a-f]{6}$/i.test(hex)) hex = `FF${hex}`;
    if (!/^[0-9a-f]{8}$/i.test(hex)) return parseColour(fallback, 'FFFFFFFF');
    return {
        a: parseInt(hex.substring(0, 2), 16) / 255,
        r: parseInt(hex.substring(2, 4), 16) / 255,
        g: parseInt(hex.substring(4, 6), 16) / 255,
        b: parseInt(hex.substring(6, 8), 16) / 255
    };
}

function mixColour(first, second, amount) {
    const t = clamp01(amount);
    return {
        r: first.r + (second.r - first.r) * t,
        g: first.g + (second.g - first.g) * t,
        b: first.b + (second.b - first.b) * t,
        a: first.a + (second.a - first.a) * t
    };
}

export function parseParticleProgram(value) {
    const source = String(value || '').trim();
    const match = source.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\((.*)\))?$/);
    if (!match) return {name: source, args: []};
    return {
        name: match[1],
        args: match[2] === undefined ? [] : match[2].split(',').map(argument => argument.trim())
    };
}

export function evaluateParticleState(value, progress) {
    const definition = normaliseParticleDefinition(value);
    const state = {
        progress: clamp01(progress),
        size: definition.size,
        scale: definition.scale,
        maxLifetime: definition.max_lifetime,
        color: parseColour(definition.color),
        secondary: parseColour(definition.color_secondary),
        stretch: definition.stretch.slice(),
        textureShift: Math.trunc(Number(definition.texture_shift) || 0),
        rotationYaw: Number(definition.rotation?.[0]) || 0,
        rotationPitch: Number(definition.rotation?.[1]) || 0,
        retextures: {},
        ignoredPrograms: []
    };
    if (definition.red !== undefined) state.color.r = clamp01(definition.red);
    if (definition.green !== undefined) state.color.g = clamp01(definition.green);
    if (definition.blue !== undefined) state.color.b = clamp01(definition.blue);
    if (definition.alpha !== undefined) state.color.a = clamp01(definition.alpha);

    definition.programs.map(parseParticleProgram).forEach(program => {
        const p = state.progress;
        switch (program.name) {
            case 'dust_transition':
                state.scale = 1 + p * 0.5;
                state.color.a = 1 - p;
                break;
            case 'smoke_transition': {
                state.scale = 1 + p;
                let alpha;
                if (p < 0.2) alpha = p / 0.2 * 0.75;
                else if (p < 0.7) alpha = 0.75 - 0.5 * ((p - 0.2) / 0.5);
                else alpha = 0.25 * (1 - (p - 0.7) / 0.3);
                const suppliedAlpha = Number(program.args[0]);
                state.color.a = alpha * (Number.isFinite(suppliedAlpha) ? suppliedAlpha : 1);
                break;
            }
            case 'shockwave_transition':
                state.scale = 1 + p * 2;
                state.color.a = 1 - p;
                break;
            case 'color_transition': {
                const colours = program.args.map(argument => parseColour(argument)).filter(Boolean);
                if (colours.length >= 2) {
                    const scaled = p * (colours.length - 1);
                    const segment = Math.min(colours.length - 2, Math.floor(scaled));
                    const mixed = mixColour(colours[segment], colours[segment + 1], scaled - segment);
                    state.color.r = mixed.r;
                    state.color.g = mixed.g;
                    state.color.b = mixed.b;
                }
                break;
            }
            case 'lifetime_retexture':
                state.textureShift = definition.textures.length
                    ? Math.min(definition.textures.length - 1, Math.floor(p * definition.textures.length))
                    : 0;
                break;
            case 'retexture': {
                const index = Math.trunc(Number(program.args[0]));
                if (Number.isInteger(index) && program.args[1]) state.retextures[index] = program.args[1];
                break;
            }
            case 'set_rotation':
                state.rotationYaw = Number(program.args[0]) || 0;
                state.rotationPitch = Number(program.args[1]) || 0;
                break;
            case 'rotation': {
                const ticks = p * state.maxLifetime;
                state.rotationYaw += (Number(program.args[0]) || 0) * ticks;
                state.rotationPitch += (Number(program.args[1]) || 0) * ticks;
                break;
            }
            case 'gravity':
            case 'emitter':
            case 'grass_color':
            case 'foliage_color':
            case 'block_color':
            case 'fluid_color':
                state.ignoredPrograms.push(program.name);
                break;
            default:
                if (program.name) state.ignoredPrograms.push(program.name);
        }
    });
    return state;
}

function disposePreviewObject(object) {
    object?.traverse?.(child => {
        if (child.geometry?.userData?.iiOwnedGeometry) child.geometry.dispose?.();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.filter(Boolean).forEach(material => {
            if (material.userData?.iiOwnedMaterial) material.dispose?.();
        });
    });
}

function clearChildren(object) {
    if (!object) return;
    while (object.children.length) {
        const child = object.children[object.children.length - 1];
        object.remove(child);
        disposePreviewObject(child);
    }
}

function ownedGeometry(geometry) {
    geometry.userData = Object.assign({}, geometry.userData, {iiOwnedGeometry: true});
    return geometry;
}

function particleMaterial(options = {}) {
    const material = new THREE.MeshBasicMaterial({
        color: options.color || 0xffffff,
        map: options.map || null,
        transparent: true,
        opacity: options.opacity === undefined ? 1 : options.opacity,
        alphaTest: options.alphaTest === undefined ? 0.01 : options.alphaTest,
        side: THREE.DoubleSide,
        depthWrite: options.depthWrite !== false,
        vertexColors: options.vertexColors === true
    });
    material.blending = options.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.no_export = true;
    material.userData = {iiOwnedMaterial: true};
    return material;
}

function particleVertexMaterial(additive) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            particleMap: {value: null},
            hasParticleMap: {value: false}
        },
        vertexShader: [
            'attribute vec4 iiParticleColor;',
            'varying vec2 iiParticleUv;',
            'varying vec4 iiParticleTint;',
            'void main() {',
            '  iiParticleUv = uv;',
            '  iiParticleTint = iiParticleColor;',
            '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
            '}'
        ].join('\n'),
        fragmentShader: [
            'uniform sampler2D particleMap;',
            'uniform bool hasParticleMap;',
            'varying vec2 iiParticleUv;',
            'varying vec4 iiParticleTint;',
            'void main() {',
            '  vec4 texel = hasParticleMap ? texture2D(particleMap, iiParticleUv) : vec4(1.0);',
            '  gl_FragColor = texel * iiParticleTint;',
            '  if (gl_FragColor.a < 0.01) discard;',
            '}'
        ].join('\n'),
        transparent: true,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    material.no_export = true;
    material.userData = {iiOwnedMaterial: true};
    return material;
}

function applyMaterialState(material, state) {
    if (!material) return;
    material.color.setRGB(state.color.r, state.color.g, state.color.b);
    material.opacity = clamp01(state.color.a);
    material.transparent = material.opacity < 1 || !!material.map || material.blending === THREE.AdditiveBlending;
    material.needsUpdate = true;
}

function particleContextFromElement(element) {
    return {
        assetsRoot: element.particleAssetsRoot || '',
        namespace: element.particleNamespace || 'immersiveintelligence',
        particleId: element.particleId || ''
    };
}

function resolveAssetPathFromContext(context, resourceLocation, category, extension) {
    const {fs, path} = desktopModules();
    if (!path || !resourceLocation) return '';
    const [namespace, resource] = splitResourceLocation(resourceLocation, context.namespace);
    const withoutExtension = String(resource).replace(new RegExp(`\\.${extension}$`, 'i'), '');
    const roots = [context.assetsRoot, ...particleAssetRoots()].filter(Boolean);
    const candidates = [...new Set(roots)].map(root =>
        path.join(root, namespace, category, `${withoutExtension}.${extension}`));
    return candidates.find(candidate => {
        try {
            return fs?.isFile ? fs.isFile(candidate) : fs?.statSync(candidate).isFile();
        } catch (ignored) {
            return false;
        }
    }) || candidates[0] || '';
}

function resolveAssetPath(element, resourceLocation, category, extension) {
    return resolveAssetPathFromContext(particleContextFromElement(element), resourceLocation, category, extension);
}

function parseParticleTextureMetadata(value, sourceName = '') {
    if (!value) return null;
    try {
        const metadata = typeof value === 'string' ? JSON.parse(value) : value;
        return metadata?.animation && typeof metadata.animation === 'object' ? metadata : null;
    } catch (error) {
        console.warn(`Could not parse animated texture metadata${sourceName ? ` "${sourceName}"` : ''}:`, error);
        return null;
    }
}

function particleTextureMetadata(entry, resourceKey, texturePath = '') {
    const embedded = entry?.texture_metadata?.[resourceKey];
    if (embedded) return parseParticleTextureMetadata(embedded, resourceKey);
    if (!texturePath) return null;
    const metadataPath = `${texturePath}.mcmeta`;
    const contents = readTextFile(metadataPath);
    return contents ? parseParticleTextureMetadata(contents, metadataPath) : null;
}

function positiveInteger(value, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function parseParticleTextureAnimation(metadata, imageWidth, imageHeight) {
    const animation = parseParticleTextureMetadata(metadata);
    const sourceWidth = positiveInteger(imageWidth, 0);
    const sourceHeight = positiveInteger(imageHeight, 0);
    if (!animation || !sourceWidth || !sourceHeight) return null;

    const frameWidth = Math.min(sourceWidth, positiveInteger(animation.animation.width, sourceWidth));
    const frameHeight = Math.min(sourceHeight, positiveInteger(animation.animation.height, frameWidth));
    const columns = Math.floor(sourceWidth / frameWidth);
    const rows = Math.floor(sourceHeight / frameHeight);
    const frameCount = columns * rows;
    if (!frameCount) return null;

    const defaultTime = positiveInteger(animation.animation.frametime, 1);
    const sourceFrames = Array.isArray(animation.animation.frames) && animation.animation.frames.length
        ? animation.animation.frames : Array.from({length: frameCount}, (_, index) => index);
    let frames = sourceFrames.map(frame => {
        const object = frame && typeof frame === 'object' ? frame : null;
        return {
            index: Math.trunc(Number(object ? object.index : frame)),
            time: positiveInteger(object?.time, defaultTime)
        };
    }).filter(frame => Number.isInteger(frame.index) && frame.index >= 0 && frame.index < frameCount);
    if (!frames.length)
        frames = Array.from({length: frameCount}, (_, index) => ({index, time: defaultTime}));

    return {
        frameWidth,
        frameHeight,
        columns,
        frames,
        interpolate: animation.animation.interpolate === true,
        totalTime: frames.reduce((total, frame) => total + frame.time, 0)
    };
}

function drawAnimatedParticleTexture(texture, sequenceIndex, blend = 0) {
    const state = texture.userData?.iiTextureAnimation;
    if (!state) return;
    const {animation, canvas, context, sourceImage} = state;
    const frame = animation.frames[sequenceIndex];
    const next = animation.frames[(sequenceIndex + 1) % animation.frames.length];
    const drawFrame = (index, alpha = 1) => {
        const sourceX = (index % animation.columns) * animation.frameWidth;
        const sourceY = Math.floor(index / animation.columns) * animation.frameHeight;
        context.globalAlpha = alpha;
        context.drawImage(sourceImage, sourceX, sourceY, animation.frameWidth, animation.frameHeight,
            0, 0, canvas.width, canvas.height);
    };
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawFrame(frame.index);
    if (animation.interpolate && blend > 0) drawFrame(next.index, blend);
    context.globalAlpha = 1;
    texture.needsUpdate = true;
}

function updateAnimatedParticleTexture(texture, now) {
    const state = texture.userData?.iiTextureAnimation;
    if (!state?.animation?.totalTime) return;
    let tick = ((now - state.startedAt) / MINECRAFT_TEXTURE_TICK_MS) % state.animation.totalTime;
    let sequenceIndex = 0;
    while (sequenceIndex < state.animation.frames.length - 1
        && tick >= state.animation.frames[sequenceIndex].time) {
        tick -= state.animation.frames[sequenceIndex].time;
        sequenceIndex++;
    }
    const duration = state.animation.frames[sequenceIndex].time;
    const blend = state.animation.interpolate ? clamp01(tick / duration) : 0;
    const renderKey = state.animation.interpolate
        ? `${sequenceIndex}:${Math.floor(blend * 64)}` : String(sequenceIndex);
    if (renderKey === state.renderKey) return;
    state.renderKey = renderKey;
    drawAnimatedParticleTexture(texture, sequenceIndex, blend);
}

function runAnimatedParticleTextures() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    animatedParticleTextures.forEach(texture => updateAnimatedParticleTexture(texture, now));
}

function registerAnimatedParticleTexture(texture, metadata) {
    const sourceImage = texture?.image;
    const animation = parseParticleTextureAnimation(metadata, sourceImage?.width, sourceImage?.height);
    if (!texture || !sourceImage || !animation || typeof document === 'undefined') return texture;
    const canvas = document.createElement('canvas');
    canvas.width = animation.frameWidth;
    canvas.height = animation.frameHeight;
    const context = canvas.getContext('2d');
    if (!context) return texture;
    context.imageSmoothingEnabled = false;
    texture.image = canvas;
    texture.userData = Object.assign({}, texture.userData, {
        iiTextureAnimation: {
            animation,
            canvas,
            context,
            sourceImage,
            startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
            renderKey: ''
        }
    });
    drawAnimatedParticleTexture(texture, 0);
    if (animation.frames.length > 1) {
        animatedParticleTextures.add(texture);
        if (!animatedParticleTextureTimer)
            animatedParticleTextureTimer = setInterval(runAnimatedParticleTextures, ANIMATED_TEXTURE_UPDATE_MS);
    }
    return texture;
}

function clearAnimatedParticleTextures() {
    if (animatedParticleTextureTimer) clearInterval(animatedParticleTextureTimer);
    animatedParticleTextureTimer = null;
    animatedParticleTextures.clear();
}

function clearParticleTextureCache() {
    clearAnimatedParticleTextures();
    textureCache.clear();
}

function textureSource(path) {
    const {fs} = desktopModules();
    if (!fs || !path) return null;
    try {
        const data = fs.readFileSync(path);
        if (typeof Blob !== 'undefined' && globalThis.URL?.createObjectURL) {
            const url = globalThis.URL.createObjectURL(new Blob([data], {type: 'image/png'}));
            return {url, release: () => globalThis.URL.revokeObjectURL(url)};
        }
        return {url: `data:image/png;base64,${data.toString('base64')}`, release: () => {}};
    } catch (ignored) {
        return null;
    }
}

async function loadParticleTexture(element, resourceLocation) {
    const entry = projectParticleEntry(element);
    const resourceKey = canonicalResourceLocation(resourceLocation,
        entry?.resource_namespace || element.particleNamespace);
    const cachedData = entry?.textures?.[resourceKey];
    if (cachedData) {
        const cacheKey = `embedded:${particleCacheKey(element)}:${resourceKey}`;
        if (!textureCache.has(cacheKey)) {
            const metadata = particleTextureMetadata(entry, resourceKey);
            textureCache.set(cacheKey, new Promise(resolve => {
                new THREE.TextureLoader().load(`data:image/png;base64,${cachedData}`,
                    texture => resolve(registerAnimatedParticleTexture(
                        normalizeIIPreviewTexture(texture, {flipY: false}), metadata)),
                    undefined, () => resolve(null));
            }));
        }
        return textureCache.get(cacheKey);
    }
    const path = resolveAssetPath(element, resourceLocation, 'textures', 'png');
    if (!path) return null;
    if (!textureCache.has(path)) {
        const source = textureSource(path);
        if (!source) return null;
        const metadata = particleTextureMetadata(entry, resourceKey, path);
        const promise = new Promise(resolve => {
            new THREE.TextureLoader().load(source.url,
                texture => {
                    source.release();
                    resolve(registerAnimatedParticleTexture(
                        normalizeIIPreviewTexture(texture, {flipY: false}), metadata));
                },
                undefined, () => {
                    source.release();
                    resolve(null);
                });
        });
        textureCache.set(path, promise);
    }
    return textureCache.get(path);
}

function addRotationCorrection(element, visual) {
    visual.userData.localQuaternion = visual.quaternion.clone();
    visual.onBeforeRender = (renderer, scene, camera) => {
        if (!visual.parent) return;
        if (!element.correctRotation) {
            visual.quaternion.copy(visual.userData.localQuaternion);
            return;
        }
        visual.parent.getWorldQuaternion(visual.userData.parentQuaternion
            || (visual.userData.parentQuaternion = new THREE.Quaternion()));
        camera.getWorldQuaternion(visual.userData.cameraQuaternion
            || (visual.userData.cameraQuaternion = new THREE.Quaternion()));
        visual.quaternion.copy(visual.userData.parentQuaternion).invert()
            .multiply(visual.userData.cameraQuaternion)
            .multiply(visual.userData.localQuaternion);
    };
}

function createPlaceholderVisual(element, labelColour = 0xff9900) {
    const visual = new THREE.Group();
    visual.name = 'particle_visual';
    const geometry = ownedGeometry(new THREE.OctahedronGeometry(4, 0));
    const material = particleMaterial({color: labelColour, opacity: 0.65});
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'particle_placeholder';
    mesh.no_export = true;
    visual.add(mesh);
    visual.userData.applyState = state => applyMaterialState(material, state);
    addRotationCorrection(element, visual);
    return visual;
}

async function createVanillaVisual(element, definition) {
    const state = evaluateParticleState(definition, element.lifetime);
    const resources = definition.textures;
    const textures = await Promise.all(resources.map(resource => loadParticleTexture(element, resource)));
    let visual;
    let material;
    if (element.correctRotation) {
        material = new THREE.SpriteMaterial({transparent: true, alphaTest: 0.01, depthWrite: true});
        material.blending = definition.draw_stage.includes('additive')
            ? THREE.AdditiveBlending : THREE.NormalBlending;
        material.no_export = true;
        material.userData = {iiOwnedMaterial: true};
        visual = new THREE.Sprite(material);
    } else {
        material = particleMaterial({additive: definition.draw_stage.includes('additive')});
        visual = new THREE.Mesh(ownedGeometry(new THREE.PlaneGeometry(2, 2)), material);
        visual.onBeforeRender = (renderer, scene, camera) => visual.quaternion.copy(camera.quaternion);
    }
    visual.name = 'particle_visual';
    visual.no_export = true;
    visual.userData.applyState = current => {
        const radius = Math.max(0.001, current.size * current.scale * 16);
        const displaySize = visual.isSprite ? radius * 2 : radius;
        visual.scale.set(displaySize, displaySize, 1);
        const textureIndex = textures.length ? floorMod(current.textureShift, textures.length) : -1;
        material.map = textureIndex >= 0 ? textures[textureIndex] : null;
        applyMaterialState(material, current);
    };
    visual.userData.applyState(state);
    return visual;
}

function seededRandom(seed = 432) {
    let value = seed >>> 0;
    return () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 0x100000000;
    };
}

function createGlowVisual(element) {
    const random = seededRandom(432);
    const positions = [];
    const vertexKinds = [];
    const origin = new THREE.Vector3();
    for (let i = 0; i < 60; i++) {
        const theta = random() * Math.PI * 2;
        const z = random() * 2 - 1;
        const radial = Math.sqrt(Math.max(0, 1 - z * z));
        const direction = new THREE.Vector3(Math.cos(theta) * radial, z, Math.sin(theta) * radial);
        const reference = Math.abs(direction.y) < 0.95
            ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const side = direction.clone().cross(reference).normalize();
        const up = side.clone().cross(direction).normalize();
        const length = random() * 35;
        const radius = random() * 15;
        const ring = [0, 1, 2].map(index => {
            const angle = index * Math.PI * 2 / 3;
            return direction.clone().multiplyScalar(length)
                .addScaledVector(side, Math.cos(angle) * radius)
                .addScaledVector(up, Math.sin(angle) * radius);
        });
        for (let sideIndex = 0; sideIndex < 3; sideIndex++) {
            [origin, ring[sideIndex], ring[(sideIndex + 1) % 3]].forEach((point, vertexIndex) => {
                positions.push(point.x, point.y, point.z);
                vertexKinds.push(vertexIndex === 0 ? 0 : 1);
            });
        }
    }
    const geometry = ownedGeometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('iiColor', new THREE.Float32BufferAttribute(new Float32Array(vertexKinds.length * 4), 4));
    const material = new THREE.ShaderMaterial({
        vertexShader: [
            'attribute vec4 iiColor;',
            'varying vec4 iiParticleColor;',
            'void main() {',
            '  iiParticleColor = iiColor;',
            '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
            '}'
        ].join('\n'),
        fragmentShader: [
            'varying vec4 iiParticleColor;',
            'void main() { gl_FragColor = iiParticleColor; }'
        ].join('\n'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    material.no_export = true;
    material.userData = {iiOwnedMaterial: true};
    const visual = new THREE.Mesh(geometry, material);
    visual.name = 'particle_visual';
    visual.no_export = true;
    visual.userData.usesParticleRotation = true;
    visual.userData.applyState = state => {
        const age = state.progress * state.maxLifetime;
        const fadeIn = clamp01(age / (state.maxLifetime * 0.1));
        const fadeOut = clamp01((state.maxLifetime - age) / (state.maxLifetime * 0.05));
        const visibleScale = Math.max(0.0001, state.size * state.scale * Math.min(fadeIn, fadeOut));
        visual.scale.setScalar(visibleScale);
        visual.position.y = (-1 + Math.min(1, age) * 12 * state.size / 200) * 16;
        visual.userData.particleSpin = state.progress * 25;
        const colors = geometry.getAttribute('iiColor');
        for (let index = 0; index < vertexKinds.length; index++) {
            const colour = vertexKinds[index] === 0 ? state.color : state.secondary;
            const offset = index * 4;
            colors.array[offset] = colour.r;
            colors.array[offset + 1] = colour.g;
            colors.array[offset + 2] = colour.b;
            colors.array[offset + 3] = vertexKinds[index] === 0 ? clamp01(state.color.a) : 0;
        }
        colors.needsUpdate = true;
    };
    addRotationCorrection(element, visual);
    return visual;
}

function createLightningVisual(element, definition) {
    const end = new THREE.Vector3().fromArray(definition.stretch).multiplyScalar(16);
    const random = seededRandom(0x4c4947);
    const points = [new THREE.Vector3()];
    const length = end.length();
    for (let i = 1; i < 12; i++) {
        const amount = i / 12;
        const point = end.clone().multiplyScalar(amount);
        const modifier = (1 - Math.abs(amount * 2 - 1) * 0.75) * Math.min(8, Math.max(1, length * 0.12));
        point.add(new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(modifier));
        points.push(point);
    }
    points.push(end);
    const geometry = ownedGeometry(new THREE.BufferGeometry().setFromPoints(points));
    const material = new THREE.LineBasicMaterial({transparent: true});
    material.no_export = true;
    material.userData = {iiOwnedMaterial: true};
    const visual = new THREE.Line(geometry, material);
    visual.name = 'particle_visual';
    visual.no_export = true;
    visual.userData.applyState = state => {
        material.color.setRGB(state.color.r, state.color.g, state.color.b);
        material.opacity = clamp01(state.color.a);
    };
    addRotationCorrection(element, visual);
    return visual;
}

function makeRibbonGeometry(stretch, size, scale, beam) {
    const start = new THREE.Vector3();
    const end = new THREE.Vector3().fromArray(stretch).multiplyScalar(16);
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < 1e-8) direction.set(0, 0, 1);
    direction.normalize();
    const reference = Math.abs(direction.y) < 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const sideA = direction.clone().cross(reference).normalize();
    const sideB = sideA.clone().cross(direction).normalize();
    const positions = [];
    const uvs = [];
    const colorProgress = [];
    const addQuad = (a, b, c, d, startProgress, endProgress) => {
        [a, b, c, a, c, d].forEach(point => positions.push(point.x, point.y, point.z));
        uvs.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0);
        colorProgress.push(startProgress, endProgress, endProgress, startProgress, endProgress, startProgress);
    };

    if (beam) {
        const startDiameter = Math.max(0, size) * 16;
        const endDiameter = Math.max(0, scale) * 16;
        const largestDiameter = Math.max(startDiameter, endDiameter, 0.0001);
        const segments = Math.max(1, Math.ceil(length / largestDiameter));
        for (let segment = 0; segment < segments; segment++) {
            const startProgress = segment / segments;
            const endProgress = (segment + 1) / segments;
            const segmentStart = start.clone().addScaledVector(direction, length * startProgress);
            const segmentEnd = start.clone().addScaledVector(direction, length * endProgress);
            const startRadius = THREE.MathUtils.lerp(startDiameter, endDiameter, startProgress) * 0.5;
            const endRadius = THREE.MathUtils.lerp(startDiameter, endDiameter, endProgress) * 0.5;
            const corners = (centre, radius) => [
                centre.clone().addScaledVector(sideA, radius).addScaledVector(sideB, radius),
                centre.clone().addScaledVector(sideA, -radius).addScaledVector(sideB, radius),
                centre.clone().addScaledVector(sideA, -radius).addScaledVector(sideB, -radius),
                centre.clone().addScaledVector(sideA, radius).addScaledVector(sideB, -radius)
            ];
            const startCorners = corners(segmentStart, startRadius);
            const endCorners = corners(segmentEnd, endRadius);
            for (let face = 0; face < 4; face++)
                addQuad(startCorners[face], endCorners[face], endCorners[(face + 1) % 4],
                    startCorners[(face + 1) % 4], startProgress, endProgress);
        }
    } else {
        const diameter = Math.max(0.0001, size * scale * 16);
        const segments = Math.max(1, Math.ceil(length / diameter));
        const ribbonA = sideA.clone().multiplyScalar(diameter * 0.5);
        const ribbonB = sideB.clone().multiplyScalar(diameter * 0.5);
        for (let segment = 0; segment < segments; segment++) {
            const startDistance = Math.min(segment * diameter, length);
            const endDistance = Math.min((segment + 1) * diameter, length);
            const segmentStart = start.clone().addScaledVector(direction, startDistance);
            const segmentEnd = start.clone().addScaledVector(direction, endDistance);
            [ribbonA, ribbonB].forEach(side => addQuad(
                segmentStart.clone().add(side), segmentEnd.clone().add(side),
                segmentEnd.clone().sub(side), segmentStart.clone().sub(side), 0, 0
            ));
        }
    }
    const geometry = ownedGeometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('iiParticleColor',
        new THREE.Float32BufferAttribute(new Float32Array(colorProgress.length * 4), 4));
    geometry.userData.iiColorProgress = colorProgress;
    geometry.computeVertexNormals();
    return geometry;
}

async function createRibbonVisual(element, definition, beam = false) {
    const textures = await Promise.all(definition.textures.map(resource => loadParticleTexture(element, resource)));
    const state = evaluateParticleState(definition, element.lifetime);
    const geometry = makeRibbonGeometry(definition.stretch, definition.size, definition.scale, beam);
    const material = particleVertexMaterial(definition.draw_stage.includes('additive'));
    const visual = new THREE.Mesh(geometry, material);
    visual.name = 'particle_visual';
    visual.no_export = true;
    visual.userData.applyState = current => {
        const textureIndex = textures.length ? floorMod(current.textureShift, textures.length) : -1;
        material.uniforms.particleMap.value = textureIndex >= 0 ? textures[textureIndex] : null;
        material.uniforms.hasParticleMap.value = textureIndex >= 0 && !!textures[textureIndex];
        const colors = geometry.getAttribute('iiParticleColor');
        geometry.userData.iiColorProgress.forEach((progress, index) => {
            const colour = beam ? mixColour(current.color, current.secondary, progress) : current.color;
            colors.setXYZW(index, colour.r, colour.g, colour.b, colour.a);
        });
        colors.needsUpdate = true;
    };
    addRotationCorrection(element, visual);
    visual.userData.applyState(state);
    return visual;
}

function parseMTLTextures(contents) {
    const textures = new Map();
    let material = '';
    String(contents || '').split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('newmtl ')) material = trimmed.substring(7).trim();
        else if (material && trimmed.startsWith('map_Kd ')) textures.set(material, trimmed.substring(7).trim());
    });
    return textures;
}

function parseOBJGeometry(contents) {
    const positions = [];
    const uvs = [];
    const normals = [];
    const groups = new Map();
    let material = 'default';
    let materialLibrary = '';
    const groupFor = name => {
        if (!groups.has(name)) groups.set(name, {positions: [], uvs: [], normals: []});
        return groups.get(name);
    };
    const resolveIndex = (index, length) => index < 0 ? length + index : index - 1;
    const vertex = token => {
        const [v, vt, vn] = token.split('/').map(Number);
        return {
            position: positions[resolveIndex(v, positions.length)],
            uv: vt ? uvs[resolveIndex(vt, uvs.length)] : [0, 0],
            normal: vn ? normals[resolveIndex(vn, normals.length)] : [0, 1, 0]
        };
    };
    String(contents || '').split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        const values = trimmed.split(/\s+/);
        if (values[0] === 'v') positions.push(values.slice(1, 4).map(Number));
        else if (values[0] === 'vt') uvs.push(values.slice(1, 3).map(Number));
        else if (values[0] === 'vn') normals.push(values.slice(1, 4).map(Number));
        else if (values[0] === 'usemtl') material = values.slice(1).join(' ') || 'default';
        else if (values[0] === 'mtllib') materialLibrary = values.slice(1).join(' ');
        else if (values[0] === 'f' && values.length >= 4) {
            const corners = values.slice(1).map(vertex);
            for (let index = 1; index < corners.length - 1; index++) {
                [corners[0], corners[index], corners[index + 1]].forEach(corner => {
                    const group = groupFor(material);
                    group.positions.push(...corner.position.map(value => value * 16));
                    group.uvs.push(corner.uv[0], 1 - corner.uv[1]);
                    group.normals.push(...corner.normal);
                });
            }
        }
    });
    return {groups, materialLibrary};
}

function firstParticleModel(definition) {
    if (typeof definition.model === 'string' && definition.model_range && typeof definition.model_range === 'object') {
        const first = Math.trunc(Number(definition.model_range.first) || 0);
        const extension = definition.model.toLowerCase().endsWith('.obj') ? '.obj' : '';
        const base = extension ? definition.model.slice(0, -extension.length) : definition.model;
        return `${base}${first}${extension}`;
    }
    if (typeof definition.model === 'string') return definition.model;
    if (Array.isArray(definition.models) && definition.models.length) return definition.models[0];
    return '';
}

function particleModelResources(definition) {
    if (typeof definition.model === 'string' && definition.model_range && typeof definition.model_range === 'object') {
        const first = Math.trunc(Number(definition.model_range.first) || 0);
        const last = Math.max(first + 1, Math.trunc(Number(definition.model_range.last) || first + 1));
        const extension = definition.model.toLowerCase().endsWith('.obj') ? '.obj' : '';
        const base = extension ? definition.model.slice(0, -extension.length) : definition.model;
        return Array.from({length: last - first}, (_, index) => `${base}${first + index}${extension}`);
    }
    if (typeof definition.model === 'string') return [definition.model];
    return Array.isArray(definition.models) ? definition.models.filter(model => typeof model === 'string') : [];
}

function readBinaryBase64(filePath) {
    const {fs} = desktopModules();
    if (!fs || !filePath) return '';
    try {
        return fs.readFileSync(filePath).toString('base64');
    } catch (ignored) {
        return '';
    }
}

function createPortableParticleEntry(source) {
    const definition = normaliseParticleDefinition(source.definition);
    const context = source.context;
    const textures = {};
    const textureMetadata = {};
    const models = {};
    const missingAssets = [];
    const textureResources = new Set(definition.textures);

    definition.programs.map(parseParticleProgram).forEach(program => {
        if (program.name === 'retexture' && program.args[1]) textureResources.add(program.args[1]);
    });

    particleModelResources(definition).forEach(resource => {
        const modelPath = resolveAssetPathFromContext(context, resource, 'models/particle', 'obj');
        const obj = readTextFile(modelPath);
        if (!obj) {
            missingAssets.push(resource);
            return;
        }
        const {path} = desktopModules();
        const materialLibrary = (obj.match(/^\s*mtllib\s+(.+)$/m) || [])[1]?.trim() || '';
        const mtlPath = materialLibrary && path ? path.join(path.dirname(modelPath), materialLibrary) : '';
        const mtl = readTextFile(mtlPath);
        if (materialLibrary && !mtl) missingAssets.push(materialLibrary);
        parseMTLTextures(mtl).forEach(texture => textureResources.add(texture));
        models[canonicalResourceLocation(resource, context.namespace)] = {obj, mtl, materialLibrary};
    });

    textureResources.forEach(resource => {
        const texturePath = resolveAssetPathFromContext(context, resource, 'textures', 'png');
        const data = readBinaryBase64(texturePath);
        const key = canonicalResourceLocation(resource, context.namespace);
        if (data) {
            textures[key] = data;
            const metadata = particleTextureMetadata(null, key, texturePath);
            if (metadata) textureMetadata[key] = metadata;
        }
        else missingAssets.push(key);
    });

    return {
        id: canonicalResourceLocation(context.particleId, context.namespace),
        namespace: context.namespace,
        resource_namespace: context.namespace,
        definition,
        textures,
        texture_metadata: textureMetadata,
        models,
        missing_assets: [...new Set(missingAssets)],
        source_name: fileNameFromPath(source.sourcePath)
    };
}

function cacheEditorSource(source, keyOverride = '') {
    const key = canonicalResourceLocation(source.context.particleId, source.context.namespace);
    const bare = key.substring(key.indexOf(':') + 1);
    editorParticleCache.set(key, source);
    if (!editorParticleCache.has(bare)) editorParticleCache.set(bare, source);
    if (keyOverride) editorParticleCache.set(keyOverride, source);
    return source;
}

function cacheEditorParticle(sourcePath, loaded = null) {
    const particle = loaded || loadParticleDefinitionFromPath(sourcePath);
    return cacheEditorSource({
        sourcePath: normalisePath(sourcePath),
        definition: normaliseParticleDefinition(particle.definition),
        context: particle.context
    });
}

function storePortableParticle(source, keyOverride = '') {
    const entry = createPortableParticleEntry(source);
    const key = keyOverride || entry.id;
    entry.id = key;
    entry.namespace = key.substring(0, key.indexOf(':')) || entry.namespace;
    getProjectParticleCache()[key] = entry;
    return entry;
}

async function createModelVisual(element, definition) {
    const {path} = desktopModules();
    const modelResource = firstParticleModel(definition);
    const particleEntry = projectParticleEntry(element);
    const cachedModel = particleEntry?.models?.[
        canonicalResourceLocation(modelResource, particleEntry?.resource_namespace || element.particleNamespace)
    ];
    const modelPath = cachedModel ? '' : resolveAssetPath(element, modelResource, 'models/particle', 'obj');
    const contents = cachedModel?.obj || readTextFile(modelPath);
    if (!contents) return createPlaceholderVisual(element, 0x6699ff);

    const parsed = parseOBJGeometry(contents);
    const mtlPath = !cachedModel && parsed.materialLibrary && path
        ? path.join(path.dirname(modelPath), parsed.materialLibrary) : '';
    const materialTextures = parseMTLTextures(cachedModel?.mtl || readTextFile(mtlPath));
    const groupNames = [...parsed.groups.keys()].sort();
    const textureMaterialNames = materialTextures.size ? [...materialTextures.keys()] : groupNames;
    const textureResources = textureMaterialNames.map(name => materialTextures.get(name) || '');
    const textures = await Promise.all(textureResources.map(resource => loadParticleTexture(element, resource)));
    const retextures = definition.programs.map(parseParticleProgram)
        .filter(program => program.name === 'retexture' && Number.isInteger(Number(program.args[0])) && program.args[1]);
    for (const program of retextures) {
        const index = Number(program.args[0]);
        if (index >= 0 && index < textures.length)
            textures[index] = await loadParticleTexture(element, program.args[1]);
    }
    const lifetimeRetexture = definition.programs.map(parseParticleProgram)
        .some(program => program.name === 'lifetime_retexture');
    const visual = new THREE.Group();
    visual.name = 'particle_visual';
    visual.no_export = true;
    visual.userData.usesParticleRotation = true;
    const entries = [];
    groupNames.forEach(name => {
        const data = parsed.groups.get(name);
        if (!data.positions.length) return;
        const geometry = ownedGeometry(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
        const material = particleMaterial({additive: definition.draw_stage.includes('additive')});
        const mesh = new THREE.Mesh(geometry, material);
        mesh.no_export = true;
        visual.add(mesh);
        entries.push({material, materialIndex: Math.max(0, textureMaterialNames.indexOf(name))});
    });
    visual.userData.applyState = state => {
        visual.scale.setScalar(Math.max(0.0001, state.size * state.scale));
        visual.rotation.set(THREE.MathUtils.degToRad(state.rotationPitch),
            THREE.MathUtils.degToRad(state.rotationYaw), 0);
        const textureShift = lifetimeRetexture
            ? textures.length
                ? Math.min(textures.length - 1, Math.floor(state.progress * textures.length))
                : 0
            : state.textureShift;
        entries.forEach(({material, materialIndex}) => {
            const shifted = textures.length ? floorMod(materialIndex + textureShift, textures.length) : -1;
            material.map = shifted >= 0 ? textures[shifted] : null;
            applyMaterialState(material, state);
        });
    };
    addRotationCorrection(element, visual);
    return visual;
}

async function createParticleVisual(element, definition) {
    switch (definition.type) {
        case 'ParticleVanilla': return createVanillaVisual(element, definition);
        case 'ParticleModel': return createModelVisual(element, definition);
        case 'ParticleGlow': return createGlowVisual(element);
        case 'ParticleLightning': return createLightningVisual(element, definition);
        case 'ParticleRibbon': return createRibbonVisual(element, definition, false);
        case 'ParticleBeam': return createRibbonVisual(element, definition, true);
        default: return createPlaceholderVisual(element);
    }
}

function markParticleResolution(element, entry, key) {
    element._particleUnknown = !entry;
    element._particleResolvedId = entry ? key : '';
    if (entry) {
        element.particleNamespace = entry.namespace || key.substring(0, key.indexOf(':'));
        element.particleDefinitionId = key;
        element.particleData = normaliseParticleDefinition(entry.definition);
    }
    updateParticlePanel();
    return entry;
}

function resolveParticleElement(element, allowElementMigration = true) {
    const key = particleCacheKey(element);
    if (!String(element.particleId || '').trim()) return markParticleResolution(element, null, key);

    const projectEntry = projectParticleEntry(key);
    if (projectEntry) return markParticleResolution(element, projectEntry, key);

    const editorEntry = editorParticleEntry(key);
    if (editorEntry) return markParticleResolution(element, storePortableParticle(editorEntry, key), key);

    if (allowElementMigration && element.particleData && Object.keys(element.particleData).length) {
        const sourceContext = particleAssetContext(element.particleSource, element.particleSource);
        const provenance = element.particleDefinitionId
            || (sourceContext.particleId ? canonicalResourceLocation(sourceContext.particleId, sourceContext.namespace) : '');
        if (provenance === key) {
            const source = {
                sourcePath: element.particleSource || '',
                definition: element.particleData,
                context: {
                    assetsRoot: element.particleAssetsRoot || sourceContext.assetsRoot,
                    namespace: element.particleNamespace || sourceContext.namespace,
                    particleId: key.substring(key.indexOf(':') + 1)
                }
            };
            return markParticleResolution(element, storePortableParticle(source, key), key);
        }
    }
    return markParticleResolution(element, null, key);
}

async function rebuildParticlePreview(element) {
    if (!element.mesh) return;
    const token = element._particlePreviewToken = (element._particlePreviewToken || 0) + 1;
    clearChildren(element.mesh);
    if (!resolveParticleElement(element)) return;
    const definition = effectiveParticleDefinition(element);
    let visual;
    try {
        visual = await createParticleVisual(element, definition);
    } catch (error) {
        console.warn('Could not build AMT particle preview:', error);
        visual = createPlaceholderVisual(element, 0xff4444);
    }
    if (token !== element._particlePreviewToken || !element.mesh) {
        disposePreviewObject(visual);
        return;
    }
    element.mesh.add(visual);
    applyParticlePreviewState(element);
}

function applyParticlePreviewState(element, progress = null) {
    const visual = element.mesh?.getObjectByName('particle_visual') || element.mesh?.children?.[0];
    if (!visual) return;
    const state = evaluateParticleState(effectiveParticleDefinition(element),
        progress === null ? element.lifetime : progress);
    visual.userData.applyState?.(state);
    if (visual.userData.usesParticleRotation) {
        visual.rotation.set(
            THREE.MathUtils.degToRad(state.rotationPitch),
            THREE.MathUtils.degToRad(state.rotationYaw),
            Number(visual.userData.particleSpin) || 0
        );
    }
    visual.userData.localQuaternion?.copy(visual.quaternion);
    element._particleIgnoredPrograms = state.ignoredPrograms;
}

function updateSelectedParticlePreview(rebuild = false) {
    const selectedParticles = Array.isArray(AMTParticle.selected) ? AMTParticle.selected : [];
    selectedParticles.forEach(element => rebuild
        ? AMTParticle.preview_controller.updateGeometry(element)
        : applyParticlePreviewState(element));
}

function selectedParticle() {
    return Array.isArray(AMTParticle.selected) ? AMTParticle.selected[0] : null;
}

function getCurrentOutlinerGroup() {
    if (typeof getCurrentGroup === 'function') return getCurrentGroup();
    return Group.selected || null;
}

function selectAnimatorFor(element) {
    if (Animator.open && Animation.selected) Animation.selected.getBoneAnimator(element)?.select(true);
}

function showParticleError(error) {
    Blockbench.showMessageBox({
        title: 'AMT Particle',
        message: error instanceof Error ? error.message : String(error),
        icon: 'error'
    });
}

function deriveParticleLabel(filePath) {
    const context = particleAssetContext(filePath);
    return context.particleId ? `${context.namespace}:${context.particleId}` : fileNameFromPath(filePath);
}

function scanParticleFiles(root) {
    const {fs, path, error} = desktopModules();
    if (!fs || !path) throw filesystemUnavailableError(error);
    const nativeRoot = nativePath(root);
    if (!nativeRoot) return [];
    let rootStats;
    try {
        rootStats = fs.statSync(nativeRoot);
    } catch (error) {
        throw new Error(`Could not read the AMT particle folder: ${nativeRoot}\n${error.message}`);
    }
    if (!rootStats.isDirectory()) throw new Error(`The AMT particle path is not a directory: ${nativeRoot}`);
    const files = [];
    const pending = [nativeRoot];
    while (pending.length && files.length < MAX_PARTICLE_FILES) {
        const directory = pending.pop();
        let entries;
        try {
            entries = fs.readdirSync(directory, {withFileTypes: true});
        } catch (error) {
            throw new Error(`Could not scan ${directory}: ${error.message}`);
        }
        entries.forEach(entry => {
            if (entry.name === '.git' || entry.name === 'node_modules' || files.length >= MAX_PARTICLE_FILES) return;
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) pending.push(entryPath);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.fx.amt')) files.push(entryPath);
        });
    }
    return files.sort((first, second) => deriveParticleLabel(first).localeCompare(deriveParticleLabel(second)));
}

function invalidateParticleFolderIndex(clearEditorCache = true) {
    particleFolderIndex = null;
    particleFolderIndexRoot = '';
    clearParticleTextureCache();
    if (clearEditorCache) editorParticleCache.clear();
}

function getParticleFolderIndex(root = particleResourceFolder()) {
    const nativeRoot = nativePath(root);
    const normalisedRoot = normalisePath(nativeRoot);
    if (!normalisedRoot) return {files: [], byId: new Map(), assetRoots: [], errors: []};
    if (particleFolderIndex && particleFolderIndexRoot === normalisedRoot) return particleFolderIndex;

    const candidates = scanParticleFiles(nativeRoot);
    const files = [];
    const byId = new Map();
    const assetRoots = new Set();
    const errors = [];
    candidates.forEach(file => {
        try {
            const source = cacheEditorParticle(file);
            files.push(file);
            const context = source.context;
            if (context.assetsRoot) assetRoots.add(context.assetsRoot);
            const resource = stripParticleExtension(context.particleId).toLowerCase();
            const namespace = String(context.namespace || 'immersiveintelligence').toLowerCase();
            if (resource) {
                byId.set(`${namespace}:${resource}`, file);
                if (!byId.has(resource)) byId.set(resource, file);
            }
        } catch (error) {
            errors.push({file, message: error.message});
        }
    });
    particleFolderIndexRoot = normalisedRoot;
    particleFolderIndex = {files, byId, assetRoots: [...assetRoots], errors};
    return particleFolderIndex;
}

function particleAssetRoots() {
    try {
        return getParticleFolderIndex().assetRoots;
    } catch (ignored) {
        return [];
    }
}

function applyParticleDefinition(element, sourcePath, definition, context, options = {}) {
    if (options.undo !== false) Undo.initEdit({elements: [element], outliner: true});
    const source = cacheEditorSource({
        sourcePath: normalisePath(sourcePath),
        definition: normaliseParticleDefinition(definition),
        context
    });
    element.particleSource = normalisePath(sourcePath);
    element.particleAssetsRoot = normalisePath(context.assetsRoot);
    element.particleNamespace = context.namespace || 'immersiveintelligence';
    if (!options.preserveId)
        element.particleId = context.particleId || stripParticleExtension(fileNameFromPath(sourcePath));
    const key = particleCacheKey(element);
    const entry = storePortableParticle(source, key);
    element.particleDefinitionId = key;
    element.particleData = normaliseParticleDefinition(entry.definition);
    element._particleUnknown = false;
    if (!element.name || element.name === 'particle') {
        const sourceName = element.particleId.substring(element.particleId.lastIndexOf('/') + 1);
        if (sourceName) element.name = sourceName;
    }
    if (options.undo !== false)
        Undo.finishEdit('Load AMT particle definition', {elements: [element], outliner: true});
    AMTParticle.preview_controller.updateGeometry(element);
    scheduleParticleCacheSync();
    if (!options.quiet)
        Blockbench.showQuickMessage(`Loaded ${element.particleNamespace}:${element.particleId}`);
}

function loadParticlePath(element, sourcePath, options = {}) {
    try {
        const source = cacheEditorParticle(sourcePath);
        applyParticleDefinition(element, sourcePath, source.definition, source.context, options);
        return true;
    } catch (error) {
        if (!options.quiet) showParticleError(error);
        return false;
    }
}

function refreshParticleFromId(element, options = {}) {
    if (!element) return false;
    const entry = resolveParticleElement(element);
    AMTParticle.preview_controller.updateGeometry(element);
    scheduleParticleCacheSync();
    if (!entry) {
        if (!options.quiet) Blockbench.showQuickMessage(`Particle not found: ${element.particleId}`, 'error');
        return false;
    }
    return true;
}

function refreshAllParticlesFromFolder() {
    const index = getParticleFolderIndex();
    usedParticleElements().forEach(element => {
        const source = editorParticleEntry(element);
        if (source) storePortableParticle(source, particleCacheKey(element));
        AMTParticle.preview_controller.updateGeometry(element);
    });
    reconcileUsedParticleCache();
    Canvas.updateAll?.();
    return index;
}

function importedParticleSource(file) {
    const sourcePath = nativePath(file.path || file.name || '');
    if (file.path) {
        try {
            return cacheEditorParticle(sourcePath);
        } catch (ignored) {
            // Some import providers expose a virtual path; their supplied contents are still usable.
        }
    }
    const context = particleAssetContext(sourcePath, file.name);
    return cacheEditorSource({
        sourcePath: normalisePath(sourcePath),
        definition: normaliseParticleDefinition(JSON.parse(file.content)),
        context
    });
}

function chooseParticleFile(element = selectedParticle(), keyOverride = '') {
    Blockbench.import({
        resource_id: 'ii_particle_definition',
        type: 'AMT Particle Definition',
        extensions: ['amt', 'json'],
        readtype: 'text',
        multiple: false
    }, files => {
        if (!files?.length) return;
        const file = files[0];
        try {
            const source = importedParticleSource(file);
            if (keyOverride) {
                editorParticleCache.set(keyOverride, source);
                storePortableParticle(source, keyOverride);
                usedParticleElements().filter(candidate => particleCacheKey(candidate) === keyOverride)
                    .forEach(candidate => AMTParticle.preview_controller.updateGeometry(candidate));
                scheduleParticleCacheSync();
                Blockbench.showQuickMessage(`Loaded ${keyOverride}`);
            } else if (element) {
                applyParticleDefinition(element, source.sourcePath, source.definition, source.context);
            } else {
                reconcileUsedParticleCache();
                Blockbench.showQuickMessage(`Loaded ${canonicalResourceLocation(
                    source.context.particleId, source.context.namespace)}`);
            }
        } catch (error) {
            showParticleError(new Error(`Could not load particle JSON: ${error.message}`));
        }
    });
}

function showParticleSelector(element, folder) {
    let index;
    try {
        index = getParticleFolderIndex(folder);
    } catch (error) {
        showParticleError(error);
        return false;
    }
    const files = index.files;
    if (!files.length) {
        Blockbench.showQuickMessage('No .fx.amt files found in the selected folder', 'error');
        return false;
    }
    const options = {};
    const paths = {};
    files.forEach((file, index) => {
        const key = `particle_${index}`;
        options[key] = deriveParticleLabel(file);
        paths[key] = file;
    });
    new Dialog('ii_particle_folder_select', {
        title: 'Select AMT Particle',
        form: {
            particle: {
                label: 'Particle',
                type: 'select',
                options,
                value: Object.keys(options)[0]
            }
        },
        onConfirm(result) {
            this.hide();
            loadParticlePath(element, paths[result.particle]);
        }
    }).show();
    return true;
}

async function chooseParticleFromFolder(element) {
    if (Blockbench.isWeb || typeof Blockbench.pickDirectory !== 'function') {
        chooseParticleFile(element);
        return;
    }
    const configured = particleResourceFolder();
    if (configured && showParticleSelector(element, configured)) return;

    try {
        const result = await Promise.resolve(Blockbench.pickDirectory({
            title: 'Select AMT Particle Resource Folder',
            resource_id: 'ii_particle_folder',
            startpath: configured || element.particleSource || Project?.save_path || undefined
        }));
        const folder = nativePath(result);
        if (!folder) return;
        setParticleResourceFolder(normalisePath(folder));
        retryNativeFilesystemAccess();
        invalidateParticleFolderIndex();
        showParticleSelector(element, folder);
    } catch (error) {
        showParticleError(error);
    }
}

async function chooseGlobalParticleFolder() {
    if (typeof Blockbench.pickDirectory !== 'function') {
        Blockbench.showQuickMessage('Particle folders require Blockbench Desktop', 'error');
        return;
    }
    try {
        const result = await Promise.resolve(Blockbench.pickDirectory({
            title: 'Set AMT Particle Resource Folder',
            resource_id: 'ii_particle_resource_folder',
            startpath: particleResourceFolder() || Project?.save_path || undefined
        }));
        const folder = nativePath(result);
        if (!folder) return;
        setParticleResourceFolder(normalisePath(folder));
        retryNativeFilesystemAccess();
        invalidateParticleFolderIndex();
        const index = refreshAllParticlesFromFolder();
        const suffix = index.errors.length ? `, ${index.errors.length} invalid` : '';
        Blockbench.showQuickMessage(`AMT particle folder set (${index.files.length} definitions${suffix})`);
    } catch (error) {
        showParticleError(error);
    }
}

function reconcileUsedParticleCache() {
    const elements = usedParticleElements();
    const usedKeys = new Set(elements.map(element => particleCacheKey(element)));
    const cache = getProjectParticleCache();
    Object.keys(cache).forEach(key => {
        if (!usedKeys.has(key)) delete cache[key];
    });
    elements.forEach(element => resolveParticleElement(element));
    updateParticlePanel();
}

function scheduleParticleCacheSync(rebuild = false) {
    clearTimeout(particleCacheSyncTimer);
    particleCacheSyncTimer = setTimeout(() => {
        particleCacheSyncTimer = null;
        reconcileUsedParticleCache();
        if (rebuild) usedParticleElements().forEach(element => AMTParticle.preview_controller.updateGeometry(element));
    }, 100);
}

function particlePanelEntries() {
    const entries = new Map();
    usedParticleElements().forEach(element => {
        const key = particleCacheKey(element);
        if (!entries.has(key)) entries.set(key, {key, count: 0, elements: []});
        const row = entries.get(key);
        row.count++;
        row.elements.push(element);
    });
    return [...entries.values()].map(row => {
        const embedded = projectParticleEntry(row.key);
        const available = editorParticleEntry(row.key);
        return Object.assign(row, {
            missing: !embedded && !available,
            missingAssets: embedded?.missing_assets?.length || 0,
            status: embedded ? 'Embedded in model' : available ? 'Available in editor' : 'Definition missing'
        });
    }).sort((first, second) => first.key.localeCompare(second.key));
}

function updateParticlePanel() {
    const vue = Panels?.ii_particle_cache?.vue;
    if (vue) vue.revision++;
}

function selectParticleCacheEntry(entry) {
    const element = entry?.elements?.[0];
    if (!element) return;
    unselectAll();
    element.select();
    element.scrollTo?.();
}

function particleDefinitionForEntry(entry) {
    return projectParticleEntry(entry?.key)?.definition || editorParticleEntry(entry?.key)?.definition || null;
}

function displayParticleInformation(entry) {
    const definition = particleDefinitionForEntry(entry);
    if (!definition) {
        Blockbench.showQuickMessage(`Particle definition missing: ${entry?.key || ''}`, 'error');
        return;
    }
    new Dialog('ii_particle_information', {
        title: `Particle Information — ${entry.key}`,
        width: 720,
        singleButton: true,
        buttons: ['Close'],
        form: {
            json: {
                label: 'Particle JSON',
                type: 'textarea',
                style: 'code',
                height: 420,
                readonly: true,
                value: JSON.stringify(definition, null, 2)
            }
        }
    }).show();
}

function openParticleEntryMenu(event, entry) {
    particleEntryMenu?.open(event, entry);
}

function ensureParticleTimelineResolution(animation) {
    if (!animation) return;
    const snapping = Number(animation.snapping);
    if (Number.isFinite(snapping) && snapping >= PARTICLE_TIMELINE_SNAPPING) return;
    animation.snapping = PARTICLE_TIMELINE_SNAPPING;
    animation.saved = false;
    Timeline.vue?.$forceUpdate?.();
}

function reloadConfiguredParticleFolder() {
    if (!particleResourceFolder()) {
        chooseGlobalParticleFolder();
        return;
    }
    try {
        retryNativeFilesystemAccess();
        invalidateParticleFolderIndex();
        const index = refreshAllParticlesFromFolder();
        const suffix = index.errors.length ? `, ${index.errors.length} invalid` : '';
        Blockbench.showQuickMessage(`Reloaded ${index.files.length} particle definitions${suffix}`);
    } catch (error) {
        showParticleError(error);
    }
}

function registerParticlePanel() {
    const projectProperty = new Property(ModelProject, 'object', PARTICLE_CACHE_PROJECT_PROPERTY, {
        default: () => ({}),
        condition: () => Format?.id === 'free'
    });
    particlePanelStyle = Blockbench.addCSS(`
        .ii_particle_cache_panel { display: flex; flex-direction: column; height: 100%; }
        .ii_particle_cache_actions { display: flex; gap: 4px; padding: 6px; border-bottom: 1px solid var(--color-border); }
        .ii_particle_cache_actions button { min-width: 32px; }
        .ii_particle_cache_list { overflow-y: auto; flex: 1; }
        .ii_particle_cache_list li { display: flex; align-items: flex-start; min-height: 38px; gap: 7px; padding: 5px 6px; }
        .ii_particle_cache_list li:hover { background-color: var(--color-accent); color: var(--color-accent_text); }
        .ii_particle_cache_list .ii_particle_cache_state { flex: 0 0 24px; width: 24px; text-align: center; }
        .ii_particle_cache_list .ii_particle_cache_missing { color: var(--color-error); }
        .ii_particle_cache_list .ii_particle_cache_warning { color: var(--color-warning); }
        .ii_particle_cache_description { display: block; flex: 1; min-width: 0; overflow: hidden; }
        .ii_particle_cache_name { display: block; line-height: 1.25; overflow-wrap: anywhere; word-break: break-word; white-space: normal; }
        .ii_particle_cache_description small { display: block; color: var(--color-subtle_text); line-height: 1.25; overflow-wrap: anywhere; }
        .ii_particle_cache_empty { padding: 12px; color: var(--color-subtle_text); text-align: center; }
    `);
    particleEntryMenu = new Menu([
        {
            id: 'display_particle_information',
            name: 'Display Particle Information',
            icon: 'info',
            click: displayParticleInformation
        },
        {
            id: 'set_particle_source_file',
            name: 'Set Source File...',
            icon: 'folder_open',
            click(entry) { chooseParticleFile(null, entry?.key || ''); }
        }
    ]);
    const panel = new Panel('ii_particle_cache', {
        name: 'Particles',
        icon: 'flare',
        condition: {project: true, modes: ['edit', 'animate']},
        growable: true,
        resizable: true,
        default_position: {slot: 'left_bar', height: 260, sidebar_index: 3},
        insert_after: 'textures',
        component: {
            data() { return {revision: 0}; },
            computed: {
                particles() { this.revision; return particlePanelEntries(); }
            },
            methods: {
                chooseFile() { chooseParticleFile(); },
                chooseFolder() { chooseGlobalParticleFolder(); },
                reloadFolder() { reloadConfiguredParticleFolder(); },
                selectEntry(entry) { selectParticleCacheEntry(entry); },
                openEntryMenu(event, entry) { openParticleEntryMenu(event, entry); }
            },
            template: `
                <div class="ii_particle_cache_panel">
                    <div class="ii_particle_cache_actions">
                        <button title="Load particle definition" aria-label="Load particle definition" @click="chooseFile()"><i class="material-icons">note_add</i></button>
                        <button title="Set AMT particle folder" aria-label="Set AMT particle folder" @click="chooseFolder()"><i class="material-icons">folder_special</i></button>
                        <button title="Reload configured particle folder" aria-label="Reload configured particle folder" @click="reloadFolder()"><i class="material-icons">refresh</i></button>
                    </div>
                    <ul class="ii_particle_cache_list list mobile_scrollbar" v-if="particles.length">
                        <li v-for="entry in particles" :key="entry.key" @click="selectEntry(entry)" @contextmenu.prevent.stop="openEntryMenu($event, entry)" :title="entry.status + ' — right-click for options'">
                            <span class="ii_particle_cache_state">
                                <i v-if="entry.missing" class="material-icons ii_particle_cache_missing">error</i>
                                <i v-else-if="entry.missingAssets" class="material-icons ii_particle_cache_warning" :title="entry.missingAssets + ' missing asset(s)'">warning</i>
                                <i v-else class="material-icons">flare</i>
                            </span>
                            <span class="ii_particle_cache_description"><span class="ii_particle_cache_name">{{entry.key}}</span><small>{{entry.count}} element{{entry.count === 1 ? '' : 's'}} · {{entry.status}}</small></span>
                        </li>
                    </ul>
                    <div class="ii_particle_cache_empty" v-else>No Particle elements are used by this model.</div>
                </div>`
        }
    });
    const projectListener = Blockbench.on('select_project load_project new_project', () => {
        clearParticleTextureCache();
        scheduleParticleCacheSync(true);
    });
    const outlinerListener = Blockbench.on('add_ii_particle finish_edit load_undo_save', () => scheduleParticleCacheSync());
    const saveListener = Blockbench.on('quick_save_model', reconcileUsedParticleCache);
    deletables.push(projectProperty, particlePanelStyle, particleEntryMenu, panel, projectListener, outlinerListener, saveListener);
    scheduleParticleCacheSync(true);
}

function editParticleProperties() {
    const particles = Array.isArray(AMTParticle.selected) ? AMTParticle.selected : [];
    if (!particles.length || !Modes.edit) return;
    const initial = normaliseParticleProperties(particles[0].particleProperties);
    new Dialog('edit_ii_particle_properties', {
        title: 'AMT Particle Properties',
        form: {
            help: {
                type: 'info',
                text: 'Properties are written directly into this AMT part\'s NBT header. '
                    + 'Examples: `size`, `scale`, `color`, `color_secondary`, `stretch`, '
                    + '`textures`, `texture_shift`, `max_lifetime`, `draw_stage`, and `aabb`.'
            },
            properties: {
                label: 'Particle Properties (JSON)',
                type: 'textarea',
                style: 'code',
                value: JSON.stringify(initial, null, 2)
            }
        },
        onConfirm(result) {
            let parsed;
            try {
                parsed = JSON.parse(String(result.properties || '{}'));
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                    throw new Error('The root value must be a JSON object.');
            } catch (error) {
                showParticleError(new Error(`Invalid particle properties: ${error.message}`));
                return;
            }
            const properties = normaliseParticleProperties(parsed);
            Undo.initEdit({elements: particles});
            particles.forEach(element => {
                element.particleProperties = JSON.parse(JSON.stringify(properties));
                AMTParticle.preview_controller.updateGeometry(element);
            });
            Undo.finishEdit('Change AMT particle properties', {elements: particles});
            this.hide();
        }
    }).show();
}

function addElement() {
    Undo.initEdit({outliner: true, elements: [], selection: true});
    const element = new AMTParticle().init();
    element.addTo(getCurrentOutlinerGroup());
    element.createUniqueName();
    unselectAll();
    element.select();
    Undo.finishEdit('Add AMT Particle', {outliner: true, elements: selected, selection: true});
    Blockbench.dispatchEvent('add_ii_particle', {object: element});
    chooseParticleFromFolder(element);
    return element;
}

export class AMTParticleElement extends OutlinerElement {
    constructor(data, uuid) {
        super(data, uuid);
        resetElementProperties(this, AMTParticleElement);
        this.name = 'particle';
        this.children = [];
        this.selected = false;
        this.locked = false;
        this.export = true;
        this.parent = 'root';
        this.isOpen = false;
        this.visibility = true;
        if (data && typeof data === 'object') this.extend(data);
    }

    get origin() { return this.position; }
    extend(object) { return mergeElementProperties(this, AMTParticleElement, object); }
    init() {
        super.init();
        if (!this.mesh || !this.mesh.parent) AMTParticleElement.preview_controller.setup(this);
        return this;
    }
    select(event, isOutlinerClick) {
        const result = super.select(event, isOutlinerClick);
        if (result !== false) selectAnimatorFor(this);
        return result;
    }
    unselect(...args) {
        super.unselect(...args);
        if (Animator.open && Timeline.selected_animator && Timeline.selected_animator.element === this)
            Timeline.selected_animator.selected = false;
    }
    getWorldCenter() { return this.mesh ? THREE.fastWorldPosition(this.mesh, new THREE.Vector3()) : new THREE.Vector3(); }
    getSaveCopy() { return makeSaveCopy(this, AMTParticleElement); }
    getUndoCopy() { return makeSaveCopy(this, AMTParticleElement); }
    getChildlessCopy(keepUuid = false) { return makeChildlessCopy(this, AMTParticleElement, keepUuid); }
}

const AMTParticle = AMTParticleElement;

AMTParticle.behavior = {unique_name: true, movable: true, rotatable: true, scalable: true};
AMTParticle.preview_controller = null;
AMTParticle.prototype.title = 'Particle';
AMTParticle.prototype.type = 'particle';
AMTParticle.prototype.icon = 'flare';
AMTParticle.prototype.movable = true;
AMTParticle.prototype.rotatable = true;
AMTParticle.prototype.scalable = true;
AMTParticle.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility];
AMTParticle.prototype.menu = new Menu([
    ...Outliner.control_menu_group,
    'load_ii_particle_definition',
    'edit_ii_particle_properties',
    new MenuSeparator('manage'),
    'rename', 'delete'
]);

OutlinerElement.registerType(AMTParticle, 'particle');

new Property(AMTParticle, 'string', 'name', {default: 'particle'});
new Property(AMTParticle, 'vector', 'position');
new Property(AMTParticle, 'vector', 'rotation');
new Property(AMTParticle, 'vector', 'scale', {default: [1, 1, 1]});
new Property(AMTParticle, 'string', 'particleId', {
    default: '',
    inputs: {
        element_panel: {
            input: {label: 'Particle ID', type: 'text'},
            onChange() {
                clearTimeout(particleIdChangeTimer);
                particleIdChangeTimer = setTimeout(() => {
                    const particles = Array.isArray(AMTParticle.selected) ? AMTParticle.selected : [];
                    particles.forEach(element => refreshParticleFromId(element, {quiet: true}));
                }, 180);
            }
        }
    }
});
new Property(AMTParticle, 'string', 'particleSource', {default: ''});
new Property(AMTParticle, 'string', 'particleAssetsRoot', {default: ''});
new Property(AMTParticle, 'string', 'particleNamespace', {default: 'immersiveintelligence'});
new Property(AMTParticle, 'string', 'particleDefinitionId', {default: ''});
new Property(AMTParticle, 'object', 'particleData', {default: {}});
new Property(AMTParticle, 'object', 'particleProperties', {default: {}});
new Property(AMTParticle, 'boolean', 'correctRotation', {
    default: false,
    inputs: {
        element_panel: {
            input: {label: 'Correct Camera Rotation', type: 'checkbox'},
            onChange() { updateSelectedParticlePreview(true); }
        }
    }
});
new Property(AMTParticle, 'number', 'lifetime', {
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    inputs: {
        element_panel: {
            input: {label: 'Lifetime', type: 'num_slider', min: 0, max: 1, step: 0.01},
            onChange() {
                const particles = Array.isArray(AMTParticle.selected) ? AMTParticle.selected : [];
                particles.forEach(element => {
                    element.lifetime = clamp01(element.lifetime);
                    applyParticlePreviewState(element);
                });
            }
        }
    }
});
new Property(AMTParticle, 'boolean', 'visibility', {default: true});

new NodePreviewController(AMTParticle, {
    setup(element) {
        createPreviewObject3D(element, {group: true});
        this.updateTransform(element);
        this.updateGeometry(element);
        this.dispatchEvent('setup', {element});
    },
    updateTransform(element) {
        updatePreviewTransform(element);
        applyParticlePreviewState(element);
        this.dispatchEvent('update_transform', {element});
    },
    updateGeometry(element) {
        rebuildParticlePreview(element);
        this.dispatchEvent('update_geometry', {element});
    },
    updateVisibility(element) {
        setPreviewVisibility(element);
        this.dispatchEvent('update_visibility', {element});
    },
    updateSelection(element) {
        this.dispatchEvent('update_selection', {element});
    }
});

function registerParticleKeyframeProperty() {
    if (typeof KeyframeDataPoint === 'undefined') return;
    if (!KeyframeDataPoint.properties[PARTICLE_LIFETIME_PROPERTY]) {
        particleLifetimeKeyframeProperty = new Property(KeyframeDataPoint, 'molang', PARTICLE_LIFETIME_PROPERTY, {
            label: 'Lifetime',
            default: '0',
            condition(point) {
                return point.keyframe?.channel === 'property' && point.keyframe?.animator instanceof AMTParticleAnimator;
            }
        });
    }
}

export function readParticleLifetimeKeyframe(keyframe) {
    if (!keyframe) return 0;
    const point = keyframe.data_points?.[0];
    const hasProperty = point?.[PARTICLE_LIFETIME_PROPERTY] !== undefined;
    const raw = hasProperty ? point[PARTICLE_LIFETIME_PROPERTY] : (point?.x ?? point?.value ?? 0);
    if (typeof keyframe.calc === 'function') {
        const calculated = keyframe.calc(hasProperty ? PARTICLE_LIFETIME_PROPERTY : 'x');
        if (Number.isFinite(Number(calculated))) return clamp01(calculated);
    }
    return clamp01(raw);
}

function interpolateParticleLifetime(animator) {
    const keyframes = Array.isArray(animator.property) ? animator.property : [];
    if (!keyframes.length) return clamp01(animator.getElement()?.lifetime);
    const time = animator.animation.time;
    let before = null;
    let after = null;
    let beforeTime = 0;
    let afterTime = 0;
    keyframes.forEach(keyframe => {
        if (keyframe.time <= time && (!before || keyframe.time > beforeTime)) {
            before = keyframe;
            beforeTime = keyframe.time;
        }
        if (keyframe.time >= time && (!after || keyframe.time < afterTime)) {
            after = keyframe;
            afterTime = keyframe.time;
        }
    });
    if (Format.animation_loop_wrapping && animator.animation.loop === 'loop' && keyframes.length >= 2) {
        if (!before) {
            before = keyframes.reduce((result, keyframe) => !result || keyframe.time > result.time ? keyframe : result, null);
            beforeTime = before.time - animator.animation.length;
        }
        if (!after) {
            after = keyframes.reduce((result, keyframe) => !result || keyframe.time < result.time ? keyframe : result, null);
            afterTime = after.time + animator.animation.length;
        }
    }
    if (before && Math.abs(beforeTime - time) < 1 / 1200) return readParticleLifetimeKeyframe(before);
    if (after && Math.abs(afterTime - time) < 1 / 1200) return readParticleLifetimeKeyframe(after);
    if (before && !after) return readParticleLifetimeKeyframe(before);
    if (after && !before) return readParticleLifetimeKeyframe(after);
    if (!before || !after) return clamp01(animator.getElement()?.lifetime);
    if (before.interpolation === 'step') return readParticleLifetimeKeyframe(before);
    const factor = Math.getLerp(beforeTime, afterTime, time);
    return clamp01(readParticleLifetimeKeyframe(before)
        + (readParticleLifetimeKeyframe(after) - readParticleLifetimeKeyframe(before)) * factor);
}

export class AMTParticleAnimator extends AMTTransformAnimator {
    constructor(uuid, animation) {
        super(uuid, animation);
        if (!Array.isArray(this.property)) this.property = [];
    }

    select(...args) {
        ensureParticleTimelineResolution(this.animation);
        return super.select(...args);
    }

    displayFrame(multiplier = 1) {
        const element = this.getElement();
        if (!element?.mesh) return;

        AMTParticle.preview_controller.updateTransform(element);
        const mesh = element.mesh;
        if (!this.muted?.rotation) {
            const rotation = this.interpolate('rotation', true);
            if (rotation) {
                mesh.rotation.x += Math.degToRad(rotation[0]) * multiplier;
                mesh.rotation.y += Math.degToRad(rotation[1]) * multiplier;
                mesh.rotation.z += Math.degToRad(rotation[2]) * multiplier;
            }
        }
        if (!this.muted?.position) {
            const position = this.interpolate('position', true);
            if (position) {
                mesh.position.x += position[0] * multiplier;
                mesh.position.y += position[1] * multiplier;
                mesh.position.z += position[2] * multiplier;
            }
        }
        if (!this.muted?.scale) {
            const scale = this.interpolate('scale', true);
            if (scale) {
                mesh.scale.x *= (1 + (scale[0] - 1) * multiplier) || 0.00001;
                mesh.scale.y *= (1 + (scale[1] - 1) * multiplier) || 0.00001;
                mesh.scale.z *= (1 + (scale[2] - 1) * multiplier) || 0.00001;
            }
        }
        mesh.updateMatrixWorld(true);

        const lifetime = this.muted?.property ? clamp01(element.lifetime) : interpolateParticleLifetime(this);
        applyParticlePreviewState(element, lifetime);
    }

    createKeyframe(value, time, channel, undo, select) {
        if (channel !== 'property') return super.createKeyframe(value, time, channel, undo, select);
        if (typeof time !== 'number') time = Timeline.time;
        ensureParticleTimelineResolution(this.animation);
        const keyframes = [];
        if (undo) Undo.initEdit({keyframes});
        const keyframe = new Keyframe({
            channel,
            time,
            interpolation: settings.default_keyframe_interpolation.value
        }, null, this);
        keyframes.push(keyframe);

        let scalar;
        if (typeof value === 'number') scalar = value;
        else if (value && typeof value === 'object')
            scalar = value.property ?? value.x ?? value.value ?? value.data_points?.[0]?.x;
        if (scalar === undefined || scalar === null || scalar === '') scalar = clamp01(this.getElement()?.lifetime);
        keyframe.set(PARTICLE_LIFETIME_PROPERTY, clamp01(scalar));
        keyframe.channel = channel;
        keyframe.time = Timeline.snapTime(time);
        this.property.push(keyframe);
        keyframe.animator = this;
        if (select !== false) keyframe.select();

        const deleted = [];
        delete keyframe.time_before;
        keyframe.replaceOthers(deleted);
        if (deleted.length && Undo.current_save) Undo.addKeyframeCasualties(deleted);
        Animation.selected.setLength();
        if (undo) Undo.finishEdit('Add particle lifetime keyframe');
        return keyframe;
    }
}

AMTParticleAnimator.prototype.type = 'particle';
AMTParticleAnimator.prototype.channels = Object.assign({}, BoneAnimator.prototype.channels, {
    property: {name: 'Lifetime', mutable: true, transform: false, max_data_points: 1}
});
AMTParticle.animator = AMTParticleAnimator;

export function registerParticle() {
    registerParticleKeyframeProperty();
    registerParticlePanel();
    addAction = new Action('add_ii_particle', {
        name: 'AMT Particle',
        description: 'Add an AMT particle preview element',
        icon: 'flare',
        category: 'edit',
        condition: () => Modes.edit,
        click: addElement
    });
    loadAction = new Action('load_ii_particle_definition', {
        name: 'Load AMT Particle Definition...',
        description: 'Load a .fx.amt particle from a resource pack or particle folder',
        icon: 'folder_open',
        category: 'edit',
        condition: () => !!selectedParticle(),
        click() {
            const element = selectedParticle();
            if (element) chooseParticleFromFolder(element);
        }
    });
    propertiesAction = new Action('edit_ii_particle_properties', {
        name: 'AMT Particle Properties...',
        description: 'Apply particle properties through this part\'s AMT model header',
        icon: 'tune',
        category: 'edit',
        condition: () => Modes.edit && !!selectedParticle(),
        click: editParticleProperties
    });
    setParticleFolderAction = new Action('set_ii_particle_folder', {
        name: 'Set AMT Particle Folder...',
        description: 'Choose the persistent resource folder used by every AMT Particle element',
        icon: 'folder_special',
        category: 'edit',
        condition: () => !Blockbench.isWeb,
        click: chooseGlobalParticleFolder
    });
    deletables.push(addAction, loadAction, propertiesAction, setParticleFolderAction);
    BarItems.add_element.side_menu.addAction(addAction);
    window.IIParticleElement = AMTParticle;
    window.IIParticleAnimator = AMTParticleAnimator;
}

export function unregisterParticleActions() {
    clearTimeout(particleIdChangeTimer);
    particleIdChangeTimer = null;
    clearTimeout(particleCacheSyncTimer);
    particleCacheSyncTimer = null;
    deletables.forEach(action => action?.delete?.());
    deletables = [];
    particlePanelStyle = null;
    particleEntryMenu = null;
    setParticleFolderAction = null;
    invalidateParticleFolderIndex();
    particleLifetimeKeyframeProperty?.delete?.();
    particleLifetimeKeyframeProperty = null;
}

export function getParticleElementProperties(element) {
    const particle = String(element.particleId || '').trim();
    return Object.assign({}, normaliseParticleProperties(element.particleProperties), {
        particle,
        correct_rotation: element.correctRotation === true,
        property: clamp01(element.lifetime)
    });
}
