import {
    mergeParticlePreviewDefinitions,
    normaliseParticleDefinition,
    parseParticleProgram,
    resolveParticlePreviewSource
} from '../elements/particle';

export const AMT_PARTICLE_FORMAT_ID = 'ii_amt_particle';
export const AMT_PARTICLE_MODE_ID = 'ii_amt_particle_mode';
export const AMT_PARTICLE_PROJECT_PROPERTY = 'ii_amt_particle_definition';
export const AMT_PARTICLE_CONTEXT_PROPERTY = 'ii_amt_particle_context';

export const PARTICLE_TYPES = [
    'ParticleVanilla', 'ParticleModel', 'ParticleRibbon',
    'ParticleBeam', 'ParticleGlow', 'ParticleLightning'
];

export const DRAW_STAGES = [
    'vanilla', 'vanilla_additive', 'color_only_additive',
    'custom', 'custom_additive', 'custom_smoke_noise_shader', 'custom_solid',
    'color_only_additive_triangles', 'color_only_line_strip', 'color_only_line_strip_thin'
];

export const OFFSPRING_GENERATORS = [
    'same', 'rand_xz', 'circle_xz', 'cone_toward_25',
    'cone_toward_45', 'cone_toward_75', 'cone_toward_90', 'sphere'
];

export const INHERITABLE_PROPERTIES = [
    'previous_position', 'position', 'motion', 'rotation', 'rotation_pitch', 'rotation_yaw',
    'stretch', 'scale', 'size', 'lifetime', 'max_lifetime', 'progress', 'is_alive',
    'on_ground', 'color', 'color_secondary', 'red', 'green', 'blue', 'alpha',
    'textures', 'textures_count', 'texture_shift'
];

export const PROGRAM_TYPES = [
    'dust_transition', 'smoke_transition', 'shockwave_transition', 'color_transition',
    'lifetime_retexture', 'retexture', 'gravity', 'set_rotation', 'rotation', 'emitter',
    'grass_color', 'foliage_color', 'block_color', 'fluid_color'
];

export const PARTICLE_PROPERTY_TYPES = Object.freeze({
    position: {label: 'Position', type: 'vector3', default: [0, 0, 0]},
    motion: {label: 'Motion', type: 'vector3', default: [0, 0, 0]},
    rotation: {label: 'Rotation', type: 'vector2', default: [0, 0]},
    rotation_yaw: {label: 'Rotation Yaw', type: 'number', default: 0},
    rotation_pitch: {label: 'Rotation Pitch', type: 'number', default: 0},
    stretch: {label: 'Stretch Endpoint', type: 'vector3', default: [0, 0, 0]},
    scale: {label: 'Scale', type: 'number', default: 1},
    size: {label: 'Size', type: 'number', default: 1},
    lifetime: {label: 'Starting Lifetime', type: 'integer', default: 0, min: 0},
    aabb: {label: 'AABB Radius', type: 'number', default: 0.25, min: 0},
    color: {label: 'Colour', type: 'text', default: 'FFFFFFFF', placeholder: 'AARRGGBB'},
    color_secondary: {label: 'Secondary Colour', type: 'text', default: 'FFFFFFFF', placeholder: 'AARRGGBB'},
    red: {label: 'Red', type: 'number', default: 1, min: 0, max: 1, step: 0.01},
    green: {label: 'Green', type: 'number', default: 1, min: 0, max: 1, step: 0.01},
    blue: {label: 'Blue', type: 'number', default: 1, min: 0, max: 1, step: 0.01},
    alpha: {label: 'Alpha', type: 'number', default: 1, min: 0, max: 1, step: 0.01},
    texture_shift: {label: 'Texture Shift', type: 'integer', default: 0}
});

const MAX_PREVIEW_TICKS = 600;
const MAX_PREVIEW_PARTICLES = 256;

export function cloneParticleData(value) {
    return JSON.parse(JSON.stringify(value ?? {}));
}

export function createDefaultParticleDefinition() {
    return {
        type: 'ParticleVanilla',
        textures: [],
        models: [],
        max_lifetime: 20,
        draw_stage: 'custom',
        programs: [],
        scheduled: [],
        chained: []
    };
}

export function createDefaultParticleContext() {
    return {sourcePath: '', assetsRoot: '', namespace: 'immersiveintelligence', particleId: ''};
}

export function sanitiseParticleDefinition(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? cloneParticleData(value) : createDefaultParticleDefinition();
    source.type = PARTICLE_TYPES.includes(source.type) ? source.type : 'ParticleVanilla';
    source.max_lifetime = Math.max(1, Math.trunc(Number(source.max_lifetime) || 20));
    source.draw_stage = DRAW_STAGES.includes(source.draw_stage) ? source.draw_stage : 'custom';
    source.textures = Array.isArray(source.textures)
        ? source.textures.filter(value => typeof value === 'string') : [];
    source.models = Array.isArray(source.models)
        ? source.models.filter(value => typeof value === 'string') : [];
    if (!source.models.length && typeof source.model === 'string' && !source.model_range) {
        source.models = [source.model];
        delete source.model;
    }
    source.programs = Array.isArray(source.programs)
        ? source.programs.filter(value => typeof value === 'string') : [];
    source.scheduled = Array.isArray(source.scheduled)
        ? source.scheduled.map(entry => sanitiseOffspring(entry, true)) : [];
    source.chained = Array.isArray(source.chained)
        ? source.chained.map(entry => sanitiseOffspring(entry, false)) : [];
    return source;
}

export function sanitiseOffspring(value, scheduled) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? cloneParticleData(value) : {};
    const entry = Object.assign({
        generator: 'same', type: '', distance: 0, speed: 0, stretch: 0, amount: 1,
        inherited_properties: []
    }, source);
    entry.generator = OFFSPRING_GENERATORS.includes(entry.generator) ? entry.generator : 'same';
    entry.type = String(entry.type || '');
    entry.distance = finiteNumber(entry.distance, 0);
    entry.speed = source.speed === undefined ? entry.distance : finiteNumber(source.speed, entry.distance);
    entry.stretch = finiteNumber(entry.stretch, 0);
    if (Number.isFinite(Number(source.amount)) && Number(source.amount) > 0) {
        entry.amount = Math.max(0, Math.trunc(Number(source.amount)));
        delete entry.min_amount;
        delete entry.max_amount;
    } else {
        delete entry.amount;
        entry.min_amount = Math.max(0, Math.trunc(Number(source.min_amount)) || 0);
        entry.max_amount = Math.max(entry.min_amount, Math.trunc(Number(source.max_amount)) || entry.min_amount);
    }
    entry.inherited_properties = Array.isArray(source.inherited_properties)
        ? source.inherited_properties.filter(name => INHERITABLE_PROPERTIES.includes(name)) : [];
    if (scheduled) entry.time = Math.max(0, Math.trunc(Number(source.time)) || 0);
    else delete entry.time;
    return entry;
}

export function effectiveRootDefinition(value, context) {
    const definition = sanitiseParticleDefinition(value);
    if (typeof definition.parent !== 'string' || !definition.parent.trim())
        return normaliseParticleDefinition(definition);
    const parent = resolveParticlePreviewSource(definition.parent, context);
    return parent ? mergeParticlePreviewDefinitions(parent.definition, definition)
        : normaliseParticleDefinition(definition);
}

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function vector(value, size = 3) {
    return Array.from({length: size}, (_, index) => finiteNumber(value?.[index], 0));
}

function add(first, second) {
    return [first[0] + second[0], first[1] + second[1], first[2] + second[2]];
}

function subtract(first, second) {
    return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function multiply(value, scale) {
    return [value[0] * scale, value[1] * scale, value[2] * scale];
}

function lengthSquared(value) {
    return value[0] * value[0] + value[1] * value[1] + value[2] * value[2];
}

function normalise(value, fallback = [0, 0, 0]) {
    const length = Math.sqrt(lengthSquared(value));
    return length > 1e-12 ? multiply(value, 1 / length) : fallback.slice();
}

function cross(first, second) {
    return [
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0]
    ];
}

function seededRandom(seed = 0x4949414d) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function coneDirection(direction, degrees, random) {
    const forward = normalise(direction, [0, 1, 0]);
    const reference = Math.abs(forward[1]) < 0.999 ? [0, 1, 0] : [1, 0, 0];
    const right = normalise(cross(forward, reference), [1, 0, 0]);
    const up = normalise(cross(right, forward), [0, 0, 1]);
    const minCos = Math.cos(degrees * Math.PI / 180);
    const cosTheta = 1 - random() * (1 - minCos);
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = random() * Math.PI * 2;
    return add(multiply(forward, cosTheta), add(
        multiply(right, Math.cos(phi) * sinTheta),
        multiply(up, Math.sin(phi) * sinTheta)
    ));
}

function generatedOffset(generator, direction, index, distance, amount, random) {
    switch (generator) {
        case 'same': return [0, 0, 0];
        case 'rand_xz': return multiply([random(), 0, random()], distance);
        case 'circle_xz': {
            const angle = Math.PI * 2 * index / Math.max(1, amount);
            return [Math.cos(angle) * distance, 0, Math.sin(angle) * distance];
        }
        case 'sphere': {
            const phi = Math.acos(1 - 2 * random());
            const theta = Math.PI * 2 * random();
            return multiply([
                Math.sin(phi) * Math.cos(theta),
                Math.sin(phi) * Math.sin(theta),
                Math.cos(phi)
            ], distance);
        }
        default: {
            const match = String(generator).match(/^cone_toward_(\d+)$/);
            return match ? multiply(coneDirection(direction, Number(match[1]), random), distance) : [0, 0, 0];
        }
    }
}

function childAmount(entry, random) {
    if (Number.isFinite(Number(entry.amount))) return Math.max(0, Math.trunc(Number(entry.amount)));
    const minimum = Math.max(0, Math.trunc(Number(entry.min_amount)) || 0);
    const maximum = Math.max(minimum, Math.trunc(Number(entry.max_amount)) || minimum);
    return minimum + (maximum > minimum ? Math.floor(random() * (maximum - minimum)) : 0);
}

function inheritedValue(parent, name) {
    switch (name) {
        case 'previous_position': return parent.previousPosition.slice();
        case 'position': return parent.position.slice();
        case 'motion': return parent.motion.slice();
        case 'rotation': return parent.rotation.slice();
        case 'rotation_yaw': return parent.rotation[0];
        case 'rotation_pitch': return parent.rotation[1];
        case 'stretch': return parent.stretch.slice();
        case 'lifetime': return parent.life;
        case 'max_lifetime': return parent.maxLifetime;
        case 'progress': return parent.life / Math.max(1, parent.maxLifetime);
        case 'is_alive': return parent.life < parent.maxLifetime;
        case 'on_ground': return false;
        case 'textures_count': return Array.isArray(parent.definition.textures) ? parent.definition.textures.length : 0;
        default: return parent.definition[name] === undefined ? undefined : cloneParticleData(parent.definition[name]);
    }
}

function applyInheritedProperties(child, parent, names) {
    (Array.isArray(names) ? names : []).forEach(name => {
        const value = inheritedValue(parent, name);
        if (value === undefined) return;
        if (name === 'position') child.position = vector(value);
        else if (name === 'previous_position') child.previousPosition = vector(value);
        else if (name === 'motion') child.motion = vector(value);
        else if (name === 'rotation') child.rotation = vector(value, 2);
        else if (name === 'rotation_yaw') child.rotation[0] = finiteNumber(value);
        else if (name === 'rotation_pitch') child.rotation[1] = finiteNumber(value);
        else if (name === 'stretch') child.stretch = vector(value);
        else if (name === 'lifetime') child.life = Math.max(0, Math.trunc(finiteNumber(value)));
        else if (name === 'max_lifetime') child.maxLifetime = Math.max(1, Math.trunc(finiteNumber(value, 20)));
        else if (!['progress', 'is_alive', 'on_ground', 'textures_count'].includes(name))
            child.definition[name] = value;
    });
}

function makeParticle(id, definition, context, options = {}) {
    const normalised = normaliseParticleDefinition(definition);
    const position = vector(options.position ?? normalised.position);
    const particle = {
        id,
        definition: normalised,
        context: Object.assign({assetsRoot: '', namespace: 'immersiveintelligence', particleId: ''}, context),
        life: Math.max(0, Math.trunc(finiteNumber(options.life, normalised.lifetime || 0))),
        maxLifetime: Math.max(1, Math.trunc(finiteNumber(normalised.max_lifetime, 20))),
        position,
        previousPosition: position.slice(),
        motion: vector(options.motion ?? normalised.motion),
        rotation: vector(options.rotation ?? normalised.rotation, 2),
        stretch: vector(options.stretch ?? normalised.stretch)
    };
    normalised.programs.map(parseParticleProgram).forEach(program => {
        if (program.name === 'set_rotation') {
            particle.rotation[0] = finiteNumber(program.args[0]);
            particle.rotation[1] = finiteNumber(program.args[1]);
        }
    });
    return particle;
}

function resolvedChild(type, parentContext, cache, missing) {
    const cacheKey = `${parentContext.namespace || 'immersiveintelligence'}:${String(type || '')}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const source = resolveParticlePreviewSource(type, parentContext);
    if (!source) {
        missing.add(String(type || '(empty particle ID)'));
        cache.set(cacheKey, null);
        return null;
    }
    const result = {definition: normaliseParticleDefinition(source.definition), context: source.context};
    cache.set(cacheKey, result);
    return result;
}

function spawnOffspring(entry, parent, state) {
    const resolved = resolvedChild(entry.type, parent.context, state.definitionCache, state.missing);
    if (!resolved) return [];
    const amount = Math.min(childAmount(entry, state.random), state.maxParticles - state.totalParticles);
    const direction = normalise(parent.motion, [0, 1, 0]);
    const distance = finiteNumber(entry.distance);
    const speed = Number.isFinite(Number(entry.speed)) ? Number(entry.speed) : distance;
    const stretchLength = finiteNumber(entry.stretch);
    const particles = [];
    for (let index = 0; index < amount; index++) {
        const offset = generatedOffset(entry.generator, direction, index, distance, amount, state.random);
        const position = add(parent.position, offset);
        let motionDirection = normalise(offset);
        if (lengthSquared(motionDirection) <= 1e-12) {
            const unitOffset = generatedOffset(entry.generator, direction, index, 1, amount, state.random);
            motionDirection = normalise(unitOffset);
        }
        const motion = multiply(motionDirection, speed);
        const stretchDirection = normalise(lengthSquared(motion) > 1e-12 ? motion
            : (lengthSquared(offset) > 1e-12 ? offset : direction));
        const stretch = add(position, multiply(stretchDirection, stretchLength));
        const child = makeParticle(`particle_${state.nextId++}`, resolved.definition, resolved.context, {
            position, motion, rotation: [0, 0], stretch
        });
        applyInheritedProperties(child, parent, entry.inherited_properties);
        particles.push(child);
        state.totalParticles++;
    }
    return particles;
}

function emitterEntry(program) {
    if (program.args.length < 5) return null;
    const amount = Math.max(0, Math.trunc(finiteNumber(program.args[4], 1)));
    const entry = {
        type: program.args[1], generator: String(program.args[2] || 'same').toLowerCase(),
        distance: finiteNumber(program.args[3]), speed: finiteNumber(program.args[3]), stretch: 0,
        inherited_properties: program.args.slice(7).map(value => String(value).trim().toLowerCase())
            .filter(value => INHERITABLE_PROPERTIES.includes(value))
    };
    if (program.args[5] !== undefined) {
        entry.min_amount = amount;
        entry.max_amount = Math.max(amount, Math.trunc(finiteNumber(program.args[5], amount)));
    } else entry.amount = amount;
    return {interval: Math.max(1, Math.trunc(finiteNumber(program.args[0], 20))), entry};
}

function updateParticle(particle, state) {
    const additionsBeforeMove = [];
    particle.previousPosition = particle.position.slice();
    particle.definition.programs.map(parseParticleProgram).forEach(program => {
        if (program.name === 'gravity') {
            const dampen = finiteNumber(program.args[0], 1);
            particle.motion = multiply(particle.motion, dampen);
            particle.motion[1] -= finiteNumber(program.args[1]);
        } else if (program.name === 'rotation') {
            particle.rotation[0] += finiteNumber(program.args[0]);
            particle.rotation[1] += finiteNumber(program.args[1]);
        } else if (program.name === 'emitter') {
            const emitter = emitterEntry(program);
            if (emitter && particle.life % emitter.interval === 0)
                additionsBeforeMove.push(...spawnOffspring(emitter.entry, particle, state));
        }
    });
    particle.position = add(particle.position, particle.motion);
    const scheduled = Array.isArray(particle.definition.scheduled) ? particle.definition.scheduled : [];
    const additionsAfterMove = scheduled.filter(entry => Math.trunc(Number(entry.time)) === particle.life)
        .flatMap(entry => spawnOffspring(entry, particle, state));
    particle.life++;
    const chained = particle.life >= particle.maxLifetime && Array.isArray(particle.definition.chained)
        ? particle.definition.chained.flatMap(entry => spawnOffspring(entry, particle, state)) : [];
    return [...additionsBeforeMove, ...additionsAfterMove, ...chained];
}

function snapshotParticle(particle) {
    const definition = Object.assign({}, particle.definition, {
        motion: particle.motion.slice(),
        rotation: particle.rotation.slice(),
        stretch: subtract(particle.stretch, particle.position),
        programs: particle.definition.programs.filter(value => {
            const name = parseParticleProgram(value).name;
            return name !== 'rotation' && name !== 'set_rotation';
        })
    });
    return {
        id: particle.id,
        definition,
        context: particle.context,
        position: particle.position.slice(),
        progress: Math.max(0, Math.min(1, particle.life / Math.max(1, particle.maxLifetime)))
    };
}

export function simulateParticleSystem(value, context, options = {}) {
    const definition = effectiveRootDefinition(value, context);
    const state = {
        random: seededRandom(options.seed),
        definitionCache: new Map(),
        missing: new Set(),
        nextId: 1,
        totalParticles: 1,
        maxParticles: Math.max(1, Math.trunc(options.maxParticles || MAX_PREVIEW_PARTICLES))
    };
    let particles = [makeParticle('particle_0', definition, context)];
    const frames = [];
    const maxTicks = Math.max(1, Math.trunc(options.maxTicks || MAX_PREVIEW_TICKS));
    let limited = false;
    for (let tick = 0; tick <= maxTicks; tick++) {
        frames.push(particles.filter(particle => particle.life < particle.maxLifetime).map(snapshotParticle));
        if (!particles.length) break;
        const additions = [];
        particles.forEach(particle => {
            if (particle.life < particle.maxLifetime) additions.push(...updateParticle(particle, state));
        });
        particles = particles.filter(particle => particle.life < particle.maxLifetime).concat(additions);
        if (state.totalParticles >= state.maxParticles) limited = true;
        if (tick === maxTicks) limited = true;
    }
    return {
        frames,
        duration: Math.max(0, frames.length - 1),
        missing: [...state.missing],
        limited,
        particleCount: state.totalParticles
    };
}
