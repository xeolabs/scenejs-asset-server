var assetStore = require('./assets/assetStore');
var sys = require("sys");
var log = require('../lib/log').log;

/**
 *   Services request to create/query/remove assets on the asset store
 *
 */
exports.service = function(params, callback) {
    if (!params.cmd) {
        callback({
            error: 501,
            body: "I need a cmd!"
        });
        return;
    }


    switch (params.cmd) {

        case "createAsset" :
            assetStore.createAsset(params, callback);
            break;

        case "getAssetMetaTags" :
            assetStore.getAssetMetaTags(params, callback);
            break;

        case "getAssetMeta" :
            assetStore.getAssetMeta(params, callback);
            break;

        case "getAssetAssembly" :
            assetStore.getAssetAssembly(params, callback);
            break;

        case "getAssetBody" :

            /* Get attachToNode - if given, prepend with hash required by
             * the SceneJS configs map that SceneJS.Socket will push onto its subgraph
             */
            var attachToNode = params.attachToNode ? params.attachToNode.replace(/^\s\s*/, '').replace(/\s\s*$/, '') : null;
            if (attachToNode) {
                if (attachToNode.length == 0) {
                    callback({
                        error: 501,
                        body: "attachToNode is empty string"
                    });
                }
                attachToNode = attachToNode.charAt(0) == "#" ? attachToNode : "#" + attachToNode;
            }

            var symbolNode = params.symbolNode ? params.symbolNode.replace(/^\s\s*/, '').replace(/\s\s*$/, '') : null;
            if (symbolNode) {
                if (symbolNode.length == 0) {
                    callback({
                        error: 501,
                        body: "attachToNode is empty string"
                    });
                }
                symbolNode = symbolNode.charAt(0) == "#" ? symbolNode : "#" + symbolNode;
            }

            assetStore.getAssetBody(
                    params,
                    function(result) {
                        if (result.error) {
                            callback(result);
                        } else {
                            if (attachToNode) {
                                callback({
                                    format : "json",
                                    body: "{ \"" + attachToNode + "\": { \"+node\": " + result.body + " } }"
                                    //    body: "{ \"" + attachToNode + "\": { \"+node\": SceneJS.objects.teapot() } }"
                                });
                            }
                            else {
                                callback(result);
                            }
                        }
                    });
            break;

        case "removeAsset" :
            assetStore.removeAsset(params, callback);
            break;

        default:
            callback({
                error: 501,
                body: "I don't know that cmd: '" + params.cmd + "'"
            });
    }
    log("DONE");
};


//assetStore.getAssetInfo({
//    assetId: "asset-info-204476A1-88FD-4308-896C-50621910A4CB"
//}, function(result) {
//    sys.puts("getAssetInfo: result = " + result.error + ", " + result.body);
//});
//
//assetStore.getAssetBody({
//    assetId: "asset-body-B11912E4-57D5-4B7C-A73F-6484E2FFA91F"
//}, function(result) {
//    sys.puts("getAssetBody: result = " + result.error + ", " + result.body);
//});

//
for (var i = 0; i < 10; i++) {
    assetStore.createAsset({
        meta : {
            title :"An Elephant",
            description: "This is my elephant!",
            tags : ["rabbits"]
        },
        assembly : {
            type : "dae",
            sourceURL: "http://www.scenejs.org/library/v0.7/assets/examples/seymourplane_triangulate/seymourplane_triangulate_augmented.dae",
            visualScene : "VisualSceneNode",
            camera : null  // Could use the COLLADA file's camera if we wanted
        }},
            function(result) {
                if (result.error) {
                    sys.puts("" + result.error + ": " + result.body);
                } else {
                    sys.puts("CREATED OK");
                    //                    assetStore.getAsset({ cmd: "getAsset",
                    //                        assetId : "org.scenejs.examples.v0_7_6.seymour_plane_A"+i
                    //                    },
                    //                            function(result) {
                    //                                sys.puts("" + result.error + ": " + result.body);
                    //                            });
                }
            });
}


//
///** Returns snippet of SceneJS JavaScript that will fetch the existing asset of the given ID
// */
//function getAssetSocketPastie(params, callback) {
//    if (!params.assetId) {
//        callback({
//            error: 501,
//            body: "parameter expected: assetId"
//        });
//        return;
//    }
//    assets.getAssetInfo(
//            function(result) {
//                if (result.error) {
//                    callback(result);
//                } else {
//                    var assetInfo = result.body;
//                    callback({
//                        body: ["SceneJS.socket({",
//                            "        uri: \"ws://xeolabs.org/modelbank/\",",
//                            "        messages: [{",
//                            "            cmd: \"getAssetBody\",",
//                            "            id : \"" + assetInfo.assetId + "\",",
//                            "            attachToNode: \"#687678687687687678678678687687\"," +
//                            "        }" +
//                            "    }," +
//                            "    SceneJS.node({ sid: \"687678687687687678678678687687\"}));"].join("")
//                    });
//                }
//            });
//}
//;
//
//
//
//
