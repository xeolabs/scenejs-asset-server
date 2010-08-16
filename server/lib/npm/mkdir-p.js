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
var fs = require("fs")
        , path = require("path");

exports.mkdir = function(ensure, chmod, cb) {
    if (ensure.charAt(0) !== "/")
        ensure = path.join(process.cwd(), ensure);
    var dirs = ensure.split("/"), walker = [];
    if (arguments.length < 3) {
        cb = chmod;
        chmod = 0755;
    }
    walker.push(dirs.shift()); // gobble the "/" first
    (function S(d) {
        if (d === undefined) return cb();
        walker.push(d);
        var dir = walker.join("/");
        fs.stat(dir, function (er, s) {
            if (er) {
                fs.mkdirSync(dir, chmod, function (er, s) {
                    if (er) return cb(new Error(
                            "Failed to make " + dir + " while ensuring " + ensure + "\n" + er.message));
                    S(dirs.shift());
                });
            } else {
                if (s.isDirectory()) S(dirs.shift());
                else cb(new Error("Failed to mkdir " + dir + ": File exists"));
            }
        });
    })(dirs.shift());
};