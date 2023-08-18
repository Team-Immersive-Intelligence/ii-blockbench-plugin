export var lastAnimationState = true, lastAMTState = true;

export var exportAnimationAMT = new Action('export_animation_amt', {
    name: 'Export AMT Animation...',
    description: 'Export a selection of animations as AMT',
    icon: 'movie',
    click: function () {
        const animations = Animation.all.slice()
        let keys = [];
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
        lines.push("Select animations to be exported as <pre>.json</pre>  AMT Animation files.<br>");
        lines.push("Select Export AMT to export a <pre>.obj.amt</pre>  metadata file.");
        lines.push("<hr>");

        //form
        form["0_animations"] = {label: "Export Animations", type: 'checkbox', value: lastAnimationState};

        animations.forEach(animation => {
            const key = animation.name;
            keys.push(key);
            form["1_" + key.hashCode()] = {
                label: " " + key + "",
                type: 'checkbox',
                value: lastAnimationState
            };
        })

        form["2_amt"] = {label: "Export AMT Metadata", type: 'checkbox', value: lastAMTState};

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
                    newValues["2_amt"] = form_result["2_amt"];

                    dialog.setFormValues(newValues);
                }

            },
            onConfirm(form_result) {

                dialog.hide();
                console.log(form_result);

                keys = keys.filter(key => form_result["1_" + key.hashCode()])

                Animator.animations.forEach(function (animation) {
                    if (keys.includes(animation.name)) {
                        Blockbench.export({
                            resource_id: 'animation',
                            type: 'JSON Animation',
                            extensions: ['json'],
                            name: animation.name,
                            content: autoStringify(compileAnimation(animation)),
                        });

                    }
                })

                lastAMTState = form_result["2_amt"];

                if (form_result["2_amt"])
                    Blockbench.export({
                        resource_id: 'amt',
                        type: 'AMT Data',
                        extensions: ['amt'],
                        name: Project.name + ".obj" + ".amt",
                        content: autoStringify(compileAMT()),
                    });

            }
        })
        dialog.show();
    }
});

function compileAnimation(animation) {
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
                        //rotation Y should be flipped
                        //bad solution for a self-made problem
                        if (channel == 'rotation')
                            arr = [arr[0], -arr[1], arr[2]];

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