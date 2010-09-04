/*
 Copyright (c) 2010 Lindsay Kay <lindsay.kay@xeolabs.com>

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 */
var builders = require('./builders/builder-registry');

/* Register builder modules
 */
require('./builders/collada-builder').init();
require('./builders/scenejs-builder').init();

var sys = require("sys");

var fs = require('fs');
var path = require("path");
var http = require("http");
var url = require("url");
var log = require('../../lib/log').log;
var uuid = require('../../lib/uuid');
var jsonUtils = require('../../lib/scenejs-utils/scenejs-js-utils');
var couchdb = require('../../lib/node-couchdb/couchdb'); // Node-CouchDB: http://github.com/felixge/node-couchdb
var mkdirp = require('../../lib/npm/mkdir-p');
var rmdirrf = require('../../lib/npm/rm-rf');

var settings;
var client;
var db;

const DB_NAME = "scenejs-asset-store";

/*----------------------------------------------------------------------------------------------------------------------
 * Asset Store
 *
 * After starting it up with #start, the store
 *--------------------------------------------------------------------------------------------------------------------*/


exports.start = function(_settings, cb) {
    settings = _settings;

    /* Ensure attachments dir exists
     */
    if (settings.attachmentsDir.charAt(settings.attachmentsDir.length - 1) != "/") {
        settings.attachmentsDir += "/";
    }
    ensureDirExists(settings.attachmentsDir);

    log("SceneServer.AssetStore: attachmentsDir     = " + settings.attachmentsDir);
    log("SceneServer.AssetStore: attachmentsBaseURL = " + settings.attachmentsBaseURL);

    /* Connect to CouchDB    
     */
    log("SceneServer.AssetStore: connecting to CouchDB at " + settings.db.host + ":" + settings.db.port);
    try {
        client = couchdb.createClient(settings.db.port, settings.db.host, settings.db.user, settings.db.password);
        db = client.db(DB_NAME);
    } catch (e) {
        throw "SceneServer.AssetStore failed to connect to CouchDB: " + e;
    }

    /* Create DB if not existing
     */
    db.exists(
            function(error, exists) {
                if (error) {
                    throw JSON.stringify(error);
                }
                if (!exists) {

                    log("SceneServer.AssetStore: did not find DB '" + DB_NAME + "' - that's OK I'll make one..");

                    db.create(
                            function(error) {
                                log("SceneServer.AssetStore: creating DB '" + DB_NAME + "'");
                                if (error) {
                                    log("SceneServer.AssetStore: failed to create CouchDB database: " + JSON.stringify(error));
                                    throw "SceneServer.AssetStore failed to create CouchDB database";
                                } else {
                                    createViews(function(error) {
                                        if (error) {
                                            log("SceneServer.AssetStore: failed to create CouchDB views: " + JSON.stringify(error));
                                            throw "SceneServer.AssetStore failed to create CouchDB views";
                                        }
                                    });
                                }
                                if (cb) {
                                    cb();
                                }
                            });
                }
            });
};


function ensureDirExists(dir) {
    path.exists(dir, function(exists) {
        if (!exists) {
            mkdirp.mkdir(dir, 0755, function(error) {
                if (error) {
                    throw "Unable to create attachmentsDir '" + dir + "': " + error;
                }
            });
        }
    });
}

function createViews(cb) {
    db.saveDoc("_design/asset-meta", {
        "language": "javascript",
        "views": {

            "all_tags": {
                "map": "function(doc) { if (doc.type == 'asset-handle' && doc.tags) {  doc.tags.forEach(function(tag) { emit(tag, doc.name);  }); } }"
            },

            "all_assets": {
                "map": "function(doc) { if (doc.type == 'asset-handle')  emit(doc._id, doc.name) }"
            }
        }
    }, cb);
}

/*---------------------------------------------------------------------------------------------------------------------
 * Creates new asset. This creates four records for the new asset: body, assembly, metadata and handle. These
 * creations are done in a chain, in that order. Also creates an attachments directory (path specified in settings)
 * and downloads all attachments referenced in the asset source file(s) into that.
 *
 * Cleans up on error by unmaking all documents/directories/files that were successfully made.
 *--------------------------------------------------------------------------------------------------------------------*/
exports.createAsset = function(params, cb) {
    if (!params.meta) {
        cb({ error: 501, body: "createAsset.meta expected" });
    } else if (!params.meta.tags) {
        cb({ error: 501, body: "createAsset.meta.tags expected" });
    } else if (!params.meta.name) {
        cb({ error: 501, body: "createAsset.meta.name expected" });
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
        log("SceneServer.AssetStore: createAsset");

        var builder = builders.getBuilder(params.assembly.type);
        if (!builder) {
            cb({
                error: 404, // ie. can't find any assets of this type
                body: "asset type not supported: assembly.type '" + params.assembly.type + "'"
            });
        } else {

            var dirName = uuid.uuidFast() + "/";
            var storage = {
                dirName: dirName,
                attachmentsDir: settings.attachmentsDir + dirName,
                attachmentsBaseURL : settings.attachmentsBaseURL + dirName
            };

            log("SceneServer.AssetStore: createAsset attachmentsDir     = " + storage.attachmentsDir);
            log("SceneServer.AssetStore: createAsset attachmentsBaseURL = " + storage.attachmentsBaseURL);

            builder.build(
                    params,

                    function(builderProduct) {
                        if (builderProduct.error) {
                            cb(builderProduct);
                        } else {


                            /* Save asset
                             */
                            createAssetBody(
                                    params,
                                    storage,
                                    builderProduct,

                                    function(result) {
                                        if (result.error) {
                                        } else {
                                            log("SceneServer.AssetStore: asset created OK: result=" + JSON.stringify(result));
                                        }
                                        if (cb) {
                                            cb(result);
                                        }
                                    });
                        }
                    });
        }
    }
};

/* Creates asset body, then asset assembly info, then asset metadata, in that order.
 * We start by creating the body because it's the part that is most likely to fail
 * because it involves fetching and parsing the target file.
 */
function createAssetBody(
        params, // request
        storage, // how server stores it
        builtProduct, // asset body
        cb) {

    var id = "asset-body-" + uuid.uuidFast();
    log("SceneServer.AssetStore: creating asset body: " + id);

    /* Create body
     */
    db.saveDoc(id, {
        type : "asset-body",
        rootNode: builtProduct.body.rootNode
    },
            function(error, assetBody) {

                /* Failed
                 */
                if (error) {
                    log("SceneServer.AssetStore: FAILED to create asset-body " + id + ": " + JSON.stringify(error));
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {

                    /* Create assembly
                     */
                    createAssetAssembly(params, storage, builtProduct, assetBody,
                            function(result) {
                                if (result.error) {

                                    /* Failed - remove asset body
                                     */
                                    log("SceneServer.AssetStore: deleting asset-body " + assetBody.id);
                                    db.removeDoc(assetBody.id, assetBody.rev,
                                            function(error, result) {
                                                if (error) {
                                                    log("SceneServer.AssetStore: FAILED to delete asset-body " + assetBody.id + ": " + JSON.stringify(error));
                                                }
                                            });
                                } else {
                                    log("SceneServer.AssetStore: asset-body created OK: " + id);
                                }
                                if (cb) {
                                    cb(result);
                                }
                            });
                }
            });
}

/** Creates the asset assembly record, then the metadata and handle records
 *
 * @param params
 * @param builtProduct
 * @param assetBody
 * @param cb
 */
function createAssetAssembly(params, storage, builtProduct, assetBody, cb) {
    var id = "asset-assembly-" + uuid.uuidFast();
    log("SceneServer.AssetStore: creating asset assembly: " + id);

    /* Create assembly
     */
    db.saveDoc(id, {
        type : "asset-assembly",

        /* Assembly data is in its own sub-object because it could potentially contain
         * all sorts of properties for strange assemblies, and so we don't want to clash
         * with the names of any other properties, such as 'type'
         */
        assembly : params.assembly
    },
            function(error, assembly) {
                if (error) {

                    /* Failed
                     */
                    log("SceneServer.AssetStore: FAILED to create asset-assembly " + id + ": " + error);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {

                    /* Create attachments and metadata
                     */
                    saveAssetAttachments(params, storage, builtProduct, assetBody, assembly,
                            function(result) {
                                if (result.error) {

                                    /* Failed - uncreate assembly
                                     */
                                    log("SceneServer.AssetStore: deleting asset-assembly " + assembly.id);
                                    db.removeDoc(assembly.id, assembly.rev,
                                            function(error, result) {
                                                if (error) {
                                                    log("SceneServer.AssetStore: FAILED to delete asset-assembly " + assembly.id + ": " + error);
                                                }
                                            });
                                } else {
                                    log("SceneServer.AssetStore: asset-assembly created OK: " + id);
                                }
                                cb(result);
                            });
                }
            });
}

/** Saves asset attachments then creates metadata
 *
 * @param params
 * @param builtProduct
 * @param assetBody
 * @param assetAssembly
 * @param cb
 */
function saveAssetAttachments(params, storage, builtProduct, assetBody, assetAssembly, cb) {
    saveAttachments(params, storage, builtProduct,

            function(error, savedAttachments) {

                if (error) {
                    cb({ error: 500, body: JSON.stringify(error) });

                } else {

                    /* Create metadata record
                     */
                    createAssetMeta(params, storage, builtProduct, assetBody, assetAssembly, savedAttachments,
                            function(result) {
                                if (result.error) {

                                    /* Failed to create metadata - remove attachments dir
                                     */
                                    log("SceneServer.AssetStore: removing attachments dir " + savedAttachments.attachmentsDir);
                                    rmdirrf.rm(savedAttachments.attachmentsDir, function(error) {
                                        if (error) {
                                            log("SceneServer.AssetStore: FAILED to remove attachments dir " + savedAttachments.attachmentsDir + ": " + error);
                                        }
                                    });
                                } else {
                                    log("SceneServer.AssetStore: asset attachments saved OK");
                                }
                                cb(result);
                            });
                }
            });
}

function saveAttachments(params, storage, builtProduct, cb) {
    fs.mkdir(storage.attachmentsDir, 0755,
            function(error) {
                if (error) {
                    log("SceneServer.AssetStore: FAILED to create attachments dir " + storage.attachmentsDir + ": " + error);
                    cb({ error: error });
                } else {
                    var savedAttachments = {
                        imageList : []
                    };
                    var attachments = builtProduct.body.attachments || [];
                    try {
                        fetchAttachments(storage.attachmentsDir, attachments, 0, savedAttachments,
                                function() {
                                    cb(null, {
                                        dirName: storage.dirName,
                                        attachmentsDir: storage.attachmentsDir,
                                        savedAttachments: savedAttachments.imageList
                                    });
                                });
                    } catch (e) {
                        rmdirrf.rm(storage.attachmentsDir,
                                function(error) {
                                    if (error) {
                                        log("SceneServer.AssetStore: FAILED to remove attachments dir " + storage.attachmentsDir + ": " + error);
                                    }
                                });
                        cb({ error: e });
                    }
                }
            });
}

/**
 * Recursively loop through attachments, loading each one while blocking.
 * Not majorly efficient, but ensures that we don't have too many concurrent
 * connections and file handles open. Since asset creation is likely done as
 * a batch process I can live with this.
 */
function fetchAttachments(attachmentsDir, attachments, i, savedAttachments, cb) {
    if (i < attachments.length) {
        fetchAttachment(attachmentsDir, attachments[i],
                function(error) {
                    if (error) {
                        log("SceneServer.AssetStore: FAILED to fetch attachment " + attachments[i].name + ": " + error);
                        throw error;
                    }
                    savedAttachments.imageList.push(attachments[i].name);
                    fetchAttachments(attachmentsDir, attachments, i + 1, savedAttachments, cb);
                });
    } else {
        cb();
    }
}

function fetchAttachment(attachmentsDir, attachment, cb) {
    var parts = url.parse(attachment.absPath);
    var twimg = http.createClient(80, parts.host);
    var request = twimg.request('GET', parts.pathname, { 'host': parts.host });
    var writeStream = fs.createWriteStream(attachmentsDir + attachment.name, {
        'flags': 'w', 'encoding': 'binary','mode': 0666});

    request.addListener('response',
            function (response) {
                response.setEncoding('binary');
                response.addListener('data', function (chunk) {
                    writeStream.write(chunk, "binary");
                });
                response.addListener('end', function () {
                    writeStream.end();
                    cb(null);
                });
            });

    request.end();
}

/** Creates the asset metadata record
 *
 * @param params
 * @param builtProduct
 * @param assetBody
 * @param assetAssembly
 * @param cb
 */
function createAssetMeta(params, storage, builtProduct, assetBody, assetAssembly, savedAttachments, cb) {
    var id = "asset-meta-" + uuid.uuidFast();
    log("SceneServer.AssetStore: creating asset meta: " + id);
    var asset = builtProduct.asset || {}; // Optional asset metadata found by parser
    db.saveDoc(id, {
        type : "asset-meta",
        description : params.meta.description || asset.name || "n/a",
        contributor : params.meta.contributor || asset.contributor || "n/a",
        params : params.meta.params || {},
        manifest : builtProduct.body.manifest || {},
        spatial : builtProduct.body.spatial || {},
        stats : builtProduct.body.stats || {},
        attachments : savedAttachments
    },
            function(error, assetMeta) {
                if (error) {
                    log("SceneServer.AssetStore: FAILED to create asset-meta " + id + ": " + error);
                    cb({ error: 500, body: JSON.stringify(error) });

                } else {

                    /* Create asset handle record
                     */
                    createAssetHandle(params, builtProduct, assetBody, assetAssembly, assetMeta,
                            function(result) {
                                if (result.error) {

                                    /* Failed to create handle - uncreate metadata
                                     */
                                    log("SceneServer.AssetStore: deleting asset-meta " + assetMeta.id);
                                    db.removeDoc(assetMeta.id, assetMeta.rev,
                                            function(error, result) {
                                                if (error) {
                                                    log("SceneServer.AssetStore: FAILED to delete asset-meta " + assetMeta.id + ": " + JSON.stringify(error));
                                                }
                                            });
                                    cb(result);
                                } else {
                                    log("SceneServer.AssetStore: asset-meta created OK: " + id);
                                    cb({ body: { assetId: result.body.id, spatial : builtProduct.body.spatial }});
                                }
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
 * @param params
 * @param builtProduct
 * @param assetBody
 * @param assetAssembly
 * @param assetMeta
 * @param cb
 */
function createAssetHandle(params, builtProduct, assetBody, assetAssembly, assetMeta, cb) {
    var id = params.meta.name.replace(/ /g, ".");
    //var id = "asset-" + uuid.uuidFast();
    log("SceneServer.AssetStore: creating asset-handle: " + id);
    db.saveDoc(id, {
        type : "asset-handle",
        name : params.meta.name || ((builtProduct.asset && builtProduct.asset.name) ? builtProduct.asset.name : id),
        tags : mergeMaps(params.meta.tags || [], (builtProduct.asset ? builtProduct.asset.tags : [])),
        assetBodyId : assetBody.id,
        assetAssemblyId : assetAssembly.id,
        assetMetaId : assetMeta.id
    },
            function(error, assetHandle) {
                if (error) {
                    log("SceneServer.AssetStore: FAILED to create asset-handle " + id + ": " + JSON.stringify(error));
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {
                    log("SceneServer.AssetStore: asset-handle created OK: " + id);
                    cb({ body: { id: assetHandle.id } });
                }
            });
}


/*---------------------------------------------------------------------------------------------------------------------
 * Deletes an asset. This deletes four components: body, assembly, metadata and handle, along with the attachments
 * directory.
 *--------------------------------------------------------------------------------------------------------------------*/
exports.deleteAsset = function(params, cb) {
    if (!params.id) {
        cb({ error: 501, body: "deleteAsset.id expected" });
        return;
    }

    /* Get asset handle first - from that we'll get the other components
     */
    db.getDoc(params.id,
            function(error, assetHandle) {
                if (error) {
                    cb({ error: 500, body: JSON.stringify(error) });

                } else {

                    /* Delete asset metadata
                     */
                    db.getDoc(assetHandle.assetMetaId,
                            function(error, assetMeta) {
                                if (error) {
                                    cb({ error: 500, body: JSON.stringify(error) });

                                } else {

                                    log("SceneServer.AssetStore: deleting asset-meta " + assetMeta._id);

                                    log(JSON.stringify(assetMeta))
                                    db.removeDoc(assetMeta._id, assetMeta._rev,
                                            function(error, result) {
                                                if (error) {
                                                    log("SceneServer.AssetStore: FAILED to delete asset " + assetHandle._id + " asset-meta " + assetMeta._id + ": " + JSON.stringify(error));
                                                }

                                                /* Delete asset assembly
                                                 */
                                                db.getDoc(assetHandle.assetAssemblyId,
                                                        function(error, assetAssembly) {
                                                            if (error) {
                                                                cb({ error: 500, body: JSON.stringify(error) });

                                                            } else {

                                                                log("SceneServer.AssetStore: deleting asset-assembly " + assetAssembly._id);

                                                                db.removeDoc(assetAssembly._id, assetAssembly._rev,
                                                                        function(error, result) {
                                                                            if (error) {
                                                                                log("SceneServer.AssetStore: FAILED to delete asset " + assetHandle._id + " asset-assembly " + assetAssembly._id + ": " + JSON.stringify(error));
                                                                            }

                                                                            /* Delete asset body
                                                                             */
                                                                            db.getDoc(assetHandle.assetBodyId,
                                                                                    function(error, assetBody) {
                                                                                        if (error) {
                                                                                            cb({ error: 500, body: JSON.stringify(error) });

                                                                                        } else {

                                                                                            log("SceneServer.AssetStore: deleting asset-body " + assetBody._id);

                                                                                            db.removeDoc(assetBody._id, assetBody._rev,
                                                                                                    function(error, result) {
                                                                                                        if (error) {
                                                                                                            log("SceneServer.AssetStore: FAILED to delete asset " + assetHandle._id + " asset-body " + assetBody._id + ": " + JSON.stringify(error));
                                                                                                        }

                                                                                                        /* Delete asset handle
                                                                                                         */
                                                                                                        db.removeDoc(assetHandle._id, assetHandle._rev,
                                                                                                                function(error, result) {
                                                                                                                    if (error) {
                                                                                                                        log("SceneServer.AssetStore: FAILED to delete asset handle " + assetHandle._id + ": " + JSON.stringify(error));
                                                                                                                    }

                                                                                                                    /* Remove attachments dir
                                                                                                                     */
                                                                                                                    log("SceneServer.AssetStore: removing attachments dir " + assetMeta.attachments.attachmentsDir);
                                                                                                                    rmdirrf.rm(assetMeta.attachments.attachmentsDir, function(error) {
                                                                                                                        if (error) {
                                                                                                                            log("SceneServer.AssetStore: FAILED to remove attachments dir " + assetMeta.attachments.attachmentsDir + ": " + error);
                                                                                                                        }
                                                                                                                    });
                                                                                                                });
                                                                                                    });
                                                                                        }
                                                                                    });
                                                                        });
                                                            }
                                                        });
                                            });
                                }
                            });
                }
            });
};


function deleteDoc(id, cb) {
    db.getDoc(id,
            function(error, doc) {
                if (error) {
                    cb(error);
                } else {
                    db.removeDoc(doc.assetBodyId, doc.rev,
                            function(error, result) {
                                if (error) {
                                    log("SceneServer.AssetStore: FAILED to delete document " + id + ": " + JSON.stringify(error));
                                }
                            });
                }
            });
}


/*---------------------------------------------------------------------------------------------------------------------
 * Returns entire set of asset category tags
 *
 *--------------------------------------------------------------------------------------------------------------------*/
exports.getAssetTags = function(params, cb) {
    log("SceneServer.AssetStore: getAssetTags");
    db.view("asset-meta", "all_tags", {},
            function(error, tags) {
                if (error) {
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {
                    cb({
                        format: "json",
                        body:  JSON.stringify(tags)
                    });
                }
            });
};

/*---------------------------------------------------------------------------------------------------------------------
 * Returns entire   
 *
 *--------------------------------------------------------------------------------------------------------------------*/
exports.getAssets = function(params, cb) {
    log("SceneServer.AssetStore: getAssets");
    db.view("asset-meta", "all_assets", {},
            function(error, tags) {
                if (error) {
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {
                    cb({
                        format: "json",
                        body:  JSON.stringify(tags)
                    });
                }
            });
};

//
//exports.getAssetTags = function(params, cb) { // TODO:
//    cb({ format: "json", body: JSON.stringify(["cats", "dogs", "collada", "tests", "obj", "mtl", "architecture"]) });
//};


/*---------------------------------------------------------------------------------------------------------------------
 *
 *
 *--------------------------------------------------------------------------------------------------------------------*/
exports.getAssetsForTags = function(params, cb) {
    if (!params.tags) {
        cb({ error: 501, body: "getAssetsForTags.tags expected" });
    } else {
        log("SceneServer.AssetStore: getAssetMeta tags:" + JSON.stringify(params.tags));
        db.getDoc(params.id,
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
                                            body:  JSON.stringify({    // Filter out couchdb id and rev
                                                name : assetMeta.name,
                                                description : assetMeta.description,
                                                contributor : assetMeta.contributor,
                                                manifest : assetMeta.manifest,
                                                spatial : assetMeta.spatial,
                                                stats : assetMeta.stats
                                            })
                                        });
                                    }
                                });
                    }
                });
    }
};


/** Gets metadata on an asset
 *
 * @param params
 * @param cb
 */
exports.getAssetMeta = function(params, cb) {
    if (!params.id) {
        cb({ error: 501, body: "getAssetMeta.id expected" });
    } else {
        log("SceneServer.AssetStore: getAssetMeta id:" + params.id);
        db.getDoc(params.id,
                function(error, assetHandle) {
                    if (error) {
                        cb({ error: 500, body: JSON.stringify(error) });
                    } else {
                        db.getDoc(assetHandle.assetMetaId,
                                function(error, assetMeta) {
                                    if (error) {
                                        cb({ error: 500, body: JSON.stringify(error) });
                                    } else {
                                        cb({ body:  { // Filtering out couchdb id and rev
                                            name : assetMeta.name,
                                            description : assetMeta.description,
                                            contributor : assetMeta.contributor,
                                            tags : assetMeta.tags,
                                            manifest : assetMeta.manifest,
                                            spatial : assetMeta.spatial,
                                            stats : assetMeta.stats
                                        }
                                        });
                                    }
                                });
                    }
                });
    }
};

/** Gets assembly information on an asset
 *
 * @param params
 * @param cb
 */
exports.getAssetAssembly = function(params, cb) {
    if (!params.id) {
        cb({ error: 501, body: "getAssetAssembly.id expected" });
    } else {
        log("SceneServer.AssetStore: getAssetAssembly: " + params.id);
        db.getDoc(params.id,
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
                                                assembly : assetAssembly.assembly
                                            })
                                        });
                                    }
                                });
                    }
                });
    }
};

exports.getAsset = function(params, cb) {
    if (!params.id || params.name) {
        cb({ error: 501, body: "getAsset.id or getAsset.name expected" });
        return;
    }

    if (params.id) {
        log("SceneServer.AssetStore.getAsset id: " + params.id);
    }

    /* Get asset handle first
     */
    db.getDoc(params.id,
            function(error, assetHandle) {
                if (error) {
                    cb({ error: 500, body: JSON.stringify(error) });

                } else {

                    /* Then get asset metadata
                     */
                    db.getDoc(assetHandle.assetMetaId,
                            function(error, assetMeta) {
                                if (error) {
                                    cb({ error: 500, body: JSON.stringify(error) });

                                } else {

                                    /* Then get asset body
                                     */
                                    db.getDoc(assetHandle.assetBodyId,
                                            function(error, assetBody) {
                                                if (error) {
                                                    cb({ error: 500, body: JSON.stringify(error) });
                                                } else {
                                                    cb({
                                                        format : "script",
                                                        body:  JSON.stringify(postProcess(assetMeta, assetBody, params))
                                                    });
                                                }
                                            });
                                }
                            });
                }
            });
};

function postProcess(assetMeta, assetBody, params) {
    var node = assetBody.rootNode;
//    if (assetBody.constructor) {
//        var context = {};
//        node = assetBody.constructor({
//            context: context,
//            params: params,
//            node: node
//        });
//    }
    log(JSON.stringify(assetMeta.attachments))
    if (assetMeta.attachments.dirName) {
        fixAssetImageURLs(node, settings.attachmentsBaseURL + "/" + assetMeta.attachments.dirName);
    }
    return node;
}

function fixAssetImageURLs(node, urlBase) {
    if (node) {
        if (node.type == "texture") {
            var cfg = node.cfg;
            if (cfg) {
                var layers = cfg.layers;
                if (layers) {
                    var layer;
                    for (var i = 0; i < layers.length; i++) {
                        layer = layers[i];
                        layer.uri = urlBase + layer.uri;
                    }
                }
            }
        }
        var nodes = node.nodes;
        if (nodes) {
            for (var i = nodes.length; i >= 0; i--) {
                fixAssetImageURLs(nodes[i], urlBase);
            }
        }
    }
}
