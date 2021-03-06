var fs     = require('fs');
var path   = require('path');
var mkpath = require('mkpath');
// We don't want to include our own version of CoffeeScript since we don't know
// what version the parent relies on
var coffee;
try {
  coffee = require('coffee-script');
  // CoffeeScript 1.7 support
  if (typeof coffee.register === 'function') {
    coffee.register();
  }
} catch (e) {
  // No coffee-script installed in the project; warn them and stop
  process.stderr.write("coffee-cache: No coffee-script package found.\n");
  return;
}

// Directory to store compiled source
var cacheDir = process.env['COFFEE_CACHE_DIR'] || '.coffee';

// Root directory of project - use __dirname by default
var rootDir = process.env['COFFEE_ROOT_DIR'] || '.';

// Storing coffee's require extension for backup use
var coffeeExtension = require.extensions['.coffee'];

var useOnlyMemory = false

var contentsByFilename = {}

// Only log once if we can't write the cache directory
var logCouldNotWriteCache = function() {
  process.stderr.write(
    "coffee-cache: Could not write cache at " + cacheDir + ".\n"
  );
  logCouldNotWriteCache = function(){};
}

// Compile a file as you would with require and return the contents
function cacheFile(filename) {
  var content = contentsByFilename[filename];
  if (content) return content;

  // First, convert the filename to something more digestible and use our cache
  // folder
  var cachePath = path.join(cacheDir, path.relative(rootDir, filename)).replace(/\.coffee$/, '.js');

  if (!useOnlyMemory) {
    // Try and stat the files for their last modified time
    try {
      var cacheTime = fs.statSync(cachePath).mtime;
      var sourceTime = fs.statSync(filename).mtime;
      if (cacheTime > sourceTime) {
        // We can return the cached version
        content = fs.readFileSync(cachePath, 'utf8');
      }
    } catch (err) {
      // If the cached file was not created yet, this will fail, and that is okay
    }
  }

  // If we don't have the content, we need to compile ourselves
  if (!content) {
    // Read from disk and then compile
    var compiled = coffee.compile(fs.readFileSync(filename, 'utf8'), {
      bare: true,
      filename: filename,
      sourceMap: true,
    });
    var map = JSON.parse(compiled.v3SourceMap);
    map.sources = [filename];
    var bufferFrom = Buffer.alloc && Buffer.from || function (it) { return new Buffer(it); };
    map = bufferFrom(JSON.stringify(map), 'utf8').toString('base64');
    content = compiled.js + '\n//# sourceMappingURL=data:application/json;base64,' + map;

    // Since we don't know which version of CoffeeScript we have, make sure
    // we handle the older versions that return just the compiled version.
    if (content == null)
      content = compiled;

    if (!useOnlyMemory) {
      try {
        // Try writing to cache
        mkpath.sync(path.dirname(cachePath));
        fs.writeFileSync(cachePath, content, 'utf8');
        sourceTime.setSeconds(sourceTime.getSeconds() + 1);
        fs.utimesSync(cachePath, sourceTime, sourceTime);
      } catch (err) {
        logCouldNotWriteCache()
      }
    }
  }

  return content;
}

// Set up an extension map for .coffee files -- we are completely overriding
// CoffeeScript's since it only returns the compiled module.
require.extensions['.coffee'] = function(module, filename) {
  var content = cacheFile(filename);
  if (content)
    // Successfully retrieved the file from disk or the cache
    return module._compile(content, filename);
  else
    // Something went wrong, so we can use coffee's require
    return coffeeExtension.apply(this, arguments);
};

try {
  require('source-map-support').install({
    retrieveFile: function (path) {
      return /\.coffee$/.test(path) ? cacheFile(path) : null;
    },
  });
} catch (err) {
  // The `source-map-support` module is only optional
}

// Export settings
module.exports = {
  setCacheDir: function(dir, root){
    if(root) {
      rootDir = root;
    }

    cacheDir = dir;
    return this;
  },
  useOnlyMemory: function (use) {
    useOnlyMemory = use !== false
    return this
  },
  cacheFile: cacheFile,
};
