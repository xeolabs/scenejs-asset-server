var registry = require('./builder-registry');
var log = require('../../../lib/log').log;

exports.init = function() {

    registry.registerBuilder({

        info : {
            id: "json"
        },

        build : function(params, cb) {
            if (!params.assembly.source) {
                cb({
                    error: 501,
                    body: "parameter expected: 'source'"
                });
                return;
            }

            log("Builder 'json' building asset");

            cb({
                body: {
                    rootNode: {
                        type: "node",
                        id: params.meta.name
                    },
                    manifest: {}, // Nothing yet
                    spatial: {},  // Nothing yet
                    stats: {},    // Nothing yet
                    attachments: [] // TODO
                }
            });
        }
    });
};