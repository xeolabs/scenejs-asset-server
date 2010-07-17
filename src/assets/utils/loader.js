


exports.load = function(params, callback) {
    var request = require('../../../lib/request/request');
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


exports.load2 = function(params, callback) {
    var sys = require('sys');
    var http = require('http');
    var urlParts = require("url").parse(params.url);
    var client = http.createClient(80, urlParts.host);
    //client.setTimeout(0);
    var request = client.request('GET', urlParts.pathname, { host: urlParts.host });

    request.addListener('response',

            function (response) {
                var status = response.statusCode;
                if (status != 200) {
                    callback({ error: status, body: "Failed to load file : '" + params.url });
                    return;
                }

                var chunks = [];

                response.setEncoding('utf8');

                response.addListener(
                        'data',
                        function (chunk) {
                            // require("sys").puts(chunk);
                            chunks += chunk;
                        });

                response.addListener(
                        'end',
                        function () {
                            callback({
                                body : chunks
                            });
                        });

                response.addListener(
                        'upgrade',
                        function () {
                        });

                response.addListener(
                        'timout',
                        function () {
                        });
            });
    request.close();
};
