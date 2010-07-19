exports.init = function() {
    require('./../builder-registry').registerBuilder({
        info : {
            id: "dae"
        },
        build : function(assetParams, callback) {

            if (!assetParams.sourceURL) {
                callback({
                    error: 501,
                    body: "parameter expected: 'sourceURL'"
                });
                return false;
            }

            require("sys").puts("Builder 'dae' building asset");
            require("sys").puts("Loading COLLADA from '" + assetParams.sourceURL + "'");

            /* Load source file
             */
            require('../../../lib/loader').load({
                url: assetParams.sourceURL
            },
                /*
                 */
                    function(result) {
                        if (result.error) {
                            callback({ error : result.error, body : result.body });
                        } else {

                            /* Parse source file
                             */
                            var sceneJSONBuilder = require("../../utils/scenejsBuilder").createBuilder();
                            var parser = new ColladaParser(sceneJSONBuilder);
                            try {
                                parser.parse({
                                    sourceURL : assetParams.sourceURL  ,
                                    visualScene : assetParams.visualScene
                                },
                                        result.body, // XML
                                        callback);
                            } catch (e) {
                                require("sys").puts("Error parsing COLLADA: " + e);
                                callback({
                                    error : 500,
                                    body: "Error parsing COLLADA file - see server log for details"
                                });
                            }
                        }
                    });
        }
    });
};


var ColladaParser = function(sceneJSONBuilder) {  // Constructor

    this._builder = sceneJSONBuilder;

    this.parse = function(params, xml, callback) {
        this._sources = {};
        this._nextSID = 0;
        this._uri = params.sourceURL;
        this._rootSID = params.sourceURL;
        this._dirURI = params.sourceURL.substring(0, params.sourceURL.lastIndexOf("/") + 1);
        this._options = params.options || {
            visualScene : params.visualScene
        };
        this._attachments = [];
        var self = this;
        require('../../../lib/glge_xmlparser').parseXMLToDOM(xml, function(doc) {
            self._xmlDoc = doc;
            self._buildIdMap();
            self._parseDocument(callback);
        });
    };

    /**
     * Finds every element in the xmlDoc and maps the by IDs into this._idMap
     */
    this._buildIdMap = function() {
        this._idMap = {};
        var elements = this._xmlDoc.getElementsByTagName("*");
        var id;
        for (var i = elements.length - 1; i >= 0; i--) {
            id = elements[i].getAttribute("id");
            if (id != "") {
                this._idMap[id] = elements[i];
            }
        }
    };

    this._randomSID = function() {
        return "sid" + this._nextSID++;
    };

    this._parseDocument = function(callback) {
        this._builder.openNode("node", {
            cfg: {
                sid: this._rootSID,
                info : "model_root"
            },
            comment: this._options.comments ?
                     "COLLADA model from " + this._uri :
                     null
        });
        this._parseLibraryCameras();
        this._parseLibraryLights();
        this._parseLibraryEffects();
        this._parseLibraryMaterials();    // Instances effects
        this._parseLibraryGeometries();   // Instances materials
        this._parseLibraryNodes();        // Instances geometries

        if (this._options.visualScene) {
            var visualScene = this._idMap[this._options.visualScene];
            if (!visualScene) {
                callback({
                    error: 404,
                    body : "Unable to find requested <visual_scene> in COLLADA: '" + this._options.visualScene + "'"
                });
                return;
            } else {
                this._parseNode(visualScene, "", this._options.visualScene);
                // this._parseVisualScene(visualScene);
            }
        } else {
            this._parseLibraryVisualScenes();
        }
        this._builder.closeNode();
        callback({
            body: this._builder.getJSON(),
            attachments : this._attachments
        });
    };

    //==================================================================================================================
    // Cameras library
    //==================================================================================================================

    this._parseLibraryCameras = function() {
        this._parseLibrary("library_cameras", "camera", this._parseCamera);
    };

    /** Generic library_xxx parser which creates nodes through callback
     *
     * @param libraryTagName eg. "library_cameras"
     * @param symbolTagName eg. "camera"
     * @param parseTag Callback that creates SceneJS node from symbol tag
     * @private
     */
    this._parseLibrary = function(libraryTagName, symbolTagName, parseTag) {
        this._builder.openNode("node", {
            cfg: {
                info: libraryTagName
            },
            comment: this._options.comments ?
                     "Library of Symbols parsed from <" + libraryTagName + ">" :
                     null
        });
        var libraryTags = this._xmlDoc.getElementsByTagName(libraryTagName);
        var i, j, symbolTags, symbolTag, libraryTag;
        for (i = 0; i < libraryTags.length; i++) {
            libraryTag = libraryTags[i];
            symbolTags = libraryTag.getElementsByTagName(symbolTagName);
            for (j = 0; j < symbolTags.length; j++) {
                symbolTag = symbolTags[j];
                this._builder.openNode("symbol", {
                    cfg: {
                        sid: symbolTag.getAttribute("id"),
                        info: symbolTagName + "_symbol"
                    },
                    comment: this._options.comments ?
                             "Symbol parsed from <" + symbolTagName + ">" :
                             null
                });
                parseTag.call(this, symbolTag);
                this._builder.closeNode();
            }
        }
        this._builder.closeNode();
    };

    // @private
    this._parseCamera = function(cameraTag) {
        var optics = cameraTag.getElementsByTagName("optics")[0];
        var techniqueCommon = optics.getElementsByTagName("technique_common")[0];
        var perspectiveTag = techniqueCommon.getElementsByTagName("perspective")[0];
        if (perspectiveTag) {
            var yfov = perspectiveTag.getElementsByTagName("yfov")[0];
            var aspectRatio = perspectiveTag.getElementsByTagName("aspect_ratio")[0];
            var znear = perspectiveTag.getElementsByTagName("znear")[0];
            var zfar = perspectiveTag.getElementsByTagName("zfar")[0];
            this._builder.openNode("camera", {
                cfg: {
                    sid: cameraTag.getAttribute("id"),
                    info: "camera",
                    optics: {
                        type: "perspective",
                        fovy: yfov ? parseFloat(yfov.textContent) : 60.0,
                        aspect: aspectRatio ? parseFloat(aspectRatio.textContent) : 1.0,
                        near: znear ? parseFloat(znear.textContent) : 0.1,
                        far: zfar ? parseFloat(zfar.textContent) : 20000.0
                    }
                }
            });
            this._builder.closeNode();
        } else {
            var orthographic = techniqueCommon.getElementsByTagName("orthographic")[0];
            if (orthographic) {
                this._builder.openNode("camera");
                this._builder.closeNode();
            }
        }
    };

    //==================================================================================================================
    // Lights library
    //==================================================================================================================

    this._parseLibraryLights = function() {
        this._parseLibrary("library_lights", "light", this._parseLight);
    };

    this._parseLight = function(lightTag) {
        var techniqueCommonTag = lightTag.getElementsByTagName("technique_common")[0];
        var directionalTag = techniqueCommonTag.getElementsByTagName("directional")[0];
        if (directionalTag) {
            this._builder.addNode("lights", {
                cfg:  {
                    sid: lightTag.getAttribute("id"),
                    info: "light",
                    sources : [
                        {
                            type: "dir",
                            dir: { x: 0, y: 0, z: -1.0 },
                            color: this._parseFloatArray(directionalTag.getElementsByTagName("color")[0])
                        }
                    ]}
            });
        }
        var pointTag = techniqueCommonTag.getElementsByTagName("point")[0];
        if (pointTag) {
            var constantAttenuation = pointTag.getElementsByTagName("constant_attenuation")[0];
            var linearAttenuation = pointTag.getElementsByTagName("linear_attenuation")[0];
            var quadraticAttenuation = pointTag.getElementsByTagName("quadratic_attenuation")[0];
            this._builder.addNode("lights", {
                cfg : {
                    sid: lightTag.getAttribute("id"),
                    info: "light",
                    sources : [
                        {
                            type: "point",
                            pos: { x: 0, y: 0, z: 0},
                            color: this._parseFloatArray(pointTag.getElementsByTagName("color")[0]),
                            constantAttenuation : constantAttenuation ? parseFloat(constantAttenuation) : 1.0,
                            linearAttenuation : linearAttenuation ? parseFloat(linearAttenuation) : 0.0,
                            quadraticAttenuation : quadraticAttenuation ? parseFloat(quadraticAttenuation) : 0.0
                        }
                    ]}
            });
        }
        var spot = techniqueCommonTag.getElementsByTagName("spot")[0];
        if (spot) {
            var constantAttenuation = spot.getElementsByTagName("constant_attenuation")[0];
            var linearAttenuation = spot.getElementsByTagName("linear_attenuation")[0];
            var quadraticAttenuation = spot.getElementsByTagName("quadratic_attenuation")[0];
            var falloffAngle = spot.getElementsByTagName("falloff_angle")[0];
            var falloffExponent = spot.getElementsByTagName("falloff_exponent")[0];
            this._builder.addNode("lights", {
                cfg : {
                    sid: lightTag.getAttribute("id"),
                    info: "light",
                    sources : [
                        {
                            type: "spot",
                            // TODO: position & dir?
                            color: this._parseFloatArray(spot.getElementsByTagName("color")[0]) ,
                            constantAttenuation : constantAttenuation ? parseFloat(constantAttenuation) : 1.0,
                            linearAttenuation : linearAttenuation ? parseFloat(linearAttenuation) : 0.0,
                            quadraticAttenuation : quadraticAttenuation ? parseFloat(quadraticAttenuation) : 0.0,
                            falloffAngle : falloffAngle ? parseFloat(falloffAngle) : 180.0,
                            falloffExponent : falloffExponent ? parseFloat(falloffExponent) : 0.0
                        }
                    ]}
            });
        }
    };

    //==================================================================================================================
    // Effects library
    //==================================================================================================================

    // @private
    this._parseLibraryEffects = function() {
        this._parseLibrary("library_effects", "effect", this._parseEffect);
    };

    // @private
    this._parseEffect = function(effectTag) {
        var profileCommonTag = effectTag.getElementsByTagName("profile_COMMON")[0];
        var techniqueTag = profileCommonTag.getElementsByTagName("technique")[0];
        var materialData = {
            texturesData : []
        };
        this._getDiffuseMaterialData(profileCommonTag, techniqueTag, materialData);
        this._getSpecularColorMaterialData(profileCommonTag, techniqueTag, materialData);
        this._getShininessMaterialData(profileCommonTag, techniqueTag, materialData);
        this._getBumpMapMaterialData(profileCommonTag, techniqueTag, materialData);

        var effectId = effectTag.getAttribute("id");

        this._builder.openNode("material", {
            cfg: {
                sid: effectId,
                info: "material",
                baseColor:     materialData.baseColor,
                specularColor: materialData.specularColor ,
                shine:         10.0,  // TODO: parse from shininess?
                specular: 1
            }
        });

        /* Add SceneJS.Texture child for textures data
         */
        var textureLayers = materialData.texturesData;
        if (textureLayers.length > 0) {
            var layers = [];
            for (var j = 0; j < textureLayers.length; j++) {
                layers.push({
                    uri : textureLayers[j].uri,
                    applyTo: textureLayers[j].applyTo,
                    flipY : false,
                    blendMode: textureLayers[j].blendMode,
                    wrapS: "repeat",
                    wrapT: "repeat" ,
                    minFilter: "linearMipMapLinear",
                    magFilter: "linear"
                });
            }
            this._builder.addNode("texture", {
                cfg: {
                    sid: "texture",
                    layers: layers
                }
            });
        }
        this._builder.closeNode();
    };

    // @private
    this._getDiffuseMaterialData = function(profileCommonTag, techniqueTag, materialData) {
        var diffuseTag = techniqueTag.getElementsByTagName("diffuse");
        if (diffuseTag.length > 0) {
            var child = diffuseTag[0].firstChild;
            do{
                switch (child.tagName) {
                    case "color":
                        var color = child.firstChild.nodeValue.split(" ");
                        materialData.baseColor = { r:parseFloat(color[0]), g:parseFloat(color[1]), b:parseFloat(color[2]) };
                        break;

                    case "texture":
                        materialData.texturesData.push(
                                this._getTextureData(profileCommonTag, child, "baseColor"));
                        break;
                }
            } while (child = child.nextSibling);
        }
    };

    // @private
    this._getSpecularColorMaterialData = function(profileCommonTag, techniqueTag, materialData) {
        var specular = techniqueTag.getElementsByTagName("specular");
        if (specular.length > 0) {
            var child = specular[0].firstChild;
            do{
                switch (child.tagName) {
                    case "color":
                        var color = child.firstChild.nodeValue.split(" ");
                        materialData.specularColor = { r:parseFloat(color[0]), g:parseFloat(color[1]), b:parseFloat(color[2]),a: 1 };
                        break;

                    case "texture":
                        materialData.texturesData.push(
                                this._getTextureData(profileCommonTag, child, "specularColor"));
                        break;
                }
            } while (child = child.nextSibling);
        }
    };

    // @private
    this._getShininessMaterialData = function(profileCommonTag, techniqueTag, materialData) {
        var shininess = techniqueTag.getElementsByTagName("shininess");
        if (shininess.length > 0) {
            var child = shininess[0].firstChild;
            do{
                switch (child.tagName) {
                    case "float":
                        materialData.shine = parseFloat(child.firstChild.nodeValue);
                        break;

                    case "texture":
                        materialData.texturesData.push(
                                this._getTextureData(profileCommonTag, child, "shine"));

                        break;
                }
            } while (child = child.nextSibling);
        }
    };

    // @private
    this._getBumpMapMaterialData = function(profileCommonTag, techniqueTag, materialData) {
        var bump = techniqueTag.getElementsByTagName("bump");
        if (bump.length > 0) {
            var child = bump[0].firstChild;
            do{
                switch (child.tagName) {
                    case "texture":
                        break;
                }
            } while (child = child.nextSibling);
        }
    };

    // @private
    this._getTextureData = function(profileCommonTag, textureTag, applyTo) {
        var source = getSamplerSource(profileCommonTag, textureTag.getAttribute("texture"));
        var imageId = getImageId(profileCommonTag, source);
        var image = this._idMap[imageId];
        var imageFileName = image.getElementsByTagName("init_from")[0].firstChild.nodeValue;
        var blendMode = textureTag.getElementsByTagName("blend_mode")[0];               // TODO: should be nodeValue?
        this._attachments.push(imageFileName);
        return {
            uri : this._dirURI + imageFileName,
            //uri : "ATTACHMENT_DIR" + imageFileName,
            applyTo: applyTo,
            blendMode: (blendMode == "MULTIPLY") ? "multiply" : "add"
        };
    };

    // @private
    function getSamplerSource(profileTag, sid) {
        var params = profileTag.getElementsByTagName("newparam");
        for (var i = 0; i < params.length; i++) {
            if (params[i].getAttribute("sid") == sid) {
                return params[i]
                        .getElementsByTagName("sampler2D")[0]
                        .getElementsByTagName("source")[0]
                        .firstChild
                        .nodeValue;
            }
        }
        throw "COLLADA element expected: "
                + profileTag.tagName
                + "/newparam[sid == '"
                + sid + "']/sampler2D[0]/source[0]";
    }

    // @private
    function getImageId(profileTag, sid) {
        var newParamTags = profileTag.getElementsByTagName("newparam");
        for (var i = 0; i < newParamTags.length; i++) {
            if (newParamTags[i].getAttribute("sid") == sid) {
                var surfaceTag = newParamTags[i].getElementsByTagName("surface")[0];
                return surfaceTag
                        .getElementsByTagName("init_from")[0]
                        .firstChild
                        .nodeValue;
            }
        }
        throw "COLLADA element expected: "
                + profileTag.tagName
                + "/newparam[sid == '"
                + sid + "']/surface[0]/init_from[0]";
    }

    //==================================================================================================================
    // Materials library
    //
    // A Material is a parameterised instance of an effect
    //==================================================================================================================

    // @private
    this._parseLibraryMaterials = function() {
        this._parseLibrary("library_materials", "material", this._parseMaterial);
    };

    // @private
    this._parseMaterial = function(materialTag) {
        var effectId = materialTag.getElementsByTagName("instance_effect")[0].getAttribute("url").substr(1);
        //        return new SceneJS.WithData({
        //            specularColor: { r: 1, g: 0 }
        //        },
        this._builder.addNode("instance", {
            cfg: {
                uri: effectId,
                info: "instance_effect",
                mustExist: true
            }
        });
        //)
    };

    //==================================================================================================================
    // Geometries library
    //==================================================================================================================

    // @private
    this._parseLibraryGeometries = function() {
        this._parseLibrary("library_geometries", "geometry", this._parseGeometry);
    };

    // @private
    this._parseGeometry = function(geometryTag) {
        this._builder.openNode("node", {
            cfg: {
                sid: geometryTag.getAttribute("id")
            }
        });
        var trianglesList = this._getTrianglesList(geometryTag);
        for (var it = 0; it < trianglesList.length; it++) {
            var triangle = trianglesList [it];
            var inputs = triangle.getElementsByTagName("input");
            var inputArray = [];
            var outputData = {};
            for (var n = 0; n < inputs.length; n++) {
                inputs[n].data = this._getSource(inputs[n].getAttribute("source").substr(1));
                var group = inputs[n].getAttribute("semantic");
                if (group == "TEXCOORD") {
                    group = group + inputs[n].getAttribute("set") || 0;
                }
                inputs[n].group = group;
                inputArray[inputs[n].getAttribute("offset")] = inputs[n];
                outputData[group] = [];
            }
            var faces;
            if (triangle.getElementsByTagName("p")[0].data) {
                faces = triangle.getElementsByTagName("p")[0].data;
            }
            else {
                faces = this._parseFloatArray(triangle.getElementsByTagName("p")[0]);
            }
            for (var i = 0; i < faces.length; i = i + inputArray.length) {
                for (var n = 0; n < inputArray.length; n++) {
                    var group = inputArray[n].group;
                    var pCount = 0;
                    for (var j = 0; j < inputArray[n].data.stride; j++) {
                        if (inputArray[n].data.typeMask[j]) {
                            outputData[group].push(
                                    parseFloat(inputArray[n].data.array[faces[i + n]
                                            * inputArray[n].data.stride + j
                                            + inputArray[n].data.offset]));
                            pCount++;
                        }
                    }
                    if (group == "VERTEX" && pCount == 1) { // 1D
                        outputData[group].push(0);
                    }
                    if (group == "VERTEX" && pCount == 2) { // 2D
                        outputData[group].push(0);
                    }
                    if (group == "TEXCOORD0" && pCount == 3) { // 2D textures
                        outputData[group].pop();
                    }
                    if (group == "TEXCOORD1" && pCount == 3) {
                        outputData[group].pop();
                    }
                }
            }
            faces = [];
            for (n = 0; n < outputData.VERTEX.length / 3; n++) {
                faces.push(n);
            }


            var materialName = triangle.getAttribute("material");
            if (materialName) {
                this._builder.openNode("instance", {
                    callback : "function(data) { return { uri: data.get(\"" + materialName + "\") }; }",
                    comment: this._options.comments ?
                             "Target Material Symbol is dynamically configured on this Geometry Symbol when instanced" :
                             null
                });
            }
            this._builder.addNode("geometry", {
                cfg: {
                    info: "geometry",
                    positions: outputData.VERTEX,
                    normals: outputData.NORMAL,
                    uv : outputData.TEXCOORD0,
                    uv2 : outputData.TEXCOORD1,
                    indices: faces
                }
            });
            if (materialName) {
                this._builder.closeNode();
            }
        }
        this._builder.closeNode();
    };

    // @private
    this._getTrianglesList = function(geometryTag) {
        var trianglesList = [];
        var meshNode = geometryTag.getElementsByTagName("mesh")[0];
        var polyLists = meshNode.getElementsByTagName("polylist"); // Extract polylist children
        for (var i = 0; i < polyLists.length; i++) {
            var polyList = polyLists[i];
            polyList.getElementsByTagName("p")[0].data = this._getTrianglesFromPolyList(polyList);
            trianglesList.push(polyList);
        }
        var tris = meshNode.getElementsByTagName("triangles");
        for (i = 0; i < tris.length; i++) {
            trianglesList.push(tris[i]);
        }
        return trianglesList;
    };

    // @private
    this._getTrianglesFromPolyList = function(polyList) {
        var i, j, k;
        var inputs = polyList.getElementsByTagName("input");
        var maxOffset = this._getMaxOffset(inputs);
        var vcount = this._parseFloatArray(polyList.getElementsByTagName("vcount")[0]);
        var faces = this._parseFloatArray(polyList.getElementsByTagName("p")[0]);         // TODO: parseInt
        var triangles = [];
        var base = 0;
        for (i = 0; i < vcount.length; i++) {
            for (j = 0; j < vcount[i] - 2; j++) { // For each vertex
                for (k = 0; k <= maxOffset; k++) { // A
                    triangles.push(faces[base + k]);
                }
                for (k = 0; k <= maxOffset; k++) { // B
                    triangles.push(faces[base + (maxOffset + 1) * (j + 1) + k]);
                }
                for (k = 0; k <= maxOffset; k++) { // C
                    triangles.push(faces[base + (maxOffset + 1) * (j + 2) + k]);
                }
            }
            base = base + (maxOffset + 1) * vcount[i];
        }
        return triangles;
    };

    // @private
    this._getMaxOffset = function(inputs) {
        var maxOffset = 0;
        for (var n = 0; n < inputs.length; n++) {
            var offset = inputs[n].getAttribute("offset");
            if (offset > maxOffset) {
                maxOffset = offset;
            }
        }
        return maxOffset;
    };

    // @private
    this._getSource = function(id) {
        var source = this._sources[id];
        if (source) {
            return source;
        }
        var element = this._idMap[id];
        if (element.tagName == "vertices") {
            source = this._getSource(// Recurse to child <source> element
                    element
                            .getElementsByTagName("input")[0]
                            .getAttribute("source")
                            .substr(1));
        } else {
            var accessor = element// <source>
                    .getElementsByTagName("technique_common")[0]
                    .getElementsByTagName("accessor")[0];

            var stride = parseInt(accessor.getAttribute("stride"));         // Number of values per unit
            var offset = parseInt(accessor.getAttribute("offset")) || 0;    // Index of first value
            var count = parseInt(accessor.getAttribute("count"));           // Number of units

            /* Create mask that indicates what data types are in the
             * source - int, float, Name, bool and IDREF.
             *
             * The number and type of the <param> elements define the
             * output of the <accessor>. Parameters are bound to values
             * in the order in which both are specified. A <param> wtihout
             * a name attribute indicates that the value is not part of the
             * input.
             */
            var params = accessor.getElementsByTagName("param");
            var typeMask = [];
            for (var i = 0; i < params.length; i++) {
                if (params[i].hasAttribute("name")) {
                    typeMask.push(true);
                } else {
                    typeMask.push(false);
                }
            }
            source = {
                array:this._parseFloatArray(this._idMap[accessor.getAttribute("source").substr(1)]),
                stride:stride,
                offset:offset,
                count:count,
                typeMask: typeMask
            };
        }
        this._sources[id] = source;
        return source;
    };

    // @private
    this._parseFloatArray = function(node) {
        var result = [];
        var prev = "";
        var child = node.firstChild;
        var currArray;
        while (child) {
            currArray = (prev + child.nodeValue).replace(/\s+/g, " ").replace(/^\s+/g, "").split(" ");
            child = child.nextSibling;
            if (currArray[0] == "") {
                currArray.unshift();
            }
            if (child) {
                prev = currArray.pop();
            }
            for (var i = 0; i < currArray.length; i++) {
                result.push(parseFloat(currArray[i]));
            }
        }
        return result;
    };


    //==================================================================================================================
    // Nodes library
    //==================================================================================================================

    // @private
    this._parseLibraryNodes = function() {
        this._parseLibrary("library_nodes", "node", function(nodeTag) {
            this._parseNode.call(this, nodeTag, "", {});
        });
    };

    //==================================================================================================================
    // Visual scenes library
    //==================================================================================================================

    // @private
    this._parseLibraryVisualScenes = function() {
        this._builder.openNode("node", {
            cfg: {
                info: "<library_visual_scenes>"
            },
            comment: this._options.comments ?
                     "Symbols parsed from <library_visual_scenes>" :
                     null
        });
        var libraryTags = this._xmlDoc.getElementsByTagName("library_visual_scenes");
        var i, j, symbolTags, symbolTag, libraryTag;
        for (i = 0; i < libraryTags.length; i++) {
            libraryTag = libraryTags[i];
            symbolTags = libraryTag.getElementsByTagName("visual_scene");
            for (j = 0; j < symbolTags.length; j++) {
                symbolTag = symbolTags[j];
                this._parseVisualScene(symbolTag);
            }
        }
        this._builder.closeNode();
    };

    /**
     * @private
     */
    this._parseVisualScene = function(visualSceneTag) {
        this._builder.openNode("node", {
            cfg: {
                info: "visual_scene"
            },
            comment: this._options.comments ? "" : null
        });

        /* Pre-parse visual scene node to collect list of subgraphs, collecting some metadata about their
         * cameras and lights, order the list so that the ones containing lights are first
         */
        var childTag = visualSceneTag.firstChild;
        var graphs = [];
        var graph;
        do{
            if (childTag.tagName) {
                graph = {
                    tag: childTag,
                    meta: {}
                };
                this._preParseNode(childTag, "", graph.meta);
                if (graph.meta.lightId) {
                    graphs.unshift(graph);
                } else {
                    graphs.push(graph);
                }
            }
        } while (childTag = childTag.nextSibling);

        /* Write Symbol for visual scene node first, including within that those
         * subgraphs that do not contain cameras.
         */
        var visualSceneID = visualSceneTag.getAttribute("id");
        this._builder.openNode("symbol", {
            cfg: {
                sid: visualSceneID,
                info: "symbol_visual_scene"
            },
            comment: this._options.comments ? "" : null
        });
        for (var i = 0; i < graphs.length; i++) {
            graph = graphs[i];
            if (!graph.meta.cameraId) {
                this._parseNode(graph.tag, "", visualSceneID);
            }
        }
        this._builder.closeNode();

        /* At same level as visual scene Symbol, write a subgraph for each camera,
         * with an Instance of the Symbol at each subgraph's leaf
         */
        for (var i = 0; i < graphs.length; i++) {
            graph = graphs[i];
            if (graph.meta.cameraId) {
                this._builder.openNode("symbol", {
                    cfg: {
                        sid: visualSceneID + "/" + graph.meta.cameraId,
                        info: "symbol_camera_visual_scene"
                    },
                    comment: this._options.comments ?
                             "Instance of visual_scene " + visualSceneID + " through camera " + graph.meta.cameraId :
                             null
                });

                this._parseNode(graph.tag, "", visualSceneID);
                this._builder.closeNode();
            }
        }
        this._builder.closeNode();
    };

    /**
     * Reconnoiter of node subgraph to find out if it contains cameras or lights
     * @private
     */
    this._preParseNode = function(nodeTag, path, meta) {
        var childTag = nodeTag.firstChild;
        do{
            switch (childTag.tagName) {
                case "node":
                    this._preParseNode(childTag, path, meta);
                    break;

                case "instance_camera":
                    meta.cameraId = childTag.getAttribute("url").substr(1);
                    break;

                case "instance_light":
                    meta.lightId = childTag.getAttribute("url").substr(1);
                    break;
            }
        } while (childTag = childTag.nextSibling);
    };

    /**
     *
     * @param nodeTag
     * @param path
     * @param visualSceneId Only required when we know that node contains a <camera> - used to form target URI for camera's Instance
     */
    this._parseNode = function(nodeTag, path, visualSceneId) {
        var id = nodeTag.getAttribute("id");
        if (id) {
            this._builder.openNode("node", {
                cfg: {
                    info: "<node id='" + id + "'>",
                    sid: id }
            });
            path = "../" + path;
        } else {
            this._builder.openNode("node", {});
        }
        var childTag = nodeTag.firstChild;
        var xfStack = {
            stack : [],
            nProcessed: 0,
            path: path
        };
        do{
            switch (childTag.tagName) {
                case "matrix":
                case "translate":
                case "rotate":
                case "scale":
                case "lookat":
                    xfStack.stack.push(childTag);
                    break;

                case "node":
                    this._openXFStack(xfStack);
                    this._parseNode(childTag, path, visualSceneId);
                    break;

                case "instance_node":
                    this._openXFStack(xfStack);
                    this._builder.addNode("instance", {
                        cfg: {
                            info: "<instance_node>",
                            uri : xfStack.path + childTag.getAttribute("url").substr(1),
                            mustExist: true
                        }
                    });
                    break;

                case "instance_visual_scene":
                    this._openXFStack(xfStack);
                    this._builder.addNode("instance", {
                        cfg: {
                            info: "<instance_visual_scene>",
                            uri : xfStack.path + childTag.getAttribute("url").substr(1),
                            mustExist: true
                        }
                    });
                    break;

                case "instance_geometry":
                    this._openXFStack(xfStack);
                    this._parseInstanceGeometry(xfStack.path, childTag);
                    break;

                case "instance_camera":
                    this._openXFStack(xfStack);
                    this._builder.openNode("instance", {
                        cfg: {
                            info: "<instance_camera>",
                            uri : xfStack.path + childTag.getAttribute("url").substr(1)
                        }
                    });
                    this._builder.openNode("instance", {
                        cfg: {
                            info: "<instance_visual_scene>",
                            uri : xfStack.path + visualSceneId
                        }
                    });
                    this._builder.closeNode();
                    break;

                case "instance_light":
                    this._openXFStack(xfStack);
                    this._builder.addNode("instance", {
                        cfg: {
                            info: "<instance_light>",
                            uri : xfStack.path + childTag.getAttribute("url").substr(1),
                            mustExist: true
                        }
                    });
                    break;
            }
        } while (childTag = childTag.nextSibling);
        this._closeXFStack(xfStack);
        this._builder.closeNode();
    };

    this._openXFStack = function(xfStack) {
        var tag;
        for (var i = xfStack.stack.length - 1; i >= xfStack.nProcessed; i--) {
            tag = xfStack.stack[i];
            switch (tag.tagName) {
                case "matrix":
                    this._openMatrix(tag);
                    break;
                case "translate":
                    this._openTranslate(tag);
                    break;
                case "rotate":
                    this._openRotate(tag);
                    break;
                case "scale":
                    this._openScale(tag);
                    break;
                case "lookat":
                    this._openLookat(tag);
                    break;
            }
            if (tag.getAttribute("sid")) {
                xfStack.path = "../" + xfStack.path;
            }
        }
        xfStack.nProcessed = xfStack.stack.length;
    };

    this._closeXFStack = function(xfStack) {
        for (var i = 0; i < xfStack.nProcessed; i++) {
            this._builder.closeNode();
        }
    };

    this._openRotate = function(rotateTag) {
        var array = this._parseFloatArray(rotateTag);
        this._builder.openNode("rotate", {
            cfg: {
                info: "<rotate>",
                sid: rotateTag.getAttribute("sid") || this._randomSID(),
                x: array[0],
                y: array[1],
                z: array[2],
                angle: array[3]
            }
        });
    };

    // @private
    this._openMatrix = function(matrixTag) {
        var array = this._parseFloatArray(matrixTag);
        this._builder.openNode("rotate", {
            cfg: {
                info: "<matrix>",
                sid: matrixTag.getAttribute("sid") || this._randomSID(),
                elements: [
                    array[0],array[4],array[8],array[12],
                    array[1],array[5],array[9],array[13],
                    array[2],array[6],array[10],array[14],
                    array[3],array[7],array[11],array[15]] }
        });
    };

    // @private
    this._openTranslate = function(translateTag) {
        var array = this._parseFloatArray(translateTag);
        this._builder.openNode("translate", {
            cfg: {
                info: "<translate>",
                sid: translateTag.getAttribute("sid") || this._randomSID(),
                x: array[0],
                y: array[1],
                z: array[2]
            }
        });
    };

    // @private
    this._openScale = function(scaleTag) {
        var array = this._parseFloatArray(scaleTag);
        this._builder.openNode("scale", {
            cfg: {
                info: "<scale>",
                sid: scaleTag.getAttribute("sid") || this._randomSID(),
                x: array[0],
                y: array[1],
                z: array[2]
            }
        });
    };

    // @private
    this._openLookat = function(lookatTag) {
        var array = this._parseFloatArray(lookatTag);
        this._builder.openNode("lookAt", {
            info: "<lookat>",
            sid: lookatTag.getAttribute("sid") || "lookat", // Will be unique
            eye: {
                x: array[0],
                y: array[1],
                z:array[2]
            },
            look: {
                x: array[3],
                y: array[4],
                z: array[5]
            },
            up: {
                x: array[6],
                y: array[7],
                z: array[8]
            }
        });
    };

    this._parseInstanceGeometry = function(path, instanceGeometryTag) {

        /* COLLADA geometry elements like <triangles> can have a "material" attribute which identifies an
         * abstract material it is to be bound to when instantiated. The Geometry node created in the parseGeometry()
         * method is then wrapped in a Instance, which will dynamically receive via a WithConfig the URLs of a Symbols
         * that each wrap a Material.
         */
        var params = null;
        var materials = instanceGeometryTag.getElementsByTagName("instance_material");
        var material;
        for (var i = 0; i < materials.length; i++) {
            if (!params) {
                params = {};
            }
            material = materials[i];
            params[material.getAttribute("symbol")] = "../" + material.getAttribute("target").substr(1);
        }
        if (params) {
            this._builder.openNode("withData", {
                cfg: params
            });
        }
        this._builder.addNode("instance", {
            cfg: {
                info: "<instance_geometry>",
                uri : path + instanceGeometryTag.getAttribute("url").substr(1),
                mustExist: true
            }
        });
        if (params) {
            this._builder.closeNode();
        }
    };

    function parseScene() {
        var sceneTag = this._xmlDoc.getElementsByTagName("scene")[0];
        var scene = new SceneJS.Symbol({
            info: "scene-symbol",
            sid: "__SceneJS_default_scene"
        });
        var ivsTags = sceneTag.getElementsByTagName("instance_visual_scene");
        for (var i = 0; i < ivsTags.length; i++) {
            scene.addNode(parseInstanceVisualScene(ivsTags[i]));
        }
        return scene;
    }

    function parseInstanceVisualScene(instanceVisualSceneTag) {
        var sid = instanceVisualSceneTag.getAttribute("sid") || this._randomSID();
        var target = instanceVisualSceneTag.getAttribute("url").substr(1); // Non-null for instance tags
        return new SceneJS.Instance({
            info: "scene-instance",
            sid: sid,
            uri : "../" + target
        });

    }
}
