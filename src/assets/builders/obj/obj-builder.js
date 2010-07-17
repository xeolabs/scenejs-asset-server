exports.init = function() {
    require('./../builder-registry').registerBuilder({
        info : {
            id: "obj"
        },
        build : function(assetParams, callback) {

            if (!assetParams.sourceURL) {
                callback({
                    error: 501,
                    body: "parameter expected: 'sourceURL'"
                });
                return false;
            }

            require("sys").puts("Builder 'obj' building asset");
            require("sys").puts("Loading Wavefront OBJ file from '" + assetParams.sourceURL + "'");

            /* Load source file
             */
            require('../../utils/loader').load({
                url: assetParams.sourceURL
            },
                    function(result) {
                        if (result.error) {
                            callback({ error : result.error, body : result.body });
                        } else {
                            var jsonBuilder = require("../../utils/scenejsBuilder").createBuilder();
                            var parser = new OBJParser(jsonBuilder);
                            try {
                                parser.parse({
                                    sourceURL : assetParams.sourceURL
                                },
                                        result.body, // Text
                                        callback);
                            } catch (e) {
                                callback({ error : 500, body: "Error parsing OBJ file - see server log for details" });
                            }
                        }
                    });
        }
    });
};


var OBJParser = function(builder) {  // Constructor

    this._builder = builder;

    this.parse = function(params, text, callback) {
        this._positions = [];
        this._uv = [];
        this._normals = [];
        this._group = null;
        this._node = null;
        this._index = 0;
        this._indexMap = [];
        this._mtllib = null;         // Name of auxiliary MTL file
        this._groupNames = [];
        this._uri = cfg.uri;
        this._rootSID = uri;
        this._dirURI = cfg.uri.substring(0, cfg.uri.lastIndexOf("/") + 1);
        return _parse(cfg.data);
    };

    /**
     * @param text File content
     * @private
     */
    function _parse(text) {
        this._node = new SceneJS.Node();
        var lines = text.split("\n");
        var tokens;

        for (var i in lines) {
            var line = lines[i];
            if (line.length > 0) {
                line = lines[i].replace(/[ \t]+/g, " ").replace(/\s\s*$/, "");
                tokens = line.split(" ");
                if (tokens.length > 0) {

                    if (tokens[0] == "mtllib") { // Name of auxiliary MTL file
                        this._mtllib = tokens[1];
                    }
                    if (tokens[0] == "usemtl") { // Name of auxiliary MTL file
                        if (!this._group) {
                            openGroup(null, null); // Default group - no name or texture group
                        }
                        this._group.materialName = tokens[1];
                    }
                    if (tokens[0] == "v") { // vertex
                        this._positions.push(parseFloat(tokens[1]));
                        this._positions.push(parseFloat(tokens[2]));
                        this._positions.push(parseFloat(tokens[3]));
                    }
                    if (tokens[0] == "vt") {
                        this._uv.push(parseFloat(tokens[1]));
                        this._uv.push(parseFloat(tokens[2]));
                    }

                    if (tokens[0] == "vn") {
                        this._normals.push(parseFloat(tokens[1]));
                        this._normals.push(parseFloat(tokens[2]));
                        this._normals.push(parseFloat(tokens[3]));
                    }

                    if (tokens[0] == "g") {
                        closeGroup();
                        var name = tokens[1];
                        var textureGroup = tokens[2];
                        openGroup(name, textureGroup);
                    }

                    if (tokens[0] == "f") {
                        if (!this._group) {
                            openGroup("default", null); // Default group - default name, no texture group
                        }
                        parseFace(tokens);
                    }
                }
            }
        }
        closeGroup();

        /* Add to root a sibling "model" Symbol to all the group Symbol nodes that
         * instantiates all the groups collectively
         */
        var modelSymbol = this._node.addNode(new SceneJS.Symbol({ sid: "model" }));
        for (var i = 0; i < this._groupNames.length; i++) {
            modelSymbol.addNode(new SceneJS.Instance({ uri: this._groupNames[i] }));
        }

        if (this._mtllib) {

            /* If an MTL file is referenced, then add an Instance node to the result subgraph,
             * to load the material file. Attach a handler to the Instance to attach the
             * OBJ subgraph as its next sibling when the Instance has finished loading.
             * This is neccessary to ensure that the Instance nodes in the OBJ subgraph
             * don't try to reference Symbols in the MTL subgraph before they are defined.
             */
            var root = new SceneJS.Node({
                info: "obj"
            });
            root.addNode(new SceneJS.Instance({
                info: "instance-mtl",
                uri: this._dirURI + this._mtllib,             // Path to MTL
                listeners: {
                    "state-changed" : {
                        fn: (function() {
                            var added = false;
                            var _node = this._node;
                            var _root = root;
                            return function(loadMTL) {
                                if (loadMTL.getState() == SceneJS.Instance.STATE_READY && !added) {
                                    _root.addNode(_node);
                                    added = true;
                                }
                            };
                        })()
                    }
                }
            }));
            return root;
        } else {
            return this._node;
        }
    }

    function openGroup(name, textureGroup) {
        this._group = {
            name: name,
            textureGroup : textureGroup,
            positions: [],
            uv: [],
            normals: [],
            indices : [],
            materialName : null
        };
        //  this._indexMap = [];
        this._index = 0;
    }

    /**
     * Closes group if open; adds a subgraph to the output, containing
     * a geometry wrapped in a Symbol. If the group has a material, then
     * the geometry is also wrapped in an instance that refers to the
     * material.
     */
    function closeGroup() {
        if (this._group) {
            var symbol = new SceneJS.Symbol({
                sid: this._group.name
            });
            var geometry = new SceneJS.Geometry({
                primitive: "triangles",
                positions: this._group.positions,
                normals: this._group.normals,
                indices: this._group.indices,
                uv: this._group.uv
            });
            if (this._group.materialName) {

                /* If group has material then, assuming that an MTL file has been loaded,
                 * define geometry within an instance of the corresponding Material node
                 * that will (should) have been defined (within a Symbol node) when the
                 * MTL file was parsed.
                 */
                symbol.addNode(
                        new SceneJS.Instance({
                            uri: "../" + this._group.materialName }, // Back up a level out of group's Name
                                geometry));
            } else {
                symbol.addNode(geometry);
            }
            this._node.addNode(symbol);
            this._groupNames.push(this._group.name);
        }
    }

    function parseFace(tokens) {
        var vert = null;             // Array of refs to pos/tex/normal for a vertex
        var pos = 0;
        var tex = 0;
        var nor = 0;
        var x = 0.0;
        var y = 0.0;
        var z = 0.0;

        var indices = [];
        for (var i = 1; i < tokens.length; ++i) {
            if (!(tokens[i] in this._indexMap)) {
                vert = tokens[i].split("/");

                if (vert.length == 1) {
                    pos = parseInt(vert[0]) - 1;
                    tex = pos;
                    nor = pos;
                }
                else if (vert.length == 3) {
                    pos = parseInt(vert[0]) - 1;
                    tex = parseInt(vert[1]) - 1;
                    nor = parseInt(vert[2]) - 1;
                }
                else {
                    return;
                }

                x = 0.0;
                y = 0.0;
                z = 0.0;
                if ((pos * 3 + 2) < this._positions.length) {
                    x = this._positions[pos * 3];
                    y = this._positions[pos * 3 + 1];
                    z = this._positions[pos * 3 + 2];
                }
                this._group.positions.push(x);
                this._group.positions.push(y);
                this._group.positions.push(z);

                x = 0.0;
                y = 0.0;
                if ((tex * 2 + 1) < this._uv.length) {
                    x = this._uv[tex * 2];
                    y = this._uv[tex * 2 + 1];
                }
                this._group.uv.push(x);
                this._group.uv.push(y);

                x = 0.0;
                y = 0.0;
                z = 1.0;
                if ((nor * 3 + 2) < this._normals.length) {
                    x = this._normals[nor * 3];
                    y = this._normals[nor * 3 + 1];
                    z = this._normals[nor * 3 + 2];
                }
                this._group.normals.push(x);
                this._group.normals.push(y);
                this._group.normals.push(z);

                this._indexMap[tokens[i]] = this._index++;
            }
            indices.push(this._indexMap[tokens[i]]);
        }

        if (indices.length == 3) {

            /* Triangle
             */
            this._group.indices.push(indices[0]);
            this._group.indices.push(indices[1]);
            this._group.indices.push(indices[2]);

        } else if (indices.length == 4) {

            // TODO: Triangulate quads
        }
    }
}