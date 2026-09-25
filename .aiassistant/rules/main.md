---
apply: always
---

You are working on a plugin called IIToolkit for the 3D model editor Blockbench.
The purpose of this plugin is to enhance the 3D-modeling process for the Minecraft 1.12.2 mod Immersive Intelligence.
The plugin adds in custom outliner elements and export options, in order, to cater to the mod.
The main export format of the plugin is .obj, and a .obj.amt model header file that uses JSON structure to describe
parent-child dependencies between model groups and their offsets for applying animations.
The AMT model format uses a mix of Wavefront OBJ and embeddable model parts, f.e. AMTBullet or AMTWire, that are used to
render a projectile or a hanging electrical wire, without a need to model the geometry every time.
For that reason, the plugin supplies Outliner elements such as Bullet class, which are meant to represent an AMTBullet
part renderer from the minecraft mod.
The plugin uses Node.js and JavaScript, but the Minecraft mod uses Java 25, and its source code is located in the
`./src/iitoolkit` directory.
The mod's repository is located on GitHub and the working branch is
at https://github.com/Team-Immersive-Intelligence/ImmersiveIntelligence/tree/dev/main, you can take a preview of it,
when you need to check how a specific AMT renderer class works.
Use ASD-STE100 Standard Technical English for this project's in-code documentation. Use short, single-sentence comments
covering classes and major functions.
The `./plugins/` directory contains code of other Blockbench plugins, and is read-only. It can be a useful resource in
addition to the official blockbench documentation at https://web.blockbench.net/docs/.
You can use the node.js actions to build the plugin to check if it works, but don't do any testing, nor try to preview
it in a browser, because that would require running the 3D model editor, which is extra overhead.
Instead, result to static analysis and building it on my end, to see, whether the code compiles.