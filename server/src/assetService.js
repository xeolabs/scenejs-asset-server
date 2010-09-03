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

/*----------------------------------------------------------------------------------------------------------------------
 * Asset server core
 *
 * Provides a single #start function to kick it off, then listens for commands on WS and HTTP.
 *
 * This is just a thin wrapper around the Asset Store. It maps the value of the request "cmd" parameter to a function
 * on the Asset Store module, leaving that to validate the remaining parameters in context of the request.
 *
 * For a WS, the response from the Asset Store module is just serialised straight back as JSON.
 *
 * For HTTP the Store's response will have a "format" field specifying whether the response needs JSONification or
 * is already serielised. For HTTP, it also takes an optional "callback" parameter which causes it to wrap the
 * response for JSONP.
 *--------------------------------------------------------------------------------------------------------------------*/

var sys = require("sys");
var log = require('../lib/log').log;
var ws = require('../lib/ws');
var url = require('url');
var qs = require('querystring');

var assetStore = require('./store/assetStore');
var assetMap = require('./map/assetMap');

var settings;
var server;


var defaultSettings = {
    host : "localhost",
    port : 8888,
    attachmentsDir : process.cwd() + "/.attachments",
    attachmentsBaseURL: "/",
    db : {
        host: "localhost",
        port: 5984,
        dbname: "scenejs-assets"
    }
};

exports.defaultSettings = defaultSettings;

function createMessage(msg) {
    return "{ body: " + msg + "}";
}

function createErrorMessage(code, msg) {
    return "{ error: " + code + ", body: '" + msg + "'}";
}

/** Starts the asset server
 *
 * @param customSettings Optional settings to override internal defaults
 * @param cb Success callback
 */
exports.start = function(customSettings, cb) {
    settings = customSettings || defaultSettings;


    assetMap.start(settings,
            function() {
                assetStore.start(settings, function () {
                    createDummyContent();
                });
            });

    server = ws.createServer({
        debug: false
    });

    server.addListener("listening", function() {
        log("SceneJS Asset Server listening for connections on " + settings.host + ":" + settings.port);
        if (cb) {
            cb();
        }
    });

    /*---------------------------------------------------
     * Handle WebSocket requests
     *--------------------------------------------------*/

    server.addListener("connection",
            function(conn) {

                log("opened connection: " + conn._id);

                conn.addListener("message",
                        function(message) {

                            parseMessage(message,
                                    function(params) {

                                        service(
                                                params,
                                                function (result) {
                                                    if (result.error) {
                                                        server.send(conn._id, createErrorMessage(501, result.error));
                                                    } else {       
                                                        server.send(conn._id, createMessage(result.body));
                                                    }
                                                });
                                    },
                                    function(error) {
                                        server.send(JSON.stringify(error));
                                    });
                        });
            });


    server.addListener("close", function(conn) {
        log("closed connection: " + conn._id);
    });

    /*---------------------------------------------------
     * Handle HTTP requests
     *--------------------------------------------------*/

    server.addListener("request",
            function(req, res) {
                res.writeHead(200, {'Content-Type': "application/json"});
                var params = qs.parse(url.parse(req.url).query);
                log("http request " + JSON.stringify(params));

                service(
                        params,
                        function (result) {
                            var resultStr;

                            if (result.error) {
                                log("error handling HTTP request: " + result.error + " : " + result.body);
                                resultStr = JSON.stringify(result);

                            } else {
                                log("SceneServer READY");
                                switch (result.format) {

                                    /* Naked unbodied response from asset store,
                                     * eg. script for <script> tag or SceneJS.requireModule
                                     */
                                    case "script" :
                                        resultStr = result.body;
                                        break;

                                    default:

                                        /* Bodied response from asset store
                                         */
                                        resultStr = JSON.stringify(result);
                                }

                                //  log("responding with " + resultStr);
                            }
                            if (params.callback) {
                                res.end(wrapInCallback(params.callback, resultStr));
                            } else {
                                res.end(resultStr);
                            }

                        });

                log("DONE http request");
            });

    server.addListener("shutdown", function(conn) {
        log("Server shutdown"); // never actually happens, because I never tell the server to shutdown.
    });

    server.listen(settings.port, settings.host);
};

function parseMessage(message, ok, er) {
    try {
        ok(JSON.parse(message));
    } catch (e) {
        er({ error : 501, body : "request is not valid JSON: " + message });
    }
}

function service(params, cb) {
    if (!params.cmd) {
        cb({
            error: 501,
            body: "I need a cmd!"
        });
    } else {

        switch (params.cmd) {

            case "getStatus":
                cb({ body: "Ready" });
                break;

            case "createAsset":

                /* Create asset in AssetStore, then if it has spatial metadata insert it into AssetMap
                 */
                assetStore.createAsset(
                        params,
                        function(result) {
                            if (result.error) {
                                cb(result);
                            } else {

                                /* Asset created
                                 */
                                var assetMeta = result.body;
                                if (assetMeta.spatial && assetMeta.spatial.boundary) {

                                    /* Asset has spatial metadata - insert into AssetMap
                                     */
                                    assetMap.insertAsset({
                                        assetId:assetMeta.assetId,
                                        boundary:assetMeta.spatial.boundary
                                    },
                                            function(mapResult) {
                                                if (mapResult.error) {

                                                    /* Just log AssetMap insertion failure, but keep asset
                                                     */
                                                    log("FAILED to insert asset into AssetMap: " + mapResult.error);
                                                }
                                                cb(result);
                                            });
                                } else {

                                    /* Asset has no spatial metadata
                                     */
                                    log("AssetService : not inserting asset '" + assetMeta.assetId + "' into AssetMap - no assetMeta.spatial or assetMeta.spatial.boundary");
                                    cb(result);
                                }
                            }
                        });
                break;

            case "getAssetTags":
                assetStore.getAssetTags(params, cb);
                break;

            case "getAsset":
                assetStore.getAsset(params, cb);
                break;

            case "getAssetMeta":
                assetStore.getAssetMeta(params, cb);
                break;

            case "getAssetAssembly":
                assetStore.getAssetAssembly(params, cb);
                break;

            case "getAssets":
                assetStore.getAssets(params, cb);
                break;

            case "getAssetsInBoundary":
                assetMap.getAssetsInBoundary(params, cb);
                break;

            // Authentication needed here
            //
            //            case "deleteAsset":
            //                assetStore.deleteAsset(params, cb);
            //                return;

            case "getAssetMap":
                assetMap.getAssetMap(params, cb);
                break;

            case "getKDGraph" :
                assetMap.getKDGraph(params, cb);
                break;

            case "clientMessages" :
                    log("client messages");
                assetMap.clientMessages(params, cb);
                break;

            default:
                cb({
                    error: 501,
                    body: "I dont know that cmd: '" + params.cmd + "'"
                });
        }
    }
}

function wrapInCallback(callback, str) {
    return [callback, "(", str, ")"].join("");
}


function createDummyContent() {


    //    assetStore.deleteAsset({
    //        id :"org.scenejs.examples.collada.seymourplane"
    //    },
    //            function(result) {
    //                if (result.error) {
    //                    log(JSON.stringify(result.error));
    //                }
    //            });
    //
    //    assetStore.deleteAsset({
    //        id :"org.scenejs.examples.collada.house"
    //    },
    //            function(result) {
    //                if (result.error) {
    //                    log(JSON.stringify(result.error));
    //                }
    //            });

    service({
        cmd: "createAsset",
        meta : {
            name :"org.scenejs.examples.collada.seymourplane",
            description: "The Seymour Plane test model",
            tags : ["collada", "example", "zoofers", "zafus"]
        },
        assembly : {
            type : "dae",
            source: {
                url: "http://www.scenejs.org/library/v0.7/assets/examples/seymourplane_triangulate/seymourplane_triangulate_augmented.dae"
            }
        }
    }, function (result) {
        //        log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX")
        //        log(JSON.stringify(result))
    });

    //    service({
    //        cmd:"createAsset",
    //        meta : {
    //            name :"org.scenejs.examples.collada.house",
    //            description: "House model from VAST Architecture",
    //            tags : ["collada", "example", "gizangos"]
    //        },
    //        assembly : {
    //            type : "dae",
    //            source: {
    //                url: "http://scenejs.org/library/v0.7/assets/examples/courtyard-house/models/model.dae"
    //            },
    //            transforms : {
    //                center: true,
    //                position: { x: 1000.0 }
    //            }
    //        }
    //    }, function(result) {
    //
    //    });
    //
    //    service({
    //        cmd:"createAsset",
    //        meta : {
    //            name :"org.scenejs.examples.scenejs.spiralstairs",
    //            description: "Procedurally-generated spiral staircase",
    //            tags : ["collada", "example", "gizangos"]
    //        },
    //        assembly : {
    //            type : "scenejs-node",
    //            source: {
    //                url: "http://scenejs.org/library/v0.7/assets/examples/spiral-staircase/spiral-stairs-subgraph.js"
    //            },
    //            attachments: []
    //        }}, function(result) {
    //
    //    });
}