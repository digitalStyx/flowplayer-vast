#!/bin/bash
../node_modules/.bin/browserify src/main.js > dist/vast.js
../node_modules/.bin/browserify src/main.js | ../node_modules/.bin/uglifyjs > dist/vast.min.js
