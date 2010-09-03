/*
 Testing the asset server API "getAsset" command.

 This just pulls back the Seymour Plane example and plants it in a simple scene.

 Lindsay S. Kay,
 lindsay.kay@xeolabs.com


 */

/* Retain the rotate nodes so we can update them off the mouse
 */
var rotateY;
var rotateX;

var exampleScene = new SceneJS.Scene({
    canvasId: "theCanvas" ,
    loggingElementId: "theLoggingDiv"
},
        new SceneJS.LookAt({
            eye : { x: -1.0, y: 0.0, z: 15 },
            look : { x: -1.0, y: 0, z: 0 },
            up : { y: 1.0 }
        },
                new SceneJS.Camera({
                    optics: {
                        type: "perspective",
                        fovy : 55.0,
                        aspect : 1.47,
                        near : 0.10,
                        far : 300.0 }
                },
                        new SceneJS.Light({
                            type:     "dir",
                            color:    { r: 1.0, g: 1.0, b: 1.0 },
                            dir:      { x: 1.0, y: -1.0, z: 1.0 },
                            diffuse:  true,
                            specular: true
                        }),

                        new SceneJS.Light({
                            type:     "dir",
                            color:    { r: 1.0, g: 1.0, b: 1.0 },
                            dir:      { x: -1.0, y: -1.0, z: -3.0 },
                            diffuse:  true,
                            specular: true
                        }),

                        rotateY = SceneJS.rotate({
                            sid: "yaw",
                            angle : { name: "yaw", value: 0.0 },
                            y : 1.0
                        },
                                rotateX = SceneJS.rotate({
                                    sid: "pitch",
                                    angle : { name: "pitch", value: 30.0 },
                                    x : 1.0
                                },

                                    /* Use our plane model, defined in seymour-plane-model.js
                                     * and loaded via a <script> tag in index.html
                                     */
                                        seymourPlane)
                                )
                        )));


/*----------------------------------------------------------------------
 * Scene rendering loop and mouse handler stuff follows
 *---------------------------------------------------------------------*/
var pInterval;

var yaw = 305;
var pitch = 10;
var lastX;
var lastY;
var dragging = false;

/* Always get canvas from scene - it will try to bind to a default canvas
 * can't find the one specified
 */
var canvas = document.getElementById(exampleScene.getCanvasId());

function mouseDown(event) {
    lastX = event.clientX;
    lastY = event.clientY;
    dragging = true;
}

function mouseUp() {
    dragging = false;
}

/* On a mouse drag, we'll re-render the scene, passing in
 * incremented angles in each time.
 */
function mouseMove(event) {
    if (dragging) {
        yaw += (event.clientX - lastX) * 0.5;
        pitch += (event.clientY - lastY) * 0.5;
        lastX = event.clientX;
        lastY = event.clientY;
    }
}

canvas.addEventListener('mousedown', mouseDown, true);
canvas.addEventListener('mousemove', mouseMove, true);
canvas.addEventListener('mouseup', mouseUp, true);

window.render = function() {

    rotateX.setAngle(pitch);
    rotateY.setAngle(yaw);

    exampleScene.render();
};

SceneJS.addListener("error", function(event) {
    alert(event.exception.message);
    window.clearInterval(pInterval);
});

SceneJS.addListener("reset", function(event) {
    window.clearInterval(pInterval);
});

pInterval = setInterval("window.render()", 10);
