var sys = require("sys");

/** Wrap the given subgraph JSON as a SceneJS Module
 *
 * @param name Name for the module - mandatory
 * @param jsonStr SceneJs subgraph - mandatory
 * @param comments Comments to include above module definition - optional
 * @param baseDir Base dir to override that set by SceneJS.requireModule - optional, only given when serving module and attachments through asset server
 */
exports.packageAsModule = function(moduleName, jsonStr, comments, baseDir) {
    var json = [];
    json.push([
        "(function() {",
        "    SceneJS.installModule(\"" + moduleName + "\", {",
        "        init : function (cfg) {",
        "            configs = cfg;",
        baseDir ? "            configs.baseURL = \"" + baseDir + "\";" : "", // Override baseDir injected on installation
        "        },",
        "        getNode : function(params) {",
        "            var symbolURI = params.symbolURI;"].join("\n"));

    /* Intermediate variable, on seperate line, to avoid expensive 
     * string pre-concatenation of 'return' to the subgraph JSON
     */
    json.push("            var node = ");
    json.push(jsonStr); // Minor format glitch - extra newline - not worried about it
    json.push("            return node;");
    json.push("            ;");

    json.push("        }");
    json.push("    });");
    json.push("})();");

    json.push(" "); // Kills whitespace at end that sometimes wont eval

    if (comments) {
        json.unshift(" */");
        for (var i = comments.length - 1; i >= 0; i--) {
            json.unshift(" * " + comments[i]);
        }
        json.unshift("/**");
    }
    return json.join("\n");
};

/**
 * Wrap the given subgraph in a factory function to include directly
 * as a child node in a scene graph - this is used by an asset server
 * that is pushing content into a scene graph through a WebSocket. The
 * JSON returned by this method is not for human consumption.
 *
 * @param jsonStr SceneJS subgraph
 */
exports.packageAsFactoryFunc = function(jsonStr, params) {
    params = params || {};
    var json = [];

    /* Anonomous factory function, wraps optional
     * baseURL and symbolURI in closure
     */
    json.push("(function() {");
    json.push("   configs = {};\n");
    json.push("   configs.baseURL = \"" + (params.baseURL ? params.baseURL : "") + "\";\n");
    json.push("   var symbolURI = null;\n");
    if (params.symbolURI) {

        /* If we have a Symbol we want to instance straight-off, then set it now.
         * Otherwise, fall back on getting one off the data scope when we instance the visual scene.
         */
        json.push("   symbolURI = \"" + params.symbolURI + "\";\n");
    }
    json.push("            var node = ");
    json.push(jsonStr); // Minor format glitch - extra newline - not worried about it
    json.push("            return node;");

    json.push("})()");
    json.push(" "); // Kills whitespace at end that sometimes wont eval

    return json.join("\n");
};
