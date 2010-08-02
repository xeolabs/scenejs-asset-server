/*
 Copyright 2009, 2010 Isaac Zimmitti Schlueter. All rights reserved.
 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to
 deal in the Software without restriction, including without limitation the
 rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 sell copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 IN THE SOFTWARE.
 */
module.exports = set
var get = require("./get")
        , processJson = require("./read-json").processJson
function set (obj, key, val) {
    for (var i in obj) if (i.toLowerCase() === key.toLowerCase()) return obj[i] = val
    obj[key] = val
    if (val && val.version && key.indexOf("-" + val.version) !== -1) {
        processJson(val)
        key = key.replace("-" + val.version, "")
        var reg = get(obj, key) || {}
        set(obj, key, reg)
        reg.versions = get(reg, "versions") || {}
        if (!get(reg.versions, val.version)) set(reg.versions, val.version, val)
    } else if (val && val.versions) {
        for (var v in val.versions) set(obj, key + "-" + v, val.versions[v])
    }
}