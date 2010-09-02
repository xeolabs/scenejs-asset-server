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

var sys = require("sys");

var fs = require('fs');
var path = require("path");
var http = require("http");
var url = require("url");
var log = require('../../lib/log').log;
var uuid = require('../../lib/uuid');
var couchdb = require('../../lib/node-couchdb/couchdb'); // Node-CouchDB: http://github.com/felixge/node-couchdb

var settings;
var client;
var db;

/* Spatial extents of the kd-map
 */
//const MAP_BOUNDARY = { xmin: -2000, ymin: -2000, zmin: -2000, xmax: 600, ymax: 600, zmax: 600 };

const MAP_BOUNDARY = { xmin: -30000, ymin: -30000, zmin: -30000, xmax: 1300, ymax: 1300, zmax: 1300 };
/* Intersection results for kd-map
 */
const INTERSECT_A_OUTSIDE_B = 0;
const INTERSECT_A_INSIDE_B = 1;
const INTERSECT_B_INSIDE_A = 2;
const INTERSECT_A_OVERLAP_B = 3;

/* Max depth of kd-map - when this exceeded during insertion descent,
 * asset is inserted into watever node we stopped at descent
 */
const MAX_DEPTH = 500;

/* The kd-tree
 */
var kdTree;

/* Node ID map
 */
var kdNodes = {};


const DB_NAME = "scenejs-asset-map";

/*----------------------------------------------------------------------------------------------------------------------
 * Starts the Asset Map service
 *
 * - loads the whole k-d tree into memory for fast access
 *--------------------------------------------------------------------------------------------------------------------*/

exports.start = function(_settings, cb) {
    settings = _settings;
           
    /* Connect to DB
     */
    log("SceneServer.AssetMap: connecting to CouchDB at " + settings.db.host + ":" + settings.db.port);
    try {
        client = couchdb.createClient(settings.db.port, settings.db.host, settings.db.user, settings.db.password);
        db = client.db(DB_NAME);
    } catch (e) {
        throw "SceneServer.AssetMap: FAILED to connect to CouchDB: " + e;
    }

    db.exists(
            function(error, exists) {
                if (error) {
                    throw JSON.stringify(error);
                }
                if (!exists) {

                    /* AssetMap DB not found
                     */
                    log("SceneServer.AssetMap: did not find DB '" + DB_NAME + "' - that's OK I'll make one..");

                    /* Create DB and map
                     */
                    db.create(
                            function(error) {
                                log("SceneServer.AssetMap: creating DB '" + DB_NAME + "'");
                                if (error) {
                                    log("SceneServer.AssetMap: failed to create CouchDB database: " + JSON.stringify(error));
                                    throw "SceneServer.AssetMap: failed to create CouchDB database";
                                }

                                /* Create map in DB - root node to begin with
                                 */
                                log("SceneServer.AssetMap: creating map");
                                kdTree = {
                                    id: uuid.uuidFast(),
                                    boundary: MAP_BOUNDARY,
                                    assets: [
                                    ]
                                };
                                kdNodes[kdTree.id] = kdTree;

                                db.saveDoc("kdtree", kdTree,
                                        function(error, doc) {
                                            if (error) {
                                                throw "SceneServer.AssetMap: failed to create kdTree: " + JSON.stringify(error);
                                            }

                                            /* Keep the revision number so we can
                                             * overwrite - we only want one version
                                             */
                                            kdTree.rev = doc.rev;
                                            log("SceneServer.AssetMap: created kdTree OK: " + JSON.stringify(kdTree));
                                            if (cb) {
                                                cb();
                                            }
                                        });
                            });
                } else {

                    /* DB exists - load kdTree
                     */
                    loadMap(function(error) {
                        if (error) {
                            throw "SceneServer.AssetMap: failed to load kdTree from DB: " + error;
                        }
                        if (cb) {
                            cb();
                        }
                    });
                }
            });
};

/** Loads kdTree
 */
function loadMap(cb) {
    log("SceneServer.AssetMap: loading kdTree");
    db.getDoc("kdtree",
            function(error, doc) {
                if (error) {
                    cb(JSON.stringify(error));
                } else {
                    kdTree = doc;
                    kdNodes = {};
                    buildNodeMap(kdTree);
                    cb();
                }
            });
}

/* Builds map of kd-nodes to their IDs
 */
function buildNodeMap(node) {
    kdNodes[node.id] = node;
    if (node.leftChild) {
        buildNodeMap(node.leftChild);
    }
    if (node.rightChild) {
        buildNodeMap(node.rightChild);
    }
}

/** Saves kdTree, overwriting existing document
 */
function saveMap(cb) {
    log("SceneServer.AssetMap: saving kdTree");
    db.removeDoc("kdtree", kdTree.rev,
            function(error) {
                if (error) {
                    log("SceneServer.AssetMap failed to remove kdTree: " + JSON.stringify(error));
                    throw "SceneServer.AssetMap failed to remove kdTree";
                }
                kdTree.rev = undefined;  // Gross HACK
                db.saveDoc("kdtree", kdTree,
                        function(error, doc) {
                            if (error) {
                                log("SceneServer.AssetMap failed to save kdTree: " + JSON.stringify(error));
                                throw "SceneServer.AssetMap failed to save kdTree";
                            }
                            kdTree.rev = doc.rev;
                            cb(kdTree);
                        });
            });
}

/*---------------------------------------------------------------------------------------------------------------------
 * Returns the IDs of assets intersecting the given boundary
 *
 *--------------------------------------------------------------------------------------------------------------------*/
exports.getAssetsInBoundary = function(params, cb) {
    var boundary;
    if (params.xmin || params.ymin || params.xmin || params.xmax || params.ymax || params.zmax) {
        if (!params.xmin || !params.ymin || !params.xmin || !params.xmax || !params.ymax || !params.zmax) {
            cb({ error: 500, body: "getAssetsInBoundary boundary is incomplete" });
            return;
        }
        if (params.xmin > params.xmax || params.ymin > params.ymax || params.zmin > params.zmax) {
            cb({ error: 500, body: "getAssetsInBoundary boundary is inside-out" });
            return;
        }
        boundary = {
            xmin: params.xmin,
            ymin: params.ymin,
            zmin: params.zmin,
            xmax: params.xmax,
            ymax: params.ymax,
            zmax: params.zmax
        };
        log("SceneServer.AssetMap: getAssetsInBoundary boundary=" + JSON.stringify(boundary));
    } else {
        log("SceneServer.AssetMap: getAssetsInBoundary");
    }
    var root = boundary ? findIsectNode(null, kdTree, boundary) : kdTree;
    var assetIds = root ? getAssetIdsInSubtree(root) : [];
    cb({ body: assetIds});
};

/**
 * Descends the kd-subtree to collect the IDs of assets referenced therein
 */
function getAssetIdsInSubtree(node, assetIds) {
    if (!assetIds) {
        assetIds = [];
    }
    for (var i = 0; i < node.assets.length; i++) {
        assetIds.push(node.assets[i].assetId);
    }
    if (node.leftChild) {
        getAssetIdsInSubtree(node.leftChild, assetIds);
    }
    if (node.rightChild) {
        getAssetIdsInSubtree(node.rightChild, assetIds);
    }
    return assetIds;
}

/*---------------------------------------------------------------------------------------------------------------------
 * Returns the Asset Map's kd-tree
 *
 *--------------------------------------------------------------------------------------------------------------------*/
exports.getAssetMap = function(params, cb) {
    log("SceneServer.AssetMap: getAssetMap");
    cb({ body: kdTree });
};


/*----------------------------------------------------------------------------------------------------------------------
 * Returns JSON (sub)graph of SceneJS.KDNodes, either for entire kd-tree of a portion of it
 *
 *   - subgraph is attached to given parent scene node
 *   - subgraph is returned in a "cfg-node" message
 *   - if a spatial region is given then the subgraph contains those kd-map nodes intersecting it
 *   - if a kd-node ID is given then the subgraph contains those kd-nodes beneath that
 *--------------------------------------------------------------------------------------------------------------------*/
exports.getKDGraph = function(params, cb) {
    if (!params.parentNodeID) {
        cb({ error: 500, body: "getKDGraph.parentNodeID missing" });
        return;
    }

    var root;
    if (params.boundary) {

        /* Get subgraph of KDNodes for a bounded section of the kd-tree
         */
        var boundary = params.boundary;
        if (!boundary.xmin || !boundary.ymin || !boundary.xmin || !boundary.xmax || !boundary.ymax || !boundary.zmax) {
            cb({ error: 500, body: "getKDGraph.boundary is incomplete" });
            return;
        }
        if (boundary.xmin > boundary.xmax || boundary.ymin > boundary.ymax || boundary.zmin > boundary.zmax) {
            cb({ error: 500, body: "getKDGraph.boundary is inside-out" });
            return;
        }
        log("SceneServer.AssetMap: getKDGraph boundary=" + JSON.stringify(boundary));

        root = findIsectNode(null, kdTree, boundary);

    } else if (params.kdNodeID) {
        log("SceneServer.AssetMap: getKDGraph kdNodeID=" + kdNodeID);

        root = kdNodes[params.kdNodeID];

    } else {
        root = kdTree;
        log("SceneServer.AssetMap: getKDGraph");
    }

    var messages = [
        {
            name: "cfg-node",
            params: {
                nodeID: params.parentNodeID,
                config: {
                    "+node": buildKDGraph(root) // TODO: cache KDNodes
                }
            }
        }
    ];
    var json = JSON.stringify(messages);
    log(json)
    cb({
        format : "json",
        body: json
    });
};

/**
 * Descends the kd-tree to selects the kd-subtree that overlaps
 * or is enclosed by the given boundary
 */
function findIsectNode(parent, node, boundary) {
    var isect = intersectsBoundary(boundary, node.boundary);
    switch (isect) {
        case INTERSECT_A_OUTSIDE_B: // No overlap between boundary and node
            return null;

        case  INTERSECT_B_INSIDE_A: // Boundary completely encloses node
            return node;

        case  INTERSECT_A_OVERLAP_B: // Boundary overlaps node
            return parent || node;

        case INTERSECT_A_INSIDE_B: // Boundary completely inside node - continue down into left or right child
            if (node.leftChild) {
                var result = findIsectNode(node, node.leftChild, boundary);
                if (result) {
                    return result;
                }
                result = findIsectNode(node, node.rightChild, boundary);
                if (result) {
                    return result;
                }
                return null;
            }
    }
}

function buildKDGraph(node) {
    var sceneNode = {
        type: "kdnode",
        id: node.id,
        cfg: {
            //            hasAssets: (node.assets && node.assets.length > 0),
            isVisible : true,
            assets: (node.assets && node.assets.length > 0) ? node.assets : undefined,
            xmin: node.boundary.xmin,
            ymin: node.boundary.ymin,
            zmin: node.boundary.zmin,
            xmax: node.boundary.xmax,
            ymax: node.boundary.ymax,
            zmax: node.boundary.zmax
        },
        nodes: []
    };
    if (node.leftChild) {
        sceneNode.nodes = [
            buildKDGraph(node.leftChild)
        ];
    }
    if (node.rightChild) {
        if (!sceneNode.nodes) {
            sceneNode.nodes = [];
        }
        sceneNode.nodes.push(buildKDGraph(node.rightChild));
    }
    return sceneNode;
}

/*----------------------------------------------------------------------------------------------------------------------
 * Services a request that notifies the server of batches of BoundingBox intersection state changes and gets
 * any assets the server then provides for kd-nodes that have either become visible or are likely to become visible
 *
 *--------------------------------------------------------------------------------------------------------------------*/
exports.getAssetMapUpdates = function(params, cb) {
    if (!params.events) {
        cb({ error: 500, body: "getAssetMapUpdates.events missing" });
        return;
    }
    const SERVER_URL = "http://" + settings.host + ":" + settings.port;

    log("SceneServer.AssetMap: getAssetMapUpdates");

    var messages = [];

    /* Process each event
     */
    var len = params.events.length;
    var event;
    for (var i = 0; i < len; i++) {
        event = params.events[i];

        switch (event.name) {

            case "gone":
                break;

            case "distant":
                break;

            case "near":
            case "visible":

                var node = kdNodes[event.params.nodeID];
                if (!node) {
                    log("kd-node not found: '" + event.params.nodeID + "'");
                } else {
                    var sceneNodes = [];
                    for (var j = node.assets.length - 1; j >= 0; j--) {
                        sceneNodes.push({
                            type: "asset",
                            cfg: {
                                uri: SERVER_URL + "?cmd=getAsset&pkg=node&id=" + node.assets[j].assetId
                            }
                        });
                    }
                    messages.push({
                        name: "cfg-node",
                        params: {
                            nodeID: event.params.nodeID,
                            config: {
                                "+nodes": sceneNodes
                            }
                        }
                    });
                }

                break;
        }
    }
    var json = JSON.stringify(messages);
    cb({
        // format : "json",
        body: json
    });
};

/*---------------------------------------------------------------------------------------------------------------------
 * Inserts an asset into the Asset Map
 *
 * TODO: Queue inserts to avoid race condition
 *
 * - inserts the asset into the kd-tree
 * - writes elements created in kd-tree through to DB
 *--------------------------------------------------------------------------------------------------------------------*/
exports.insertAsset = function(params, cb) {
    if (!params.assetId) {
        cb({ error: 501, body: "insertAsset.assetId expected" });
    } else if (!params.boundary) {
        cb({ error: 501, body: "insertAsset.boundary" });
    } else {

        log("SceneServer.AssetMap: insertAsset - " + JSON.stringify(params));
        var asset = { assetId: params.assetId, boundary: params.boundary };
        if (insertAsset(kdTree, asset, 0, 0)) {
            saveMap(function() {
                log("SceneServer.AssetMap insertAsset - OK");
                cb({ body: {} });
            });
        } else {
            cb({ error: 501, body: "SceneServer.AssetMap: insertAsset FAILED - outside of kdTree boundary!" });
        }
    }
};

function insertAsset(node, asset, axis, recursionDepth) {
    if (intersectsBoundary(asset.boundary, node.boundary) == INTERSECT_A_OUTSIDE_B) { // Asset outside root boundary
        return false;
    }

    recursionDepth++;

    if (recursionDepth >= MAX_DEPTH) { // Max hierarchy depth reached
        log("SceneServer.AssetMap: insertAsset - at max depth - inserting into current node");
        node.assets.push(asset);
        return true;
    }

    axis = (axis + 1) % 3;

    var leftBoundary = halfBoundary(node.boundary, axis, -1);
    var intersect = intersectsBoundary(asset.boundary, leftBoundary);
    switch (intersect) {
        case INTERSECT_A_INSIDE_B: // Inside left boundary - insert into left child
            if (!node.leftChild) {
                node.leftChild = {
                    id: uuid.uuidFast(),
                    boundary: leftBoundary,
                    assets: []
                };
                kdNodes[node.leftChild.id] = node.leftChild;
            }
            return insertAsset(node.leftChild, asset, axis, recursionDepth);

        case INTERSECT_A_OVERLAP_B: // Overlaps left and right child boundaries - insert into this node
            node.assets.push(asset);
            return true;

        case INTERSECT_A_OUTSIDE_B: // Outside left boundary - insert into right child
            var rightBoundary = halfBoundary(node.boundary, axis, 1);
            if (!node.rightChild) {
                node.rightChild = {
                    id: uuid.uuidFast(),
                    boundary: rightBoundary,
                    assets: []
                };
                kdNodes[node.rightChild.id] = node.rightChild;
            }
            return insertAsset(node.rightChild, asset, axis, recursionDepth);
    }
}

/** Create inverse boundary ready for expansion
 */
function newInsideOutBoundary() {
    return { xmin: 1000000.0, ymin: 1000000.0,zmin: 1000000.0, xmax: -1000000.0, ymax: -1000000.0,zmax: -1000000.0 };
}

/** Returns positive/negative half of the given boundary, split on given axis,
 */
function halfBoundary(b, axis, sign) {
    if (axis == 0) {
        var xmid = (b.xmax + b.xmin) / 2.0;
        return (sign < 0) ?
               { xmin: b.xmin, ymin: b.ymin, zmin: b.zmin, xmax: xmid,   ymax: b.ymax, zmax: b.zmax } :
               { xmin: xmid,   ymin: b.ymin, zmin: b.zmin, xmax: b.xmax, ymax: b.ymax, zmax: b.zmax };
    } else if (axis == 1) {
        var ymid = (b.ymax + b.ymin) / 2.0;
        return (sign < 0) ?
               { xmin: b.xmin, ymin: b.ymin, zmin: b.zmin, xmax: b.xmax, ymax: ymid,   zmax: b.zmax } :
               { xmin: b.xmin, ymin: ymid,   zmin: b.zmin, xmax: b.xmax, ymax: b.ymax, zmax: b.zmax };
    } else {
        var zmid = (b.zmax + b.zmin) / 2.0;
        return (sign < 0) ?
               { xmin: b.xmin, ymin: b.ymin, zmin: b.zmin, xmax: b.xmax, ymax: b.ymax, zmax: zmid } :
               { xmin: b.xmin, ymin: b.ymin, zmin: zmid,   xmax: b.xmax, ymax: b.ymax, zmax: b.zmax };
    }
}

/** Returns intersection status of boundary A with B
 */
function intersectsBoundary(a, b) {
    if (a.xmax < b.xmin ||
        a.xmin > b.xmax ||
        a.ymax < b.ymin ||
        a.ymin > b.ymax ||
        a.zmax < b.zmin ||
        a.zmin > b.zmax) {
        // log("intersectsBoundary INTERSECT_A_OUTSIDE_B : a=" + JSON.stringify(a) + ", b=" + JSON.stringify(b))
        return INTERSECT_A_OUTSIDE_B; // A entirely outside B
    }
    if (a.xmax <= b.xmax &&
        a.ymax <= b.ymax &&
        a.zmax <= b.zmax &&
        a.xmin >= b.xmin &&
        a.ymin >= b.ymin &&
        a.zmin >= b.zmin) {
        // log("intersectsBoundary INTERSECT_A_INSIDE_B : a=" + JSON.stringify(a) + ", b=" + JSON.stringify(b))
        return INTERSECT_A_INSIDE_B;  // A entirely inside B
    }
    if (a.xmax >= b.xmax &&
        a.ymax >= b.ymax &&
        a.zmax >= b.zmax &&
        a.xmin <= b.xmin &&
        a.ymin <= b.ymin &&
        a.zmin <= b.zmin) {
        // log("intersectsBoundary INTERSECT_B_INSIDE_A : a=" + JSON.stringify(a) + ", b=" + JSON.stringify(b))
        return INTERSECT_B_INSIDE_A;  // B entirely inside A
    }
    // log("intersectsBoundary INTERSECT_A_OVERLAP_B : a=" + JSON.stringify(a) + ", b=" + JSON.stringify(b))
    return INTERSECT_A_OVERLAP_B;     // A overlaps B
}


/*---------------------------------------------------------------------------------------------------------------------
 * Removes an asset from the Asset Map
 *
 * - finds node in kd-tree
 * - removes asset from node
 * - if node then has no assets, removes it else writes changes
 *--------------------------------------------------------------------------------------------------------------------*/
exports.removeAsset = function(params, cb) {
    log("SceneServer.AssetMap: removeAsset");
    if (!params.assetId) {
        cb({ error: 501, body: "removeAsset.assetId expected" });
    } else if (!params.boundary) {
        cb({ error: 501, body: "removeAsset.boundary" });
    } else {
        var asset = { assetId: params.assetId, boundary: params.boundary };
        if (removeAsset(kdTree, asset, 0, 0)) {
            cb({ body: {} });
        } else {
            cb({ error: 501, body: "asset boundary too big" });
        }
    }
};

function removeAsset(node, asset, axis, recursionDepth, cb) {
    axis = (axis + 1) % 3;
    if (intersectsBoundary(asset.boundary, node.boundary) != INTERSECT_A_INSIDE_B) { // Asset outside root boundary
        cb({ error: 501, body: "SceneServer.AssetMap: outside root node boundary" });
        return;
    }

    recursionDepth++;
    if (recursionDepth >= MAX_DEPTH) { // Max hierarchy depth reached
        var index = getAssetIndex(node, asset);
        if (index > -1) {
            if (node.assets.length == 0) {
                /* Remove leaf node
                 */
            } else {
                node.assets.splice(index, 1);
            }
        }
        cb();
        return;
    }

    if (node.leftChild != null) { // Try to insert into existing left child
        insertAsset(node.leftChild, asset, axis, recursionDepth, cb);
        return;
    }

    if (node.rightChild != null) { // Try to insert into existing right child
        insertAsset(node.rightChild, asset, axis, recursionDepth, cb);
        return;
    }

    var leftBoundary = halfBoundary(node.boundary, axis, -1);
    switch (intersectsBoundary(leftBoundary, asset.boundary)) {
        case INTERSECT_A_INSIDE_B: // Inside left boundary - insert into left child
            if (!node.leftChild) {
                node.leftChild = {
                    sid:  "l",
                    boundary: leftBoundary,
                    assets: []
                };
            }
            insertAsset(node.leftChild, asset, axis, recursionDepth, cb);
            return;

        case INTERSECT_A_OVERLAP_B: // Overlaps left and right child boundaries - insert into this node
            node.assets.push(asset);
            cb();
            return;

        case INTERSECT_A_OUTSIDE_B: // Outside left boundary - insert into right child
            var rightBoundary = halfBoundary(node.boundary, axis, 1);
            if (!node.rightChild) {
                node.rightChild = {
                    sid:  "r",
                    boundary: rightBoundary,
                    assets: []
                };
            }
            insertAsset(node.rightChild, asset, axis, recursionDepth, cb);
            return;
    }
}

function getAssetIndex(node, asset) {
    for (var i = 0; i < node.assets.length; i++) {
        if (node.assets[i] == asset.assetId) {
            return i;
        }
    }
    return -1;
}