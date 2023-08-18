export var ungroup = new Action('ungroup', {
    name: 'Ungroup',
    description: 'Removes all groups',
    icon: 'fas.fa-fire-extinguisher',
    click: function () {
        while (Project.groups.length > 0)
            Project.groups.forEach(g => g.resolve());
    }
});