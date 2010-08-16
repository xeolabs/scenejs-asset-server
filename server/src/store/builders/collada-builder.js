var sys = require("sys");
var registry = require('./builder-registry');
var loaderLib = require('../../../lib/loader');
var xmlLib = require('../../../lib/scenejs-utils/dep/glge_xmlparser');
var jsonLib = require('../../../lib/scenejs-utils/scenejs-json-builder');
var colladaLib = require('../../../lib/scenejs-utils/scenejs-collada-parser');

exports.init = function() {

    registry.registerBuilder({

        info : {
            id: "dae"
        },

        /**
         * Build asset from COLLADA file at URL
         */
        build : function(assetParams, cb) {
            if (!assetParams.source) {
                cb({
                    error: 501,
                    body: "parameter expected: 'source'"
                });
                return;
            }

            if (!assetParams.source.url) {
                cb({
                    error: 501,
                    body: "parameter expected: 'source.url'"
                });
                return;
            }

            sys.puts("Builder 'dae' building asset");
            sys.puts("Loading COLLADA from '" + assetParams.source.url + "'");

            /* Load source COLLADA file
             */
            loaderLib.load({
                url: assetParams.source.url
            },
                    function(result) {
                        if (result.error) { // Failed
                            cb(result);

                        } else {

                            /* Parse XML into DOM
                             */
                            xmlLib.parseXMLToDOM(

                                    result.body,

                                    function(result) {
                                        if (result.error) { // Failed
                                            cb(result);

                                        } else {

                                            /* Parse DOM into SceneJS JSON
                                             */
                                            var jsonBuilder = jsonLib.newBuilder({
                                                numIndents: 4, // TODO: put in asset assembly params
                                                module : assetParams.moduleName,
                                                api : "function" // or "object"
                                            });

                                            var colladaParser = colladaLib.newParser(jsonBuilder);
                                            colladaParser.parse({
                                                sourceURL: assetParams.source.url,
                                                options:{
                                                    comments: false, // TODO: put in asset assembly params
                                                    boundingBoxes : false,
                                                    info: false
                                                }
                                            },
                                                    result.body,

                                                    function(result) {
                                                        if (result.error) { // Failed
                                                            cb(result);

                                                        } else {

                                                            /* All done!
                                                             */

                                                            cb({
                                                                body: {
                                                                    rootNode: result.body.rootNode,
                                                                    manifest : result.body.manifest,
                                                                    spatial : result.body.spatial,
                                                                    stats: result.body.stats,
                                                                    attachments : getAttachmentURLs(
                                                                            assetParams.source.url,
                                                                            result.body.manifest.attachments)
                                                                }
                                                            });
                                                        }
                                                    });
                                        }
                                    });
                        }
                    });
        }
    });
};

function getAttachmentURLs(sourceURL, attachments) {
    var baseURL = sourceURL.substring(0, sourceURL.lastIndexOf("/") + 1);
    var urls = [];
    for (var i = 0; i < attachments.length; i++) {
        urls.push({
            absPath : baseURL + attachments[i].relPath,
            relPath : attachments[i].relPath,
            name : attachments[i].name
        });
    }
    return urls;
}
