/* CouchDB Documents to drop into Futon to create the SceneJS Asset Server DB
 *  --------------------------------------------------------------------------
 */

var xx = // Ignore these assignments - they're just so I can do IDE auto-format OK


{
   "_id": "_design/asset-meta",
   "language": "javascript",
   "views": {
       "all_tags": {
           "map": "function(doc) { if (doc.type == 'asset-handle' && doc.tags) {  doc.tags.forEach(function(tag) { emit(tag, doc.name);  }); } }"
       },
       "all_assets": {
           "map": "function(doc) { if (doc.type == 'asset-handle')  emit(doc._id, doc.name) }"
       }
   }
}

