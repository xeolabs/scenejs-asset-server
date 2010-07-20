# SceneJS Asset Server

Fetches files in various formats like COLLADA, OBJ etc, parses and warehouses them as SceneJS
JavaScript subgraphs for quick and easy download and integration into scene graphs.

Supports query of asset metadata, and download through either HTTP or WebSocket protocol. Using the
latter, a SceneJS.Socket node will be able to dynamically pull in live content from the server.

* Compatible with SceneJS v0.7.6.1, Node.js v0.1.91 and CouchDB 1.0.0
* Uses the Node.js WebSocket library at http://github.com/ncr/node.ws.js
* Wiki page at http://scenejs.wikispaces.com/Asset+Server
