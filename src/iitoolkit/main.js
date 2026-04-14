import './utils'

import './elements/aabb'

import './codec/aabb_exporter'
import './codec/obj_exporter'
import './codec/amt_animation_exporter'
import {registerAABBActions, unregisterAABBActions} from "./elements/aabb";
import {registerBullet, unregisterBulletActions} from "./elements/bullet";
import {exportAnimationAMT} from "./codec/amt_animation_exporter";
import {exportAABB} from "./codec/aabb_exporter";
import {ungroup} from "./misc_actions";
import {exportAMTModel, exportOBJStaticAction, exportOBJDynamicAction, objCodec, objIECodec} from "./codec/obj_exporter";
import {registerTrack, unregisterTrackActions} from "./elements/track";
import {registerWire, unregisterWireActions} from "./elements/wire";


var iiBarMenu = null;

const plugin = BBPlugin.register('iitoolkit', {
	title: 'Immersive Intelligence Toolkit',
	author: 'Pabilo8',
	icon: 'icon.png',
	description: 'Utility plugin for Immersive Intelligence mod models. https://github.com/Pabilo8/ImmersiveIntelligence',
	about: 'Go to Animation -> Export AMT...',
	tags: ["Minecraft: Java Edition"],
	version: '0.4.0',
	min_version: '4.0.0',
	variant: 'both',
	onload() {
		registerAABBActions();
		registerBullet();
		registerTrack();
		registerWire();

		iiBarMenu = new BarMenu("iitoolkit", [ungroup, exportAnimationAMT, exportAMTModel, exportAABB],{
			name: 'Immersive Intelligence Toolkit'
		});
		MenuBar.addAction(exportAMTModel, 'file.export.0');

		MenuBar.menus.file.addAction(exportOBJStaticAction, "export.1");
		MenuBar.menus.file.addAction(exportOBJDynamicAction, "export.1");

		let hook = Blockbench.on("quick_save_model", () => {
			for (let collection of Collection.all) {
				if (collection.export_codec === objCodec.id)
					objCodec.writeCollection(collection);
				else if (collection.export_codec === objIECodec.id)
					objIECodec.writeCollection(collection);

			}
		});
	},
	onunload() {
		unregisterAABBActions();
		unregisterBulletActions();
		unregisterTrackActions();
		unregisterWireActions();

		exportAnimationAMT.delete();
		exportAMTModel.delete();
		exportAABB.delete();
		ungroup.delete();
		exportOBJStaticAction.delete();
		exportOBJDynamicAction.delete();
	}
});
