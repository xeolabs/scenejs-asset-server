/* CouchDB Documents to drop into Futon to create the SceneJS Asset Server DB
 *  --------------------------------------------------------------------------
 */

var xx = // Ignore these assignments - they're just so I can do IDE auto-format OK

{
   "_id": "_design/asset-meta",
   "_rev": "1-2da18e1593176e9653a8bf276b8e4ba4",
   "language": "javascript",
   "views": {
       "all_tags": {
           "map": "function(doc) { if (doc.type == 'asset-handle' && doc.tags) {  doc.tags.forEach(function(tag) { emit(tag, 1);  }); } }",
           "reduce": "function(keys, values) { return sum(values); }"
       },
        "all-assets": {
           "map": "function(doc) { if (doc.type == 'asset-meta')  emit(doc.id, doc) }"
       },
       "all": {
           "map": "function(doc) { if (doc.type == 'asset-meta')  emit(null, doc) }"
       },
       "meta_by_tags": {
           "map": "function(doc) { if (doc.type == 'asset-meta' && doc.tags) { doc.tags.forEach(function(tag) { emit(tag, doc); }); } }"
       }
   }
}


