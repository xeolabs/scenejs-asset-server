(function () {

    /*-----------------------------------------------------------------------------------------------------------------
     * kdAsset node definition
     *
     *
     *---------------------------------------------------------------------------------------------------------------*/

    function jsonp(fullUri, onLoad) {
        var callbackName = "cb" + (new Date()).getTime();
        var head = document.getElementsByTagName("head")[0];
        var script = document.createElement("script");
        script.type = "text/javascript";
        window[callbackName] = function(data) {
            onLoad(data);
            window[callbackName] = undefined;
            try {
                delete window[callbackName];
            } catch(e) {
            }
            head.removeChild(script);
        };
        head.appendChild(script);
        script.src = fullUri;  // Request fires now
    }

    const INITIAL = 0;
    const LOADING = 1;
    const LOADED = 2;
    const RENDERING = 2;

    SceneJS.kdAsset = function(uri) {

        var status = INITIAL;
        var asset;

        return SceneJS.node({
            listeners: {
                "rendering" : function() {
                    if (status != RENDERING) {
                        var self = this;
                        switch (status) {
                            case INITIAL:
                                jsonp(uri,
                                        function(json) {    // onLoad
                                            if (!data) {
                                                throw "asset server kd-tree asset response is null";
                                            } else if (data.error) {
                                                throw "asset server responded with error: " + data.error;
                                            } else {
                                                alert(json);
                                                asset = eval("(" + json + ")");
                                                status = LOADED;
                                            }
                                        });
                                status = LOADING;
                                break;

                            case LOADING:
                                break;

                            case LOADED:
                                self.addNode(asset);
                                status = RENDERING;
                                break;
                        }
                    }
                }
            }
        });
    };

    /*-----------------------------------------------------------------------------------------------------------------
     * kdClient module definition
     *
     *---------------------------------------------------------------------------------------------------------------*/

    var moduleCfg = {};

    SceneJS.installModule("org.scenejs.kdclient", {

        init : function (cfg) {
            moduleCfg = cfg;
        },

        /** Node factory function - returns the subgraph that
         * will contain the kd-tree content
         *
         * @param {String} params.serverURI WS URL of Asset Server
         * @param {Object} params.boundary Optional 3D boundary to select a portion fo the kd-tree to pull in
         */
        getNode : function(params) {
            alert("getNode");
            if (!params.serverURI) {
                throw "kdclient needs a serverURI";
            }

            if (params.boundary) {

                /* Will get BoundingBoxes for a bounded section of the kd-tree
                 */


                var b = params.boundary;
                if (!b.xmin || !b.ymin || !b.xmin || !b.xmax || !b.ymax || !b.zmax) {
                    throw "kdclient boundary is incomplete";
                }
                if (b.xmin > b.xmax || b.ymin > b.ymax || b.zmin > b.zmax) {
                    throw "kdclient boundary is inside-out";
                }
            }

            return SceneJS.socket({

                /* URL of Asset Server WebSocket
                 */
                uri: params.serverURI,

                /* Bootstrap message to send on opening connection - requests BoundingBoxes
                 */
                messages: [
                    {
                        cmd: "getAssetMapBoundingBoxes",
                        boundary: params.boundary        // Can be undefined
                    }
                ],

                /* Listeners for events on the BoundingBoxes. These are in a function closure,
                 * which holds the outgoing event/message buffer. SceneJS puts a "uri" property in
                 * each event's params, which is the relative SID path down to the source BoundingBox.
                 */
                listeners: (function () {

                    var eventBuffer = [];

                    return {

                        /* Intersection event from BoundingBox
                         */
                        "isect-event" : function(params) {

                            /* Intersection state reporting in event - which of these
                             * is actually reported depends on which ones the server has
                             * configured the BoundingBox to report, which in turn depends
                             * on what caching/staging and LOD capabilities the server provides
                             */
                            switch (params.newState) {
                                case SceneJS.BoundingBox.STATE_OUTSIDE_OUTER_LOCALITY:
                                    eventBuffer.push({ name: "gone", params: params });
                                    break;

                                case SceneJS.BoundingBox.STATE_INTERSECTING_OUTER_LOCALITY:
                                    eventBuffer.push({ name: "distant", params: params });
                                    break;

                                case SceneJS.BoundingBox.STATE_INTERSECTING_INNER_LOCALITY:
                                    eventBuffer.push({ name: "near", params: params });
                                    break;

                                case SceneJS.BoundingBox.STATE_INTERSECTING_FRUSTUM:
                                    eventBuffer.push({ name: "visible", params: params });
                                    break;
                            }
                        },

                        /* LOD switch state - only received if server has configured
                         * BoundingBoxes to report it, which depends on whether the server
                         * supports LOD in any way
                         */
                        "lod-event" : function(params) {
                            eventBuffer.push({ name: "lod-changed", params: params });
                        },

                        /* Event from this Socket signifying that the traversal (rendering)
                         * of the BoundingBox subgraph has just completed. All events that were
                         * fired by the BoundingBoxes during the traversal are buffered, so
                         * package them all into a single enqueued message for the server.
                         */
                        "rendered" : function() {
                            this.addMessage({ cmd: "getAssetMapUpdates", events: eventBuffer });
                            eventBuffer = [];
                        },

                        /* Filter server response - we want to
                         */
                        //                        "msg-received" : function(params) {
                        //
                        //                            if (params.menuUpdate) {
                        //
                        //                                /* Menu update
                        //                                 */
                        //                            }
                        //                        } ,

                        "msg-sent" : {
                            fn: function(message) {
                                alert(JSON.stringify(message));
                            }
                        },

                        "msg-received" : {
                            fn: function(message) {
                                alert(JSON.stringify(message.body.configs));
                            }
                        },

                        "state-changed" : {
                            fn: function(params) {
                                switch (params.newState) {
                                    case SceneJS.Socket.STATE_CONNECTING:
                                        alert("STATE_CONNECTING");
                                        break;

                                    case SceneJS.Socket.STATE_OPEN:
                                        alert("STATE_OPEN");
                                        break;

                                    case SceneJS.Socket.STATE_CLOSED:
                                        alert("STATE_CLOSED");
                                        break;

                                    case SceneJS.Socket.STATE_ERROR:
                                        alert("STATE_ERROR: " + params.exception.message);
                                        break;
                                }
                            }
                        }
                    };
                })()
            },

                /**
                 * This is the node that the BoundingBox hierarchy will attach to:
                 */
                    SceneJS.node({
                        sid: "assetMap"  // "scoped identifier", unique within scope of the parent node
                    }));
        }
    });
})();
