var builders = require('./builders/builder-registry');

require('./builders/collada-builder').init();

var sys = require("sys");
var log = require('../../lib/log').log;
var http = require("http");
var url = require("url");
var Buffer = require("buffer").Buffer;
var uuid = require('../../lib/uuid');


// Node-CouchDB: http://github.com/felixge/node-couchdb
var couchdb = require('../../lib/node-couchdb/couchdb');
const DB_PORT = 5984;
const DB_HOST = "localhost";

//const DB_HOST = "184.106.205.99";
var client;
var db;
log("Asset Server connecting to CouchDB at " + DB_HOST + ":" + DB_PORT);
try {
    client = couchdb.createClient(DB_PORT, DB_HOST);
    db = client.db('scenejs-assets');
} catch (e) {
    throw "Failed to connect to CouchDB at " + DB_HOST + ":" + DB_PORT;
}

/** Creates four records for a new asset: body, assembly, metadata and handle.
 */
exports.createAsset = function(reqParams, cb) {
    if (!reqParams.meta) {
        cb({ error: 501, body: "createAsset.meta expected" });
    } else if (!reqParams.meta.tags) {
        cb({ error: 501, body: "createAsset.meta.tags expected" });
    } else if (!reqParams.meta.title) {
        cb({ error: 501, body: "createAsset.meta.title expected" });
    } else if (!reqParams.meta.description) {
        cb({ error: 501, body: "createAsset.meta.description expected" });
    } else if (!reqParams.assembly) {
        cb({ error: 501, body: "createAsset.assembly expected" });
    } else if (!reqParams.assembly.type) {
        cb({ error: 501, body: "createAsset.assembly.type expected" });
    } else if (!reqParams.assembly.source) {
        cb({ error: 501, body: "createAsset.assembly.source expected" });
    } else if (!reqParams.assembly.source.url) {
        cb({ error: 501, body: "createAsset.assembly.source.url expected" });
    } else {
        log("createAsset");

        var builder = builders.getBuilder(reqParams.assembly.type);
        if (!builder) {
            cb({
                error: 404, // ie. can't find any assets of this type
                body: "asset type not supported: assembly.type '" + reqParams.assembly.type + "'"
            });
        } else {
            builder.build(
                    reqParams.assembly,
                    function(builderProduct) {
                        if (builderProduct.error) {
                            cb(builderProduct);
                        } else {
                            createAssetBody(reqParams, builderProduct, cb);
                        }
                    });
        }
    }
};

/* Creates asset body, then asset assembly info, then asset metadata, in that order.
 * We start by creating the body because it's the part that is most likely to fail
 * because it involves fetching and parsing the target file.
 */
function createAssetBody(reqParams, builtProduct, cb) {
    var id = "asset-body-" + uuid.uuidFast();
    log("creating asset body: " + id);
    db.saveDoc(id, {
        type : "asset-content",
        rootNode: builtProduct.body.rootNode
        //body: builtProduct.body.replace("ATTACHMENT_DIR", "http://foo.com/")
    },
            function(error, assetBody) {
                if (error) {
                    log("FAILED to create asset-body " + id);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {

                    /* Create asset assembly record
                     */
                    createAssetAssembly(reqParams, builtProduct, assetBody,
                            function(result) {
                                if (result.error) {

                                    /* Failed to create assembly - uncreate body                                    
                                     */
                                    db.removeDoc(assetBody.id, assetBody.rev,
                                            function(error, result) {
                                            });
                                }
                                cb(result);
                            });
                }
            });
}

/** Creates the asset assembly record, then the metadata and handle records
 *
 * @param reqParams
 * @param builtProduct
 * @param assetBody
 * @param cb
 */
function createAssetAssembly(reqParams, builtProduct, assetBody, cb) {
    var id = "asset-assembly-" + uuid.uuidFast();
    log("creating asset assembly: " + id);
    db.saveDoc(id, {
        type : "asset-assembly",

        /* Assembly data is in its own sub-object because it could potentially contain
         * all sorts of properties for strange assemblies, and so we don't want to clash
         * with the names of any other properties, such as 'type'
         */
        assembly : reqParams.assembly
    },
            function(error, assembly) {
                if (error) {
                    sys.puts("FAILED to create " + id);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {

                    /* Create metadata record
                     */
                    createAssetMeta(reqParams, builtProduct, assetBody, assembly,
                            function(result) {
                                if (result.error) {

                                    /* Failed to create metadata - uncreate assembly record
                                     */
                                    db.removeDoc(assembly.id, assembly.rev,
                                            function(error, result) {
                                            });
                                }
                                cb(result);
                            });
                }
            });
}

/** Creates the asset metadata record
 *
 * @param reqParams
 * @param builtProduct
 * @param assetBody
 * @param assetAssembly
 * @param cb
 */
function createAssetMeta(reqParams, builtProduct, assetBody, assetAssembly, cb) {
    var id = "asset-meta-" + uuid.uuidFast();
    log("creating asset meta: " + id);
    var asset = builtProduct.asset || {}; // Optional asset metadata found by parser
    db.saveDoc(id, {
        type : "asset-meta",
        title : reqParams.meta.title || builtProduct.asset.title,
        description : reqParams.meta.description || asset.title || "n/a",
        contributor : reqParams.meta.contributor || asset.contributor || "n/a",
        tags : mergeMaps(reqParams.meta.tags || [], asset.tags || []),
        manifest : builtProduct.body.manifest || {}
    },
            function(error, assetMeta) {
                if (error) {
                    sys.puts("FAILED to create " + id);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {

                    /* Create asset handle record
                     */
                    createAssetHandle(reqParams, builtProduct, assetBody, assetAssembly, assetMeta,
                            function(result) {
                                if (result.error) {

                                    /* Failed to create handle - uncreate metadata
                                     */
                                    db.removeDoc(assetMeta.id, assetMeta.rev,
                                            function(error, result) {
                                            });
                                }
                                cb(result);
                            });
                }
            });
}

function mergeMaps(map1, map2) {
    for (var key in map2) {
        if (map2.hasOwnProperty(key)) {
            map1[key] = map2[key];
        }
    }
    return map1;
}

/** Creates asset handle record, which references the asset body, assembly and metadata documents
 *
 * @param reqParams
 * @param builtProduct
 * @param assetBody
 * @param assetAssembly
 * @param assetMeta
 * @param cb
 */
function createAssetHandle(reqParams, builtProduct, assetBody, assetAssembly, assetMeta, cb) {
    var id = "asset-handle-" + uuid.uuidFast();
    log("creating asset handle: " + id);
    db.saveDoc(id, {
        type : "asset-handle",
        assetBodyId : assetBody.id,
        assetAssemblyId : assetAssembly.id,
        assetMetaId : assetMeta.id
    },
            function(error, result) {
                if (error) {
                    sys.puts("FAILED to create " + id);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {
                    cb({ body: result });
                }
            });
}

/** Gets all available asset category tags
 *
 * @param reqParams
 * @param cb
 */
exports.getAssetMetaTags = function(reqParams, cb) { // TODO:
    cb({ format: "json", body: JSON.stringify(["cats", "dogs", "collada", "tests", "obj", "mtl", "architecture"]) });
};

/** Gets metadata on an asset
 *
 * @param reqParams
 * @param cb
 */
exports.getAssetMeta = function(reqParams, cb) {
    if (!reqParams.id) {
        cb({ error: 501, body: "getAssetMata.id expected" });
    } else {
        log("getAssetMeta: " + reqParams.id);
        db.getDoc(reqParams.id,
                function(error, assetHandle) {
                    if (error) {
                        cb({ error: 500, body: JSON.stringify(error) });
                    } else {
                        db.getDoc(assetHandle.assetMetaId,
                                function(error, assetMeta) {
                                    if (error) {
                                        cb({ error: 500, body: JSON.stringify(error) });
                                    } else {
                                        cb({ format: "json",
                                            body: JSON.stringify({    // Filter out couchdb id and rev
                                                type : "asset-meta",
                                                title : assetMeta.title,
                                                description : assetMeta.description,
                                                contributor : assetMeta.contributor,
                                                tags : assetMeta.tags,
                                                manifest : assetMeta.manifest
                                            })
                                        });
                                    }
                                });
                    }
                });
    }
};

/** Gets assembly information on an asset
 *
 * @param reqParams
 * @param cb
 */
exports.getAssetAssembly = function(reqParams, cb) {
    if (!reqParams.id) {
        cb({ error: 501, body: "getAssetAssembly.id expected" });
    } else {
        log("getAssetAssembly: " + reqParams.id);
        db.getDoc(reqParams.id,
                function(error, assetHandle) {
                    if (error) {
                        cb({ error: 500, body: JSON.stringify(error) });
                    } else {
                        db.getDoc(assetHandle.assetAssemblyId,
                                function(error, assetAssembly) {
                                    if (error) {
                                        cb({ error: 500, body: JSON.stringify(error) });
                                    } else {
                                        cb({ format: "json",
                                            body: JSON.stringify({          // Filter out couchdb id and rev
                                                type : "asset-assembly",
                                                assembly : assetAssembly
                                            })
                                        });
                                    }
                                });
                    }
                });
    }
};

/** Gets contents of an asset
 *
 * @param reqParams
 * @param cb
 */
exports.getAssetBody = function(reqParams, cb) {
    if (!reqParams.id) {
        cb({ error: 501, body: "getAssetBody.id expected" });
    } else {
        log("getAssetBody: " + reqParams.id);
        db.getDoc(reqParams.id,
                function(error, assetHandle) {
                    if (error) {
                        cb({ error: 500, body: JSON.stringify(error) });
                    } else {

                        db.getDoc(assetHandle.assetBodyId.id,
                                function(error, assetBody) {
                                    if (error) {
                                        cb({ error: 500, body: JSON.stringify(error) });
                                    } else {
                                        cb({ format: "json", body: assetBody.body });   // Body is a big string of SceneJS scene definition
                                    }
                                });
                    }
                });
    }
};

exports.removeAsset = function(reqParams, builderProduct, cb) {
    if (!reqParams.assetMetaId) {
        cb({ error: 501, body: "removeAsset.id expected" });
    } else {
        this.getAsset({
            id: reqParams.assetMetaId
        },
                function(result) {
                    if (result.error) {
                        cb(result);
                    } else {

                    }
                });
    }
};