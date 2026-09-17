/* global PathModule, Settings, autoStringify */
export var lastAnimationState = true, exportAnimations = {};

function getSelectedAnimations(animations, formResult) {
    return animations.filter(animation => formResult["1_" + animation.name.hashCode()]);
}

function safeAnimationFileName(name) {
    const safeName = String(name || 'animation')
        .replace(/[<>:"/\\|?*]/g, '_')
        .split('')
        .map(character => character.charCodeAt(0) < 32 ? '_' : character)
        .join('')
        .replace(/[. ]+$/g, '');
    return safeName || 'animation';
}

function exportAnimationWithDialog(animation) {
    Blockbench.export({
        resource_id: 'animation',
        type: 'AMT JSON Animation',
        extensions: ['json'],
        name: animation.name,
        content: autoStringify(compileAnimation(animation)),
    });
}

function exportAnimationsToFolder(animations) {
    if (!isApp) {
        Blockbench.showQuickMessage('Batch export is available in the Blockbench desktop app', 'error');
        return false;
    }
    if (!animations.length) {
        Blockbench.showQuickMessage('Select at least one animation', 'error');
        return false;
    }

    const folder = Blockbench.pickDirectory({
        title: 'Export AMT Animations',
        resource_id: 'animation',
        startpath: Project.export_path ? PathModule.dirname(Project.export_path) : undefined
    });
    if (!folder) return false;

    animations.forEach(animation => {
        const path = PathModule.join(folder, safeAnimationFileName(animation.name) + '.json');
        Blockbench.writeFile(path, {content: autoStringify(compileAnimation(animation))});
    });
    Blockbench.showQuickMessage(`Exported ${animations.length} AMT animation${animations.length === 1 ? '' : 's'}`);
    return true;
}

export var exportAnimationAMT = new Action('export_animation_amt', {
    name: 'Export AMT Animation...',
    description: 'Export a selection of animations as AMT',
    icon: 'movie',
    click: function () {
        const animations = Animation.all.slice()
        let form = {};
        let lines = [];
        if (Format.animation_files) {
            animations.sort((a1, a2) => a1.path.hashCode() - a2.path.hashCode())
        }

        //html
        lines.push("<style>pre {\n" +
            "                display: inline;\n" +
            "                margin: 0;\n" +
            "            }</style>");
        lines.push("Select animations to be exported as <pre>.json</pre> AMT Animation files.<br>");
        lines.push("<b>Export Selected</b> uses the normal save dialog for each checked animation.<br>");
        lines.push("<b>Export All Selected</b> writes all checked animations to one selected folder.");
        lines.push("<hr>");

        //form
        form["0_animations"] = {label: "Export Animations", type: 'checkbox', value: lastAnimationState};

        animations.forEach(animation => {
            const key = animation.name;
            form["1_" + key.hashCode()] = {
                label: " " + key + "",
                type: 'checkbox',
                value: key in exportAnimations ? exportAnimations[key] : true,
            };
        })

        const dialog = new Dialog({
            id: 'animation_export',
            title: 'dialog.animation_export.title',
            form: form, lines: lines,
            onFormChange(form_result) {
                let allowAnimations = form_result["0_animations"];

                //animation toggle
                if (allowAnimations != lastAnimationState) {
                    let newValues = {};
                    animations.forEach(animation => {
                        newValues["1_" + animation.name.hashCode()] = allowAnimations;
                    });
                    //to prevent infinite looping

                    newValues["0_animations"] = lastAnimationState = allowAnimations;
                    dialog.setFormValues(newValues);
                }

            },
            buttons: ['Export Selected', 'Export All Selected', 'dialog.cancel'],
            confirmIndex: 0,
            cancelIndex: 2,
            onConfirm(form_result) {
                dialog.hide();
                getSelectedAnimations(animations, form_result).forEach(exportAnimationWithDialog);
            },
            onButton(buttonIndex) {
                if (buttonIndex !== 1)
                    return;
                const selectedAnimations = getSelectedAnimations(animations, dialog.getFormResult());
                if (exportAnimationsToFolder(selectedAnimations))
                    dialog.hide();
                return false;
            }
        })
        dialog.show();
    }
});

export function compileAnimation(animation) {
    const amt_file = {};
    const maxlength = animation.getMaxLength();

    const animators = animation.animators;
    const groups = {};

    for (const uuid in animators) {
        const animator = animators[uuid];
        if (animator instanceof BoneAnimator) {
            const keyframes = animator.keyframes;
            if (keyframes.length) {
                const group = animator.getGroup();
                const part = groups[group ? group.name : animator.name] = {};

                /*const origin = group.origin;
                part["origin"] = origin;*/

                const channels = {};
                keyframes.forEach(function (kf) {
                    const channel = kf.channel;
                    if (!channels[channel]) {
                        channels[channel] = {};
                    }
                    if (kf.transform) {
                        let keyframe;
                        const timecodeString = kf.getTimecodeString();

                        let arr = kf.getArray();
                        // AMT uses the opposite X rotation and Z translation directions.
                        if (channel === 'rotation')
                            arr = [-arr[0], arr[1], arr[2]];
                        else if (channel === 'position')
                            arr = [-arr[0], arr[1], arr[2]];

                        keyframe = {
                            time: parseFloat(timecodeString) / maxlength,
                            transform: arr
                        }

                        channels[channel][timecodeString] = keyframe;
                    }
                })
                for (const channel in Animator.possible_channels) {
                    const timecodes = channels[channel];
                    if (timecodes) {
                        Object.keys(timecodes).sort((a, b) => parseFloat(a) - parseFloat(b)).forEach((timecode) => {
                            if (!part[channel]) {
                                part[channel] = [];
                            }
                            part[channel].push(timecodes[timecode]);
                        })
                    }
                }
            }
        }
    }

    amt_file.comment = Settings.get("credit");
    if (Object.keys(groups).length > 0) {
        amt_file.groups = groups;
    }
    return amt_file;
}