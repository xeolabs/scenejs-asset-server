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

//const DB_HOST = "http://scenejs.couchone.com";
var client;
var db;
log("Asset Server connecting to CouchDB at " + DB_HOST + ":" + DB_PORT);
try {
    client = couchdb.createClient(DB_PORT, DB_HOST);
    db = client.db('scenejs-assets');
} catch (e) {
    throw "Failed to connect to CouchDB at " + DB_HOST + ":" + DB_PORT;
}

/** Creates asset, asset body and asset assembly
 */
exports.createAsset = function(params, cb) {
    if (!params.meta) {
        cb({ error: 501, body: "createAsset.meta expected" });
    } else if (!params.meta.tags) {
        cb({ error: 501, body: "createAsset.meta.tags expected" });
    } else if (!params.meta.title) {
        cb({ error: 501, body: "createAsset.meta.title expected" });
    } else if (!params.meta.description) {
        cb({ error: 501, body: "createAsset.meta.description expected" });
    } else if (!params.assembly) {
        cb({ error: 501, body: "createAsset.assembly expected" });
    } else if (!params.assembly.type) {
        cb({ error: 501, body: "createAsset.assembly.type expected" });
    } else if (!params.assembly.source) {
        cb({ error: 501, body: "createAsset.assembly.source expected" });
    } else if (!params.assembly.source.url) {
        cb({ error: 501, body: "createAsset.assembly.source.url expected" });
    } else {
        log("createAsset");

        var builder = builders.getBuilder(params.assembly.type);
        if (!builder) {
            cb({
                error: 404, // ie. can't find any assets of this type
                body: "asset type not supported: assembly.type '" + params.assembly.type + "'"
            });
        } else {
            builder.build(
                    params.assembly,
                    function(product) {
                        if (product.error) {
                            cb(product);
                        } else {
                            createAssetBody(params, product, cb);
                        }
                    });
        }
    }
};

/* Creates asset body, then asset assembly info, then asset metadata, in that order.
 * We start by creating the body because it's the part that is most likely to fail
 * because it involves fetching and parsing the target file.
 */
function createAssetBody(params, product, cb) {
    var id = "asset-body-" + uuid.uuidFast();
    log("creating asset body: " + id);
    db.saveDoc(id, {
        type : "asset-content",
        body: product.body
        //body: product.body.replace("ATTACHMENT_DIR", "http://foo.com/")
    },
            function(error, assetBody) {
                if (error) {
                    log("FAILED to create asset-body " + id);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {
                    createAssetAssembly(params, product, assetBody, function(result) {
                        if (result.error) {
                            db.removeDoc(assetBody.id, assetBody.rev, function(error, result) {
                                /* TODO: Log failure to clean up asset-body
                                 */
                            });
                        }
                        cb(result);
                    });
                }
            });
}

function createAssetAssembly(params, product, assetBody, cb) {
    var id = "asset-assembly-" + uuid.uuidFast();
    log("creating asset assembly: " + id);
    db.saveDoc(id, {
        type : "asset-assembly",
        assembly : params.assembly  // Polymorphic, so in own sub-object
    },
            function(error, assembly) {
                if (error) {
                    sys.puts("FAILED to create " + id);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {
                    createAssetMeta(params, product, assetBody, assembly, function(result) {
                        if (result.error) {
                            db.removeDoc(assembly.id, assembly.rev, function(error, result) {
                                /* TODO: Log failure to clean up asset-assembly
                                 */
                            });
                        }
                        cb(result);
                    });
                }
            });
}

function createAssetMeta(params, product, assetBody, assembly, cb) {
    var id = "asset-meta-" + uuid.uuidFast();
    log("creating asset meta: " + id);
    var asset = product.asset || {}; // Optional asset metadata found by parser
    db.saveDoc(id, {
        type : "asset-meta",
        title : params.meta.title || product.asset.title,
        description : params.meta.description || asset.title || "n/a",
        contributor : params.meta.contributor || asset.contributor || "n/a",
        tags : mergeMaps(params.meta.tags || [], asset.tags || []),
        manifest : product.manifest || {},
        assetBodyId : assetBody.id,
        assetAssemblyId : assembly.id
    },
            function(error, result) {
                if (error) {
                    sys.puts("FAILED to create " + id);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {
                    cb({ body: "created!" });
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

exports.getAssetMetaTags = function(params, cb) { // TODO:
    cb({ format: "json", body: JSON.stringify(["cats", "dogs", "collada", "tests", "obj", "mtl", "architecture"]) });
};

exports.getAssetMeta = function(params, cb) {
    if (!params.id) {
        cb({ error: 501, body: "getAssetMata.id expected" });
    }
    db.getDoc(params.id, function(error, doc) {
        if (error) {
            cb({ error: 500, body: JSON.stringify(error) });
        } else {
            cb({ format: "json", body: JSON.stringify(doc) });
        }
    });
};

exports.getAssetAssembly = function(params, cb) {
    if (!params.id) {
        cb({ error: 501, body: "getAssetAssembly.id expected" });
    } else {
        log("getAssetAssembly: " + params.id);
        db.getDoc(params.id, function(error, doc) {
            if (error) {
                cb({ error: 500, body: JSON.stringify(error) });
            } else {
                cb({ format: "json", body: JSON.stringify(doc.body) });
            }
        });
    }
};

exports.getAssetBody = function(params, cb) {
    if (!params.id) {
        cb({ error: 501, body: "getAssetBody.id expected" });
    } else {
        db.getDoc(params.id, function(error, doc) {
            if (error) {
                cb({ error: 500, body: JSON.stringify(error) });
            } else {
                cb({ format: "json", body: doc.body });
            }
        });
    }
};

exports.removeAsset = function(params, product, cb) {
    if (!params.assetMetaId) {
        cb({ error: 501, body: "removeAsset.assetMetaId expected" });
    } else {
        this.getAsset({
            id: params.assetMetaId
        },
                function(result) {
                    if (result.error) {
                        cb(result);
                    } else {

                    }
                });
    }
};