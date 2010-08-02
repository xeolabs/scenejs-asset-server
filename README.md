# SceneJS Asset Server

Fetches files in various formats like COLLADA, OBJ etc, parses and warehouses them as SceneJS
JavaScript subgraphs for quick and easy download and integration into scene graphs.

Supports query of asset metadata, and download through either HTTP or WebSocket protocol. Using the
latter, a SceneJS.Socket node will be able to dynamically pull in live content from the server.

* Compatible with SceneJS v0.7.6.1, Node.js v0.1.91 and CouchDB 1.0.0
* Uses the Node.js WebSocket library at http://github.com/ncr/node.ws.js
* Wiki page at http://scenejs.wikispaces.com/Asset+Server

### Get metadata on an asset

http://localhost:8888?cmd=getAssetMeta&id=asset-55FA0B73-09B3-47FB-B1D5-0C4757AB740C


### Get an asset packaged as a SceneJS content module

<script src="http://localhost:8888/?cmd=getAsset&id=asset-55FA0B73-09B3-47FB-B1D5-0C4757AB740C&pkg=module"/>

SceneJS.requireModule("http://localhost:8888/?cmd=getAsset&id=asset-55FA0B73-09B3-47FB-B1D5-0C4757AB740C&pkg=module");


### Get an asset through a SceneJS.Socket

This Socket node will fetch an asset when first rendered, then bind it to it's subgraph:

SceneJS.socket({

        uri: "http://localhost:8888/"

        messages: [{
            cmd: getAsset,
            id: asset-55FA0B73-09B3-47FB-B1D5-0C4757AB740C,
            pkg: socket,
            attachToNode: "attachHere"
        }]
    },

    SceneJS.node({ sid: "attachHere" })
);


