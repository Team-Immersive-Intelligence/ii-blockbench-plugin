const TRANSFORM_CHANNELS = ['position', 'rotation', 'scale'];

function isNumericMolang(value) {
    return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?f?$/i.test(value.trim());
}

function negateExpression(expression) {
    const trimmed = expression.trim();
    if (!trimmed || trimmed === '0' || trimmed === '-0')
        return trimmed === '-0' ? '0' : trimmed;

    if (trimmed.startsWith('-(') && trimmed.endsWith(')'))
        return trimmed.slice(2, -1);

    return `-(${trimmed})`;
}

/**
 * Negates a number or the returned value of a Molang expression.
 *
 * Keyframe components may be full Molang snippets rather than plain numbers,
 * so wrapping the complete string would break expressions containing
 * assignments or return statements.
 */
export function negateMolang(value) {
    if (typeof value === 'number')
        return Object.is(value, 0) || Object.is(value, -0) ? 0 : -value;
    if (typeof value !== 'string')
        return value;

    if (isNumericMolang(value)) {
        const suffix = value.trim().toLowerCase().endsWith('f') ? 'f' : '';
        const number = -parseFloat(value);
        return `${Object.is(number, -0) ? 0 : number}${suffix}`;
    }

    if (value.includes('return ')) {
        return value.replace(/return (.+?)(;|$)/g, (match, expression, end) =>
            `return ${negateExpression(expression)}${end}`
        );
    }

    const withoutTrailingSemicolons = value.replace(/;+$/, '');
    const lastSemicolon = withoutTrailingSemicolons.lastIndexOf(';');
    if (lastSemicolon === -1)
        return value.includes('=') ? `${withoutTrailingSemicolons};` : negateExpression(withoutTrailingSemicolons);

    const before = withoutTrailingSemicolons.slice(0, lastSemicolon + 1);
    const returnedExpression = withoutTrailingSemicolons.slice(lastSemicolon + 1);
    if (returnedExpression.includes('='))
        return `${withoutTrailingSemicolons};`;
    return before + negateExpression(returnedExpression);
}

function reAxisVector(vector, negateX, negateZ) {
    if (!vector || vector.length < 3)
        return;

    const oldX = vector[0];
    const oldZ = vector[2];
    vector[0] = negateX ? negateMolang(oldZ) : oldZ;
    vector[2] = negateZ ? negateMolang(oldX) : oldX;
}

/**
 * Exchanges the X/Z components of one transform keyframe. Negation is applied
 * after the exchange. Scale magnitudes are exchanged but never negated.
 */
export function reAxisKeyframe(keyframe, options = {}) {
    if (!keyframe || !TRANSFORM_CHANNELS.includes(keyframe.channel))
        return false;

    const negateX = keyframe.channel !== 'scale' && options.negateX === true;
    const negateZ = keyframe.channel !== 'scale' && options.negateZ === true;

    (keyframe.data_points || []).forEach(point => {
        const oldX = point.x;
        const oldZ = point.z;
        point.x = negateX ? negateMolang(oldZ) : oldZ;
        point.z = negateZ ? negateMolang(oldX) : oldX;
    });

    // Bézier timing belongs to the axis being moved, but only the value handle
    // follows the optional sign change.
    reAxisVector(keyframe.bezier_left_time, false, false);
    reAxisVector(keyframe.bezier_right_time, false, false);
    reAxisVector(keyframe.bezier_left_value, negateX, negateZ);
    reAxisVector(keyframe.bezier_right_value, negateX, negateZ);
    return true;
}

export function getReAxisKeyframes(animation) {
    const keyframes = [];
    if (!animation || !animation.animators)
        return keyframes;

    Object.keys(animation.animators).forEach(uuid => {
        const animator = animation.animators[uuid];
        (animator.keyframes || []).forEach(keyframe => {
            if (TRANSFORM_CHANNELS.includes(keyframe.channel))
                keyframes.push(keyframe);
        });
    });
    return keyframes;
}

export function reAxisAnimationKeyframes(animation, options = {}) {
    const keyframes = getReAxisKeyframes(animation);
    keyframes.forEach(keyframe => reAxisKeyframe(keyframe, options));
    return keyframes.length;
}

export const reAxisAnimation = new Action('re_axis_animation', {
    name: 'Re-Axis Animation',
    description: 'Exchange the X and Z axes of every transform keyframe in the selected animation',
    icon: 'swap_horiz',
    category: 'animation',
    condition: {modes: ['animate'], method: () => Animation.selected},
    click() {
        const animation = Animation.selected;
        if (!animation) {
            Blockbench.showQuickMessage('No animation selected', 'error');
            return;
        }

        const keyframes = getReAxisKeyframes(animation);
        if (!keyframes.length) {
            Blockbench.showQuickMessage('The selected animation has no transform keyframes', 'error');
            return;
        }

        new Dialog({
            id: 're_axis_animation',
            title: 'Re-Axis Animation',
            form: {
                info: {
                    type: 'info',
                    text: 'Exchange X and Z on all position, rotation, and scale keyframes in the selected animation.<br>' +
                        'Negation is applied after exchanging the axes. Scale magnitudes are never negated.'
                },
                negate_x: {
                    label: 'Negate X Result',
                    description: 'Negate the new X value on position and rotation keyframes',
                    type: 'checkbox',
                    value: false
                },
                negate_z: {
                    label: 'Negate Z Result',
                    description: 'Negate the new Z value on position and rotation keyframes',
                    type: 'checkbox',
                    value: false
                }
            },
            onConfirm(result) {
                this.hide();
                Undo.initEdit({animations: [animation]});
                const count = reAxisAnimationKeyframes(animation, {
                    negateX: result.negate_x,
                    negateZ: result.negate_z
                });
                Animator.preview();
                Undo.finishEdit('Re-axis animation');
                Blockbench.showQuickMessage(`Re-axed ${count} keyframe${count === 1 ? '' : 's'}`);
            }
        }).show();
    }
});
