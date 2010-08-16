var builders = {};

exports.registerBuilder = function(builder) {
    builders[builder.info.id] = builder;
};

exports.getBuilder = function(id) {
    return builders[id];
};

exports.getBuilders = function() {
    return builders;
};