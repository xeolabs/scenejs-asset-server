/** Creates a subgraph of BoundingBoxes from the Asset Server's asset map
 *
 * @param mapNode Root of asset map
 */
function assetMap2BoundingBoxes(mapNode, parent) {
    var node = createBoundingBox(mapNode);
//    if (mapNode.assets && mapNode.assets.length > 0) {
//        node.nodes.push({
//            type: "material",
//            cfg: {
//                baseColor:      { r: 0.3, g: 0.3, b: 0.9 },
//                specularColor:  { r: 0.9, g: 0.9, b: 0.9 },
//                specular:       0.9,
//                shine:          6.0
//            },
//            nodes: [
//                {
//                    type:"teapot"
//                }
//            ]
//        });
//    }
    if (parent) {
        parent.nodes.push(node);
    }
    if (mapNode.leftChild) {
        assetMap2BoundingBoxes(mapNode.leftChild, node);
    }
    if (mapNode.rightChild) {
        assetMap2BoundingBoxes(mapNode.rightChild, node);
    }
    return node;
}

function createBoundingBox(mapNode) {
    var boundary = mapNode.boundary;
    var min = -0.5;
    var max = +0.5;

    return {
        type: "boundingBox",
        id: mapNode.id,

        cfg: {
            xmin: boundary.xmin,
            ymin: boundary.ymin,
            zmin: boundary.zmin,
            xmax: boundary.xmax,
            ymax: boundary.ymax,
            zmax: boundary.zmax
        },
        nodes: [

            /* Wireframe box - sibling to whatever else is
             * within this bounding box
             */
            {
                type: "renderer",
                cfg: {
                    lineWidth: 1
                },
                nodes: [
                    {
                        type: "material",
                        cfg: {
                            baseColor:      { r: 0.5, g: 0.5, b: 0.5 },
                            specularColor:  { r: 0.4, g: 0.4, b: 0.4 },
                            specular:       0.9,
                            shine:          6.0
                        },
                        nodes: [
                            {
                                type: "translate",
                                cfg: {
                                    x : (boundary.xmax + boundary.xmin) / 2,
                                    y : (boundary.ymax + boundary.ymin) / 2,
                                    z : (boundary.zmax + boundary.zmin) / 2
                                },
                                nodes: [
                                    {
                                        type: "scale",
                                        cfg: {
                                            x : (boundary.xmax - boundary.xmin),
                                            y : (boundary.ymax - boundary.ymin),
                                            z : (boundary.zmax - boundary.zmin)
                                        },
                                        nodes: [
                                            {
                                                type: "geometry",
                                                cfg: {
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
                                                }
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    };
}
