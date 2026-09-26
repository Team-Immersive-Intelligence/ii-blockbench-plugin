/* global Setting */

const CATEGORY_ID = 'iitoolkit';
const DISPLAY_AIR_AABB = 'ii_display_air_aabb';
const DISPLAY_MULTIBLOCK_MASTER = 'ii_display_multiblock_master';
const PARTICLE_RESOURCE_FOLDER = 'ii_particle_resource_folder';

let registeredSettings = [];

function notifyDisplaySettingsChanged() {
    Blockbench.dispatchEvent('ii_toolkit_display_settings_changed');
}

function settingValue(id, fallback) {
    return settings[id] ? settings[id].value === true : fallback;
}

function stringSettingValue(id, fallback = '') {
    const value = settings[id]?.value;
    return typeof value === 'string' ? value : fallback;
}

function setSettingValue(id, value) {
    const setting = settings[id];
    if (!setting) return;
    setting.set(value);
}

export function displayAirAABB() {
    return settingValue(DISPLAY_AIR_AABB, false);
}

export function displayMultiblockMaster() {
    return settingValue(DISPLAY_MULTIBLOCK_MASTER, true);
}

export function setDisplayAirAABB(value) {
    setSettingValue(DISPLAY_AIR_AABB, value);
}

export function setDisplayMultiblockMaster(value) {
    setSettingValue(DISPLAY_MULTIBLOCK_MASTER, value);
}

export function particleResourceFolder() {
    return stringSettingValue(PARTICLE_RESOURCE_FOLDER);
}

export function setParticleResourceFolder(value) {
    const setting = settings[PARTICLE_RESOURCE_FOLDER];
    if (!setting) return;
    setting.set(String(value || ''));
}

export function registerIIToolkitSettings() {
    unregisterIIToolkitSettings();

    registeredSettings = [
        new Setting(DISPLAY_AIR_AABB, {
            name: 'Display Air AABB',
            description: 'Display zero-size AABBs as full-block wireframe boxes.',
            category: CATEGORY_ID,
            type: 'toggle',
            value: false,
            onChange: notifyDisplaySettingsChanged
        }),
        new Setting(DISPLAY_MULTIBLOCK_MASTER, {
            name: 'Display master block in Multiblock view',
            description: 'Display the master block label and outline in Multiblock mode.',
            category: CATEGORY_ID,
            type: 'toggle',
            value: true,
            onChange: notifyDisplaySettingsChanged
        }),
        new Setting(PARTICLE_RESOURCE_FOLDER, {
            name: 'AMT Particle Resource Folder',
            description: 'Persistent resource-pack folder used to resolve AMT particle definitions, models, and textures.',
            category: CATEGORY_ID,
            type: 'text',
            value: ''
        })
    ];
}

export function unregisterIIToolkitSettings() {
    registeredSettings.forEach(setting => setting.delete());
    registeredSettings = [];
}
