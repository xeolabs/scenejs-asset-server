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

require('./builders/collada-builder').init();

var sys = require("sys");

var fs = require('fs');
var path = require("path");
var http = require("http");
var url = require("url");
var log = require('../../lib/log').log;
var uuid = require('../../lib/uuid');
var jsonUtils = require('../../lib/scenejs-utils/scenejs-json-utils');
var couchdb = require('../../lib/node-couchdb/couchdb'); // Node-CouchDB: http://github.com/felixge/node-couchdb
var mkdirp = require('../../lib/npm/mkdir-p');

var settings;
var client;
var db;

exports.start = function(_settings) {
    settings = _settings;

    /* Ensure attachments dir exists
     */
    if (settings.attachmentsDir.charAt(settings.attachmentsDir.length - 1) != "/") {
        settings.attachmentsDir += "/";
    }
    ensureDirExists(settings.attachmentsDir);

    /* Fire up the asset service    
     */
    log("Asset Server connecting to CouchDB at " + settings.db.host + ":" + settings.db.port);
    try {
        client = couchdb.createClient(settings.db.port, settings.db.host);
        db = client.db('scenejs-assets');
    } catch (e) {
        throw "Failed to connect to CouchDB at " + settings.db.host + ":" + settings.db.port;
    }
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

/** Creates four records for a new asset: body, assembly, metadata and handle.
 */
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
                    function(builderProduct) {
                        if (builderProduct.error) {
                            cb(builderProduct);
                        } else {
                            createAssetBody(params, builderProduct, cb);
                        }
                    });
        }
    }
};

/* Creates asset body, then asset assembly info, then asset metadata, in that order.
 * We start by creating the body because it's the part that is most likely to fail
 * because it involves fetching and parsing the target file.
 */
function createAssetBody(params, builtProduct, cb) {
    var id = "asset-body-" + uuid.uuidFast();
    log("creating asset body: " + id);
    db.saveDoc(id, {
        type : "asset-content",
        rootNode: builtProduct.body.rootNode
    },
            function(error, assetBody) {
                if (error) {
                    log("FAILED to create asset-body " + id);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {

                    /* Create asset assembly record
                     */
                    createAssetAssembly(params, builtProduct, assetBody,
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
 * @param params
 * @param builtProduct
 * @param assetBody
 * @param cb
 */
function createAssetAssembly(params, builtProduct, assetBody, cb) {
    var id = "asset-assembly-" + uuid.uuidFast();
    log("creating asset assembly: " + id);
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
                    sys.puts("FAILED to create " + id);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {

                    /* Create asset images and metadata record
                     */
                    saveAssetImages(params, builtProduct, assetBody, assembly,
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

/** Saves asset images then creates metadata
 *
 * @param params
 * @param builtProduct
 * @param assetBody
 * @param assetAssembly
 * @param cb
 */
function saveAssetImages(params, builtProduct, assetBody, assetAssembly, cb) {
    log("saving asset images..");

    saveImages(params, builtProduct,

            function(error, savedImages) {

                if (error) {
                    cb({ error: 500, body: JSON.stringify(error) });

                } else {

                    sys.puts(JSON.stringify(savedImages));

                    /* Create metadata record
                     */
                    createAssetMeta(params, builtProduct, assetBody, assetAssembly, savedImages,
                            function(result) {
                                if (result.error) {

                                    /* Failed to create metadata - remove images dir
                                     */
                                    fs.rmdir(savedImages.imagesDir, function(error) {
                                        // noop
                                    });
                                }
                                cb(result);
                            });
                }
            });
}

function saveImages(params, builtProduct, cb) {
    var imagesDir = settings.attachmentsDir + "/" + uuid.uuidFast() + "/";
    fs.mkdir(imagesDir, 0755, function(error) {
        if (error) {
            cb({ error: error });
        } else {
            var savedImages = [];
            if (builtProduct.body.attachments) {
                var attachments = builtProduct.body.attachments;
                try {
                    fetchAttachments(imagesDir, attachments, 0, savedImages);
                } catch (e) {
                    fs.rmdir(imagesDir, function(error) {

                        // noop
                    });
                    cb({ error: e });
                    return;
                }
            }
            cb(null, { imagesDir: imagesDir, savedImages: savedImages });
        }
    });
}

/**
 * Recursively loop through attachments, loading each one while blocking.
 * Not majorly efficient, but ensures that we don't have too many concurrent
 * connections and file handles open. Since asset creation is likely done as
 * a batch process I can live with this.
 *
 * @param imagesDir
 * @param attachments
 * @param i
 * @param savedImages
 */
function fetchAttachments(imagesDir, attachments, i, savedImages) {
    if (i < attachments.length) {
        fetchAttachment(imagesDir, attachments[i],
                function(error) {
                    if (error) {
                        throw error;
                    }
                    fetchAttachments(imagesDir, attachments, i + 1, savedImages);
                });
    }
}

function fetchAttachment(imagesDir, attachment, cb) {
    var parts = url.parse(attachment.absPath);
    var twimg = http.createClient(80, parts.host);
    var request = twimg.request('GET', parts.pathname, { 'host': parts.host });
    var writeStream = fs.createWriteStream(imagesDir + attachment.name, {
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
function createAssetMeta(params, builtProduct, assetBody, assetAssembly, savedImages, cb) {
    var id = "asset-meta-" + uuid.uuidFast();
    log("creating asset meta: " + id);
    var asset = builtProduct.asset || {}; // Optional asset metadata found by parser
    db.saveDoc(id, {
        type : "asset-meta",
        name : params.meta.name || builtProduct.asset.name,
        description : params.meta.description || asset.name || "n/a",
        contributor : params.meta.contributor || asset.contributor || "n/a",
        tags : mergeMaps(params.meta.tags || [], asset.tags || []),
        manifest : builtProduct.body.manifest || {},
        spatial : builtProduct.body.spatial || {},
        stats : builtProduct.body.stats || {},
        images : savedImages
    },
            function(error, assetMeta) {
                if (error) {
                    sys.puts("FAILED to create " + id);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {

                    /* Create asset handle record
                     */
                    createAssetHandle(params, builtProduct, assetBody, assetAssembly, assetMeta,
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
 * @param params
 * @param builtProduct
 * @param assetBody
 * @param assetAssembly
 * @param assetMeta
 * @param cb
 */
function createAssetHandle(params, builtProduct, assetBody, assetAssembly, assetMeta, cb) {
    var id = "asset-" + uuid.uuidFast();
    log("creating asset handle: " + id);
    db.saveDoc(id, {
        type : "asset-handle",
        assetBodyId : assetBody.id,
        assetAssemblyId : assetAssembly.id,
        assetMetaId : assetMeta.id
    },
            function(error, assetHandle) {
                if (error) {
                    sys.puts("FAILED to create " + id);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {
                    cb({ body: { id: assetHandle._id } });
                }
            });
}


/** Gets all available asset category tags
 *
 * @param params
 * @param cb
 */
exports.getAssetMetaTags = function(params, cb) { // TODO:
    cb({ format: "json", body: JSON.stringify(["cats", "dogs", "collada", "tests", "obj", "mtl", "architecture"]) });
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
        log("getAssetMeta id:" + params.id);
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
                                            body: JSON.stringify({    // Filter out couchdb id and rev
                                                name : assetMeta.name,
                                                description : assetMeta.description,
                                                contributor : assetMeta.contributor,
                                                tags : assetMeta.tags,
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

/** Gets assembly information on an asset
 *
 * @param params
 * @param cb
 */
exports.getAssetAssembly = function(params, cb) {
    if (!params.id) {
        cb({ error: 501, body: "getAssetAssembly.id expected" });
    } else {
        log("getAssetAssembly: " + params.id);
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
    if (!params.id) {
        cb({ error: 501, body: "getAssetNode.id expected" });
        return;
    }

    if (!params.pkg) {
        cb({ error: 501, body: "getAssetNode.pkg expected" });
        return;
    }

    log("getAsset id: " + params.id + ", pkg: " + params.pkg);

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

                                                    /* Package the asset body
                                                     */
                                                    switch (params.pkg) {
                                                        case "socket" :
                                                            assetPkgForSocket(params, assetMeta, assetBody, cb);
                                                            break;

                                                        case "module":
                                                            assetPkgForModule(params, assetMeta, assetBody, cb);
                                                            break;

                                                        default:
                                                            cb({
                                                                error: 501,
                                                                body: "I don't know that pkg: '" + params.pkg + "'"
                                                            });
                                                    }
                                                }
                                            });
                                }
                            });
                }
            });
};


/** Packages asset node for use by client SceneJS.Socket
 */
function assetPkgForSocket(params, assetMeta, assetBody, cb) {

    /* Madatory attachToNode param - prepend with hash required
     * in the SceneJS.Socket configs map
     */
    var attachToNode = params.attachToNode ? params.attachToNode.replace(/^\s\s*/, '').replace(/\s\s*$/, '') : null;
    if (!attachToNode) {
        cb({ error: 501, body: "getAsset.attachToNode expected" });
        return;
    }
    attachToNode = attachToNode.charAt(0) == "#" ? attachToNode : "#" + attachToNode;

    /* Optional symbolURI
     */
    var symbolURI = params.symbolURI ? params.symbolURI.replace(/^\s\s*/, '').replace(/\s\s*$/, '') : null;
    if (symbolURI) {
        if (symbolURI.length == 0) {
            cb({
                error: 501,
                body: "getAsset.symbolURI is empty string"
            });
            return;
        }
        symbolURI = symbolURI.charAt(0) == "#" ? symbolURI : "#" + symbolURI;
    }
    cb({
        format : "json",
        body: "{ \"" + attachToNode + "\": { \"+node\": " +
              jsonUtils.packageAsFactoryFunc(assetBody.rootNode, {
                  baseURL: assetMeta.images.imagesDir,
                  symbolURI:params.symbolURI
              }) +
              " } }"
    });
}

function assetPkgForModule(params, assetMeta, assetBody, cb) {
    cb({
        format : "script",
        body: jsonUtils.packageAsModule(
                assetMeta.name,
                assetBody.rootNode,
                null,
                assetMeta.images.imagesDir)  // TODO: comments option
    });
}

exports.removeAsset = function(params, builderProduct, cb) {
    if (!params.assetMetaId) {
        cb({ error: 501, body: "removeAsset.id expected" });
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

