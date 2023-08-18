// import helloWorld from './hello_world'
import './utils'

import './elements/aabb'
import './elements/amt_text'
// import registerWire from './elements/amt_wire'

import './codec/aabb_exporter'
import './codec/obj_exporter'
import './codec/amt_animation_exporter'
import {registerAABB} from "./elements/aabb";
import {exportAnimationAMT} from "./codec/amt_animation_exporter";
import {exportAABB} from "./codec/aabb_exporter";
import {ungroup} from "./misc_actions";
import {exportAMTModel} from "./codec/obj_exporter";


var iiBarMenu = null;

const plugin = Plugin.register('iitoolkit', {
	title: 'Immersive Intelligence Toolkit',
	author: 'Pabilo8',
	icon: 'icon-format_java',
	description: 'Utility plugin for Immersive Intelligence mod models. https://github.com/Pabilo8/ImmersiveIntelligence',
	about: 'Go to Animation -> Export AMT...',
	tags: ["Minecraft: Java Edition"],
	version: '0.3.0',
	min_version: '4.0.0',
	variant: 'both',
	onload() {
		registerAABB();

		iiBarMenu = new BarMenu("iitoolkit", [ungroup, exportAnimationAMT, exportAMTModel, exportAABB]);
		MenuBar.addAction(exportAMTModel, 'file.export.0');
	},
	onunload() {
		exportAnimationAMT.delete();
		exportAMTModel.delete();
		exportAABB.delete();
		ungroup.delete();
	}
});
