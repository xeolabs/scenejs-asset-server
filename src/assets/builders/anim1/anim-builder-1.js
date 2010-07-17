exports.init = function() {
    require('./../builder-registry').registerBuilder({
        info : {
            id: "anim1"
        },
        build : function(params, callback) {
        }
    });
};
