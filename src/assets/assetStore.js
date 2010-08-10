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
var rmdirrf = require('../../lib/npm/rm-rf');

var settings;
var client;
var db;

/*----------------------------------------------------------------------------------------------------------------------
 * Asset Store
 *
 * After starting it up with #start, the store
 *--------------------------------------------------------------------------------------------------------------------*/


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

/*---------------------------------------------------------------------------------------------------------------------
 * Creates new asset. This creates four records for the new asset: body, assembly, metadata and handle. These
 * creations are done in a chain, in that order. Also creates an attachments directory (path specified in settings)
 * and downloads all images referenced in the asset source file(s) into that.
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
                    log("FAILED to create asset-body " + id + ": " + JSON.stringify(error));
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {

                    /* Create assembly
                     */
                    createAssetAssembly(params, builtProduct, assetBody,
                            function(result) {
                                if (result.error) {

                                    /* Failed - remove asset body
                                     */
                                    log("Deleting asset-body " + assetBody.id);
                                    db.removeDoc(assetBody.id, assetBody.rev,
                                            function(error, result) {
                                                if (error) {
                                                    log("FAILED to delete asset-body " + assetBody.id + ": " + JSON.stringify(error));
                                                }
                                            });
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
function createAssetAssembly(params, builtProduct, assetBody, cb) {
    var id = "asset-assembly-" + uuid.uuidFast();
    log("creating asset assembly: " + id);

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
                    log("FAILED to create asset-assembly " + id + ": " + error);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {

                    /* Create images and metadata
                     */
                    saveAssetImages(params, builtProduct, assetBody, assembly,
                            function(result) {
                                if (result.error) {

                                    /* Failed - uncreate assembly
                                     */
                                    log("Deleting asset-assembly " + assembly.id);
                                    db.removeDoc(assembly.id, assembly.rev,
                                            function(error, result) {
                                                if (error) {
                                                    log("FAILED to delete asset-assembly " + assembly.id + ": " + error);
                                                }
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

                    /* Create metadata record
                     */
                    createAssetMeta(params, builtProduct, assetBody, assetAssembly, savedImages,
                            function(result) {
                                if (result.error) {

                                    /* Failed to create metadata - remove images dir
                                     */
                                    log("Removing images dir " + savedImages.imagesDir);
                                    rmdirrf.rm(savedImages.imagesDir, function(error) {
                                        if (error) {
                                            log("FAILED to remove images dir " + savedImages.imagesDir + ": " + error);
                                        }
                                    });
                                }
                                cb(result);
                            });
                }
            });
}

function saveImages(params, builtProduct, cb) {
    var imagesDir = settings.attachmentsDir + "/" + uuid.uuidFast() + "/";
    fs.mkdir(imagesDir, 0755,
            function(error) {
                if (error) {
                    log("FAILED to create images dir " + imagesDir + ": " + error);
                    cb({ error: error });
                } else {
                    var savedImages = {
                        imageList : []
                    };
                    if (builtProduct.body.attachments) {
                        var attachments = builtProduct.body.attachments;
                        try {
                            fetchAttachments(imagesDir, attachments, 0, savedImages,
                                    function() {
                                        cb(null, { imagesDir: imagesDir, savedImages: savedImages.imageList });
                                    });
                        } catch (e) {
                            rmdirrf.rm(imagesDir,
                                    function(error) {
                                        if (error) {
                                            log("FAILED to remove images dir " + imagesDir + ": " + error);
                                        }
                                    });
                            cb({ error: e });
                            return;
                        }
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
function fetchAttachments(imagesDir, attachments, i, savedImages, cb) {
    if (i < attachments.length) {
        fetchAttachment(imagesDir, attachments[i],
                function(error) {
                    if (error) {
                        log("FAILED to fetch attachment " + attachments[i].name + ": " + error);
                        throw error;
                    }
                    savedImages.imageList.push(attachments[i].name);
                    fetchAttachments(imagesDir, attachments, i + 1, savedImages, cb);
                });
    } else {
        cb();
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
        description : params.meta.description || asset.name || "n/a",
        contributor : params.meta.contributor || asset.contributor || "n/a",
        manifest : builtProduct.body.manifest || {},
        spatial : builtProduct.body.spatial || {},
        stats : builtProduct.body.stats || {},
        images : savedImages
    },
            function(error, assetMeta) {
                if (error) {
                    log("FAILED to create asset-meta " + id + ": " + error);
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {

                    /* Create asset handle record
                     */
                    createAssetHandle(params, builtProduct, assetBody, assetAssembly, assetMeta,
                            function(result) {
                                if (result.error) {

                                    /* Failed to create handle - uncreate metadata
                                     */
                                    log("Deleting asset-meta " + assetMeta.id);
                                    db.removeDoc(assetMeta.id, assetMeta.rev,
                                            function(error, result) {
                                                if (error) {
                                                    log("FAILED to delete asset-meta " + assetMeta.id + ": " + JSON.stringify(error));
                                                }
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
    var id = params.meta.name.replace(/ /g, ".");
    //var id = "asset-" + uuid.uuidFast();
    log("creating asset handle: " + id);
    db.saveDoc(id, {
        type : "asset-handle",
        name : params.meta.name || builtProduct.asset.name,
        tags : mergeMaps(params.meta.tags || [], (builtProduct.asset ? builtProduct.asset.tags : [])),
        assetBodyId : assetBody.id,
        assetAssemblyId : assetAssembly.id,
        assetMetaId : assetMeta.id
    },
            function(error, assetHandle) {
                if (error) {
                    log("FAILED to create asset " + id + ": " + JSON.stringify(error));
                    cb({ error: 500, body: JSON.stringify(error) });
                } else {
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

                                    log("Deleting asset-meta " + assetMeta._id);

                                    log(JSON.stringify(assetMeta))
                                    db.removeDoc(assetMeta._id, assetMeta._rev,
                                            function(error, result) {
                                                if (error) {
                                                    log("FAILED to delete asset " + assetHandle._id + " asset-meta " + assetMeta._id + ": " + JSON.stringify(error));
                                                }

                                                /* Delete asset assembly
                                                 */
                                                db.getDoc(assetHandle.assetAssemblyId,
                                                        function(error, assetAssembly) {
                                                            if (error) {
                                                                cb({ error: 500, body: JSON.stringify(error) });

                                                            } else {

                                                                log("Deleting asset-assembly " + assetAssembly._id);

                                                                db.removeDoc(assetAssembly._id, assetAssembly._rev,
                                                                        function(error, result) {
                                                                            if (error) {
                                                                                log("FAILED to delete asset " + assetHandle._id + " asset-assembly " + assetAssembly._id + ": " + JSON.stringify(error));
                                                                            }

                                                                            /* Delete asset body
                                                                             */
                                                                            db.getDoc(assetHandle.assetBodyId,
                                                                                    function(error, assetBody) {
                                                                                        if (error) {
                                                                                            cb({ error: 500, body: JSON.stringify(error) });

                                                                                        } else {

                                                                                            log("Deleting asset-body " + assetBody._id);

                                                                                            db.removeDoc(assetBody._id, assetBody._rev,
                                                                                                    function(error, result) {
                                                                                                        if (error) {
                                                                                                            log("FAILED to delete asset " + assetHandle._id + " asset-body " + assetBody._id + ": " + JSON.stringify(error));
                                                                                                        }

                                                                                                        /* Delete asset handle
                                                                                                         */
                                                                                                        db.removeDoc(assetHandle._id, assetHandle._rev,
                                                                                                                function(error, result) {
                                                                                                                    if (error) {
                                                                                                                        log("FAILED to delete asset handle " + assetHandle._id + ": " + JSON.stringify(error));
                                                                                                                    }

                                                                                                                    /* Remove images dir
                                                                                                                     */
                                                                                                                    log("Removing images dir " + assetMeta.images.imagesDir);
                                                                                                                    rmdirrf.rm(assetMeta.images.imagesDir, function(error) {
                                                                                                                        if (error) {
                                                                                                                            log("FAILED to remove images dir " + assetMeta.images.imagesDir + ": " + error);
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
                                    log("FAILED to delete document " + id + ": " + JSON.stringify(error));
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
    log("getAssetTags");
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
    log("getAssets");
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
        log("getAssetMeta tags:" + JSON.stringify(params.tags));
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
                                            body:  JSON.stringify({    // Filter out couchdb id and rev
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
    if (!params.id || params.name) {
        cb({ error: 501, body: "getAsset.id or getAsset.name expected" });
        return;
    }

    if (!params.pkg) {
        cb({ error: 501, body: "getAsset.pkg expected" });
        return;
    }

    if (params.id) {
        log("getAsset id: " + params.id + ", pkg: " + params.pkg);
    } else {
        log("getAsset name: " + params.name + ", pkg: " + params.pkg);
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
        //        body:  '   { ' +
        //                       '        configs: {' +
        //                       '            "#attachHere": {' +
        //                       '                "+node" : SceneJS.node({ sid: "teapot" },' +
        //                       '                        SceneJS.translate(' +
        //                       '                            SceneJS.rotate({' +
        //                       '                                   sid: "rotate",' +
        //                       '                                    angle: 0,' +
        //                       '                                    y : 1.0' +
        //                       '                                },' +
        //                       '                                SceneJS.objects.teapot())))' +
        //                       '            }' +
        //                       '       }' +
        //                       '   }'
        body: "{ configs: { " +
              "\"" + attachToNode + "\": { \"+node\": " +
              jsonUtils.packageAsFactoryFunc(assetBody.rootNode, {
                  baseURL: assetMeta.images.imagesDir,
                  symbolURI:params.symbolURI
              }) +
              " } } }"
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

