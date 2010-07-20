


exports.load = function(params, callback) {
    var request = require('./request/request');
    request({
        uri:params.url
    },
            function (error, response, body) {
                if (error || response.statusCode != 200) {
                    callback({
                        error: response.statusCode || 500,
                        body: "Failed to load file : '" + params.url
                    });
                } else {
                   // require('sys').puts(body);
                    callback({
                        body : body
                    });
                }
            });
};

