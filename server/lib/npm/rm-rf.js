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

// like rm -rf

exports.rm = rm;

var fs = require("fs")
        , path = require("path")
        , sys = require("sys")
        , failedToRemove = []
        , log = require("../log");
//
//process.on("exit", function () {
//    if (failedToRemove.length === 0) {
//        return;
//    }
//    sys.error("");
//    log("The following files and folders could not be removed", "!")
//    log("You should remove them manually.", "!")
//    sys.error("\nsudo rm -rf "
//            + failedToRemove.map(JSON.stringify).join(" ")
//            );
//})  ;

function rm(p, cb_) {

    if (!p) return cb(new Error("Trying to rm nothing?"))

    var cb = function (er) {
        if (er) {
            failedToRemove.push(p);
            log(p, "rm fail");
            log(er.message, "rm fail");
        }
        cb_(null, er)
    };

    fs.lstat(p, function (er, s) {
        if (er) return cb();
        if (s.isFile() || s.isSymbolicLink()) {
            fs.unlink(p, cb);
        } else {
            fs.readdir(p, function (er, files) {
                if (er) return cb(er)
                        ;
                (function rmFile(f) {
                    if (!f) fs.rmdir(p, cb);
                    else rm(path.join(p, f), function (_, er) {
                        if (er) return cb(er);
                        rmFile(files.pop());
                    })
                })(files.pop());
            });
        }
    });
}