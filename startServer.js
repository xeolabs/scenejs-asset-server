#!/usr/bin/env node

/*
 Copyright (c) 2010 Lindsay Kay <lindsay.kay@xeolabs.com>

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 */

/*----------------------------------------------------------------------------------------------------------------------
 * Bootstraps the asset server, feeding it the settings file
 * specified on the command line, falling back on defaults when not specified
 *
 *--------------------------------------------------------------------------------------------------------------------*/


var fs = require('fs');
var assetService = require('./server/src/assetService');
var sys = require('sys');

var settingsFile = process.argv[2];
if (settingsFile) {
    sys.puts("Settings: " + settingsFile);
    
}

fs.readFile(settingsFile || './settings.json',
        function(err, data) {
            var settings; // AssetService to fall back on defaults 
            if (err) {
                sys.puts('No settings.json found (' + err + '). Using default settings');
            } else {
                try {
                    sys.puts(data.toString('utf8', 0, data.length));
                    settings = JSON.parse(data.toString('utf8', 0, data.length));;
                } catch (e) {
                    sys.puts('Error parsing settings.json: ' + e);
                    process.exit(1);
                }
            }
            assetService.start(settings);
        });
