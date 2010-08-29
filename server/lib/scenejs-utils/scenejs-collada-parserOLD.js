var jsonLib = require('./scenejs-js-builder');

/** @class Parses a COLLADA XML DOM into a JSON string that defines a SceneJS scene subgraph
 *
 * Requires:
 *
 *     scenejs-js-builder.js
 *     glge_xmlparser.js
 *
 *
 * @constructor
 * @param {SceneJS_JSON_Builder} jsonBuilder
 * @param {BoundaryBuilder} boundaryBuilder
 */

exports.newParser = function(jsonBuilder, boundaryBuilder) {
    return new Parser(jsonBuilder, boundaryBuilder);
};

var Parser = function(jsonBuilder, boundaryBuilder) {  // Constructor
    this._sceneBuilder = jsonBuilder;

    this._boundaryBuilder = boundaryBuilder;


    /**
     * Parses the given XML document and returns the result through a callback. The result will contain
     * the JSON SceneJS subgraph, asset metadata and a manifest of Symbols within the subgraph.
     *
     * Result is like this:
     * <pre><code>
     * {
     *       body: {
     *
     *           // SceneJS subgraph parsed from teh resource
     *
     *           rootNode: <subgraph>,
     *
     *           // Asset metadata
     *
     *           asset: {
     *               title: "Bridge",                   // Defaults to file name without extension
     *               description: "A cool bridge",      // Defaults to empty string
     *               contributor: "Lindsay Kay",        // Defaults to empty string
     *               tags: [ "architecture", "bridge" ] // Defaults to empty array
     *           },
     *
     *           // Manifest of resourse content
     *
     *           manifest: {
     *
     *              // Symbols available to be instantiated.
     *
     *              symbols: {
     *
     *                  // For resources like COLLADA we have the semantic of scenes containing cameras.
     *                  // You can instantiate a scene Symbol, or a scene's camera Symbol to
     *                  // obtain a view of a scene.
     *
     *                  scenes: {
     *                      "visualScene1": {
     *                          description: "visual_scene with id 'visualSceneID'",
     *                          uri: "visualScene1",
     *
     *                          // A camera can be instantiated to generate a view of its scene
     *
     *                          cameras : {
     *                              "camera1" {
     *                                  description: "visual_scene 'visualScene1' viewed through camera 'camera1'
     *                                  uri: "visualScene1:camera1"
     *                              }
     *                          }
     *                      }
     *                  },
     *
     *                  // Default symbol to be instantiated when none is selected from the manifest symbols
     *
     *                  defaultSymbol: "VisualSceneNode",
     *              },
     *
     *              // Image files used as textures - useful if the client wants to
     *              // also fetch the attachments from the Web
     *
     *              attachments:[ "stoneTexture.jpg", "skyTexture.jpg" ]
     *       }
     *   }
     * </pre></code>
     * @param params
     * @param xmlDoc XML document
     * @param callback
     */
    this.parse = function(params, xmlDoc, callback) {
        this._sources = {};
        this._nextSID = 0;
        this._uri = params.sourceURL || "";
        params.options = params.options || {};
        this._options = {
            comments : params.options.comments,
            boundingBoxes : params.options.boundingBoxes,
            info : params.options.info
            //            ,
            //            attachmentsDir : params.options.attachmentsDir || this._uri.substring(0, this._uri.lastIndexOf("/") + 1)
        };
        this._xmlDoc = xmlDoc;

        /* Metadata on the resource, parsed from the <asset> tag
         */
        this._asset = {

        };

        /* Manifest of resource content
         */
        this._manifest = {
            symbols: {
                scenes : {},
                defaultSymbol : null
            },

            /* Attachments used in textures
             */
            attachments : []
        };

        /* Statistical metadata
         */
        this._stats = {
            vertices: 0,
            triangles: 0,
            textures: 0
        };

        this._buildIdMap();
        this._parseDocument(callback);
    };

    this._getInfo = function(str) {
        return (this._options.info ? str : null);
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
        this._sceneBuilder.openNode("node", {
            cfg: {
                info : this._getInfo("asset_root")
            },
            comment: (this._options.comments && this._uri) // TODO: What comment when no source URI?
                    ? "Asset parsed from COLLADA resource at " + this._uri
                    : null
        });
        this._parseLibraryCameras();
        this._parseLibraryLights();
        this._parseLibraryEffects();
        this._parseLibraryMaterials();    // Instances effects
        this._parseLibraryGeometries();   // Instances materials
        this._parseLibraryNodes();        // Instances geometries
        this._parseLibraryVisualScenes();
        this._parseScene();
        this._parseSymbolSelector();

        this._sceneBuilder.closeNode();

        callback({
            body: {
                rootNode: this._sceneBuilder.getJSON(),
                asset : this._asset,
                manifest: this._manifest ,
                spatial : {
                    boundary : this._boundaryBuilder.getBoundary()
                },
                stats : this._stats
            }
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
        this._sceneBuilder.openNode("node", {
            cfg: {
                info: this._getInfo(libraryTagName)
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
                this._sceneBuilder.openNode("symbol", {
                    cfg: {
                        sid: symbolTag.getAttribute("id"),
                        info: this._getInfo(symbolTagName + "_symbol")
                    },
                    comment: this._options.comments ?
                             "Symbol parsed from <" + symbolTagName + ">" :
                             null
                });
                parseTag.call(this, symbolTag);
                this._sceneBuilder.closeNode();
            }
        }
        this._sceneBuilder.closeNode();
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
            //   alert("FIX: aspectRatio, yfov etc in COLLADA parser");
            this._sceneBuilder.openNode("camera", {
                cfg: {
                    sid: cameraTag.getAttribute("id"),
                    info: this._getInfo("camera"),
                    optics: {
                        type: "perspective",
                        fovy: yfov ? parseFloat(yfov.children[0].nodeValue) : 60.0,
                        aspect: aspectRatio ? parseFloat(aspectRatio.children[0].nodeValue) : 1.0,
                        near: znear ? parseFloat(znear.children[0].nodeValue) : 0.1,
                        far: zfar ? parseFloat(zfar.children[0].nodeValue) : 20000.0
                    }
                }
            });
            this._sceneBuilder.closeNode();
        } else {
            var orthographic = techniqueCommon.getElementsByTagName("orthographic")[0];
            if (orthographic) {
                this._sceneBuilder.openNode("camera");
                this._sceneBuilder.closeNode();
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
            this._sceneBuilder.addNode("lights", {
                cfg:  {
                    sid: lightTag.getAttribute("id"),
                    info: this._getInfo("light"),
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
            this._sceneBuilder.addNode("lights", {
                cfg : {
                    sid: lightTag.getAttribute("id"),
                    info: this._getInfo("light"),
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
            this._sceneBuilder.addNode("lights", {
                cfg : {
                    sid: lightTag.getAttribute("id"),
                    info: this._getInfo("light"),
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

        this._sceneBuilder.openNode("material", {
            cfg: {
                sid: effectId,
                info: this._getInfo("material"),
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
            /* Record stats
             */
            this._stats.textures += layers.length;

            this._sceneBuilder.addNode("texture", {
                cfg: {
                    sid: "texture",
                    layers: layers
                }
            });
        }
        this._sceneBuilder.closeNode();
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
        var imageName = imageFileName.substr(imageFileName.lastIndexOf("/") + 1);

        /* Asset server will marshal all the attachments into one place
         */
        this._manifest.attachments.push({
            relPath : imageFileName,
            name : imageName
        });
        return {
            uri : new jsonLib.newStringAssignment("configs.baseURL", imageName),
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
        this._sceneBuilder.addNode("instance", {
            cfg: {
                uri: effectId,
                info: this._getInfo("instance_effect"),
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
        var id = geometryTag.getAttribute("id");

        this._sceneBuilder.openNode("node", {
            cfg: {
                sid: id
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

            /* BoundingBox
             */
            if (this._options.boundingBoxes) {
                var extents = this._expandExtentsByPositions(this._newExtents(), outputData.VERTEX);
                this._sceneBuilder.openNode("boundingBox", {
                    cfg: {
                        boundary: extents
                    }
                });
            }

            /* Material
             */
            var materialName = triangle.getAttribute("material");
            if (materialName) {
                this._sceneBuilder.openNode("instance", {
                    callback : "function(data) { return { uri: data.get(\"" + materialName + "\") }; }",
                    comment: this._options.comments ?
                             "Target Material Symbol is dynamically configured on this Geometry Symbol when instanced" :
                             null
                });
            }

            /* Record stats
             */
            this._stats.vertices += outputData.VERTEX.length;
            this._stats.triangles += faces.length / 3;

            /* Build model boundary
             */
            this._boundaryBuilder.libGeometry(id, outputData.VERTEX);


            /* Geometry
             */
            this._sceneBuilder.addNode("geometry", {
                cfg: {
                    info: this._getInfo("geometry"),
                    positions: outputData.VERTEX,
                    normals: outputData.NORMAL,
                    uv : outputData.TEXCOORD0,
                    uv2 : outputData.TEXCOORD1,
                    indices: faces
                }
            });
            if (materialName) {
                this._sceneBuilder.closeNode(); // Material
            }
            if (this._options.boundingBoxes) {
                this._sceneBuilder.closeNode(); // BoundingBox
            }
        }
        this._sceneBuilder.closeNode();
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

    this._newExtents = function() {
        const hugeNum = 9999999; // TODO: Guarantee this is max
        return {
            xmin : hugeNum, ymin : hugeNum, zmin : hugeNum,
            xmax : -hugeNum, ymax : -hugeNum, zmax : -hugeNum
        };
    };

    this._expandExtentsByPositions = function(e, positions) {
        for (var i = 0; i < positions.length - 2; i += 3) {
            var x = positions[i];
            var y = positions[i + 1];
            var z = positions[i + 2];
            if (x < e.xmin) e.xmin = x;
            if (y < e.ymin) e.ymin = y;
            if (z < e.zmin) e.zmin = z;
            if (x > e.xmax) e.xmax = x;
            if (y > e.ymax) e.ymax = y;
            if (z > e.zmax) e.zmax = z;
        }
        return e;
    };

    this._expandExtentsByExtents = function(e, e2) {
        if (e2.xmin < e.xmin) e.xmin = e2.xmin;
        if (e2.ymin < e.ymin) e.ymin = e2.ymin;
        if (e2.zmin < e.zmin) e.zmin = e2.zmin;
        if (e2.xmax > e.xmax) e.xmax = e2.xmax;
        if (e2.ymax > e.ymax) e.ymax = e2.ymax;
        if (e2.zmax > e.zmax) e.zmax = e2.zmax;
        return e;
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
        this._sceneBuilder.openNode("node", {
            cfg: {
                info: this._getInfo("library_visual_scenes")
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
        this._sceneBuilder.closeNode();
    };

    /**
     * @private
     */
    this._parseVisualScene = function(visualSceneTag) {
        var visualSceneID = visualSceneTag.getAttribute("id");
        var visualSceneSID = visualSceneID;

        this._sceneBuilder.openNode("node", {
            cfg: {
                info: this._getInfo("visual_scene")
            },
            comment: this._options.comments ?
                     ["Symbol embodying content parsed from the <visual_scene id='" + visualSceneID + "/'> element. "] : null
        });

        /* Pre-parse visual scene node to collect list of subgraphs, collecting some metadata about their
         * cameras and lights, order the list so that the ones containing lights first
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
                this._preParseNode(childTag, graph.meta);
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
        this._sceneBuilder.openNode("symbol", {
            cfg: {
                sid: visualSceneSID,
                info: this._getInfo("symbol_visual_scene")
            },
            comment: this._options.comments ? "" : null
        });
        for (var i = 0; i < graphs.length; i++) {
            graph = graphs[i];
            if (!graph.meta.cameraId) {
                this._parseNode(graph.tag, "", visualSceneID);   // No need to back SID path out of a Symbol

            }
        }
        this._sceneBuilder.closeNode();

        /* Record scene Symbol in manifest
         */
        var mfScene = {
            description: "visual_scene '" + visualSceneID + "'",
            uri: visualSceneSID,
            cameras : {}
        };
        this._manifest.symbols.scenes[visualSceneID] = mfScene;

        /* At same level as visual scene Symbol, write a subgraph for each camera,
         * with an Instance of the Symbol at each subgraph's leaf
         */
        for (var i = 0; i < graphs.length; i++) {
            graph = graphs[i];
            if (graph.meta.cameraId) {
                var cameraSID = graph.tag.getAttribute("id") || graph.meta.cameraId;
                var symbolSID = visualSceneSID + "." + cameraSID;
                this._sceneBuilder.openNode("symbol", {
                    cfg: {
                        sid: symbolSID,
                        info: this._getInfo("symbol_camera_visual_scene")
                    },
                    comment: this._options.comments ?
                             [
                                 "Symbol embodying content parsed from the '" + visualSceneID + "' visual_scene, as viewed ",
                                 "through the camera defined within its '" + cameraSID + "' child node"
                             ] : null
                });

                this._parseNode(graph.tag, "", visualSceneSID);
                this._sceneBuilder.closeNode();

                /* Record scene camera Symbol in manifest
                 */
                mfScene.cameras[graph.meta.cameraId] = {
                    description: "visual_scene '" + visualSceneID + "' viewed through camera '" + cameraSID + "'",
                    uri: symbolSID
                };
            }
        }
        this._sceneBuilder.closeNode();
    };

    /**
     * Reconnoiter of node subgraph to find out if it contains cameras or lights
     * @private
     */
    this._preParseNode = function(nodeTag, meta) {
        var childTag = nodeTag.firstChild;
        do{
            switch (childTag.tagName) {
                case "node":
                    this._preParseNode(childTag, meta);
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
     * @param visualSceneId Only required when we know that node contains a <camera> - injected form target URI for camera's Instance at leaf of node's subtree
     * @param extractConfig
     */
    this._parseNode = function(nodeTag, path, visualSceneId, extractConfig) {
        var id = nodeTag.getAttribute("id");
        if (id) {
            this._sceneBuilder.openNode("node", {
                cfg: {
                    info: this._getInfo("node[@id='" + id + "']"),
                    sid: id }
            });
            path = "../" + path;
        } else {
            this._sceneBuilder.openNode("node", {});
        }
        var childTag = nodeTag.firstChild;
        var xfStack = {
            stack : [],
            nProcessed: 0,

            /* Path of "../" accumulated for a transform hierarchy.
             * Note that this needs to be accumulated with the Node,
             * lazily because Nodes may be descended to before/after transforms
             */
            xfPath: ""
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
                    this._parseNode(childTag, path + xfStack.xfPath, visualSceneId);
                    break;

                case "instance_node":
                    this._openXFStack(xfStack);
                    this._sceneBuilder.addNode("instance", {
                        cfg: {
                            info: this._getInfo("instance_node"),
                            uri : path + xfStack.xfPath + childTag.getAttribute("url").substr(1),
                            mustExist: true
                        }
                    });
                    break;

                case "instance_visual_scene":
                    this._openXFStack(xfStack);
                    this._sceneBuilder.addNode("instance", {
                        cfg: {
                            info: this._getInfo("instance_visual_scene"),
                            uri : path + xfStack.xfPath + childTag.getAttribute("url").substr(1),
                            mustExist: true
                        }
                    });
                    break;

                case "instance_geometry":
                    this._openXFStack(xfStack);
                    this._parseInstanceGeometry(xfStack.xfPath + path, childTag);
                    break;

                case "instance_camera":
                    this._openXFStack(xfStack);
                    this._sceneBuilder.openNode("instance", {
                        cfg: {
                            info: this._getInfo("instance_camera"),
                            uri : path + xfStack.xfPath + childTag.getAttribute("url").substr(1)
                        }
                    });
                    this._sceneBuilder.addNode("instance", {
                        cfg: {
                            info: this._getInfo("instance_visual_scene"),
                            uri : path + xfStack.xfPath + visualSceneId
                        }
                    });
                    this._sceneBuilder.closeNode();
                    break;

                case "instance_light":
                    this._openXFStack(xfStack);
                    this._sceneBuilder.addNode("instance", {
                        cfg: {
                            info: this._getInfo("instance_light"),
                            uri : path + xfStack.xfPath + childTag.getAttribute("url").substr(1),
                            mustExist: true
                        }
                    });
                    break;
            }
        } while (childTag = childTag.nextSibling);
        this._closeXFStack(xfStack);
        this._sceneBuilder.closeNode();
    };

    this._openXFStack = function(xfStack) {
        var tag;
        for (var i = xfStack.stack.length - 1; i >= xfStack.nProcessed; i--) {
            tag = xfStack.stack[i];
            switch (tag.tagName) {
                case "matrix":
                    this._openMatrix(tag);
                    xfStack.xfPath = "../" + xfStack.xfPath;
                    break;
                case "translate":
                    this._openTranslate(tag);
                    xfStack.xfPath = "../" + xfStack.xfPath;
                    break;
                case "rotate":
                    this._openRotate(tag);
                    xfStack.xfPath = "../" + xfStack.xfPath;
                    break;
                case "scale":
                    this._openScale(tag);
                    xfStack.xfPath = "../" + xfStack.xfPath;
                    break;
                case "lookat":
                    this._openLookat(tag);
                    xfStack.xfPath = "../" + xfStack.xfPath;
                    break;
            }
        }
        xfStack.nProcessed = xfStack.stack.length;
    };

    this._closeXFStack = function(xfStack) {
        for (var i = 0; i < xfStack.nProcessed; i++) {
            this._sceneBuilder.closeNode();
            this._boundaryBuilder.popTransform();
        }
    };

    this._openRotate = function(rotateTag) {
        var array = this._parseFloatArray(rotateTag);
        var sid = rotateTag.getAttribute("sid") || this._randomSID();
        var x = array[0];
        var y = array[1];
        var z = array[2];
        var angle = array[3];
        this._sceneBuilder.openNode("rotate", {
            cfg: {
                info: this._getInfo("rotate"),
                sid: sid,
                x: x,
                y: y,
                z: z,
                angle: angle
            }
        });
        this._boundaryBuilder.pushRotate(angle, [x, y, z]);
    };

    // @private
    this._openMatrix = function(matrixTag) {
        var array = this._parseFloatArray(matrixTag);
        var sid = matrixTag.getAttribute("sid") || this._randomSID();
        var elements = [
            array[0],array[4],array[8],array[12],
            array[1],array[5],array[9],array[13],
            array[2],array[6],array[10],array[14],
            array[3],array[7],array[11],array[15]];
        this._sceneBuilder.openNode("matrix", {
            cfg: {
                info: this._getInfo("matrix"),
                sid: sid,
                elements:elements }
        });
        this._boundaryBuilder.pushMatrix(elements);
    };

    // @private
    this._openTranslate = function(translateTag) {
        var array = this._parseFloatArray(translateTag);
        var sid = translateTag.getAttribute("sid") || this._randomSID();
        this._sceneBuilder.openNode("translate", {
            cfg: {
                info: this._getInfo("translate"),
                sid: sid,
                x: array[0],
                y: array[1],
                z: array[2]
            }
        });
        this._boundaryBuilder.pushTranslate(array);
    };

    // @private
    this._openScale = function(scaleTag) {
        var array = this._parseFloatArray(scaleTag);
        var sid = scaleTag.getAttribute("sid") || this._randomSID();
        this._sceneBuilder.openNode("scale", {
            cfg: {
                info: this._getInfo("scale"),
                sid: sid,
                x: array[0],
                y: array[1],
                z: array[2]
            }
        });
        this._boundaryBuilder.pushScale(array);
    };

    // @private
    this._openLookat = function(lookatTag) {
        var array = this._parseFloatArray(lookatTag);
        var sid = lookatTag.getAttribute("sid") || this._randomSID();
        this._sceneBuilder.openNode("lookAt", {
            info: this._getInfo("lookat"),
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
            this._sceneBuilder.openNode("withData", {
                cfg: params
            });
        }
        var id = instanceGeometryTag.getAttribute("url").substr(1);
        this._sceneBuilder.addNode("instance", {
            cfg: {
                info: this._getInfo("instance_geometry"),
                uri : path + id,
                mustExist: true
            }
        });
        this._boundaryBuilder.instanceGeometry(id);

        if (params) {
            this._sceneBuilder.closeNode();
        }
    };

    this._parseScene = function() {
        var symbolSID = "scene";
        var sceneTag = this._xmlDoc.getElementsByTagName("scene")[0];
        this._sceneBuilder.openNode("symbol", {
            cfg: {
                info: this._getInfo("symbol_scene"),
                sid: symbolSID
            },
            comment:
                    this._options.comments ? [
                        "Symbol embodying content parsed from the root <scene> element, ",
                        "which embodies the default COLLADA scene, which contains the entire ",
                        "set of information that can be visualized from the contents of ",
                        "this COLLADA resource. To instantiate this Symbol, then from ",
                        "just outside the root of this COLLADA SceneJS subgraph, you would do this: ",
                        "",
                        "SceneJS.instance({ uri: '" + symbolSID + "'});"] : null
        });
        var ivsTags = sceneTag.getElementsByTagName("instance_visual_scene");
        for (var i = 0; i < ivsTags.length; i++) {
            this._parseInstanceVisualScene(ivsTags[i]);
        }
        this._sceneBuilder.closeNode();
        this._manifest.symbols.defaultSymbol = {
            description: "scene - scene graph base",
            uri: symbolSID
        };
    };

    this._parseInstanceVisualScene = function(instanceVisualSceneTag) {
        var sid = instanceVisualSceneTag.getAttribute("sid") || this._randomSID();
        var target = instanceVisualSceneTag.getAttribute("url").substr(1); // Non-null for instance tags
        this._sceneBuilder.addNode("instance", {
            cfg: {
                info: this._getInfo("instance_visual_scene"),
                sid: sid,
                uri : "../" + target
            }
        });
    };

    /**
     * The last node in the subgraph is a SceneJS.Instance to instantiate one of the Symbols
     * in this subraph. When the subgraph is wrapped in a factory function, IE. when the subgraph
     * is to be integrated by a human, the Instance's target Symbol URI can be given either as a parameter
     * on the function or as a "symbolURI" property on the data scope at the subgraph root (eg. by wrapping
     * the root in a SceneJS.WithData node). The latter method takes precendence, overriding the function parameter.
     * When the subgraph is provided by an asset server, the data scope will be the method by which the Symbol
     * will be specified.
     */
    this._parseSymbolSelector = function() {
        this._sceneBuilder.addNode("instance", {
            comment: this._options.comments ? [
                "Instantiates one of the Symbols in this subgraph. Recall that each Symbol embodies either ",
                "a visual_scene or a view of a visual_scene through one of its cameras. ",
                "The URI of the selected Symbol is by default '" + this._manifest.symbols.defaultSymbol.uri + "', this resource's default ",
                "scene. That may be be overridden by either the symbolURI argument to the factory function wrapping this subgraph ",
                "or a 'symbolURI' property on the current scene data scope, the latter taking precendence."
            ] : null,
            cfg: {
                uri: this._manifest.symbols.defaultSymbol.uri
            },
            callback:  function(data) {
                return {
                    uri: data.get("symbolURI") || symbolURI   // symbolURI undefined when not packaged in a module - thats OK
                };
            }
        });
    };
};
