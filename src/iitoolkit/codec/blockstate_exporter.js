/* global autoStringify */
import {getMultiblockData} from '../multiblock/multiblock_data';

const DEFAULT_PARTICLE_TEXTURE = 'immersiveengineering:blocks/storage_steel';

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function cleanNumber(value) {
    const rounded = Math.round(finiteNumber(value) * 1000000) / 1000000;
    return Object.is(rounded, -0) ? 0 : rounded;
}

function vector3(value, fallback) {
    return [0, 1, 2].map(index => cleanNumber(Array.isArray(value) ? value[index] : fallback[index]));
}

export function normaliseMultiblockName(value) {
    const name = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(name))
        throw new Error('The multiblock name must contain only lower-case letters, numbers, and underscores.');
    return name;
}

export function normaliseModId(value) {
    const modId = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(modId))
        throw new Error('The mod ID must contain only lower-case letters, numbers, underscores, dots, and hyphens.');
    return modId;
}

export function compileGUIItemTransform(slot = Project?.display_settings?.gui) {
    const rotation = vector3(slot?.rotation, [0, 0, 0]);
    const translation = vector3(slot?.translation, [0, 0, 0]).map(value => cleanNumber(value / 16));
    const scale = vector3(slot?.scale, [1, 1, 1]).map((value, index) =>
        slot?.mirror?.[index] ? -value : value);

    const rotationSteps = [];
    if (rotation[0]) rotationSteps.push({x: rotation[0]});
    if (rotation[1]) rotationSteps.push({y: cleanNumber(-rotation[1])});
    if (rotation[2]) rotationSteps.push({z: rotation[2]});

    return {
        scale: scale.every(value => value === scale[0]) ? scale[0] : scale,
        translation,
        rotation: rotationSteps
    };
}

export function compileMultiblockBlockstate(name, itemTransform, options = {}) {
    name = normaliseMultiblockName(name);
    const modId = normaliseModId(options.mod_id === undefined
        ? 'immersiveintelligence' : options.mod_id);
    const modelRoot = `${modId}:multiblock/${name}/${name}`;
    const dynamicRender = options.dynamic_render !== false;
    const emptyModel = options.connectable
        ? `${modId}:smartmodel/conn_empty`
        : 'immersiveengineering:ie_empty';

    return {
        forge_marker: 1,
        defaults: {
            transform: 'forge:default-block',
            custom: {'flip-v': true},
            textures: {particle: DEFAULT_PARTICLE_TEXTURE}
        },
        variants: {
            [`inventory,type=${name}`]: [{
                model: `${modelRoot}_inv.obj`,
                transform: itemTransform
            }],
            type: {[name]: {}},
            facing: {
                north: {transform: {rotation: {y: 180}}},
                south: {transform: {rotation: {y: 0}}},
                west: {transform: {rotation: {y: -90}}},
                east: {transform: {rotation: {y: 90}}}
            },
            _0multiblockslave: {
                false: {},
                true: {model: emptyModel}
            },
            _1dynamicrender: {
                false: {},
                true: dynamicRender ? {model: `${modelRoot}.obj.ie`} : {}
            },
            boolean0: {
                false: {model: `${modelRoot}_base.obj`},
                true: {model: `${modelRoot}_flipped.obj`}
            },
            boolean1: {
                false: {},
                true: {}
            }
        }
    };
}

function defaultMultiblockName() {
    const multiblockId = String(getMultiblockData().name || '');
    const sourceName = multiblockId.includes(':')
        ? multiblockId.slice(multiblockId.indexOf(':') + 1)
        : (multiblockId || Project?.name || 'multiblock');
    const projectName = sourceName
        .replace(/\.[^.]+$/, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return projectName || 'multiblock';
}

function serialiseJSON(data) {
    return typeof autoStringify === 'function'
        ? autoStringify(data)
        : JSON.stringify(data, null, 2);
}

function openMultiblockBlockstateDialog() {
    const itemTransform = compileGUIItemTransform();
    const multiblock = getMultiblockData();
    new Dialog('ii_multiblock_blockstate_export', {
        title: 'Export Multiblock Blockstate',
        form: {
            name: {
                label: 'Multiblock Name',
                type: 'text',
                value: defaultMultiblockName()
            },
            mod_id: {
                label: 'Mod ID',
                type: 'text',
                value: multiblock.mod_id
            },
            item_transform: {
                label: 'GUI Item Transform',
                type: 'textarea',
                style: 'code',
                readonly: true,
                height: 180,
                value: JSON.stringify(itemTransform, null, 2)
            },
            dynamic_render: {
                label: 'Add dynamic render variant',
                type: 'checkbox',
                value: true
            },
            connectable: {
                label: 'Multiblock is connectable',
                type: 'checkbox',
                value: false
            }
        },
        onConfirm(result) {
            try {
                const name = normaliseMultiblockName(result.name);
                const blockstate = compileMultiblockBlockstate(name, itemTransform, result);
                Blockbench.export({
                    resource_id: 'ii_multiblock_blockstate',
                    type: 'Multiblock Blockstate',
                    extensions: ['json'],
                    name,
                    content: serialiseJSON(blockstate)
                });
            } catch (error) {
                Blockbench.showMessageBox({
                    title: 'Blockstate Export Error',
                    message: error instanceof Error ? error.message : String(error),
                    icon: 'error'
                });
            }
        }
    }).show();
}

export const exportMultiblockBlockstate = new Action('export_multiblock_blockstate', {
    name: 'Export Multiblock Blockstate...',
    icon: 'save',
    description: 'Export a multiblock blockstate for the configured mod ID',
    condition: () => Format?.id === 'free',
    click: openMultiblockBlockstateDialog
});
