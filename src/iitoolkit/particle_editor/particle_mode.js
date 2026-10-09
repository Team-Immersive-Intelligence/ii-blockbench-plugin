/* global Mode, ModelProject, Panel, Panels, Property, THREE, addRecentProject, newProject, scene, setupProject */
/* eslint-disable no-console */
import {
    createStandaloneParticlePreview,
    disposeStandaloneParticlePreview,
    parseParticleProgram,
    particlePreviewContextFromPath,
    updateStandaloneParticlePreview
} from '../elements/particle';
import {
    AMT_PARTICLE_CONTEXT_PROPERTY,
    AMT_PARTICLE_FORMAT_ID,
    AMT_PARTICLE_MODE_ID,
    AMT_PARTICLE_PROJECT_PROPERTY,
    DRAW_STAGES,
    OFFSPRING_GENERATORS,
    PARTICLE_PROPERTY_TYPES,
    PARTICLE_TYPES,
    PROGRAM_TYPES,
    cloneParticleData,
    createDefaultParticleContext,
    createDefaultParticleDefinition,
    sanitiseOffspring,
    sanitiseParticleDefinition,
    simulateParticleSystem
} from './particle_data';

const PANEL_IDS = [
    'ii_amt_particle_definition', 'ii_amt_particle_offspring',
    'ii_amt_particle_programs', 'ii_amt_particle_timeline'
];
const SHAPE_PARTICLE_TYPES = new Set(['ParticleBeam', 'ParticleRibbon', 'ParticleLightning']);
const PROGRAM_DEFAULT_ARGUMENTS = {
    smoke_transition: '', shockwave_transition: '', color_transition: 'FFFFFFFF,00FFFFFF',
    retexture: '0,immersiveintelligence:particle/round', gravity: '1,0.04',
    set_rotation: '0,0', rotation: '0,0', emitter: '20,particle,same,0,1',
    block_color: '1', fluid_color: '1'
};

let deletables = [];
let particleFormat = null;
let particleCodec = null;
let particleMode = null;
let previewRoot = null;
let simulation = {frames: [[]], duration: 0, missing: [], limited: false, particleCount: 0};
let previewTime = 0;
let playing = false;
let playbackFrame = null;
let playbackStartedAt = 0;
let playbackStartedTime = 0;
let rebuildTimer = null;
let visualRecords = new Map();

function track(...items) {
    items.filter(Boolean).forEach(item => deletables.push(item));
}

function formatActive() {
    return Format?.id === AMT_PARTICLE_FORMAT_ID;
}

function activateParticleEditor() {
    if (!formatActive() || !particleMode) return;
    if (!particleMode.selected) particleMode.select();
    else rebuildSimulation();
}

function activateParticleEditorNextFrame() {
    requestAnimationFrame(activateParticleEditor);
}

function getDefinition() {
    if (!Project) return createDefaultParticleDefinition();
    if (!Project[AMT_PARTICLE_PROJECT_PROPERTY])
        Project[AMT_PARTICLE_PROJECT_PROPERTY] = createDefaultParticleDefinition();
    return Project[AMT_PARTICLE_PROJECT_PROPERTY];
}

function getContext() {
    if (!Project) return createDefaultParticleContext();
    if (!Project[AMT_PARTICLE_CONTEXT_PROPERTY])
        Project[AMT_PARTICLE_CONTEXT_PROPERTY] = createDefaultParticleContext();
    return Project[AMT_PARTICLE_CONTEXT_PROPERTY];
}

function forcePanelUpdate(id = '') {
    const ids = id ? [id] : PANEL_IDS;
    ids.forEach(panelId => Panels?.[panelId]?.inside_vue?.$forceUpdate?.());
}

function markProjectDirty() {
    if (!Project) return;
    Project.saved = false;
    Blockbench.dispatchEvent('saved_state_changed', {project: Project});
}

function mutateDefinition(label, mutation, rebuild = true) {
    if (!formatActive() || !Project) return;
    Undo.initEdit({amt_particle: true});
    mutation(getDefinition());
    Project[AMT_PARTICLE_PROJECT_PROPERTY] = sanitiseParticleDefinition(getDefinition());
    Undo.finishEdit(label, {amt_particle: true});
    markProjectDirty();
    forcePanelUpdate();
    if (rebuild) scheduleSimulationRebuild();
}

function attachPreviewRoot() {
    if (!previewRoot) {
        previewRoot = new THREE.Group();
        previewRoot.name = 'ii_amt_particle_system_preview';
        previewRoot.no_export = true;
    }
    if (previewRoot.parent !== scene) scene.add(previewRoot);
}

function clearPreviewVisuals() {
    visualRecords.forEach(record => {
        record.cancelled = true;
        if (record.instance) disposeStandaloneParticlePreview(record.instance);
    });
    visualRecords.clear();
    if (previewRoot) {
        while (previewRoot.children.length) previewRoot.remove(previewRoot.children[0]);
    }
}

function detachPreviewRoot() {
    clearPreviewVisuals();
    previewRoot?.parent?.remove(previewRoot);
}

function previewFrame(index) {
    if (!simulation.frames.length) return [];
    return simulation.frames[Math.max(0, Math.min(simulation.frames.length - 1, index))] || [];
}

function interpolate(first, second, amount) {
    return first + (second - first) * amount;
}

function previewSignature(particle, tick) {
    const definition = particle.definition;
    const shape = SHAPE_PARTICLE_TYPES.has(definition.type)
        ? `:${tick}:${JSON.stringify(definition.stretch || [])}` : '';
    return [definition.type, definition.draw_stage,
        JSON.stringify(definition.textures || []), JSON.stringify(definition.models || []), shape].join('|');
}

function positionVisual(record, particle, nextParticle, fraction) {
    if (!record.instance) return;
    const nextPosition = nextParticle?.position || particle.position;
    record.instance.object.position.set(
        interpolate(particle.position[0], nextPosition[0], fraction) * 16,
        interpolate(particle.position[1], nextPosition[1], fraction) * 16,
        interpolate(particle.position[2], nextPosition[2], fraction) * 16
    );
    const nextProgress = nextParticle?.progress ?? particle.progress;
    updateStandaloneParticlePreview(record.instance, particle.definition,
        interpolate(particle.progress, nextProgress, fraction));
    record.instance.object.updateMatrixWorld(true);
}

function createVisualRecord(particle, nextParticle, fraction, signature) {
    const record = {instance: null, signature, cancelled: false};
    visualRecords.set(particle.id, record);
    createStandaloneParticlePreview(particle.definition, particle.context, {
        progress: particle.progress, correctRotation: true
    }).then(instance => {
        if (record.cancelled || visualRecords.get(particle.id) !== record || !formatActive()) {
            disposeStandaloneParticlePreview(instance);
            return;
        }
        record.instance = instance;
        previewRoot.add(instance.object);
        positionVisual(record, particle, nextParticle, fraction);
        Canvas.updateAll?.();
    }).catch(error => {
        console.warn('Could not create AMT particle editor preview:', error);
        if (visualRecords.get(particle.id) === record) visualRecords.delete(particle.id);
    });
    return record;
}

function renderPreviewAtTime() {
    if (!formatActive()) return;
    attachPreviewRoot();
    const tick = Math.floor(previewTime);
    const fraction = previewTime - tick;
    const current = previewFrame(tick);
    const next = new Map(previewFrame(tick + 1).map(particle => [particle.id, particle]));
    const desired = new Set(current.map(particle => particle.id));
    visualRecords.forEach((record, id) => {
        if (desired.has(id)) return;
        record.cancelled = true;
        if (record.instance) disposeStandaloneParticlePreview(record.instance);
        visualRecords.delete(id);
    });
    current.forEach(particle => {
        const nextParticle = next.get(particle.id);
        const signature = previewSignature(particle, tick);
        let record = visualRecords.get(particle.id);
        if (record && record.signature !== signature) {
            record.cancelled = true;
            if (record.instance) disposeStandaloneParticlePreview(record.instance);
            visualRecords.delete(particle.id);
            record = null;
        }
        if (!record) record = createVisualRecord(particle, nextParticle, fraction, signature);
        positionVisual(record, particle, nextParticle, fraction);
    });
    Canvas.updateAll?.();
}

function rebuildSimulation() {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
    if (!formatActive()) return;
    clearPreviewVisuals();
    simulation = simulateParticleSystem(getDefinition(), getContext());
    previewTime = Math.max(0, Math.min(previewTime, simulation.duration));
    renderPreviewAtTime();
    forcePanelUpdate();
}

function scheduleSimulationRebuild(delay = 80) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuildSimulation, delay);
}

function setPreviewTime(value) {
    previewTime = Math.max(0, Math.min(simulation.duration, Number(value) || 0));
    renderPreviewAtTime();
    forcePanelUpdate('ii_amt_particle_timeline');
}

function playbackStep(now) {
    if (!playing || !formatActive()) return;
    const elapsedTicks = (now - playbackStartedAt) / 50;
    let time = playbackStartedTime + elapsedTicks;
    if (time > simulation.duration) {
        time = simulation.duration ? time % simulation.duration : 0;
        playbackStartedAt = now;
        playbackStartedTime = time;
    }
    setPreviewTime(time);
    playbackFrame = requestAnimationFrame(playbackStep);
}

function setPlaying(value) {
    const next = value === undefined ? !playing : !!value;
    if (next === playing) return;
    playing = next;
    if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
    playbackFrame = null;
    if (playing) {
        if (previewTime >= simulation.duration) previewTime = 0;
        playbackStartedAt = performance.now();
        playbackStartedTime = previewTime;
        playbackFrame = requestAnimationFrame(playbackStep);
    }
    forcePanelUpdate('ii_amt_particle_timeline');
}

function stopPlayback() {
    setPlaying(false);
}

function filePath(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return filePath(value[0]);
    return filePath(value.path || value.filePath || value.name || '');
}

function normalisePath(value) {
    return String(value || '').replace(/\\/g, '/');
}

function resourceFromFile(path, kind) {
    const normalised = normalisePath(path);
    const category = kind === 'textures' ? 'textures' : 'models/particle';
    const match = normalised.match(new RegExp(`/assets/([^/]+)/${category.replace('/', '\\/')}/(.+)$`, 'i'));
    if (match) {
        const extension = kind === 'textures' ? /\.png$/i : /\.obj$/i;
        const resource = match[2].replace(extension, kind === 'textures' ? '' : '.obj');
        const assetsIndex = normalised.toLowerCase().lastIndexOf('/assets/');
        const context = getContext();
        if (!context.assetsRoot && assetsIndex >= 0) context.assetsRoot = normalised.substring(0, assetsIndex + 7);
        if (!context.namespace) context.namespace = match[1];
        return `${match[1]}:${resource}`;
    }
    return normalised.substring(normalised.lastIndexOf('/') + 1)
        .replace(kind === 'textures' ? /\.png$/i : /\.obj$/i, kind === 'textures' ? '' : '.obj');
}

function chooseResource(kind, index) {
    Blockbench.import({
        resource_id: `ii_amt_particle_${kind}`,
        type: kind === 'textures' ? 'Particle Texture' : 'Particle OBJ Model',
        extensions: [kind === 'textures' ? 'png' : 'obj'],
        readtype: kind === 'textures' ? 'image' : 'text', multiple: false
    }, files => {
        if (!files?.length) return;
        const value = resourceFromFile(filePath(files[0]), kind);
        mutateDefinition(`Select particle ${kind === 'textures' ? 'texture' : 'model'}`, definition => {
            definition[kind][index] = value;
        });
    });
}

function addResource(kind) {
    mutateDefinition(`Add particle ${kind === 'textures' ? 'texture' : 'model'}`, definition => {
        if (!Array.isArray(definition[kind])) definition[kind] = [];
        definition[kind].push('');
    });
}

function setResource(kind, index, value) {
    mutateDefinition(`Change particle ${kind === 'textures' ? 'texture' : 'model'}`, definition => {
        definition[kind][index] = String(value || '').trim();
    });
}

function removeResource(kind, index) {
    mutateDefinition(`Remove particle ${kind === 'textures' ? 'texture' : 'model'}`, definition => {
        definition[kind].splice(index, 1);
    });
}

function setCoreProperty(key, value) {
    mutateDefinition(`Change particle ${key.replace(/_/g, ' ')}`, definition => {
        if (key === 'max_lifetime') definition[key] = Math.max(1, Math.trunc(Number(value) || 1));
        else definition[key] = String(value || '');
    });
}

function propertyRows() {
    const definition = getDefinition();
    return Object.entries(PARTICLE_PROPERTY_TYPES).filter(([name]) => definition[name] !== undefined)
        .map(([name, metadata]) => ({name, metadata, value: definition[name]}));
}

function additionalPropertyMetadata(name, value) {
    if (PARTICLE_PROPERTY_TYPES[name]) return PARTICLE_PROPERTY_TYPES[name];
    if (name === 'draw_stage') return {label: name, type: 'enum', options: DRAW_STAGES};
    if (name === 'type') return {label: name, type: 'enum', options: PARTICLE_TYPES};
    if (typeof value === 'number') return {label: name, type: 'number', step: 0.01};
    if (typeof value === 'boolean') return {label: name, type: 'boolean'};
    if (Array.isArray(value) && value.length >= 2 && value.length <= 3
        && value.every(component => Number.isFinite(Number(component))))
        return {label: name, type: value.length === 2 ? 'vector2' : 'vector3'};
    return {label: name, type: 'text'};
}

function additionalPropertyRows(bucket) {
    const values = getDefinition()[bucket];
    if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
    return Object.entries(values).map(([name, value]) => ({
        name, value, metadata: additionalPropertyMetadata(name, value)
    }));
}

function setParticleProperty(name, value, component = -1) {
    const metadata = PARTICLE_PROPERTY_TYPES[name];
    if (!metadata) return;
    mutateDefinition(`Change particle ${metadata.label.toLowerCase()}`, definition => {
        if (metadata.type.startsWith('vector')) {
            const size = metadata.type === 'vector2' ? 2 : 3;
            const vectorValue = Array.isArray(definition[name]) ? definition[name].slice(0, size) : metadata.default.slice();
            while (vectorValue.length < size) vectorValue.push(0);
            vectorValue[component] = Number(value) || 0;
            definition[name] = vectorValue;
        } else if (metadata.type === 'number' || metadata.type === 'integer') {
            let number = Number(value);
            if (!Number.isFinite(number)) number = metadata.default;
            if (metadata.type === 'integer') number = Math.trunc(number);
            if (metadata.min !== undefined) number = Math.max(metadata.min, number);
            if (metadata.max !== undefined) number = Math.min(metadata.max, number);
            definition[name] = number;
        } else definition[name] = String(value || '');
    });
}

function addParticleProperty() {
    const options = {};
    Object.entries(PARTICLE_PROPERTY_TYPES).forEach(([name, metadata]) => {
        if (getDefinition()[name] === undefined) options[name] = metadata.label;
    });
    if (!Object.keys(options).length) {
        Blockbench.showQuickMessage('All particle properties are already present');
        return;
    }
    new Dialog('ii_amt_particle_add_property', {
        title: 'Add Particle Property',
        form: {property: {label: 'Property', type: 'select', options, value: Object.keys(options)[0]}},
        onConfirm(result) {
            this.hide();
            mutateDefinition('Add particle property', definition => {
                definition[result.property] = cloneParticleData(PARTICLE_PROPERTY_TYPES[result.property].default);
            });
        }
    }).show();
}

function removeParticleProperty(name) {
    mutateDefinition('Remove particle property', definition => delete definition[name]);
}

function setAdditionalProperty(bucket, name, value, component = -1) {
    const metadata = additionalPropertyMetadata(name, getDefinition()[bucket]?.[name]);
    mutateDefinition(`Change ${bucket.replace('_', ' ')} entry`, definition => {
        if (!definition[bucket] || typeof definition[bucket] !== 'object') definition[bucket] = {};
        if (metadata.type.startsWith('vector')) {
            const size = metadata.type === 'vector2' ? 2 : 3;
            const result = Array.isArray(definition[bucket][name])
                ? definition[bucket][name].slice(0, size) : Array(size).fill(0);
            while (result.length < size) result.push(0);
            result[component] = Number(value) || 0;
            definition[bucket][name] = result;
        } else if (metadata.type === 'number') definition[bucket][name] = Number(value) || 0;
        else if (metadata.type === 'boolean') definition[bucket][name] = value === true || value === 'true';
        else definition[bucket][name] = String(value || '');
    });
}

function addAdditionalProperty(bucket) {
    new Dialog(`ii_amt_particle_add_${bucket}`, {
        title: bucket === 'properties' ? 'Add Additional Property' : 'Add Dynamic Property',
        form: {
            name: {label: 'Name', type: 'text', value: ''},
            valueType: {
                label: 'Value Type', type: 'select', value: 'text',
                options: {text: 'Text', number: 'Number', boolean: 'Boolean', vector3: 'Vector'}
            }
        },
        onConfirm(result) {
            const name = String(result.name || '').trim();
            if (!name) return;
            this.hide();
            mutateDefinition(`Add ${bucket.replace('_', ' ')} entry`, definition => {
                if (!definition[bucket] || typeof definition[bucket] !== 'object') definition[bucket] = {};
                definition[bucket][name] = result.valueType === 'number' ? 0
                    : result.valueType === 'boolean' ? false
                        : result.valueType === 'vector3' ? [0, 0, 0] : '';
            });
        }
    }).show();
}

function removeAdditionalProperty(bucket, name) {
    mutateDefinition(`Remove ${bucket.replace('_', ' ')} entry`, definition => {
        if (!definition[bucket]) return;
        delete definition[bucket][name];
        if (!Object.keys(definition[bucket]).length) delete definition[bucket];
    });
}

function addOffspring(kind) {
    mutateDefinition(`Add ${kind} offspring`, definition => {
        definition[kind].push(sanitiseOffspring({
            time: 0, generator: 'same', type: '', distance: 0, speed: 0, stretch: 0, amount: 1
        }, kind === 'scheduled'));
    });
}

function removeOffspring(kind, index) {
    mutateDefinition(`Remove ${kind} offspring`, definition => definition[kind].splice(index, 1));
}

function setOffspringValue(kind, index, key, value) {
    mutateDefinition(`Change ${kind} offspring`, definition => {
        const entry = definition[kind][index];
        if (!entry) return;
        if (key === 'type' || key === 'generator') entry[key] = String(value || '');
        else if (key === 'inherited_properties') {
            entry.inherited_properties = String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
        } else if (key === 'amount') {
            if (value === '') {
                delete entry.amount;
                entry.min_amount = Number.isFinite(Number(entry.min_amount)) ? Number(entry.min_amount) : 1;
                entry.max_amount = Number.isFinite(Number(entry.max_amount)) ? Number(entry.max_amount) : entry.min_amount;
            } else {
                entry.amount = Math.max(0, Math.trunc(Number(value) || 0));
                delete entry.min_amount;
                delete entry.max_amount;
            }
        } else if (key === 'min_amount' || key === 'max_amount') {
            delete entry.amount;
            entry[key] = Math.max(0, Math.trunc(Number(value) || 0));
            if (key === 'min_amount' && Number(entry.max_amount) < entry.min_amount) entry.max_amount = entry.min_amount;
            if (key === 'max_amount' && Number(entry.min_amount) > entry.max_amount) entry.min_amount = entry.max_amount;
        } else if (key === 'time') entry.time = Math.max(0, Math.trunc(Number(value) || 0));
        else entry[key] = Number(value) || 0;
    });
}

function programName(value) {
    return parseParticleProgram(value).name;
}

function programArguments(value) {
    return parseParticleProgram(value).args.join(',');
}

function formatProgram(name, args) {
    const trimmedName = String(name || '').trim();
    const trimmedArgs = String(args || '').trim();
    return trimmedArgs ? `${trimmedName}(${trimmedArgs})` : trimmedName;
}

function addProgram(name) {
    const program = String(name || PROGRAM_TYPES[0]);
    mutateDefinition('Add particle programme', definition => {
        definition.programs.push(formatProgram(program, PROGRAM_DEFAULT_ARGUMENTS[program] || ''));
    });
}

function setProgramName(index, name) {
    mutateDefinition('Change particle programme', definition => {
        const old = parseParticleProgram(definition.programs[index]);
        const args = PROGRAM_DEFAULT_ARGUMENTS[name] !== undefined
            ? PROGRAM_DEFAULT_ARGUMENTS[name] : old.args.join(',');
        definition.programs[index] = formatProgram(name, args);
    });
}

function setProgramArguments(index, args) {
    mutateDefinition('Change particle programme arguments', definition => {
        definition.programs[index] = formatProgram(programName(definition.programs[index]), args);
    });
}

function moveProgram(index, direction) {
    mutateDefinition('Reorder particle programmes', definition => {
        const target = index + direction;
        if (target < 0 || target >= definition.programs.length) return;
        const value = definition.programs.splice(index, 1)[0];
        definition.programs.splice(target, 0, value);
    });
}

function removeProgram(index) {
    mutateDefinition('Remove particle programme', definition => definition.programs.splice(index, 1));
}

function panelPosition(side, index, height) {
    return {slot: side, sidebar_index: index, height};
}

function registerPanels() {
    const definitionPanel = new Panel('ii_amt_particle_definition', {
        name: 'Particle', icon: 'flare', condition: {modes: [AMT_PARTICLE_MODE_ID]},
        default_position: panelPosition('left_bar', 0, 520), growable: true, resizable: true,
        component: {
            data() { return {revision: 0}; },
            computed: {
                definition() { this.revision; return getDefinition(); },
                types() { return PARTICLE_TYPES; },
                drawStages() { return DRAW_STAGES; },
                properties() { this.revision; return propertyRows(); },
                additionalProperties() { this.revision; return additionalPropertyRows('properties'); },
                dynamicProperties() { this.revision; return additionalPropertyRows('dynamic_properties'); }
            },
            methods: {
                setCoreProperty, addResource, setResource, removeResource, chooseResource,
                setParticleProperty, addParticleProperty, removeParticleProperty,
                setAdditionalProperty, addAdditionalProperty, removeAdditionalProperty
            },
            template: `
                <div class="ii_amt_particle_panel ii_amt_particle_definition_panel">
                    <label>Particle Type</label>
                    <select :value="definition.type" @change="setCoreProperty('type', $event.target.value)"><option v-for="type in types" :value="type">{{type}}</option></select>
                    <label>Parent Particle</label>
                    <input type="text" autocomplete="off" placeholder="optional/parent" :value="definition.parent || ''" @change="setCoreProperty('parent', $event.target.value)">
                    <div class="ii_amt_particle_core_grid">
                        <span><label>Maximum Lifetime</label><input type="number" min="1" step="1" :value="definition.max_lifetime" @change="setCoreProperty('max_lifetime', $event.target.value)"></span>
                        <span><label>Draw Stage</label><select :value="definition.draw_stage" @change="setCoreProperty('draw_stage', $event.target.value)"><option v-for="stage in drawStages" :value="stage">{{stage}}</option></select></span>
                    </div>
                    <div class="ii_amt_particle_section_header"><b>Textures</b><button title="Add texture" @click="addResource('textures')"><i class="material-icons">add</i></button></div>
                    <div class="ii_amt_particle_asset" v-for="(texture, index) in definition.textures">
                        <input type="text" :value="texture" placeholder="namespace:particle/texture" @change="setResource('textures', index, $event.target.value)">
                        <button title="Select texture file" @click="chooseResource('textures', index)"><i class="material-icons">folder_open</i></button>
                        <button title="Remove texture" @click="removeResource('textures', index)"><i class="material-icons">delete</i></button>
                    </div>
                    <div class="ii_amt_particle_empty" v-if="!definition.textures.length">No textures.</div>
                    <div class="ii_amt_particle_section_header"><b>Models</b><button title="Add OBJ model" @click="addResource('models')"><i class="material-icons">add</i></button></div>
                    <div class="ii_amt_particle_asset" v-for="(model, index) in definition.models">
                        <input type="text" :value="model" placeholder="particle/model.obj" @change="setResource('models', index, $event.target.value)">
                        <button title="Select OBJ model" @click="chooseResource('models', index)"><i class="material-icons">folder_open</i></button>
                        <button title="Remove model" @click="removeResource('models', index)"><i class="material-icons">delete</i></button>
                    </div>
                    <div class="ii_amt_particle_empty" v-if="!definition.models.length">No models.</div>
                    <div class="ii_amt_particle_section_header"><b>Properties</b><button title="Add property" @click="addParticleProperty()"><i class="material-icons">add</i></button></div>
                    <div class="ii_amt_particle_property" v-for="row in properties" :key="row.name">
                        <label :title="row.name">{{row.metadata.label}}</label>
                        <div class="ii_amt_particle_vector" v-if="row.metadata.type === 'vector3' || row.metadata.type === 'vector2'">
                            <span v-for="(axis, component) in (row.metadata.type === 'vector2' ? ['Y','P'] : ['X','Y','Z'])"><i>{{axis}}</i><input type="number" step="0.01" :value="row.value[component]" @change="setParticleProperty(row.name, $event.target.value, component)"></span>
                        </div>
                        <input v-else-if="row.metadata.type === 'number' || row.metadata.type === 'integer'" type="number" :min="row.metadata.min" :max="row.metadata.max" :step="row.metadata.step || (row.metadata.type === 'integer' ? 1 : 0.01)" :value="row.value" @change="setParticleProperty(row.name, $event.target.value)">
                        <input v-else type="text" :placeholder="row.metadata.placeholder || ''" :value="row.value" @change="setParticleProperty(row.name, $event.target.value)">
                        <button title="Remove property" @click="removeParticleProperty(row.name)"><i class="material-icons">delete</i></button>
                    </div>
                    <div class="ii_amt_particle_empty" v-if="!properties.length">Add only the properties this particle overrides.</div>
                    <div class="ii_amt_particle_section_header"><b>Additional Properties</b><button title="Add additional property" @click="addAdditionalProperty('properties')"><i class="material-icons">add</i></button></div>
                    <div class="ii_amt_particle_property" v-for="row in additionalProperties" :key="'properties:' + row.name">
                        <label :title="row.name">{{row.metadata.label}}</label>
                        <div class="ii_amt_particle_vector" v-if="row.metadata.type === 'vector3' || row.metadata.type === 'vector2'">
                            <span v-for="(axis, component) in (row.metadata.type === 'vector2' ? ['Y','P'] : ['X','Y','Z'])"><i>{{axis}}</i><input type="number" step="0.01" :value="row.value[component]" @change="setAdditionalProperty('properties', row.name, $event.target.value, component)"></span>
                        </div>
                        <select v-else-if="row.metadata.type === 'enum'" :value="row.value" @change="setAdditionalProperty('properties', row.name, $event.target.value)"><option v-for="option in row.metadata.options" :value="option">{{option}}</option></select>
                        <select v-else-if="row.metadata.type === 'boolean'" :value="String(row.value)" @change="setAdditionalProperty('properties', row.name, $event.target.value)"><option value="true">true</option><option value="false">false</option></select>
                        <input v-else :type="row.metadata.type === 'number' ? 'number' : 'text'" :step="row.metadata.step || 0.01" :value="row.value" @change="setAdditionalProperty('properties', row.name, $event.target.value)">
                        <button title="Remove additional property" @click="removeAdditionalProperty('properties', row.name)"><i class="material-icons">delete</i></button>
                    </div>
                    <div class="ii_amt_particle_empty" v-if="!additionalProperties.length">No additional properties.</div>
                    <div class="ii_amt_particle_section_header"><b>Dynamic Properties</b><button title="Add dynamic property" @click="addAdditionalProperty('dynamic_properties')"><i class="material-icons">add</i></button></div>
                    <div class="ii_amt_particle_property" v-for="row in dynamicProperties" :key="'dynamic:' + row.name">
                        <label :title="row.name">{{row.metadata.label}}</label>
                        <div class="ii_amt_particle_vector" v-if="row.metadata.type === 'vector3' || row.metadata.type === 'vector2'">
                            <span v-for="(axis, component) in (row.metadata.type === 'vector2' ? ['Y','P'] : ['X','Y','Z'])"><i>{{axis}}</i><input type="number" step="0.01" :value="row.value[component]" @change="setAdditionalProperty('dynamic_properties', row.name, $event.target.value, component)"></span>
                        </div>
                        <select v-else-if="row.metadata.type === 'enum'" :value="row.value" @change="setAdditionalProperty('dynamic_properties', row.name, $event.target.value)"><option v-for="option in row.metadata.options" :value="option">{{option}}</option></select>
                        <select v-else-if="row.metadata.type === 'boolean'" :value="String(row.value)" @change="setAdditionalProperty('dynamic_properties', row.name, $event.target.value)"><option value="true">true</option><option value="false">false</option></select>
                        <input v-else :type="row.metadata.type === 'number' ? 'number' : 'text'" :step="row.metadata.step || 0.01" :value="row.value" @change="setAdditionalProperty('dynamic_properties', row.name, $event.target.value)">
                        <button title="Remove dynamic property" @click="removeAdditionalProperty('dynamic_properties', row.name)"><i class="material-icons">delete</i></button>
                    </div>
                    <div class="ii_amt_particle_empty" v-if="!dynamicProperties.length">No dynamic properties.</div>
                </div>`
        }
    });

    const offspringPanel = new Panel('ii_amt_particle_offspring', {
        name: 'Offspring', icon: 'account_tree', condition: {modes: [AMT_PARTICLE_MODE_ID]},
        default_position: panelPosition('right_bar', 0, 390), growable: true, resizable: true,
        component: {
            data() { return {revision: 0}; },
            computed: {
                definition() { this.revision; return getDefinition(); },
                generators() { return OFFSPRING_GENERATORS; }
            },
            methods: {addOffspring, removeOffspring, setOffspringValue},
            template: `
                <div class="ii_amt_particle_panel ii_amt_particle_offspring_panel">
                    <section v-for="kind in ['scheduled', 'chained']">
                        <div class="ii_amt_particle_section_header"><b>{{kind === 'scheduled' ? 'Scheduled' : 'Chained'}}</b><button :title="'Add ' + kind + ' offspring'" @click="addOffspring(kind)"><i class="material-icons">add</i></button></div>
                        <div class="ii_amt_particle_offspring_entry" v-for="(entry, index) in definition[kind]">
                            <div class="ii_amt_particle_offspring_title"><input type="text" placeholder="particle/type" :value="entry.type" @change="setOffspringValue(kind, index, 'type', $event.target.value)"><button title="Remove offspring" @click="removeOffspring(kind, index)"><i class="material-icons">delete</i></button></div>
                            <label v-if="kind === 'scheduled'">Spawn Tick <input type="number" min="0" step="1" :value="entry.time" @change="setOffspringValue(kind, index, 'time', $event.target.value)"></label>
                            <label>Generator <select :value="entry.generator" @change="setOffspringValue(kind, index, 'generator', $event.target.value)"><option v-for="generator in generators" :value="generator">{{generator}}</option></select></label>
                            <div class="ii_amt_particle_number_grid">
                                <label>Distance<input type="number" step="0.01" :value="entry.distance" @change="setOffspringValue(kind, index, 'distance', $event.target.value)"></label>
                                <label>Speed<input type="number" step="0.01" :value="entry.speed" @change="setOffspringValue(kind, index, 'speed', $event.target.value)"></label>
                                <label>Stretch<input type="number" step="0.01" :value="entry.stretch" @change="setOffspringValue(kind, index, 'stretch', $event.target.value)"></label>
                            </div>
                            <div class="ii_amt_particle_number_grid">
                                <label>Amount<input type="number" min="0" step="1" placeholder="random" :value="entry.amount === undefined ? '' : entry.amount" @change="setOffspringValue(kind, index, 'amount', $event.target.value)"></label>
                                <label>Minimum<input type="number" min="0" step="1" :disabled="entry.amount !== undefined" :value="entry.min_amount === undefined ? '' : entry.min_amount" @change="setOffspringValue(kind, index, 'min_amount', $event.target.value)"></label>
                                <label>Maximum<input type="number" min="0" step="1" :disabled="entry.amount !== undefined" :value="entry.max_amount === undefined ? '' : entry.max_amount" @change="setOffspringValue(kind, index, 'max_amount', $event.target.value)"></label>
                            </div>
                            <label class="ii_amt_particle_inherited">Inherited Properties<input type="text" placeholder="color, size, motion" :value="(entry.inherited_properties || []).join(', ')" @change="setOffspringValue(kind, index, 'inherited_properties', $event.target.value)"></label>
                        </div>
                        <div class="ii_amt_particle_empty" v-if="!definition[kind].length">No {{kind}} offspring.</div>
                    </section>
                </div>`
        }
    });

    const programsPanel = new Panel('ii_amt_particle_programs', {
        name: 'Programs', icon: 'code', condition: {modes: [AMT_PARTICLE_MODE_ID]},
        default_position: panelPosition('right_bar', 1, 245), growable: true, resizable: true,
        component: {
            data() { return {revision: 0, newProgram: PROGRAM_TYPES[0]}; },
            computed: {
                definition() { this.revision; return getDefinition(); },
                programTypes() { return PROGRAM_TYPES; }
            },
            methods: {programName, programArguments, addProgram, setProgramName, setProgramArguments, moveProgram, removeProgram},
            template: `
                <div class="ii_amt_particle_panel ii_amt_particle_program_panel">
                    <div class="ii_amt_particle_program_add"><select v-model="newProgram"><option v-for="type in programTypes" :value="type">{{type}}</option></select><button title="Add programme" @click="addProgram(newProgram)"><i class="material-icons">add</i></button></div>
                    <div class="ii_amt_particle_program" v-for="(program, index) in definition.programs">
                        <select :value="programName(program)" @change="setProgramName(index, $event.target.value)"><option v-for="type in programTypes" :value="type">{{type}}</option><option v-if="!programTypes.includes(programName(program))" :value="programName(program)">{{programName(program)}}</option></select>
                        <input type="text" placeholder="arguments" :value="programArguments(program)" @change="setProgramArguments(index, $event.target.value)">
                        <button title="Move up" :disabled="index === 0" @click="moveProgram(index, -1)"><i class="material-icons">arrow_upward</i></button>
                        <button title="Move down" :disabled="index === definition.programs.length - 1" @click="moveProgram(index, 1)"><i class="material-icons">arrow_downward</i></button>
                        <button title="Remove programme" @click="removeProgram(index)"><i class="material-icons">delete</i></button>
                    </div>
                    <div class="ii_amt_particle_empty" v-if="!definition.programs.length">No particle programmes.</div>
                </div>`
        }
    });

    const timelinePanel = new Panel('ii_amt_particle_timeline', {
        name: 'Particle Lifetime', icon: 'slow_motion_video', condition: {modes: [AMT_PARTICLE_MODE_ID]},
        default_position: panelPosition('right_bar', 2, 130), resizable: true,
        component: {
            data() { return {revision: 0}; },
            computed: {
                duration() { this.revision; return simulation.duration; },
                time() { this.revision; return previewTime; },
                isPlaying() { this.revision; return playing; },
                hasWarning() { this.revision; return simulation.missing.length > 0 || simulation.limited; },
                timeLabel() { this.revision; return `${previewTime.toFixed(2)} / ${simulation.duration} ticks · ${(previewTime / 20).toFixed(2)} s`; },
                status() {
                    this.revision;
                    if (simulation.missing.length) return `Missing: ${simulation.missing.join(', ')}`;
                    if (simulation.limited) return `Preview capped at ${simulation.particleCount} particles / ${simulation.duration} ticks`;
                    return `${simulation.particleCount} particle${simulation.particleCount === 1 ? '' : 's'} in the simulated lifetime`;
                }
            },
            methods: {setPreviewTime, togglePlayback() { setPlaying(); }, restart() { setPreviewTime(0); }},
            template: `
                <div class="ii_amt_particle_panel ii_amt_particle_timeline_panel">
                    <div class="ii_amt_particle_playback">
                        <button :title="isPlaying ? 'Pause' : 'Play'" @click="togglePlayback()"><i class="material-icons">{{isPlaying ? 'pause' : 'play_arrow'}}</i></button>
                        <button title="Restart" @click="restart()"><i class="material-icons">replay</i></button>
                        <input type="range" min="0" :max="Math.max(0.01, duration)" step="0.01" :value="time" @input="setPreviewTime($event.target.value)">
                    </div>
                    <div class="ii_amt_particle_time_label">{{timeLabel}}</div>
                    <div class="ii_amt_particle_status" :class="{'ii_amt_particle_warning': hasWarning}">{{status}}</div>
                </div>`
        }
    });
    track(definitionPanel, offspringPanel, programsPanel, timelinePanel);
}

function cleanForExport(value) {
    const definition = sanitiseParticleDefinition(value);
    ['textures', 'models', 'programs', 'scheduled', 'chained'].forEach(key => {
        if (!definition[key]?.length) delete definition[key];
    });
    ['properties', 'dynamic_properties'].forEach(key => {
        if (definition[key] && !Object.keys(definition[key]).length) delete definition[key];
    });
    ['scheduled', 'chained'].forEach(key => {
        definition[key]?.forEach(entry => {
            if (!entry.inherited_properties?.length) delete entry.inherited_properties;
        });
    });
    if (!definition.parent) delete definition.parent;
    return definition;
}

function projectNameFromFile(file) {
    const name = String(file?.name || file?.path || 'particle').replace(/\\/g, '/').split('/').pop();
    return name.replace(/\.fx\.amt$/i, '').replace(/\.amt$/i, '') || 'particle';
}

function loadParticleProject(model, file, args = {}) {
    if (!args.import_to_current_project) setupProject(particleFormat);
    Project[AMT_PARTICLE_PROJECT_PROPERTY] = sanitiseParticleDefinition(model);
    const context = particlePreviewContextFromPath(file?.path || '', file?.name || '');
    Project[AMT_PARTICLE_CONTEXT_PROPERTY] = Object.assign(createDefaultParticleContext(), context, {
        sourcePath: normalisePath(file?.path || '')
    });
    Project.name = projectNameFromFile(file);
    if (file?.path && !file.no_file) {
        Project.save_path = file.path;
        Project.export_path = file.path;
        if (isApp) addRecentProject({name: Project.name, path: file.path, icon: particleFormat.icon});
    }
    Project.saved = true;
    activateParticleEditorNextFrame();
}

function registerFormatAndCodec() {
    particleFormat = new ModelFormat(AMT_PARTICLE_FORMAT_ID, {
        name: 'AMT Particle', description: 'Create and preview Immersive Intelligence .fx.amt particle effects.',
        icon: 'flare', category: 'minecraft', target: 'Immersive Intelligence AMT',
        show_on_start_screen: true, show_in_new_list: true, can_convert_to: false,
        edit_mode: false, paint_mode: false, display_mode: false, animation_mode: false,
        pose_mode: false, image_editor: false, model_identifier: false, centered_grid: true,
        render_sides: 'double',
        new() {
            newProject(this);
            Project[AMT_PARTICLE_PROJECT_PROPERTY] = createDefaultParticleDefinition();
            Project[AMT_PARTICLE_CONTEXT_PROPERTY] = createDefaultParticleContext();
            Project.name = 'particle';
            activateParticleEditorNextFrame();
            return true;
        },
        onSetup(project, newModel) {
            if (newModel || !project[AMT_PARTICLE_PROJECT_PROPERTY])
                project[AMT_PARTICLE_PROJECT_PROPERTY] = createDefaultParticleDefinition();
            if (newModel || !project[AMT_PARTICLE_CONTEXT_PROPERTY])
                project[AMT_PARTICLE_CONTEXT_PROPERTY] = createDefaultParticleContext();
        }
    });
    particleCodec = new Codec('ii_amt_particle', {
        name: 'AMT Particle', extension: 'amt', remember: true,
        load_filter: {
            type: 'json', extensions: ['amt'],
            condition(model) {
                return !!model && PARTICLE_TYPES.includes(model.type)
                    && Number.isFinite(Number(model.max_lifetime)) && typeof model.draw_stage === 'string';
            }
        },
        load: loadParticleProject,
        compile(options = {}) {
            const definition = cleanForExport(getDefinition());
            return options.raw ? definition : JSON.stringify(definition, null, 2);
        },
        fileName() { return `${Project?.name || 'particle'}.fx.amt`; }
    });
    particleCodec.format = particleFormat;
    particleFormat.codec = particleCodec;
    track(particleCodec, particleFormat);
}

function registerMode() {
    particleMode = new Mode(AMT_PARTICLE_MODE_ID, {
        name: 'Particle', icon: 'flare', category: 'edit', default_tool: 'pan_tool',
        selectElements: false, hide_toolbars: true, hidden_node_types: [
            'cube', 'mesh', 'group', 'locator', 'null_object', 'texture_mesh', 'particle'
        ],
        condition: () => formatActive(),
        onSelect() {
            attachPreviewRoot();
            rebuildSimulation();
        },
        onUnselect() {
            stopPlayback();
            detachPreviewRoot();
        }
    });
    track(particleMode);
}

function registerUndoAndProjectHooks() {
    const undoCreate = Blockbench.on('create_undo_save', ({save, aspects}) => {
        if (aspects?.amt_particle && formatActive())
            save.ii_amt_particle_definition = cloneParticleData(getDefinition());
    });
    const undoLoad = Blockbench.on('load_undo_save', ({save}) => {
        if (!save?.ii_amt_particle_definition || !formatActive()) return;
        Project[AMT_PARTICLE_PROJECT_PROPERTY] = sanitiseParticleDefinition(save.ii_amt_particle_definition);
        rebuildSimulation();
    });
    const selectProject = Blockbench.on('select_project', () => {
        stopPlayback();
        detachPreviewRoot();
        if (formatActive()) activateParticleEditorNextFrame();
    });
    const unselectProject = Blockbench.on('unselect_project', () => {
        stopPlayback();
        detachPreviewRoot();
    });
    track(undoCreate, undoLoad, selectProject, unselectProject);
}

function registerStyles() {
    track(Blockbench.addCSS(`
        .ii_amt_particle_panel { box-sizing: border-box; height: 100%; padding: 8px; overflow-x: hidden; overflow-y: auto; }
        .ii_amt_particle_panel > label, .ii_amt_particle_property > label { display: block; margin: 6px 0 3px; color: var(--color-subtle_text); }
        .ii_amt_particle_panel input[type="text"], .ii_amt_particle_panel input[type="number"], .ii_amt_particle_panel select { box-sizing: border-box; min-width: 0; width: 100%; }
        .ii_amt_particle_core_grid, .ii_amt_particle_number_grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
        .ii_amt_particle_number_grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .ii_amt_particle_core_grid label, .ii_amt_particle_number_grid label { display: flex; min-width: 0; flex-direction: column; gap: 3px; margin-top: 6px; color: var(--color-subtle_text); }
        .ii_amt_particle_section_header { display: flex; align-items: center; gap: 5px; margin: 12px 0 5px; border-bottom: 1px solid var(--color-border); padding-bottom: 3px; }
        .ii_amt_particle_section_header b { flex: 1; }
        .ii_amt_particle_panel button { display: inline-flex; min-width: 26px; height: 26px; padding: 0 4px; align-items: center; justify-content: center; }
        .ii_amt_particle_panel button i { font-size: 18px; }
        .ii_amt_particle_asset { display: grid; grid-template-columns: minmax(0, 1fr) 28px 28px; gap: 4px; margin: 4px 0; }
        .ii_amt_particle_empty { padding: 5px 2px; color: var(--color-subtle_text); font-style: italic; }
        .ii_amt_particle_property { display: grid; grid-template-columns: minmax(84px, .8fr) minmax(0, 1.4fr) 28px; gap: 5px; align-items: center; margin: 5px 0; }
        .ii_amt_particle_property > label { margin: 0; overflow-wrap: anywhere; }
        .ii_amt_particle_vector { display: flex; gap: 4px; min-width: 0; }
        .ii_amt_particle_vector span { display: flex; min-width: 0; flex: 1; align-items: center; gap: 2px; }
        .ii_amt_particle_vector i { width: 10px; color: var(--color-subtle_text); font-style: normal; }
        .ii_amt_particle_offspring_entry { margin: 6px 0 10px; padding: 6px; border: 1px solid var(--color-border); border-radius: 3px; background: var(--color-back); }
        .ii_amt_particle_offspring_title { display: grid; grid-template-columns: minmax(0, 1fr) 28px; gap: 5px; }
        .ii_amt_particle_offspring_entry > label { display: grid; grid-template-columns: minmax(80px, .7fr) minmax(0, 1.3fr); gap: 6px; margin-top: 6px; align-items: center; color: var(--color-subtle_text); }
        .ii_amt_particle_offspring_entry .ii_amt_particle_inherited { display: flex; flex-direction: column; align-items: stretch; }
        .ii_amt_particle_program_add { display: grid; grid-template-columns: minmax(0, 1fr) 28px; gap: 5px; margin-bottom: 7px; }
        .ii_amt_particle_program { display: grid; grid-template-columns: minmax(105px, .9fr) minmax(100px, 1.2fr) 26px 26px 26px; gap: 4px; margin: 5px 0; align-items: center; }
        .ii_amt_particle_playback { display: grid; grid-template-columns: 30px 30px minmax(0, 1fr); gap: 5px; align-items: center; }
        .ii_amt_particle_playback input[type="range"] { width: 100%; }
        .ii_amt_particle_time_label { margin-top: 6px; text-align: center; font-variant-numeric: tabular-nums; }
        .ii_amt_particle_status { margin-top: 4px; color: var(--color-subtle_text); overflow-wrap: anywhere; }
        .ii_amt_particle_warning { color: var(--color-warning); }
    `));
}

export function registerAMTParticleEditor() {
    unregisterAMTParticleEditor();
    const definitionProperty = new Property(ModelProject, 'object', AMT_PARTICLE_PROJECT_PROPERTY, {
        default: createDefaultParticleDefinition,
        condition: () => formatActive()
    });
    const contextProperty = new Property(ModelProject, 'object', AMT_PARTICLE_CONTEXT_PROPERTY, {
        default: createDefaultParticleContext,
        condition: () => formatActive(), export: false
    });
    track(definitionProperty, contextProperty);
    registerFormatAndCodec();
    registerMode();
    registerPanels();
    registerUndoAndProjectHooks();
    registerStyles();
}

export function unregisterAMTParticleEditor() {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
    stopPlayback();
    detachPreviewRoot();
    previewRoot = null;
    simulation = {frames: [[]], duration: 0, missing: [], limited: false, particleCount: 0};
    previewTime = 0;
    while (deletables.length) {
        const item = deletables.pop();
        try { item?.delete?.(); } catch (ignored) { /* Blockbench may already have removed it. */ }
    }
    particleFormat = null;
    particleCodec = null;
    particleMode = null;
}
