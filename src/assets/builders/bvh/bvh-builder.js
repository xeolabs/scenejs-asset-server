exports.init = function() {
    require('./../builder-registry').registerBuilder({
        info : {
            id: "mtl"
        },
        build : function(params, callback) {
        }
    });
};
