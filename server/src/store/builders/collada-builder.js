var sys = require("sys");
var registry = require('./builder-registry');
var loaderLib = require('../../../lib/loader');
var xmlLib = require('../../../lib/scenejs-utils/dep/glge_xmlparser');
var boundarybuilder = require("../../../lib/scenejs-utils/boundary-builder");
//var colladaLib = require('../../../lib/scenejs-utils/scenejs-collada-parser');
//var colladaLib = require('../../../lib/scenejs-utils/scenejs-collada-parser2');
var colladaLib = require('../../../lib/scenejs-utils/scenejs-collada-parser-unrolled');

exports.init = function() {

    registry.registerBuilder({

        info : {
            id: "dae"
        },

        /**
         * Build asset from COLLADA file at URL
         */
        build : function(
                params, // Request params
                storage, // Server-provided - attachments dir etc.
                cb) {

            if (!params.assembly.source.url) {
                cb({
                    error: 501,
                    body: "parameter expected: 'assembly.source.url'"
                });
                return;
            }

            if (!params.meta.name) {
                cb({
                    error: 501,
                    body: "parameter expected: 'meta.name'"
                });
                return;
            }

            sys.puts("Builder 'dae' building asset");
            sys.puts("Loading COLLADA from '" + params.assembly.source.url + "'");

            /* Load source COLLADA file
             */
            loaderLib.load({
                url: params.assembly.source.url
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

                                            var boundaryBuilder = boundarybuilder.getBoundaryBuilder();

                                            // var colladaParser = colladaLib.newParser(jsonBuilder, boundaryBuilder);
                                            var colladaParser = colladaLib.newParser(boundaryBuilder);
                                            colladaParser.parse({
                                                sourceURL: params.assembly.source.url,
                                                baseID: params.meta.name,
                                                options:{
                                                    comments: false, // TODO: put in asset assembly params
                                                    boundingBoxes : false
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
                                                                            params.assembly.source.url,
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
