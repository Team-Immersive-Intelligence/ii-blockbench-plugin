/* global Formats */

let previousDisplayMode;
let registered = false;

function refreshModeSelector() {
    if (Modes?.vue && typeof Modes.vue.$forceUpdate === 'function')
        Modes.vue.$forceUpdate();
}

/** Enables Blockbench's native Display mode for Generic models. */
export function registerGenericDisplayMode() {
    if (registered || !Formats?.free) return;

    previousDisplayMode = Formats.free.display_mode;
    Formats.free.display_mode = true;
    registered = true;
    refreshModeSelector();
}

/** Restores the Generic model format to its state before IIToolkit loaded. */
export function unregisterGenericDisplayMode() {
    if (!registered || !Formats?.free) return;

    if (Modes?.display && Modes?.options?.edit)
        Modes.options.edit.select();
    Formats.free.display_mode = previousDisplayMode;
    previousDisplayMode = undefined;
    registered = false;
    refreshModeSelector();
}
