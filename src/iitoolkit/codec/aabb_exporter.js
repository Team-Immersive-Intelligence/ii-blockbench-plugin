export var exportAABB = new Action('export_aabb', {
    name: 'Export AABB',
    description: 'Export Axis-Aligned Bounding Boxes for collision detection',
    icon: 'icon-objects',
    click: function () {
        const form = {};

        form["export_mode"] = {
            label: "Generation Mode", type: "select", options: {
                mode_groups: "Export groups as separate models",
                mode_mixed: "Export group \'main\' and other groups (merged as a single model) separately"
            }
        }

        const dialog = new Dialog({
            id: 'animation_export',
            title: 'Export Stakan',
            form,
            onFormChange(form_result) {
                let bList = form_result["blacklist"];
                let nFormat = form_result["new_format"];
                exportOptions.blacklisted_groups = form_result["blacklisted_groups"];

                if (bList != exportOptions.blacklist) {
                    exportOptions.blacklist = bList;
                    dialog.setFormValues(form_result);
                }
                if (nFormat != exportOptions.new_format) {
                    exportOptions.new_format = nFormat;
                    if (nFormat)
                        form_result["obj_amt"] = form_result["obj_mtl"] = false;
                }

            },
            onConfirm(form_result) {

            }
        });
        dialog.show();
    }
});