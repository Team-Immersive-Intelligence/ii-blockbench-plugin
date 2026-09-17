import './utils'

import './codec/aabb_exporter'
import './codec/obj_exporter'
import './codec/amt_animation_exporter'
import {exportAnimationAMT} from "./codec/amt_animation_exporter";
import {exportAABB} from "./codec/aabb_exporter";
import {ungroup} from "./misc_actions";
import {
    exportAMTModel,
    exportOBJStaticAction,
    exportOBJDynamicAction,
    configureOBJCollectionExportAction,
    registerOBJExporterCollectionMenu,
    shouldAutoExportCollection,
    objCodec,
    objIECodec
} from "./codec/obj_exporter";

import {registerAABBActions, unregisterAABBActions} from "./elements/aabb";
import {registerBullet, unregisterBulletActions} from "./elements/bullet";
import {registerTrack, unregisterTrackActions} from "./elements/track";
import {registerWire, unregisterWireActions} from "./elements/wire";
import {registerPipe, unregisterPipeActions} from "./elements/pipe";
import {registerFluid, unregisterFluidActions} from "./elements/fluid";
import {registerEmbeddedPart, unregisterEmbeddedPartActions} from "./elements/warehouse";
import {registerHans, unregisterHansActions} from "./elements/hans";
import {registerText, unregisterTextActions} from "./elements/text";
import {registerHand, unregisterHandActions} from "./elements/hand";
import {registerBanner, unregisterBannerActions} from "./elements/banner";
import {registerItem, unregisterItemActions} from "./elements/item";
import {
    registerAMTAnimationPreviewCleanupHooks,
    unregisterAMTAnimationPreviewCleanupHooks
} from "./elements/common";


var iiBarMenu = null;

const plugin = BBPlugin.register('iitoolkit', {
    title: 'Immersive Intelligence Toolkit',
    author: 'Pabilo8',
    icon: 'icon.png',
    description: 'Utility plugin for Immersive Intelligence mod models. https://github.com/Pabilo8/ImmersiveIntelligence',
    about: 'Go to Animation -> Export AMT...',
    tags: ["Minecraft: Java Edition"],
    version: '0.7.0',
    min_version: '4.0.0',
    variant: 'both',
    onload() {
        //Cleanuo
        unregisterAll();
        registerAABBActions();
        registerBullet();
        registerWire();
        registerPipe();
        registerFluid();
        //registerEmbeddedPart();
        registerHans();
        registerTrack();
        registerText();
        registerHand();
        registerBanner();
        registerItem();
        registerAMTAnimationPreviewCleanupHooks();

        iiBarMenu = new BarMenu("iitoolkit", [ungroup, exportAnimationAMT, exportAMTModel, exportAABB], {
            name: 'Immersive Intelligence Toolkit'
        });
        MenuBar.addAction(exportAMTModel, 'file.export.0');

        MenuBar.menus.file.addAction(exportOBJStaticAction, "export.1");
        MenuBar.menus.file.addAction(exportOBJDynamicAction, "export.1");
        registerOBJExporterCollectionMenu();

        let hook = Blockbench.on("quick_save_model", () => {
            for (let collection of Collection.all) {
                if (!shouldAutoExportCollection(collection))
                    continue;
                if (collection.export_codec === objCodec.id)
                    objCodec.writeCollection(collection);
                else if (collection.export_codec === objIECodec.id)
                    objIECodec.writeCollection(collection);

            }
        });
    },
    onunload() {
        unregisterAll();
    }
});

function unregisterAll()
{
    unregisterAMTAnimationPreviewCleanupHooks();
    unregisterAABBActions();
    unregisterBulletActions();
    unregisterWireActions();
    unregisterPipeActions();
    unregisterFluidActions();
    //unregisterEmbeddedPartActions();
    unregisterHansActions();
    unregisterTrackActions();
    unregisterTextActions();
    unregisterHandActions();
    unregisterBannerActions();
    unregisterItemActions();

    exportAnimationAMT.delete();
    exportAMTModel.delete();
    exportAABB.delete();
    ungroup.delete();
    exportOBJStaticAction.delete();
    exportOBJDynamicAction.delete();
    configureOBJCollectionExportAction.delete();
}
