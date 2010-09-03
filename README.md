SceneJS Asset Server
================================================================================

The Asset Server is an experimental content server for SceneJS that

 * fetches Collada (and soon OBJ) models from the Web and warehouses them as SceneJS JSON assets, along with their attachments
 * supports download of assets through HTTP and the SceneJS.Socket node
 * provides metadata on assets to assist their integration into scene graphs
 * spatially indexes assets in a kd-tree to support fast queries for assets that intersect given boundaries

It is currently running at [assets.scenejs.org](http://assets.scenejs.org)

[Documentation](http://scenejs.wikispaces.com/Asset+Server) is still under construction, but updated regularly.

API
--------------------------------------------------------------------------------

The API so far:

 * [createAsset](http://scenejs.wikispaces.com/Asset+Server+API+-+createAsset)
 * [getAsset](http://scenejs.wikispaces.com/Asset+Server+API+-+getAsset)
 * [getAssetMeta](http://scenejs.wikispaces.com/Asset+Server+API+-+getAssetMeta)
 * [getAssetMap](http://scenejs.wikispaces.com/Asset+Server+API+-+getAssetMap)
 * [getAssetsInBoundary](http://scenejs.wikispaces.com/Asset+Server+API+-+getAssetsInBoundary)



