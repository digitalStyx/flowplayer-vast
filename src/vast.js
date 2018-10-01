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


					if (undefined !== window.fplayer.engine && undefined !== window.fplayer.engine.hls) {
						window.fplayer.engine.hls.stopLoad();
					}

					setTimeout(function () {
						var newPlaylist = player.conf.playlist.slice(0);
						newPlaylist.unshift(preroll.video);

						player.setPlaylist(newPlaylist);

						// timeout makes play work on mobile
						player.play(0);
					}, 0);

					return false;
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
						title.innerHTML = "Reklama: <strong>Pomiń &raquo;</strong>";
					} else {
						title.innerHTML = "Reklama: Skippable in " + Math.round(player.video.skip - duration) + " seconds...";
					}
				} else {
					title.innerHTML = "Reklama: Skończy się za " + Math.round(player.video.duration - duration) + " sekund...";
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

		var opt=[];opt.withCredentials=true;
		vast.client.get(url, opt, function (response) {
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
								if (media.mimeType == 'application/javascript' ) {
									return ads.push({
									js: {
											width: document.getElementById('flowplayer').offsetWidth,
											height: document.getElementById('flowplayer').offsetHeight,
											src: media.fileURL,
											parameters: creative.adParameters,
											tracker: tracker
									}
								});
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