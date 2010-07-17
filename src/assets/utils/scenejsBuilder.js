/**
 * @class Code generator that builds a JSON string defining a SceneJS subgraph.
 *
 * <p>The builder also takes care of indentation so that you have something readable. You would then probably want to
 * minify the JSON for a production environment.</p>
 *
 * <p>Tested with SceneJS V0.7.6.</p>
 *
 * <b> Example Usage</b>
 * Building JSON for a minimal functional-style scene graph, parsing it to an object, then rendering. Indentation of
 * builder calls is just for legibility.
 * <pre><code>
 * var b = new SceneJS_JSON_Builder({
 *             numIndents: 4,        // Optional, default is 4
 *             factoryFunc: null,    // Optional, name of factory func to wrap around subgraph, default is none
 *             cfgFilter: {
 *                 excludes: {
 *
 *                 }
 *             },
 *             api: "function"       // Optional - "object" or "function", defaults to "function"
 *         });
 *
 * b.openNode("scene", { canvasId: "theCanvas" });
 *     b.openNode("lookAt",
 *        {
 *           eye  : { x: -1.0, y: 0.0, z: 15 },
 *           look : { x: -1.0, y: 0, z: 0 },
 *           up   : { y: 1.0 }
 *       });
 *
 *         b.openNode("camera",
 *             {
 *                  optics: {
 *                  type: "perspective",
 *                  fovy   : 55.0,
 *                  aspect : 1.0,
 *                  near   : 0.10,
 *                  far    : 1000.0
 *              });
 *
 *             b.openNode("lights",
 *                 {
 *                       sources: [
 *                         {
 *                           type:  "dir",
 *                           color: { r: 1.0, g: 1.0, b: 1.0 },
 *                           dir:   { x: 1.0, y: -1.0, z: 1.0 }
 *                         },
 *                         {
 *                           type:  "dir",
 *                           color: { r: 1.0, g: 1.0, b: 1.0 },
 *                           dir:   { x: -1.0, y: -1.0, z: -3.0 }
 *                         }
 *                       ]
 *                });
 *
 *                 b.openNode("rotate", {
 *                       callback : "function(data) { return { x: 1.0, angle: data.get(\"" + yaw + "\") }; }",
 *                       comment: "Rotation is dynamically configured through a data context"
 *                   });
 *
 *                         b.addNode("objects.teapot");
 *
 *                 b.closeNode();
 *             b.closeNode();
 *         b.closeNode();
 *
 * var json = getJSON();
 *
 * var myScene = JSON.parse(json);
 *
 * myScene.setData({ yaw : "45" }).render();
 * </pre></code>
 *
 * @constructor
 * Create a new SceneJS_JSON_Builder
 */
var SceneJS_JSON_Builder = function(cfg) {
    cfg = cfg || {};
    this._numIndentChars = cfg.numIndents || 4;
    this._factoryFunc = cfg.factoryFunc;
    this._cfgFilter = cfg.cfgFilter;
    this._api = cfg.api || "function";
    this._jsonLine = null;
    this._json = [];
    this._comments = cfg.comments;
    this._openNodes = [];
    this._openNode = null;
    this._nodesOpen = 0;
    this._INDENT_SPACES = "                                                                                           ";
    this._COMMENT_DASHES = "-----------------------------------------------------------------------------";
    this._indentStr = "";
    this._countIndents = cfg.factoryFunc ? 1 : 0;

    this._indent = function() {
        this._countIndents++;
        this._indentStr = this._INDENT_SPACES.substr(0, this._countIndents * this._numIndentChars);
    };

    this._undent = function() {
        if (this._countIndents > 0) {
            this._countIndents--;
            this._indentStr = this._INDENT_SPACES.substr(0, this._countIndents * this._numIndentChars);
        }
    };

    this._write = function(str) {
        if (!this._jsonLine) {
            this._jsonLine = [this._indentStr];
        }
        this._jsonLine.push(str);
    };

    this._writeln = function(str) {
        if (this._jsonLine) {
            this._jsonLine.push(str);
            this._json.push(this._jsonLine.join(""));
            this._jsonLine = null;
        } else {
            this._json.push(this._indentStr + str);
        }
    };

    this.addNode = function(name, cfg) {
        this.openNode(name, cfg);
        this.closeNode();
    };

    this.openNode = function(name, cfg) {
        if (this._openNode) {
            if (this._openNode.needComma) {
                this._writeln(", ");
            }
        }
        this._indent();
        if (cfg.comment) {
            this._comment(cfg.comment);
        }
        if (this._api == "object") {
            this._write("new ");
            name = name.charAt(0).toUpperCase() + name.substr(1); // Class name
        }
        if (!this._openNode) { // Opening root node
            this._write("return ");
        }
        this._write("SceneJS." + name + "(");
        this._openNode = {};
        this._openNodes.push(this._openNode);
        var needNewline = true;
        if (cfg.cfg && this._configs(cfg.cfg)) {
            needNewline = false;
        }
        if (cfg.callback) {
            if (this._openNode.needComma) {
                this._writeln(", ");
            } else {
                this._writeln("");
            }
            this._indent();
            this._write(cfg.callback);
            this._undent();
            this._openNode.needComma = true;
            needNewline = false;
        }
        if (needNewline) {
            this._writeln("");
        }
        return this;
    };

    this._comment = function(comment) {
        this._writeln("");
        this._writeln("//" + this._COMMENT_DASHES);
        if (this._isArray(comment)) {
            for (var i = 0; i < comment.length; i++) {
                this._writeln("// " + comment[i]);
            }
        } else {
            this._writeln("// " + comment);
        }
        this._writeln("//" + this._COMMENT_DASHES);
        this._writeln("");
    };

    this._configs = function(cfg) {
        if (!this._hasConfigs(cfg)) {
            return false;
        }
        this._writeln("{");
        this._indent();
        this._indent();
        var needClosingParen = false;
        if (cfg instanceof Function) {
            this._writeln(cfg.toString());
        } else {
            for (var key in cfg) {
                if (cfg.hasOwnProperty(key)) {
                    var value = cfg[key];
                    if (value != undefined) {
                        this._property(key, value);
                        needClosingParen = true;
                    }
                }
            }
        }
        this._writeln("");
        this._undent();
        this._write("}");
        this._undent();
        this._openNode.needComma = true;
        return true;
    };

    this._hasConfigs = function(cfg) {
        for (var key in cfg) {
            if (cfg.hasOwnProperty(key)) {
                if (cfg[key]) {
                    return true;
                }
            }
        }
        return false;
    };

    this._property = function(name, value) {
        if (this._openNode.needComma) {
            this._writeln(",");
            this._openNode.needComma = false;
        }
        if (typeof value == "number") {
            this._write(name + " : " + value);
        } else if (typeof value == "boolean") {
            this._write(name + " : " + value);
        } else if (this._isArray(value)) {
            this._arrayProperty(name, value);
        } else if (typeof value == "string") {
            this._write(name + " : \"" + value + "\"");
        } else {
            this._objectProperty(name, value);
        }
        this._openNode.needComma = true;
        return this;
    };

    this._isArray = function(value) {
        return value && !(value.propertyIsEnumerable('length'))
                && typeof value === 'object' && typeof value.length === 'number';
    };

    this._arrayProperty = function(name, value) {
        this._write(name + " : [");
        if (value.length > 0) {
            if (typeof value[0] == "number") {
                this._numberArrayElements(value);
            } else if (typeof value[0] == "string") {
                this._stringArrayElements(value);
            } else {
                this._objectArrayElements(value);
            }
        }
        this._write("]");
    };

    this._numberArrayElements = function(value) {
        var needComma = false;
        for (var i = 0; i < value.length; i++) {
            if (needComma) {
                this._write(", ");
            }
            this._write(value[i]);
            needComma = true;
        }
    };

    this._stringArrayElements = function(value) {
        var needComma = false;
        for (var i = 0; i < value.length; i++) {
            if (needComma) {
                this._write(", ");
            }
            this._write("\"" + value[i] + "\"");
            needComma = true;
        }
    };

    this._objectArrayElements = function(value) {
        var needComma = false;
        for (var i = 0; i < value.length; i++) {
            if (needComma) {
                this._write(", ");
            }
            if (this._configs(value[i])) {
                needComma = true;
            }
        }
    };

    this._objectProperty = function(name, value) {
        this._writeln(name + " : {");
        this._indent();
        var needNewline = false;
        for (var key in value) {
            if (value.hasOwnProperty(key)) {
                this._property(key, value[key]);
                needNewline = true;
            }
        }
        this._undent();
        if (needNewline) {
            this._writeln();
        }
        this._write("}");
    };

    this.closeNode = function() {
        if (this._openNode) {
            this._write(")");
            this._openNodes.pop();
            if (this._openNodes.length > 0) {
                this._openNode = this._openNodes[this._openNodes.length - 1];
                this._openNode.needComma = true;
            } else {
                this._openNode = null;
            }
            this._undent();
        }
        return this;
    };

    this.getJSON = function() {
        while (this._openNode) {
            this.closeNode();
        }
        this._writeln("");
        if (this._factoryFunc) {
            this._json.unshift("function " + this._factoryFunc + "(symbolURI) {");
            this._json.push("}");
        }
        this._json.push(" "); // Kills whitespace at end that wont eval

        if (this._comments) {
            this._json.unshift(" */");
            for (var i = this._comments.length - 1; i >= 0; i--) {
                this._json.unshift(" * " + this._comments[i]);
            }
            this._json.unshift("/**");
        }
        return this._json.join("\n");
    };
};
