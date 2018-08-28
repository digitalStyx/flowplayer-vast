(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
var vast = require('./vast');
window.vast = vast;
},{"./vast":2}],2:[function(require,module,exports){
var vast = require('vast-client');

var videoFormats = ['application/x-mpegurl', 'video/webm', 'video/mp4'];

module.exports = {
	init: function (container, player, url) {
		if (player.conf.wmode != 'transparent') {
			throw new Error('The player must have wmove = transparent for video clicks to work in IE.');
		}

		if (!player.conf.playlist || !player.conf.playlist.length) {
			throw new Error('The player must have a playlist configured.');
		}

		var that = this;

		this.loadPreroll(container, url, function (preroll) {
			if (preroll) {
				if (preroll.swf) {
					return player.trigger('vpaid_swf', [preroll.swf]);
				}

				if (preroll.js) {
					return player.trigger('vpaid_js', [preroll.js]);
				}

				if (preroll.video) {
					that.attachEvents(container, player);

					var forced = false;

					player.one('resume load', function (e) {
						// forces pre-roll to play first after updating playlist
						if (forced) {
							return;
						}

						forced = true;

						if (undefined !== window.player.engine && undefined !== window.player.engine.hls) {
							window.player.engine.hls.stopLoad();
						}

						e.preventDefault();

						setTimeout(function () {
							var newPlaylist = player.conf.playlist.slice(0);
							newPlaylist.unshift(preroll.video);

							player.setPlaylist(newPlaylist);

							// timeout makes play work on mobile
							player.play(0);
						}, 0);

						return false;
					});
				}
			}
		});
	},
	attachEvents: function (container, player, options) {
		options = options || {};

		var skipped = false;
		var onClick = false;
		var completed = false;
		var adPlayed = false;

		if (options.adjustable) {
			player.on("beforeseek", function (e) {
				if (player.video.ad) {
					e.preventDefault();
				}
			});
		}

		var disable = function () {
			if (options.adjustable) {
				return;
			}

			player.disable(true);
		};

		var enable = function () {
			if (options.adjustable) {
				return;
			}

			player.disable(false);
		};

		if (flowplayer.support.inlineVideo) {
			var ui = container.querySelectorAll('.fp-player')[0];

			var onAdClick = function (e) {
				var isElement = e.target.className == 'fp-ui' || e.target.className == 'fp-engine';

				if (!isElement || !player.video.ad || !player.playing) {
					return;
				}

				ui.removeEventListener('click', onAdClick, true);

				player.video.tracker.click();
			};

			if (ui) {
				ui.addEventListener('click', onAdClick, true);
			}
		}

		if (flowplayer.support.inlineVideo) {
			player.on('pause', function () {
				if (player.video.ad) {
					// ipad will pause video on click and prevent user from continuing
					enable();
				}
			});
		}

		player.on('unload', function () {
			// allow user to replay video on mobile if they exit out ad early
			enable();
		});

		player.on('progress', function (event, player, duration) {
			if (!player.video.ad || !player.playing) {
				return;
			}

			adPlayed = true;

			disable();

			player.video.tracker.setProgress(duration);

			var title = container.querySelectorAll('.fp-title')[0];
			var header = container.querySelectorAll('.fp-header')[0];

			if (title) {
				if (!onClick) {
					onClick = true;

					var onSkipClick = function () {
						if (player.video.skip && player.video.time >= player.video.skip) {
							skipped = true;

							player.video.tracker.skip();

							player.play(1);
						}
					};

					title.onclick = onSkipClick;

					if (header) {
						// header can overlap title, so need to register in both places
						header.onclick = onSkipClick;
					}
				}

				if (player.video.skip) {
					if (player.video.skip && duration >= player.video.skip) {
						title.innerHTML = "Advertisement: <strong>Skip Ad &raquo;</strong>";
					} else {
						title.innerHTML = "Advertisement: Skippable in " + Math.round(player.video.skip - duration) + " seconds...";
					}
				} else {
					title.innerHTML = "Advertisement: Ends in " + Math.round(player.video.duration - duration) + " seconds...";
				}
			}
		});

		player.on('finish.vast_complete', function () {
			if (!player.video.ad) {
				return;
			}

			player.off('finish.vast_complete');

			if (!skipped) {
				player.video.tracker.complete();
			}
		});

		player.on('ready', function () {
			if (player.video.ad) {
				return player.video.tracker.load();
			}

			enable();

			if (!completed && adPlayed) {
				completed = true;

				if (options.keepPreroll !== true) {
					// take pre-roll out of rotation once user has seen it
					player.removePlaylistItem(0);
				}
			}
		});
	},
	loadPreroll: function (container, url, callback, timeoutMs) {
		var timedOut = false;

		var timeout = setTimeout(function () {
			timedOut = true;

			callback();
		}, timeoutMs || 5000);

		vast.client.get(url, function (response) {
			if (timedOut) {
				return;
			}

			var ads = [];

			clearTimeout(timeout);

			if (response) {
				response.ads.forEach(function (ad) {
					ad.creatives.some(function (creative) {
						if (creative.type != 'linear') {
							return;
						}

						var tracker = new vast.tracker(ad, creative);

						var clip = {
							tracker: tracker,
							skip: creative.skipDelay,
							title: 'Advertisement',
							ad: true,
							sources: []
						};

						clip.tracker.on('clickthrough', function (url) {
							window.open(url);
						});

						var typeMap = {};
						var smallest = {};

						creative.mediaFiles.forEach(function (media) {
							if (media.mimeType == 'application/javascript') {
								return;
							}

							if (media.mimeType == 'application/x-shockwave-flash') {
								return ads.push({
									swf: {
										src: media.fileURL,
										width: media.width,
										height: media.height,
										parameters: creative.adParameters,
										tracker: tracker
									}
								});
							}

							if (videoFormats.indexOf(media.mimeType) > -1) {
								var vid = {
									width: media.width,
									height: media.height,
									seconds: creative.duration,
									src: media.fileURL
								};

								if (!smallest[media.mimeType] || smallest[media.mimeType].width > media.width) {
									smallest[media.mimeType] = vid;
								}

								if (container.offsetWidth >= media.width && (!typeMap[media.mimeType] || media.width > typeMap[media.mimeType].width)) {
									typeMap[media.mimeType] = vid;
								}
							}
						});

						videoFormats.forEach(function (format) {
							var vid = typeMap[format] || smallest[format];

							if (vid) {
								clip.sources.push({
									type: format,
									seconds: vid.seconds,
									width: vid.width,
									height: vid.height,
									src: vid.src
								});
							}
						});

						if (clip.sources.length > 0) {
							ads.push({
								clip: clip
							});
						}

						return true;
					});
				});
			}

			if (ads[0]) {
				if (ads[0].swf) {
					return callback({type: 'swf', swf: ads[0].swf});
				}

				if (ads[0].js) {
					return callback({type: 'js', js: ads[0].js});
				}

				if (ads[0].clip) {
					return callback({type: 'video', video: ads[0].clip});
				}
			}

			callback(null);
		});
	}
};
},{"vast-client":8}],3:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var objectCreate = Object.create || objectCreatePolyfill
var objectKeys = Object.keys || objectKeysPolyfill
var bind = Function.prototype.bind || functionBindPolyfill

function EventEmitter() {
  if (!this._events || !Object.prototype.hasOwnProperty.call(this, '_events')) {
    this._events = objectCreate(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

var hasDefineProperty;
try {
  var o = {};
  if (Object.defineProperty) Object.defineProperty(o, 'x', { value: 0 });
  hasDefineProperty = o.x === 0;
} catch (err) { hasDefineProperty = false }
if (hasDefineProperty) {
  Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get: function() {
      return defaultMaxListeners;
    },
    set: function(arg) {
      // check whether the input is a positive number (whose value is zero or
      // greater and not a NaN).
      if (typeof arg !== 'number' || arg < 0 || arg !== arg)
        throw new TypeError('"defaultMaxListeners" must be a positive number');
      defaultMaxListeners = arg;
    }
  });
} else {
  EventEmitter.defaultMaxListeners = defaultMaxListeners;
}

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || isNaN(n))
    throw new TypeError('"n" argument must be a positive number');
  this._maxListeners = n;
  return this;
};

function $getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return $getMaxListeners(this);
};

// These standalone emit* functions are used to optimize calling of event
// handlers for fast cases because emit() itself often has a variable number of
// arguments and can be deoptimized because of that. These functions always have
// the same number of arguments and thus do not get deoptimized, so the code
// inside them can execute faster.
function emitNone(handler, isFn, self) {
  if (isFn)
    handler.call(self);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self);
  }
}
function emitOne(handler, isFn, self, arg1) {
  if (isFn)
    handler.call(self, arg1);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1);
  }
}
function emitTwo(handler, isFn, self, arg1, arg2) {
  if (isFn)
    handler.call(self, arg1, arg2);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2);
  }
}
function emitThree(handler, isFn, self, arg1, arg2, arg3) {
  if (isFn)
    handler.call(self, arg1, arg2, arg3);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2, arg3);
  }
}

function emitMany(handler, isFn, self, args) {
  if (isFn)
    handler.apply(self, args);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].apply(self, args);
  }
}

EventEmitter.prototype.emit = function emit(type) {
  var er, handler, len, args, i, events;
  var doError = (type === 'error');

  events = this._events;
  if (events)
    doError = (doError && events.error == null);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    if (arguments.length > 1)
      er = arguments[1];
    if (er instanceof Error) {
      throw er; // Unhandled 'error' event
    } else {
      // At least give some kind of context to the user
      var err = new Error('Unhandled "error" event. (' + er + ')');
      err.context = er;
      throw err;
    }
    return false;
  }

  handler = events[type];

  if (!handler)
    return false;

  var isFn = typeof handler === 'function';
  len = arguments.length;
  switch (len) {
      // fast cases
    case 1:
      emitNone(handler, isFn, this);
      break;
    case 2:
      emitOne(handler, isFn, this, arguments[1]);
      break;
    case 3:
      emitTwo(handler, isFn, this, arguments[1], arguments[2]);
      break;
    case 4:
      emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
      break;
      // slower
    default:
      args = new Array(len - 1);
      for (i = 1; i < len; i++)
        args[i - 1] = arguments[i];
      emitMany(handler, isFn, this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');

  events = target._events;
  if (!events) {
    events = target._events = objectCreate(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener) {
      target.emit('newListener', type,
          listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (!existing) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
          prepend ? [listener, existing] : [existing, listener];
    } else {
      // If we've already got an array, just append.
      if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
    }

    // Check for listener leak
    if (!existing.warned) {
      m = $getMaxListeners(target);
      if (m && m > 0 && existing.length > m) {
        existing.warned = true;
        var w = new Error('Possible EventEmitter memory leak detected. ' +
            existing.length + ' "' + String(type) + '" listeners ' +
            'added. Use emitter.setMaxListeners() to ' +
            'increase limit.');
        w.name = 'MaxListenersExceededWarning';
        w.emitter = target;
        w.type = type;
        w.count = existing.length;
        if (typeof console === 'object' && console.warn) {
          console.warn('%s: %s', w.name, w.message);
        }
      }
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    switch (arguments.length) {
      case 0:
        return this.listener.call(this.target);
      case 1:
        return this.listener.call(this.target, arguments[0]);
      case 2:
        return this.listener.call(this.target, arguments[0], arguments[1]);
      case 3:
        return this.listener.call(this.target, arguments[0], arguments[1],
            arguments[2]);
      default:
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; ++i)
          args[i] = arguments[i];
        this.listener.apply(this.target, args);
    }
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = bind.call(onceWrapper, state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');

      events = this._events;
      if (!events)
        return this;

      list = events[type];
      if (!list)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = objectCreate(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else
          spliceOne(list, position);

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (!events)
        return this;

      // not listening for removeListener, no need to emit
      if (!events.removeListener) {
        if (arguments.length === 0) {
          this._events = objectCreate(null);
          this._eventsCount = 0;
        } else if (events[type]) {
          if (--this._eventsCount === 0)
            this._events = objectCreate(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = objectKeys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = objectCreate(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (!events)
    return [];

  var evlistener = events[type];
  if (!evlistener)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

// About 1.5x faster than the two-arg version of Array#splice().
function spliceOne(list, index) {
  for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
    list[i] = list[k];
  list.pop();
}

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function objectCreatePolyfill(proto) {
  var F = function() {};
  F.prototype = proto;
  return new F;
}
function objectKeysPolyfill(obj) {
  var keys = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) {
    keys.push(k);
  }
  return k;
}
function functionBindPolyfill(context) {
  var fn = this;
  return function () {
    return fn.apply(context, arguments);
  };
}

},{}],4:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var VASTAd;

  VASTAd = (function() {
    function VASTAd() {
      this.id = null;
      this.errorURLTemplates = [];
      this.impressionURLTemplates = [];
      this.creatives = [];
    }

    return VASTAd;

  })();

  module.exports = VASTAd;

}).call(this);

},{}],5:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var VASTClient, VASTParser, VASTUtil;

  VASTParser = require('./parser');

  VASTUtil = require('./util');

  VASTClient = (function() {
    function VASTClient() {}

    VASTClient.cappingFreeLunch = 0;

    VASTClient.cappingMinimumTimeInterval = 0;

    VASTClient.options = {
      withCredentials: false,
      timeout: 0
    };

    VASTClient.get = function(url, opts, cb) {
      var extend, now, options;
      now = +new Date();
      extend = exports.extend = function(object, properties) {
        var key, val;
        for (key in properties) {
          val = properties[key];
          object[key] = val;
        }
        return object;
      };
      if (!cb) {
        if (typeof opts === 'function') {
          cb = opts;
        }
        options = {};
      }
      options = extend(this.options, opts);
      if (this.totalCallsTimeout < now) {
        this.totalCalls = 1;
        this.totalCallsTimeout = now + (60 * 60 * 1000);
      } else {
        this.totalCalls++;
      }
      if (this.cappingFreeLunch >= this.totalCalls) {
        cb(null);
        return;
      }
      if (now - this.lastSuccessfullAd < this.cappingMinimumTimeInterval) {
        cb(null);
        return;
      }
      return VASTParser.parse(url, options, (function(_this) {
        return function(response) {
          return cb(response);
        };
      })(this));
    };

    (function() {
      var defineProperty, storage;
      storage = VASTUtil.storage;
      defineProperty = Object.defineProperty;
      ['lastSuccessfullAd', 'totalCalls', 'totalCallsTimeout'].forEach(function(property) {
        defineProperty(VASTClient, property, {
          get: function() {
            return storage.getItem(property);
          },
          set: function(value) {
            return storage.setItem(property, value);
          },
          configurable: false,
          enumerable: true
        });
      });
      if (VASTClient.totalCalls == null) {
        VASTClient.totalCalls = 0;
      }
      if (VASTClient.totalCallsTimeout == null) {
        VASTClient.totalCallsTimeout = 0;
      }
    })();

    return VASTClient;

  })();

  module.exports = VASTClient;

}).call(this);

},{"./parser":10,"./util":16}],6:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var VASTCompanionAd;

  VASTCompanionAd = (function() {
    function VASTCompanionAd() {
      this.id = null;
      this.width = 0;
      this.height = 0;
      this.type = null;
      this.staticResource = null;
      this.htmlResource = null;
      this.iframeResource = null;
      this.companionClickThroughURLTemplate = null;
      this.trackingEvents = {};
    }

    return VASTCompanionAd;

  })();

  module.exports = VASTCompanionAd;

}).call(this);

},{}],7:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var VASTCreative, VASTCreativeCompanion, VASTCreativeLinear, VASTCreativeNonLinear,
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  VASTCreative = (function() {
    function VASTCreative() {
      this.trackingEvents = {};
    }

    return VASTCreative;

  })();

  VASTCreativeLinear = (function(_super) {
    __extends(VASTCreativeLinear, _super);

    function VASTCreativeLinear() {
      VASTCreativeLinear.__super__.constructor.apply(this, arguments);
      this.type = "linear";
      this.duration = 0;
      this.skipDelay = null;
      this.mediaFiles = [];
      this.videoClickThroughURLTemplate = null;
      this.videoClickTrackingURLTemplates = [];
      this.videoCustomClickURLTemplates = [];
      this.adParameters = null;
    }

    return VASTCreativeLinear;

  })(VASTCreative);

  VASTCreativeNonLinear = (function(_super) {
    __extends(VASTCreativeNonLinear, _super);

    function VASTCreativeNonLinear() {
      return VASTCreativeNonLinear.__super__.constructor.apply(this, arguments);
    }

    return VASTCreativeNonLinear;

  })(VASTCreative);

  VASTCreativeCompanion = (function(_super) {
    __extends(VASTCreativeCompanion, _super);

    function VASTCreativeCompanion() {
      this.type = "companion";
      this.variations = [];
      this.videoClickTrackingURLTemplates = [];
    }

    return VASTCreativeCompanion;

  })(VASTCreative);

  module.exports = {
    VASTCreativeLinear: VASTCreativeLinear,
    VASTCreativeNonLinear: VASTCreativeNonLinear,
    VASTCreativeCompanion: VASTCreativeCompanion
  };

}).call(this);

},{}],8:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  module.exports = {
    client: require('./client'),
    tracker: require('./tracker'),
    parser: require('./parser'),
    util: require('./util')
  };

}).call(this);

},{"./client":5,"./parser":10,"./tracker":12,"./util":16}],9:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var VASTMediaFile;

  VASTMediaFile = (function() {
    function VASTMediaFile() {
      this.id = null;
      this.fileURL = null;
      this.deliveryType = "progressive";
      this.mimeType = null;
      this.codec = null;
      this.bitrate = 0;
      this.minBitrate = 0;
      this.maxBitrate = 0;
      this.width = 0;
      this.height = 0;
      this.apiFramework = null;
      this.scalable = null;
      this.maintainAspectRatio = null;
    }

    return VASTMediaFile;

  })();

  module.exports = VASTMediaFile;

}).call(this);

},{}],10:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var EventEmitter, URLHandler, VASTAd, VASTCompanionAd, VASTCreativeCompanion, VASTCreativeLinear, VASTMediaFile, VASTParser, VASTResponse, VASTUtil,
    __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  URLHandler = require('./urlhandler');

  VASTResponse = require('./response');

  VASTAd = require('./ad');

  VASTUtil = require('./util');

  VASTCreativeLinear = require('./creative').VASTCreativeLinear;

  VASTCreativeCompanion = require('./creative').VASTCreativeCompanion;

  VASTMediaFile = require('./mediafile');

  VASTCompanionAd = require('./companionad');

  EventEmitter = require('events').EventEmitter;

  VASTParser = (function() {
    var URLTemplateFilters;

    function VASTParser() {}

    URLTemplateFilters = [];

    VASTParser.addURLTemplateFilter = function(func) {
      if (typeof func === 'function') {
        URLTemplateFilters.push(func);
      }
    };

    VASTParser.removeURLTemplateFilter = function() {
      return URLTemplateFilters.pop();
    };

    VASTParser.countURLTemplateFilters = function() {
      return URLTemplateFilters.length;
    };

    VASTParser.clearUrlTemplateFilters = function() {
      return URLTemplateFilters = [];
    };

    VASTParser.parse = function(url, options, cb) {
      if (!cb) {
        if (typeof options === 'function') {
          cb = options;
        }
        options = {};
      }
      return this._parse(url, null, options, function(err, response) {
        return cb(response);
      });
    };

    VASTParser.vent = new EventEmitter();

    VASTParser.track = function(templates, errorCode) {
      this.vent.emit('VAST-error', errorCode);
      return VASTUtil.track(templates, errorCode);
    };

    VASTParser.on = function(eventName, cb) {
      return this.vent.on(eventName, cb);
    };

    VASTParser.once = function(eventName, cb) {
      return this.vent.once(eventName, cb);
    };

    VASTParser._parse = function(url, parentURLs, options, cb) {
      var filter, _i, _len;
      if (!cb) {
        if (typeof options === 'function') {
          cb = options;
        }
        options = {};
      }
      for (_i = 0, _len = URLTemplateFilters.length; _i < _len; _i++) {
        filter = URLTemplateFilters[_i];
        url = filter(url);
      }
      if (parentURLs == null) {
        parentURLs = [];
      }
      parentURLs.push(url);
      return URLHandler.get(url, options, (function(_this) {
        return function(err, xml) {
          var ad, complete, loopIndex, node, response, _j, _k, _len1, _len2, _ref, _ref1;
          if (err != null) {
            return cb(err);
          }
          response = new VASTResponse();
          if (!(((xml != null ? xml.documentElement : void 0) != null) && xml.documentElement.nodeName === "VAST")) {
            return cb();
          }
          _ref = xml.documentElement.childNodes;
          for (_j = 0, _len1 = _ref.length; _j < _len1; _j++) {
            node = _ref[_j];
            if (node.nodeName === 'Error') {
              response.errorURLTemplates.push(_this.parseNodeText(node));
            }
          }
          _ref1 = xml.documentElement.childNodes;
          for (_k = 0, _len2 = _ref1.length; _k < _len2; _k++) {
            node = _ref1[_k];
            if (node.nodeName === 'Ad') {
              ad = _this.parseAdElement(node);
              if (ad != null) {
                response.ads.push(ad);
              } else {
                _this.track(response.errorURLTemplates, {
                  ERRORCODE: 101
                });
              }
            }
          }
          complete = function(errorAlreadyRaised) {
            var _l, _len3, _ref2;
            if (errorAlreadyRaised == null) {
              errorAlreadyRaised = false;
            }
            if (!response) {
              return;
            }
            _ref2 = response.ads;
            for (_l = 0, _len3 = _ref2.length; _l < _len3; _l++) {
              ad = _ref2[_l];
              if (ad.nextWrapperURL != null) {
                return;
              }
            }
            if (response.ads.length === 0) {
              if (!errorAlreadyRaised) {
                _this.track(response.errorURLTemplates, {
                  ERRORCODE: 303
                });
              }
              response = null;
            }
            return cb(null, response);
          };
          loopIndex = response.ads.length;
          while (loopIndex--) {
            ad = response.ads[loopIndex];
            if (ad.nextWrapperURL == null) {
              continue;
            }
            (function(ad) {
              var baseURL, protocol, _ref2;
              if (parentURLs.length >= 10 || (_ref2 = ad.nextWrapperURL, __indexOf.call(parentURLs, _ref2) >= 0)) {
                _this.track(ad.errorURLTemplates, {
                  ERRORCODE: 302
                });
                response.ads.splice(response.ads.indexOf(ad), 1);
                complete();
                return;
              }
              if (ad.nextWrapperURL.indexOf('//') === 0) {
                protocol = location.protocol;
                ad.nextWrapperURL = "" + protocol + ad.nextWrapperURL;
              } else if (ad.nextWrapperURL.indexOf('://') === -1) {
                baseURL = url.slice(0, url.lastIndexOf('/'));
                ad.nextWrapperURL = "" + baseURL + "/" + ad.nextWrapperURL;
              }
              return _this._parse(ad.nextWrapperURL, parentURLs, options, function(err, wrappedResponse) {
                var creative, errorAlreadyRaised, eventName, index, wrappedAd, _base, _l, _len3, _len4, _len5, _len6, _m, _n, _o, _ref3, _ref4, _ref5, _ref6;
                errorAlreadyRaised = false;
                if (err != null) {
                  _this.track(ad.errorURLTemplates, {
                    ERRORCODE: 301
                  });
                  response.ads.splice(response.ads.indexOf(ad), 1);
                  errorAlreadyRaised = true;
                } else if (wrappedResponse == null) {
                  _this.track(ad.errorURLTemplates, {
                    ERRORCODE: 303
                  });
                  response.ads.splice(response.ads.indexOf(ad), 1);
                  errorAlreadyRaised = true;
                } else {
                  response.errorURLTemplates = response.errorURLTemplates.concat(wrappedResponse.errorURLTemplates);
                  index = response.ads.indexOf(ad);
                  response.ads.splice(index, 1);
                  _ref3 = wrappedResponse.ads;
                  for (_l = 0, _len3 = _ref3.length; _l < _len3; _l++) {
                    wrappedAd = _ref3[_l];
                    wrappedAd.errorURLTemplates = ad.errorURLTemplates.concat(wrappedAd.errorURLTemplates);
                    wrappedAd.impressionURLTemplates = ad.impressionURLTemplates.concat(wrappedAd.impressionURLTemplates);
                    if (ad.trackingEvents != null) {
                      _ref4 = wrappedAd.creatives;
                      for (_m = 0, _len4 = _ref4.length; _m < _len4; _m++) {
                        creative = _ref4[_m];
                        if (creative.type === 'linear') {
                          _ref5 = Object.keys(ad.trackingEvents);
                          for (_n = 0, _len5 = _ref5.length; _n < _len5; _n++) {
                            eventName = _ref5[_n];
                            (_base = creative.trackingEvents)[eventName] || (_base[eventName] = []);
                            creative.trackingEvents[eventName] = creative.trackingEvents[eventName].concat(ad.trackingEvents[eventName]);
                          }
                        }
                      }
                    }
                    if (ad.videoClickTrackingURLTemplates != null) {
                      _ref6 = wrappedAd.creatives;
                      for (_o = 0, _len6 = _ref6.length; _o < _len6; _o++) {
                        creative = _ref6[_o];
                        if (creative.type === 'linear') {
                          creative.videoClickTrackingURLTemplates = creative.videoClickTrackingURLTemplates.concat(ad.videoClickTrackingURLTemplates);
                        }
                      }
                    }
                    response.ads.splice(index, 0, wrappedAd);
                  }
                }
                delete ad.nextWrapperURL;
                return complete(errorAlreadyRaised);
              });
            })(ad);
          }
          return complete();
        };
      })(this));
    };

    VASTParser.childByName = function(node, name) {
      var child, _i, _len, _ref;
      _ref = node.childNodes;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        child = _ref[_i];
        if (child.nodeName === name) {
          return child;
        }
      }
    };

    VASTParser.childsByName = function(node, name) {
      var child, childs, _i, _len, _ref;
      childs = [];
      _ref = node.childNodes;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        child = _ref[_i];
        if (child.nodeName === name) {
          childs.push(child);
        }
      }
      return childs;
    };

    VASTParser.parseAdElement = function(adElement) {
      var adTypeElement, _i, _len, _ref;
      _ref = adElement.childNodes;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        adTypeElement = _ref[_i];
        adTypeElement.id = adElement.getAttribute("id");
        if (adTypeElement.nodeName === "Wrapper") {
          return this.parseWrapperElement(adTypeElement);
        } else if (adTypeElement.nodeName === "InLine") {
          return this.parseInLineElement(adTypeElement);
        }
      }
    };

    VASTParser.parseWrapperElement = function(wrapperElement) {
      var ad, creative, wrapperCreativeElement, wrapperURLElement, _i, _len, _ref;
      ad = this.parseInLineElement(wrapperElement);
      wrapperURLElement = this.childByName(wrapperElement, "VASTAdTagURI");
      if (wrapperURLElement != null) {
        ad.nextWrapperURL = this.parseNodeText(wrapperURLElement);
      } else {
        wrapperURLElement = this.childByName(wrapperElement, "VASTAdTagURL");
        if (wrapperURLElement != null) {
          ad.nextWrapperURL = this.parseNodeText(this.childByName(wrapperURLElement, "URL"));
        }
      }
      wrapperCreativeElement = null;
      _ref = ad.creatives;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        creative = _ref[_i];
        if (creative.type === 'linear') {
          wrapperCreativeElement = creative;
          break;
        }
      }
      if (wrapperCreativeElement != null) {
        if (wrapperCreativeElement.trackingEvents != null) {
          ad.trackingEvents = wrapperCreativeElement.trackingEvents;
        }
        if (wrapperCreativeElement.videoClickTrackingURLTemplates != null) {
          ad.videoClickTrackingURLTemplates = wrapperCreativeElement.videoClickTrackingURLTemplates;
        }
      }
      if (ad.nextWrapperURL != null) {
        return ad;
      }
    };

    VASTParser.parseInLineElement = function(inLineElement) {
      var ad, creative, creativeElement, creativeTypeElement, node, _i, _j, _k, _len, _len1, _len2, _ref, _ref1, _ref2;
      ad = new VASTAd();
      ad.id = inLineElement.id;
      _ref = inLineElement.childNodes;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        node = _ref[_i];
        switch (node.nodeName) {
          case "Error":
            ad.errorURLTemplates.push(this.parseNodeText(node));
            break;
          case "Impression":
            ad.impressionURLTemplates.push(this.parseNodeText(node));
            break;
          case "Creatives":
            _ref1 = this.childsByName(node, "Creative");
            for (_j = 0, _len1 = _ref1.length; _j < _len1; _j++) {
              creativeElement = _ref1[_j];
              _ref2 = creativeElement.childNodes;
              for (_k = 0, _len2 = _ref2.length; _k < _len2; _k++) {
                creativeTypeElement = _ref2[_k];
                switch (creativeTypeElement.nodeName) {
                  case "Linear":
                    creative = this.parseCreativeLinearElement(creativeTypeElement);
                    if (creative) {
                      ad.creatives.push(creative);
                    }
                    break;
                  case "CompanionAds":
                    creative = this.parseCompanionAd(creativeTypeElement);
                    if (creative) {
                      ad.creatives.push(creative);
                    }
                }
              }
            }
        }
      }
      return ad;
    };

    VASTParser.parseCreativeLinearElement = function(creativeElement) {
      var adParamsElement, clickTrackingElement, creative, customClickElement, eventName, maintainAspectRatio, mediaFile, mediaFileElement, mediaFilesElement, offset, percent, scalable, skipOffset, trackingElement, trackingEventsElement, trackingURLTemplate, videoClicksElement, _base, _i, _j, _k, _l, _len, _len1, _len2, _len3, _len4, _len5, _m, _n, _ref, _ref1, _ref2, _ref3, _ref4, _ref5;
      creative = new VASTCreativeLinear();
      creative.duration = this.parseDuration(this.parseNodeText(this.childByName(creativeElement, "Duration")));
      if (creative.duration === -1 && creativeElement.parentNode.parentNode.parentNode.nodeName !== 'Wrapper') {
        return null;
      }
      skipOffset = creativeElement.getAttribute("skipoffset");
      if (skipOffset == null) {
        creative.skipDelay = null;
      } else if (skipOffset.charAt(skipOffset.length - 1) === "%") {
        percent = parseInt(skipOffset, 10);
        creative.skipDelay = creative.duration * (percent / 100);
      } else {
        creative.skipDelay = this.parseDuration(skipOffset);
      }
      videoClicksElement = this.childByName(creativeElement, "VideoClicks");
      if (videoClicksElement != null) {
        creative.videoClickThroughURLTemplate = this.parseNodeText(this.childByName(videoClicksElement, "ClickThrough"));
        _ref = this.childsByName(videoClicksElement, "ClickTracking");
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          clickTrackingElement = _ref[_i];
          creative.videoClickTrackingURLTemplates.push(this.parseNodeText(clickTrackingElement));
        }
        _ref1 = this.childsByName(videoClicksElement, "CustomClick");
        for (_j = 0, _len1 = _ref1.length; _j < _len1; _j++) {
          customClickElement = _ref1[_j];
          creative.videoCustomClickURLTemplates.push(this.parseNodeText(customClickElement));
        }
      }
      adParamsElement = this.childByName(creativeElement, "AdParameters");
      if (adParamsElement != null) {
        creative.adParameters = this.parseNodeText(adParamsElement);
      }
      _ref2 = this.childsByName(creativeElement, "TrackingEvents");
      for (_k = 0, _len2 = _ref2.length; _k < _len2; _k++) {
        trackingEventsElement = _ref2[_k];
        _ref3 = this.childsByName(trackingEventsElement, "Tracking");
        for (_l = 0, _len3 = _ref3.length; _l < _len3; _l++) {
          trackingElement = _ref3[_l];
          eventName = trackingElement.getAttribute("event");
          trackingURLTemplate = this.parseNodeText(trackingElement);
          if ((eventName != null) && (trackingURLTemplate != null)) {
            if (eventName === "progress") {
              offset = trackingElement.getAttribute("offset");
              if (!offset) {
                continue;
              }
              if (offset.charAt(offset.length - 1) === '%') {
                eventName = "progress-" + offset;
              } else {
                eventName = "progress-" + (Math.round(this.parseDuration(offset)));
              }
            }
            if ((_base = creative.trackingEvents)[eventName] == null) {
              _base[eventName] = [];
            }
            creative.trackingEvents[eventName].push(trackingURLTemplate);
          }
        }
      }
      _ref4 = this.childsByName(creativeElement, "MediaFiles");
      for (_m = 0, _len4 = _ref4.length; _m < _len4; _m++) {
        mediaFilesElement = _ref4[_m];
        _ref5 = this.childsByName(mediaFilesElement, "MediaFile");
        for (_n = 0, _len5 = _ref5.length; _n < _len5; _n++) {
          mediaFileElement = _ref5[_n];
          mediaFile = new VASTMediaFile();
          mediaFile.id = mediaFileElement.getAttribute("id");
          mediaFile.fileURL = this.parseNodeText(mediaFileElement);
          mediaFile.deliveryType = mediaFileElement.getAttribute("delivery");
          mediaFile.codec = mediaFileElement.getAttribute("codec");
          mediaFile.mimeType = mediaFileElement.getAttribute("type");
          mediaFile.apiFramework = mediaFileElement.getAttribute("apiFramework");
          mediaFile.bitrate = parseInt(mediaFileElement.getAttribute("bitrate") || 0);
          mediaFile.minBitrate = parseInt(mediaFileElement.getAttribute("minBitrate") || 0);
          mediaFile.maxBitrate = parseInt(mediaFileElement.getAttribute("maxBitrate") || 0);
          mediaFile.width = parseInt(mediaFileElement.getAttribute("width") || 0);
          mediaFile.height = parseInt(mediaFileElement.getAttribute("height") || 0);
          scalable = mediaFileElement.getAttribute("scalable");
          if (scalable && typeof scalable === "string") {
            scalable = scalable.toLowerCase();
            if (scalable === "true") {
              mediaFile.scalable = true;
            } else if (scalable === "false") {
              mediaFile.scalable = false;
            }
          }
          maintainAspectRatio = mediaFileElement.getAttribute("maintainAspectRatio");
          if (maintainAspectRatio && typeof maintainAspectRatio === "string") {
            maintainAspectRatio = maintainAspectRatio.toLowerCase();
            if (maintainAspectRatio === "true") {
              mediaFile.maintainAspectRatio = true;
            } else if (maintainAspectRatio === "false") {
              mediaFile.maintainAspectRatio = false;
            }
          }
          creative.mediaFiles.push(mediaFile);
        }
      }
      return creative;
    };

    VASTParser.parseCompanionAd = function(creativeElement) {
      var companionAd, companionResource, creative, eventName, htmlElement, iframeElement, staticElement, trackingElement, trackingEventsElement, trackingURLTemplate, _base, _i, _j, _k, _l, _len, _len1, _len2, _len3, _len4, _len5, _m, _n, _ref, _ref1, _ref2, _ref3, _ref4, _ref5;
      creative = new VASTCreativeCompanion();
      _ref = this.childsByName(creativeElement, "Companion");
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        companionResource = _ref[_i];
        companionAd = new VASTCompanionAd();
        companionAd.id = companionResource.getAttribute("id") || null;
        companionAd.width = companionResource.getAttribute("width");
        companionAd.height = companionResource.getAttribute("height");
        _ref1 = this.childsByName(companionResource, "HTMLResource");
        for (_j = 0, _len1 = _ref1.length; _j < _len1; _j++) {
          htmlElement = _ref1[_j];
          companionAd.type = htmlElement.getAttribute("creativeType") || 'text/html';
          companionAd.htmlResource = this.parseNodeText(htmlElement);
        }
        _ref2 = this.childsByName(companionResource, "IFrameResource");
        for (_k = 0, _len2 = _ref2.length; _k < _len2; _k++) {
          iframeElement = _ref2[_k];
          companionAd.type = iframeElement.getAttribute("creativeType") || 0;
          companionAd.iframeResource = this.parseNodeText(iframeElement);
        }
        _ref3 = this.childsByName(companionResource, "StaticResource");
        for (_l = 0, _len3 = _ref3.length; _l < _len3; _l++) {
          staticElement = _ref3[_l];
          companionAd.type = staticElement.getAttribute("creativeType") || 0;
          companionAd.staticResource = this.parseNodeText(staticElement);
        }
        _ref4 = this.childsByName(companionResource, "TrackingEvents");
        for (_m = 0, _len4 = _ref4.length; _m < _len4; _m++) {
          trackingEventsElement = _ref4[_m];
          _ref5 = this.childsByName(trackingEventsElement, "Tracking");
          for (_n = 0, _len5 = _ref5.length; _n < _len5; _n++) {
            trackingElement = _ref5[_n];
            eventName = trackingElement.getAttribute("event");
            trackingURLTemplate = this.parseNodeText(trackingElement);
            if ((eventName != null) && (trackingURLTemplate != null)) {
              if ((_base = companionAd.trackingEvents)[eventName] == null) {
                _base[eventName] = [];
              }
              companionAd.trackingEvents[eventName].push(trackingURLTemplate);
            }
          }
        }
        companionAd.companionClickThroughURLTemplate = this.parseNodeText(this.childByName(companionResource, "CompanionClickThrough"));
        creative.variations.push(companionAd);
      }
      return creative;
    };

    VASTParser.parseDuration = function(durationString) {
      var durationComponents, hours, minutes, seconds, secondsAndMS;
      if (!(durationString != null)) {
        return -1;
      }
      durationComponents = durationString.split(":");
      if (durationComponents.length !== 3) {
        return -1;
      }
      secondsAndMS = durationComponents[2].split(".");
      seconds = parseInt(secondsAndMS[0]);
      if (secondsAndMS.length === 2) {
        seconds += parseFloat("0." + secondsAndMS[1]);
      }
      minutes = parseInt(durationComponents[1] * 60);
      hours = parseInt(durationComponents[0] * 60 * 60);
      if (isNaN(hours || isNaN(minutes || isNaN(seconds || minutes > 60 * 60 || seconds > 60)))) {
        return -1;
      }
      return hours + minutes + seconds;
    };

    VASTParser.parseNodeText = function(node) {
      return node && (node.textContent || node.text || '').trim();
    };

    return VASTParser;

  })();

  module.exports = VASTParser;

}).call(this);

},{"./ad":4,"./companionad":6,"./creative":7,"./mediafile":9,"./response":11,"./urlhandler":13,"./util":16,"events":3}],11:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var VASTResponse;

  VASTResponse = (function() {
    function VASTResponse() {
      this.ads = [];
      this.errorURLTemplates = [];
    }

    return VASTResponse;

  })();

  module.exports = VASTResponse;

}).call(this);

},{}],12:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var EventEmitter, VASTClient, VASTCreativeLinear, VASTTracker, VASTUtil,
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  VASTClient = require('./client');

  VASTUtil = require('./util');

  VASTCreativeLinear = require('./creative').VASTCreativeLinear;

  EventEmitter = require('events').EventEmitter;

  VASTTracker = (function(_super) {
    __extends(VASTTracker, _super);

    function VASTTracker(ad, creative) {
      var eventName, events, _ref;
      this.ad = ad;
      this.creative = creative;
      this.muted = false;
      this.impressed = false;
      this.skipable = false;
      this.skipDelayDefault = -1;
      this.trackingEvents = {};
      this.emitAlwaysEvents = ['creativeView', 'start', 'firstQuartile', 'midpoint', 'thirdQuartile', 'complete', 'resume', 'pause', 'rewind', 'skip', 'closeLinear', 'close'];
      _ref = this.creative.trackingEvents;
      for (eventName in _ref) {
        events = _ref[eventName];
        this.trackingEvents[eventName] = events.slice(0);
      }
      if (this.creative instanceof VASTCreativeLinear) {
        this.setDuration(this.creative.duration);
        this.skipDelay = this.creative.skipDelay;
        this.linear = true;
        this.clickThroughURLTemplate = this.creative.videoClickThroughURLTemplate;
        this.clickTrackingURLTemplates = this.creative.videoClickTrackingURLTemplates;
      } else {
        this.skipDelay = -1;
        this.linear = false;
      }
      this.on('start', function() {
        VASTClient.lastSuccessfullAd = +new Date();
      });
    }

    VASTTracker.prototype.setDuration = function(duration) {
      this.assetDuration = duration;
      return this.quartiles = {
        'firstQuartile': Math.round(25 * this.assetDuration) / 100,
        'midpoint': Math.round(50 * this.assetDuration) / 100,
        'thirdQuartile': Math.round(75 * this.assetDuration) / 100
      };
    };

    VASTTracker.prototype.setProgress = function(progress) {
      var eventName, events, percent, quartile, skipDelay, time, _i, _len, _ref;
      skipDelay = this.skipDelay === null ? this.skipDelayDefault : this.skipDelay;
      if (skipDelay !== -1 && !this.skipable) {
        if (skipDelay > progress) {
          this.emit('skip-countdown', skipDelay - progress);
        } else {
          this.skipable = true;
          this.emit('skip-countdown', 0);
        }
      }
      if (this.linear && this.assetDuration > 0) {
        events = [];
        if (progress > 0) {
          events.push("start");
          percent = Math.round(progress / this.assetDuration * 100);
          events.push("progress-" + percent + "%");
          events.push("progress-" + (Math.round(progress)));
          _ref = this.quartiles;
          for (quartile in _ref) {
            time = _ref[quartile];
            if ((time <= progress && progress <= (time + 1))) {
              events.push(quartile);
            }
          }
        }
        for (_i = 0, _len = events.length; _i < _len; _i++) {
          eventName = events[_i];
          this.track(eventName, true);
        }
        if (progress < this.progress) {
          this.track("rewind");
        }
      }
      return this.progress = progress;
    };

    VASTTracker.prototype.setMuted = function(muted) {
      if (this.muted !== muted) {
        this.track(muted ? "mute" : "unmute");
      }
      return this.muted = muted;
    };

    VASTTracker.prototype.setPaused = function(paused) {
      if (this.paused !== paused) {
        this.track(paused ? "pause" : "resume");
      }
      return this.paused = paused;
    };

    VASTTracker.prototype.setFullscreen = function(fullscreen) {
      if (this.fullscreen !== fullscreen) {
        this.track(fullscreen ? "fullscreen" : "exitFullscreen");
      }
      return this.fullscreen = fullscreen;
    };

    VASTTracker.prototype.setSkipDelay = function(duration) {
      if (typeof duration === 'number') {
        return this.skipDelay = duration;
      }
    };

    VASTTracker.prototype.load = function() {
      if (!this.impressed) {
        this.impressed = true;
        this.trackURLs(this.ad.impressionURLTemplates);
        return this.track("creativeView");
      }
    };

    VASTTracker.prototype.errorWithCode = function(errorCode) {
      return this.trackURLs(this.ad.errorURLTemplates, {
        ERRORCODE: errorCode
      });
    };

    VASTTracker.prototype.complete = function() {
      return this.track("complete");
    };

    VASTTracker.prototype.close = function() {
      return this.track(this.linear ? "closeLinear" : "close");
    };

    VASTTracker.prototype.stop = function() {};

    VASTTracker.prototype.skip = function() {
      this.track("skip");
      return this.trackingEvents = [];
    };

    VASTTracker.prototype.click = function() {
      var clickThroughURL, variables, _ref;
      if ((_ref = this.clickTrackingURLTemplates) != null ? _ref.length : void 0) {
        this.trackURLs(this.clickTrackingURLTemplates);
      }
      if (this.clickThroughURLTemplate != null) {
        if (this.linear) {
          variables = {
            CONTENTPLAYHEAD: this.progressFormated()
          };
        }
        clickThroughURL = VASTUtil.resolveURLTemplates([this.clickThroughURLTemplate], variables)[0];
        return this.emit("clickthrough", clickThroughURL);
      }
    };

    VASTTracker.prototype.track = function(eventName, once) {
      var idx, trackingURLTemplates;
      if (once == null) {
        once = false;
      }
      if (eventName === 'closeLinear' && ((this.trackingEvents[eventName] == null) && (this.trackingEvents['close'] != null))) {
        eventName = 'close';
      }
      trackingURLTemplates = this.trackingEvents[eventName];
      idx = this.emitAlwaysEvents.indexOf(eventName);
      if (trackingURLTemplates != null) {
        this.emit(eventName, '');
        this.trackURLs(trackingURLTemplates);
      } else if (idx !== -1) {
        this.emit(eventName, '');
      }
      if (once === true) {
        delete this.trackingEvents[eventName];
        if (idx > -1) {
          this.emitAlwaysEvents.splice(idx, 1);
        }
      }
    };

    VASTTracker.prototype.trackURLs = function(URLTemplates, variables) {
      if (variables == null) {
        variables = {};
      }
      if (this.linear) {
        variables["CONTENTPLAYHEAD"] = this.progressFormated();
      }
      return VASTUtil.track(URLTemplates, variables);
    };

    VASTTracker.prototype.progressFormated = function() {
      var h, m, ms, s, seconds;
      seconds = parseInt(this.progress);
      h = seconds / (60 * 60);
      if (h.length < 2) {
        h = "0" + h;
      }
      m = seconds / 60 % 60;
      if (m.length < 2) {
        m = "0" + m;
      }
      s = seconds % 60;
      if (s.length < 2) {
        s = "0" + m;
      }
      ms = parseInt((this.progress - seconds) * 100);
      return "" + h + ":" + m + ":" + s + "." + ms;
    };

    return VASTTracker;

  })(EventEmitter);

  module.exports = VASTTracker;

}).call(this);

},{"./client":5,"./creative":7,"./util":16,"events":3}],13:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var URLHandler, flash, xhr;

  xhr = require('./urlhandlers/xmlhttprequest');

  flash = require('./urlhandlers/flash');

  URLHandler = (function() {
    function URLHandler() {}

    URLHandler.get = function(url, options, cb) {
      if (!cb) {
        if (typeof options === 'function') {
          cb = options;
        }
        options = {};
      }
      if (options.urlhandler && options.urlhandler.supported()) {
        return options.urlhandler.get(url, options, cb);
      } else if (typeof window === "undefined" || window === null) {
        return require('./urlhandlers/' + 'node').get(url, options, cb);
      } else if (xhr.supported()) {
        return xhr.get(url, options, cb);
      } else if (flash.supported()) {
        return flash.get(url, options, cb);
      } else {
        return cb();
      }
    };

    return URLHandler;

  })();

  module.exports = URLHandler;

}).call(this);

},{"./urlhandlers/flash":14,"./urlhandlers/xmlhttprequest":15}],14:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var FlashURLHandler;

  FlashURLHandler = (function() {
    function FlashURLHandler() {}

    FlashURLHandler.xdr = function() {
      var xdr;
      if (window.XDomainRequest) {
        xdr = new XDomainRequest();
      }
      return xdr;
    };

    FlashURLHandler.supported = function() {
      return !!this.xdr();
    };

    FlashURLHandler.get = function(url, options, cb) {
      var xdr, xmlDocument;
      if (xmlDocument = typeof window.ActiveXObject === "function" ? new window.ActiveXObject("Microsoft.XMLDOM") : void 0) {
        xmlDocument.async = false;
      } else {
        return cb();
      }
      xdr = this.xdr();
      xdr.open('GET', url);
      xdr.timeout = options.timeout || 0;
      xdr.withCredentials = options.withCredentials || false;
      xdr.send();
      xdr.onprogress = function() {};
      return xdr.onload = function() {
        xmlDocument.loadXML(xdr.responseText);
        return cb(null, xmlDocument);
      };
    };

    return FlashURLHandler;

  })();

  module.exports = FlashURLHandler;

}).call(this);

},{}],15:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var XHRURLHandler;

  XHRURLHandler = (function() {
    function XHRURLHandler() {}

    XHRURLHandler.xhr = function() {
      var xhr;
      xhr = new window.XMLHttpRequest();
      if ('withCredentials' in xhr) {
        return xhr;
      }
    };

    XHRURLHandler.supported = function() {
      return !!this.xhr();
    };

    XHRURLHandler.get = function(url, options, cb) {
      var xhr;
      if (window.location.protocol === 'https:' && url.indexOf('http://') === 0) {
        return cb(new Error('Cannot go from HTTPS to HTTP.'));
      }
      try {
        xhr = this.xhr();
        xhr.open('GET', url);
        xhr.timeout = options.timeout || 0;
        xhr.withCredentials = options.withCredentials || false;
        xhr.send();
        return xhr.onreadystatechange = function() {
          if (xhr.readyState === 4) {
            return cb(null, xhr.responseXML);
          }
        };
      } catch (_error) {
        return cb();
      }
    };

    return XHRURLHandler;

  })();

  module.exports = XHRURLHandler;

}).call(this);

},{}],16:[function(require,module,exports){
// Generated by CoffeeScript 1.7.1
(function() {
  var VASTUtil;

  VASTUtil = (function() {
    function VASTUtil() {}

    VASTUtil.track = function(URLTemplates, variables) {
      var URL, URLs, i, _i, _len, _results;
      URLs = this.resolveURLTemplates(URLTemplates, variables);
      _results = [];
      for (_i = 0, _len = URLs.length; _i < _len; _i++) {
        URL = URLs[_i];
        if (typeof window !== "undefined" && window !== null) {
          i = new Image();
          _results.push(i.src = URL);
        } else {

        }
      }
      return _results;
    };

    VASTUtil.resolveURLTemplates = function(URLTemplates, variables) {
      var URLTemplate, URLs, key, macro1, macro2, resolveURL, value, _i, _len;
      URLs = [];
      if (variables == null) {
        variables = {};
      }
      if (!("CACHEBUSTING" in variables)) {
        variables["CACHEBUSTING"] = Math.round(Math.random() * 1.0e+10);
      }
      variables["random"] = variables["CACHEBUSTING"];
      for (_i = 0, _len = URLTemplates.length; _i < _len; _i++) {
        URLTemplate = URLTemplates[_i];
        resolveURL = URLTemplate;
        if (!resolveURL) {
          continue;
        }
        for (key in variables) {
          value = variables[key];
          macro1 = "[" + key + "]";
          macro2 = "%%" + key + "%%";
          resolveURL = resolveURL.replace(macro1, value);
          resolveURL = resolveURL.replace(macro2, value);
        }
        URLs.push(resolveURL);
      }
      return URLs;
    };

    VASTUtil.storage = (function() {
      var data, isDisabled, storage, storageError;
      try {
        storage = typeof window !== "undefined" && window !== null ? window.localStorage || window.sessionStorage : null;
      } catch (_error) {
        storageError = _error;
        storage = null;
      }
      isDisabled = function(store) {
        var e, testValue;
        try {
          testValue = '__VASTUtil__';
          store.setItem(testValue, testValue);
          if (store.getItem(testValue) !== testValue) {
            return true;
          }
        } catch (_error) {
          e = _error;
          return true;
        }
        return false;
      };
      if ((storage == null) || isDisabled(storage)) {
        data = {};
        storage = {
          length: 0,
          getItem: function(key) {
            return data[key];
          },
          setItem: function(key, value) {
            data[key] = value;
            this.length = Object.keys(data).length;
          },
          removeItem: function(key) {
            delete data[key];
            this.length = Object.keys(data).length;
          },
          clear: function() {
            data = {};
            this.length = 0;
          }
        };
      }
      return storage;
    })();

    return VASTUtil;

  })();

  module.exports = VASTUtil;

}).call(this);

},{}]},{},[1]);
