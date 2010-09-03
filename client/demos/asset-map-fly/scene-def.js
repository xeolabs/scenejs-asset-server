/*
 Testing the asset server API "getAssetMap" command.

 This example pulls back the kd-map and creates a scene containing a hierarchy of BoundingBoxes
 which synchronise their content with the server as their frustum/locality intersection states changed.

 Lindsay S. Kay,
 lindsay.kay@xeolabs.com
 */

/**
 * Global scene data model. This is an object that can contain whatever metadata
 * the server and client share. It's updated by the server through "set-data"
 * response messages.
 */
var dataModel;


var exampleScene = SceneJS.scene({
    canvasId: "theCanvas",
    loggingElementId: "theLoggingDiv" },

    /* Connection to Asset Server
     */
        SceneJS.socket({
            id: "scene-socket",                             // Enables sub-nodes to fire events straight at this Socket
            uri: "ws://localhost:8888/api/v1/",             // Asset Server URL
            messages: [
                {
                    cmd: "clientMessages",
                    messages: [
                        {
                            cmd: "getAssetMap",
                            params: {
                                nodeID: "kd-root"
                            }
                        }
                    ]
                }
            ],

            /* Listen to events fired at/by this Socket
             */
            listeners: (function () {
                var eventBuffer = [];                       // Outgoing messages buffer
                return {

                    /* Socket state change
                     */
                    "state-changed" : function(event) {     // Socket state change
                        switch (event.params.newState) {
                            case SceneJS.Socket.STATE_CONNECTING:
                                //    alert("STATE_CONNECTING");
                                break;

                            case SceneJS.Socket.STATE_OPEN:
                                // alert("STATE_OPEN");
                                break;

                            case SceneJS.Socket.STATE_CLOSED:
                                // alert("STATE_CLOSED");
                                break;

                            case SceneJS.Socket.STATE_ERROR:
                                //  alert("STATE_ERROR: " + event.params.exception.message);
                                break;
                        }
                    },

                    "msg-sent": function(message) {         // Socket messages sent
                        alert(JSON.stringify(message));
                    },

                    "msg-received" : function(event) {      // Incoming messages from asset server
                        var params = event.params;
                        if (params && params.message) {
                            if (params.message.error) {
                                alert(params.message.error);
                            } else {
                                var messages = params.message.body;
                                var message;
                                for (var i = 0; i < messages.length; i++) {
                                    message = messages[i];
                                    if (message.cmd == "assetMap") {    // Asset map
                                        SceneJS.getNode(message.params.nodeID)
                                                .addNode(assetMap2BoundingBoxes(message.params.map));
                                    }
                                }
                            }
                        }
                    },

                    /* Socket subgraph traversed - schedule buffered messages for server, start fresh buffer
                     */
                    "rendered" : function() {
                        if (eventBuffer.length > 0) {
                            this.addMessage({ cmd: "clientMessages", messages: eventBuffer });
                            eventBuffer = [];
                        }
                    }
                };
            })()
        },


                SceneJS.lookAt({
                    id: "lookat",
                    eye : { x: 0, y: 0, z: 50.0 },
                    look : { x: 0, y: 0, z: 0 },
                    up : { x: 0, y: 1.0, z: 0 }
                },

                    /* Camera
                     */
                        SceneJS.camera({
                            id: "camera",
                            optics: {
                                type: "perspective",
                                fovy : 45.0,
                                aspect : 2.0,
                                near : 0.10,
                                far : 80000.0  }
                        },
                            /* Default lights
                             */
                                SceneJS.node({
                                    id: "lights"
                                },
                                        SceneJS.light({
                                            sid: "light1",
                                            cfg: {
                                                type:                   "dir",
                                                color:                  { r: 1.0, g: 1.0, b: 1.0 },
                                                diffuse:                true,
                                                specular:               true,
                                                dir:                    { x: 1.0, y: 1.0, z: -1.0 }
                                            }
                                        }),

                                        SceneJS.light({
                                            sid: "light2",
                                            cfg: {
                                                type:                   "dir",
                                                color:                  { r: 0.8, g: 0.8, b: 0.8 },
                                                diffuse:                true,
                                                specular:               true,
                                                dir:                    { x: 2.0, y: 1.0, z: 0.0 }
                                            }
                                        })),
//                                SceneJS.material({
//                                    baseColor:      { r: 0.3, g: 0.3, b: 0.9 },
//                                    specularColor:  { r: 0.9, g: 0.9, b: 0.9 },
//                                    specular:       0.9,
//                                    shine:          6.0
//                                },
//                                        SceneJS.teapot()),

                            /* Mount point for kd-tree
                             */
                                SceneJS.node({
                                    id: "kd-root"
                                })))));

/*----------------------------------------------------------------------
 * Scene rendering loop and mouse handler stuff follows
 *---------------------------------------------------------------------*/

var eye = { x: 0, y: 0, z: -150 };
var look = { x :  0, y: 0, z: 0 };
var speed = 0;
var yaw = 0;
var pitch = 0;
var lastX;
var lastY;
var dragging = false;
var moveAngle = 0;
var moveAngleInc = 0;


/* Always get the canvas from the scene graph - it might bind to
 * a default one of it can't find the one specified.
 */
var canvas = document.getElementById(exampleScene.getCanvasId());

function mouseDown(event) {
    lastX = event.clientX;
    lastY = event.clientY;
    dragging = true;
}

function mouseUp() {
    dragging = false;
    speed = 0;
    moveAngleInc = 0;
}

/* On a mouse drag, we'll re-render the scene, passing in
 * incremented angles in each time.
 */
function mouseMove(event) {
    if (!lastX) {
        lastX = event.clientX;
        lastY = event.clientY;
    }
    if (dragging) {
        moveAngleInc = (event.clientX - lastX) * 0.002;
        speed = (lastY - event.clientY) * 0.01;
    }
}

function mouseWheel(event) {
    var delta = 0;
    if (!event) event = window.event;
    if (event.wheelDelta) {
        delta = event.wheelDelta / 120;
        if (window.opera) delta = -delta;
    } else if (event.detail) {
        delta = -event.detail / 3;
    }
    if (delta) {
        if (delta < 0) {
            speed -= 3
        } else {
            speed += 3
        }
    }
    if (event.preventDefault)
        event.preventDefault();
    event.returnValue = false;
}

canvas.addEventListener('mousedown', mouseDown, true);
canvas.addEventListener('mousemove', mouseMove, true);
canvas.addEventListener('mouseup', mouseUp, true);
canvas.addEventListener('mousewheel', mouseWheel, true);

window.render = function() {
    moveAngle -= moveAngleInc;

    /* Using Sylvester Matrix Library to create this matrix
     */
    var rotMat = Matrix.Rotation(moveAngle * 0.0174532925, $V([0,1,0]));
    var moveVec = rotMat.multiply($V([0,0,1])).elements;
    if (speed) {

        eye.x += moveVec[0] * speed;
        eye.z += moveVec[2] * speed;
    }

    SceneJS.fireEvent("configure", "lookat", { cfg: { eye : eye, look: { x: eye.x + moveVec[0], y: eye.y, z : eye.z + moveVec[2] }} });
    exampleScene

            .render();
};

/* Render loop until error or reset
 * (which IDE does whenever you hit that run again button)
 */
var pInterval;

SceneJS.addListener("error", function(e) {
    alert(e.exception.message);
    window.clearInterval(pInterval);
});

SceneJS.addListener("reset", function() {
    window.clearInterval(pInterval);
});

pInterval = window.setInterval("window.render()", 10);