var sys = require("sys");
var log = require('../lib/log').log;
var ws = require('../lib/ws');
var assetService = require('./assetService');
var url = require('url');
var qs = require('querystring');

function USAGE(message) {
    var error_code = 0;
    sys.puts("\n  USAGE: node runServer.js HOST PORT\n\n" +
             "  Run the SceneJS Asset Server.\n" +
             "\b\n" +
             "  Example:\n\t\tnode runServer.js http://localhost 8888\n\n");

    if (message !== undefined) {
        sys.puts(message);
        error_code = 1;
    }
    process.exit(error_code);
}

if (process.argv.length < 3) {
    USAGE();
}

const HOST = process.argv[2];
const PORT = process.argv[3];


var server = ws.createServer({
    debug: false
});

server.addListener("listening", function() {
    log("SceneJS Asset Server listening for connections on " + HOST + ":" + PORT);
});

// Handle WebSocket Requests
server.addListener("connection", function(conn) {
    log("opened connection: " + conn._id);

    conn.addListener("message",
            function(message) {
                parseMessage(message,
                        function(params) {
                            assetService.service(
                                    params,
                                    function (result) {
                                        if (result.error) {
                                            //log("<" + conn._id + "> ERROR handling request: " + result.error + " : " + result.body);
                                            server.send(conn._id, JSON.stringify(result));
                                        } else {
                                            var jsonStr = JSON.stringify(result);
                                            //  log("<" + conn._id + "> success handling request - response has " + jsonStr.length + " chars");
                                            server.send(conn._id, jsonStr);
                                        }
                                    });
                        },
                        function(error) {
                            // log("<" + conn._id + "> ERROR handling request: " + error.error + " : " + error.message);
                            server.send(JSON.stringify(error));
                        });
            });
});

function parseMessage(message, ok, er) {
    try {
        ok(JSON.parse(message));
    } catch (e) {
        er({ error : 501, body : "request is not valid JSON: " + message });
    }
}

server.addListener("close", function(conn) {
    log("closed connection: " + conn._id);
});

// Handle HTTP Requests:
server.addListener("request", function(req, res) {
    res.writeHead(200, {'Content-Type': "text/plain"});
    var params = qs.parse(url.parse(req.url).query);
    log("http request " + JSON.stringify(params));
    assetService.service(
            params,
            function (result) {
                if (result.error) {
                    log("error handling HTTP request: " + result.error + " : " + result.body);
                    res.end(JSON.stringify(result));
                } else {
                    var jsonStr = JSON.stringify(result);
                    log("responding with " + jsonStr.length + " chars");
                    res.end(jsonStr);
                }
            });
    log("DONE http request");
});

server.addListener("shutdown", function(conn) {
    log("Server shutdown"); // never actually happens, because I never tell the server to shutdown.
});

server.listen(PORT, HOST);
