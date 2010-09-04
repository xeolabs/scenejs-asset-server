/** Creates a subgraph of BoundingBoxes from the Asset Server's asset map
 *
 * @param mapNode Root of asset map
 */
function assetMap2BoundingBoxes(mapNode, parent) {
    var node = createAssetNodeBoundingBox(mapNode);
    if (parent) {
        parent.addNode(node);
    }
    if (mapNode.leftChild) {
        assetMap2BoundingBoxes(mapNode.leftChild, node);
    }
    if (mapNode.rightChild) {
        assetMap2BoundingBoxes(mapNode.rightChild, node);
    }
    return node;
}

SceneJS.setDebugConfigs({

    shading : {
        whitewash : false
    }
});

function createAssetNodeBoundingBox(mapNode) {
    var boundary = mapNode.boundary;
    var min = -0.5;
    var max = +0.5;

    var material;
    var translate;

    var bbox = new SceneJS.BoundingBox({
        id: mapNode.id,
        xmin: boundary.xmin,
        ymin: boundary.ymin,
        zmin: boundary.zmin,
        xmax: boundary.xmax,
        ymax: boundary.ymax,
        zmax: boundary.zmax
    });

    if (mapNode.assets) {
        for (var i = 0; i < mapNode.assets.length; i++) {
            bbox.addNode(createAssetBoundingBox(mapNode.assets[i]));
        }
    }

    bbox.addNode(
            new SceneJS.Renderer({
                lineWidth: 1
            },
                    material = new SceneJS.Material({
                        baseColor:      { r: 0.5, g: 0.5, b: 0.5 },
                        specularColor:  { r: 0.4, g: 0.4, b: 0.4 },
                        specular:       0.9,
                        shine:          6.0
                    },
                            translate = new SceneJS.Translate({
                                x : (boundary.xmax + boundary.xmin) / 2,
                                y : (boundary.ymax + boundary.ymin) / 2,
                                z : (boundary.zmax + boundary.zmin) / 2
                            },
                                    new SceneJS.Scale({
                                        x : (boundary.xmax - boundary.xmin),
                                        y : (boundary.ymax - boundary.ymin),
                                        z : (boundary.zmax - boundary.zmin)
                                    },
                                            new SceneJS.Geometry({
                                                type: "kd-bbox", // Ensures same VBOs reused for all these cubes
                                                primitive: "lines",
                                                positions : [
                                                    max, max, max,
                                                    max, min, max,
                                                    min, min, max,
                                                    min, max, max,
                                                    max, max, min,
                                                    max, min, min,
                                                    min, min, min,
                                                    min, max, min
                                                ],
                                                indices : [ 0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1,5, 2, 6,3,7 ]
                                            }))))));
    //translate.addNode(SceneJS.text({ sid: "text", text: mapNode.id }));
    return bbox;
}

function createAssetBoundingBox(asset) {
    var boundary = asset.boundary;
    var min = -0.5;
    var max = +0.5;

    var material;
    var translate;

    var bbox = new SceneJS.BoundingBox({
        xmin: boundary.xmin,
        ymin: boundary.ymin,
        zmin: boundary.zmin,
        xmax: boundary.xmax,
        ymax: boundary.ymax,
        zmax: boundary.zmax
    });

    (function() {  // Stateful listeners in closure
        var loaded = false;

        /* Change in frustum/locality intersection state
         */
        bbox.addListener("state-changed", function(event) {
            if (event.params.newState == SceneJS.BoundingBox.STATE_INTERSECTING_FRUSTUM) {
                if (!loaded) {
                    material.setBaseColor({r: 1, g: 0.5, b: 0.5 });
                    translate.addNode(SceneJS.text({ sid: "text", text: "Loading " + asset.assetId }));

                    loadAsset(bbox, asset.assetId, function() {
                        material.setBaseColor({r: 0.5, g: 0.5, b: 0.5 });
                        translate.removeNode("text");
                    });
                    loaded = true;
                }
            }
        });
    })();

    bbox.addNode(
            new SceneJS.Renderer({
                lineWidth: 1
            },
                    material = new SceneJS.Material({
                        baseColor:      { r: 0.5, g: 0.5, b: 0.5 },
                        specularColor:  { r: 0.4, g: 0.4, b: 0.4 },
                        specular:       0.9,
                        shine:          6.0
                    },
                            translate = new SceneJS.Translate({
                                x : (boundary.xmax + boundary.xmin) / 2,
                                y : (boundary.ymax + boundary.ymin) / 2,
                                z : (boundary.zmax + boundary.zmin) / 2
                            },
                                    new SceneJS.Scale({
                                        x : (boundary.xmax - boundary.xmin),
                                        y : (boundary.ymax - boundary.ymin),
                                        z : (boundary.zmax - boundary.zmin)
                                    },
                                            new SceneJS.Geometry({
                                                type: "kd-bbox", // Ensures same VBOs reused for all these cubes
                                                primitive: "lines",
                                                positions : [
                                                    max, max, max,
                                                    max, min, max,
                                                    min, min, max,
                                                    min, max, max,
                                                    max, max, min,
                                                    max, min, min,
                                                    min, min, min,
                                                    min, max, min
                                                ],
                                                indices : [ 0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1,5, 2, 6,3,7 ]
                                            }))))));
    return bbox;
}

//function loadAssets(node, assets, onLoad) {
//    var num = assets.length;
//    var loaded = 0;
//    for (var i = 0; i < num; i++) {
//        loadAsset(node,
//                assets[i].assetId,
//                function() {
//                    loaded++;
//                });
//    }
//}

function loadAsset(node, assetId, onLoad) {
    var head = document.getElementsByTagName("head")[0];
    var script = document.createElement("script");
    script.type = "text/javascript";
    var callback = "cb" + (new Date()).getTime();
    window[callback] = function(data) {
        if (data.error) {
            alert(data.body);
        } else {
            node.addNode(data);
            //alert(JSON.stringify(data));
        }
        window[callback] = undefined;
        try {
            delete window[callback];
        } catch(e) {
        }
        head.removeChild(script);
        onLoad();
    };
    head.appendChild(script);
    script.src = "http://" + mapFlyDefs.SERVER_URL + "?cmd=getAsset&id=" + assetId + "&callback=" + callback;
}
