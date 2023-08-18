//Functions

/**
 *
 * @param {string} file path to the texture file
 * @returns {string} minecraft resource location path of the file
 */
function getResourceLocation(file) {
    //trim
    file = file.substring(0, file.includes(".") ? file.lastIndexOf('.') : file.length);
    file = file.replaceAll("\\", "/");

    //attempt looking for a resource location in path
    if (file.includes("assets") && file.includes("textures")) {
        file = file.substring(file.indexOf("assets") + ("assets/".length));
        let domain = file.substring(0, file.indexOf("/textures"));
        file = file.substring(file.indexOf("/textures") + "/textures/".length, file.length);
        return `${domain}:${file}`;
    }
    //no resource location in path
    if (!file.includes("/"))
        return file;
    return "immersiveintelligence:block" + file.substring(file.lastIndexOf("/"), file.length);
}

function normalizeVector(normal) {
    normal = normal.map(n => parseFloat(n));
    let max = Math.max.apply(null, normal.map(n => Math.abs(n)));
    return normal.map(n => n / max);
}
