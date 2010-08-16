var sys = require("sys");
var registry = require('./builder-registry');
var loaderLib = require('../../../lib/loader');
var log = require('../../../lib/log').log;

exports.init = function() {

    registry.registerBuilder({

        info : {
            id: "scenejs-node"
        },

        /**
         * Build asset from SceneJS subgraph file at URL
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

            log("Builder 'scenejs-node' building asset");
            log("Loading JavaScript from '" + assetParams.source.url + "'");

            /* Load source JavaScript file
             */
            loaderLib.load({
                url: assetParams.source.url
            },
                    function(result) {
                        if (result.error) {  // Failed
                            cb(result);

                        } else { // Success
                            cb({
                                body: {
                                    rootNode: result.body
                                }
                            });
                        }
                    });
        }
    });
};