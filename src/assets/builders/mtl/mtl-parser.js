var translator = require('../translator');

/**
 * Registers this MTL parser against the "mtl" file extension, along with some
 * capabilities info
 */
exports.init = function() {

    translator.registerParser(

        /* Supported file type
         */
            "mtl",

        /* Capabilities info. Each option has metadata
         * describing what it does, type and default value.
         */
    {
        options: [
            {
                name : "comments",
                type: "boolean",
                description : "Enables/disables comments in output",
                defaultValue : "false"
            }
        ]
    },
        /* Parser class
         */
            function(builder) {  // Constructor

                this._builder = builder;

                this.parse = function(params, xml, callback) {
                    this._uri = params.src;
                    this._dirURI = params.src.substring(0, params.src.lastIndexOf("/") + 1);
                    this._options = params.options || {};
                    var self = this;
                    callback({
                        body: "Testing"
                    });
                };


            });

};