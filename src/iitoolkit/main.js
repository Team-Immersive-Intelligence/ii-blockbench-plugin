import './utils'

import './codec/aabb_exporter'
import './codec/obj_exporter'
import './codec/amt_animation_exporter'
import {exportAnimationAMT} from "./codec/amt_animation_exporter";
import {
    exportAABBData,
    importMultiblockData,
    importMultiblockStructureAction,
    importTactileAABBAction,
    registerAABBExporterPersistence
} from "./codec/aabb_exporter";
import {ungroup} from "./misc_actions";
import {reAxisAnimation} from "./animation/re_axis_animation";
import {
    configureOBJCollectionExportAction,
    exportAMTModel,
    exportOBJDynamicAction,
    exportOBJStaticAction,
    objCodec,
    objIECodec,
    registerOBJExporterCollectionMenu,
    shouldAutoExportCollection
} from "./codec/obj_exporter";

import {registerAABBActions, unregisterAABBActions} from "./elements/aabb";
import {registerBullet, unregisterBulletActions} from "./elements/bullet";
import {registerTrack, unregisterTrackActions} from "./elements/track";
import {registerWire, unregisterWireActions} from "./elements/wire";
import {registerPipe, unregisterPipeActions} from "./elements/pipe";
import {registerFluid, unregisterFluidActions} from "./elements/fluid";
import {registerHans, unregisterHansActions} from "./elements/hans";
import {registerText, unregisterTextActions} from "./elements/text";
import {registerHand, unregisterHandActions} from "./elements/hand";
import {registerBanner, unregisterBannerActions} from "./elements/banner";
import {registerItem, unregisterItemActions} from "./elements/item";
import {registerAMTAnimationPreviewCleanupHooks, unregisterAMTAnimationPreviewCleanupHooks} from "./elements/common";
import {registerMultiblockMode, unregisterMultiblockMode} from './multiblock/multiblock_mode';
import {registerGenericDisplayMode, unregisterGenericDisplayMode} from "./display/display_mode";


var iiBarMenu = null;

const plugin = BBPlugin.register('iitoolkit', {
    title: 'Immersive Intelligence Toolkit',
    author: 'Pabilo8',
    icon: 'icon.png',
    description: 'Utility plugin for Immersive Intelligence mod models. https://github.com/Pabilo8/ImmersiveIntelligence',
    about: 'Go to Animation -> Export AMT...',
    tags: ["Minecraft: Java Edition"],
    version: '0.8.12',
    min_version: '4.0.0',
    variant: 'both',
    onload() {
        //Cleanuo
        unregisterAll();
        registerGenericDisplayMode();
        registerAABBActions();
        registerAABBExporterPersistence();
        registerMultiblockMode();
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

        iiBarMenu = new BarMenu("iitoolkit", [
            ungroup, reAxisAnimation, exportAnimationAMT, exportAMTModel, '_',
            importMultiblockData, importMultiblockStructureAction, importTactileAABBAction, '_',
            exportAABBData
        ], {
            name: 'Immersive Intelligence Toolkit'
        });
        MenuBar.addAction(exportAMTModel, 'file.export.0');
        MenuBar.menus.file.addAction(importMultiblockData, 'import.0');
        MenuBar.menus.file.addAction(importMultiblockStructureAction, 'import.0');
        MenuBar.menus.file.addAction(importTactileAABBAction, 'import.0');
        MenuBar.menus.file.addAction(exportAABBData, 'export.0');

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

function unregisterAll() {
    unregisterGenericDisplayMode();
    unregisterAMTAnimationPreviewCleanupHooks();
    unregisterAABBActions();
    unregisterMultiblockMode();
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
    reAxisAnimation.delete();
    exportAMTModel.delete();
    exportAABBData.delete();
    importMultiblockData.delete();
    importMultiblockStructureAction.delete();
    importTactileAABBAction.delete();
    ungroup.delete();
    exportOBJStaticAction.delete();
    exportOBJDynamicAction.delete();
    configureOBJCollectionExportAction.delete();
}
