import { json } from 'd3-fetch';

var τ = 2 * Math.PI;
var H = 0.000036; // 0.0000360°φ ~= 4m
var DEFAULT_CONFIG = 'current/wind/surface/level/orthographic';
var TOPOLOGY = isMobile() ? '/data/earth-topo-mobile.json?v2' : '/data/earth-topo.json?v2';

/**
 * @returns {Boolean} true if the specified value is truthy.
 */
function isTruthy(x) {
  return !!x;
}

/**
 * @returns {Boolean} true if the specified value is not null and not undefined.
 */
function isValue(x) {
  return x !== null && x !== undefined;
}

/**
 * @returns {Number} returns remainder of floored division, i.e., floor(a / n). Useful for consistent modulo
 *          of negative numbers. See http://en.wikipedia.org/wiki/Modulo_operation.
 */
function floorMod(a, n) {
  var f = a - n * Math.floor(a / n);
  // HACK: when a is extremely close to an n transition, f can be equal to n. This is bad because f must be
  //       within range [0, n). Check for this corner case. Example: a:=-1e-16, n:=10. What is the proper fix?
  return f === n ? 0 : f;
}

/**
 * @returns {Number} distance between two points having the form [x, y].
 */
function distance(a, b) {
  var Δx = b[0] - a[0];
  var Δy = b[1] - a[1];
  return Math.sqrt(Δx * Δx + Δy * Δy);
}

/**
 * @returns {Number} the value x clamped to the range [low, high].
 */
function clamp(x, low, high) {
  return Math.max(low, Math.min(x, high));
}

/**
 * @returns {number} the fraction of the bounds [low, high] covered by the value x, after clamping x to the
 *          bounds. For example, given bounds=[10, 20], this method returns 1 for x>=20, 0.5 for x=15 and 0
 *          for x<=10.
 */
function proportion(x, low, high) {
  return (clamp(x, low, high) - low) / (high - low);
}

/**
 * @returns {number} the value p within the range [0, 1], scaled to the range [low, high].
 */
function spread(p, low, high) {
  return p * (high - low) + low;
}

/**
 * Pad number with leading zeros. Does not support fractional or negative numbers.
 */
function zeroPad(n, width) {
  var s = n.toString();
  var i = Math.max(width - s.length, 0);
  return new Array(i + 1).join('0') + s;
}

/**
 * @returns {String} the specified string with the first letter capitalized.
 */
function capitalize(s) {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.substr(1);
}

/**
 * @returns {Boolean} true if agent is probably firefox. Don't really care if this is accurate.
 */
function isFF() {
  return /firefox/i.test(navigator.userAgent);
}

/**
 * @returns {Boolean} true if agent is probably a mobile device. Don't really care if this is accurate.
 */
function isMobile() {
  return /android|blackberry|iemobile|ipad|iphone|ipod|opera mini|webos/i.test(navigator.userAgent);
}

function isEmbeddedInIFrame() {
  return window != window.top;
}

function toUTCISO(date) {
  return (
    date.getUTCFullYear() +
    '-' +
    zeroPad(date.getUTCMonth() + 1, 2) +
    '-' +
    zeroPad(date.getUTCDate(), 2) +
    ' ' +
    zeroPad(date.getUTCHours(), 2) +
    ':00'
  );
}

function toLocalISO(date) {
  return (
    date.getFullYear() +
    '-' +
    zeroPad(date.getMonth() + 1, 2) +
    '-' +
    zeroPad(date.getDate(), 2) +
    ' ' +
    zeroPad(date.getHours(), 2) +
    ':00'
  );
}

/**
 * @returns {String} the string yyyyfmmfdd as yyyytmmtdd, where f and t are the "from" and "to" delimiters. Either
 *          delimiter may be the empty string.
 */
function ymdRedelimit(ymd, fromDelimiter, toDelimiter) {
  if (!fromDelimiter) {
    return ymd.substr(0, 4) + toDelimiter + ymd.substr(4, 2) + toDelimiter + ymd.substr(6, 2);
  }
  var parts = ymd.substr(0, 10).split(fromDelimiter);
  return [parts[0], parts[1], parts[2]].join(toDelimiter);
}

/**
 * @returns {String} the UTC year, month, and day of the specified date in yyyyfmmfdd format, where f is the
 *          delimiter (and may be the empty string).
 */
function dateToUTCymd(date, delimiter) {
  return ymdRedelimit(date.toISOString(), '-', delimiter || '');
}

function dateToConfig(date) {
  return { date: dateToUTCymd(date, '/'), hour: zeroPad(date.getUTCHours(), 2) + '00' };
}

/**
 * @returns {Object} an object to perform logging, if/when the browser supports it.
 */
function log() {
  function format(o) {
    return o && o.stack ? o + '\n' + o.stack : o;
  }
  return {
    debug: function (s) {
      if (console && console.log) console.log(format(s));
    },
    info: function (s) {
      if (console && console.info) console.info(format(s));
    },
    error: function (e) {
      if (console && console.error) console.error(format(e));
    },
    time: function (s) {
      if (console && console.time) console.time(format(s));
    },
    timeEnd: function (s) {
      if (console && console.timeEnd) console.timeEnd(format(s));
    }
  };
}

/**
 * @returns {width: (Number), height: (Number)} an object that describes the size of the browser's current view.
 */
function view() {
  var w = window;
  var d = document && document.documentElement;
  var b = document && document.getElementsByTagName('body')[0];
  var x = w.innerWidth || d.clientWidth || b.clientWidth;
  var y = w.innerHeight || d.clientHeight || b.clientHeight;
  return { width: x, height: y };
}

/**
 * Removes all children of the specified DOM element.
 */
function removeChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

/**
 * @returns {Object} clears and returns the specified Canvas element's 2d context.
 */
function clearCanvas(canvas) {
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function colorInterpolator(start, end) {
  var r = start[0],
    g = start[1],
    b = start[2];
  var Δr = end[0] - r,
    Δg = end[1] - g,
    Δb = end[2] - b;
  return function (i, a) {
    return [Math.floor(r + i * Δr), Math.floor(g + i * Δg), Math.floor(b + i * Δb), a];
  };
}

/**
 * Produces a color style in a rainbow-like trefoil color space. Not quite HSV, but produces a nice
 * spectrum. See http://krazydad.com/tutorials/makecolors.php.
 *
 * @param hue the hue rotation in the range [0, 1]
 * @param a the alpha value in the range [0, 255]
 * @returns {Array} [r, g, b, a]
 */
function sinebowColor(hue, a) {
  // Map hue [0, 1] to radians [0, 5/6τ]. Don't allow a full rotation because that keeps hue == 0 and
  // hue == 1 from mapping to the same color.
  var rad = (hue * τ * 5) / 6;
  rad *= 0.75; // increase frequency to 2/3 cycle per rad

  var s = Math.sin(rad);
  var c = Math.cos(rad);
  var r = Math.floor(Math.max(0, -c) * 255);
  var g = Math.floor(Math.max(s, 0) * 255);
  var b = Math.floor(Math.max(c, 0, -s) * 255);
  return [r, g, b, a];
}

var BOUNDARY = 0.45;
var fadeToWhite = colorInterpolator(sinebowColor(1.0, 0), [255, 255, 255]);

/**
 * Interpolates a sinebow color where 0 <= i <= j, then fades to white where j < i <= 1.
 *
 * @param i number in the range [0, 1]
 * @param a alpha value in range [0, 255]
 * @returns {Array} [r, g, b, a]
 */
function extendedSinebowColor(i, a) {
  return i <= BOUNDARY
    ? sinebowColor(i / BOUNDARY, a)
    : fadeToWhite((i - BOUNDARY) / (1 - BOUNDARY), a);
}

function asColorStyle(r, g, b, a) {
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
}

/**
 * @returns {Array} of wind colors and a method, indexFor, that maps wind magnitude to an index on the color scale.
 */
function windIntensityColorScale(step, maxWind) {
  var result = [];
  for (var j = 85; j <= 255; j += step) {
    result.push(asColorStyle(j, j, j, 1.0));
  }
  result.indexFor = function (m) {
    // map wind speed to a style
    return Math.floor((Math.min(m, maxWind) / maxWind) * (result.length - 1));
  };
  return result;
}

/**
 * Creates a color scale composed of the specified segments. Segments is an array of two-element arrays of the
 * form [value, color], where value is the point along the scale and color is the [r, g, b] color at that point.
 * For example, the following creates a scale that smoothly transitions from red to green to blue along the
 * points 0.5, 1.0, and 3.5:
 *
 *     [ [ 0.5, [255, 0, 0] ],
 *       [ 1.0, [0, 255, 0] ],
 *       [ 3.5, [0, 0, 255] ] ]
 *
 * @param segments array of color segments
 * @returns {Function} a function(point, alpha) that returns the color [r, g, b, alpha] for the given point.
 */
function segmentedColorScale(segments) {
  var points = [],
    interpolators = [],
    ranges = [];
  for (var i = 0; i < segments.length - 1; i++) {
    points.push(segments[i + 1][0]);
    interpolators.push(colorInterpolator(segments[i][1], segments[i + 1][1]));
    ranges.push([segments[i][0], segments[i + 1][0]]);
  }

  return function (point, alpha) {
    var i;
    for (i = 0; i < points.length - 1; i++) {
      if (point <= points[i]) {
        break;
      }
    }
    var range = ranges[i];
    return interpolators[i](proportion(point, range[0], range[1]), alpha);
  };
}

/**
 * Returns a human readable string for the provided coordinates.
 */
function formatCoordinates(λ, φ) {
  return (
    Math.abs(φ).toFixed(2) +
    '° ' +
    (φ >= 0 ? 'N' : 'S') +
    ', ' +
    Math.abs(λ).toFixed(2) +
    '° ' +
    (λ >= 0 ? 'E' : 'W')
  );
}

/**
 * Returns a human readable string for the provided scalar in the given units.
 */
function formatScalar(value, units) {
  return units.conversion(value).toFixed(units.precision);
}

/**
 * Returns a human readable string for the provided rectangular wind vector in the given units.
 * See http://mst.nerc.ac.uk/wind_vect_convs.html.
 */
function formatVector(wind, units) {
  var d = (Math.atan2(-wind[0], -wind[1]) / τ) * 360; // calculate into-the-wind cardinal degrees
  var wd = Math.round(((d + 360) % 360) / 5) * 5; // shift [-180, 180] to [0, 360], and round to nearest 5.
  return wd.toFixed(0) + '° @ ' + formatScalar(wind[2], units);
}

/**
 * Returns a promise for a JSON resource (URL) fetched via XHR. If the load fails, the promise rejects with an
 * object describing the reason: {status: http-status-code, message: http-status-text, resource:}.
 */
// function loadJson(resource) {
//   var d = when.defer();
//   json(resource, function (error, result) {
//     return error
//       ? !error.status
//         ? d.reject({ status: -1, message: 'Cannot load resource: ' + resource, resource: resource })
//         : d.reject({ status: error.status, message: error.statusText, resource: resource })
//       : d.resolve(result);
//   });
//   return d.promise;
// }

function loadJson(resource) {
  return new Promise((resolve, reject) => {
    json(resource)
      .then((json) => resolve(json))
      .catch((error) => {
        console.error('Load json error: ', error);
        reject({ status: error.status, message: error.statusText, resource: resource });
      });
  });
}

/**
 * Returns the distortion introduced by the specified projection at the given point.
 *
 * This method uses finite difference estimates to calculate warping by adding a very small amount (h) to
 * both the longitude and latitude to create two lines. These lines are then projected to pixel space, where
 * they become diagonals of triangles that represent how much the projection warps longitude and latitude at
 * that location.
 *
 * <pre>
 *        (λ, φ+h)                  (xλ, yλ)
 *           .                         .
 *           |               ==>        \
 *           |                           \   __. (xφ, yφ)
 *    (λ, φ) .____. (λ+h, φ)       (x, y) .--
 * </pre>
 *
 * See:
 *     Map Projections: A Working Manual, Snyder, John P: pubs.er.usgs.gov/publication/pp1395
 *     gis.stackexchange.com/questions/5068/how-to-create-an-accurate-tissot-indicatrix
 *     www.jasondavies.com/maps/tissot
 *
 * @returns {Array} array of scaled derivatives [dx/dλ, dy/dλ, dx/dφ, dy/dφ]
 */
function distortion(projection, λ, φ, x, y) {
  var hλ = λ < 0 ? H : -H;
  var hφ = φ < 0 ? H : -H;
  var pλ = projection([λ + hλ, φ]);
  var pφ = projection([λ, φ + hφ]);

  // Meridian scale factor (see Snyder, equation 4-3), where R = 1. This handles issue where length of 1° λ
  // changes depending on φ. Without this, there is a pinching effect at the poles.
  var k = Math.cos((φ / 360) * τ);

  return [(pλ[0] - x) / hλ / k, (pλ[1] - y) / hλ / k, (pφ[0] - x) / hφ, (pφ[1] - y) / hφ];
}
/**
 * Parses a URL hash fragment:
 *
 * example: "2013/11/14/0900Z/wind/isobaric/1000hPa/orthographic=26.50,-153.00,1430/overlay=off"
 * output: {date: "2013/11/14", hour: "0900", param: "wind", surface: "isobaric", level: "1000hPa",
 *          projection: "orthographic", orientation: "26.50,-153.00,1430", overlayType: "off"}
 *
 * grammar:
 *     hash   := ( "current" | yyyy / mm / dd / hhhh "Z" ) / param / surface / level [ / option [ / option ... ] ]
 *     option := type [ "=" number [ "," number [ ... ] ] ]
 *
 * @param hash the hash fragment.
 * @param projectionNames the set of allowed projections.
 * @param overlayTypes the set of allowed overlays.
 * @returns {Object} the result of the parse.
 */
function parse(hash, projectionNames, overlayTypes) {
  var option,
    result = {};
  //             1        2        3          4          5            6      7      8    9
  var tokens =
    // eslint-disable-next-line no-useless-escape
    /^(current|(\d{4})\/(\d{1,2})\/(\d{1,2})\/(\d{3,4})Z)\/(\w+)\/(\w+)\/(\w+)([\/].+)?/.exec(hash);
  if (tokens) {
    var date =
      tokens[1] === 'current'
        ? 'current'
        : tokens[2] + '/' + zeroPad(tokens[3], 2) + '/' + zeroPad(tokens[4], 2);
    var hour = isValue(tokens[5]) ? zeroPad(tokens[5], 4) : '';
    result = {
      date: date, // "current" or "yyyy/mm/dd"
      hour: hour, // "hhhh" or ""
      param: tokens[6], // non-empty alphanumeric _
      surface: tokens[7], // non-empty alphanumeric _
      level: tokens[8], // non-empty alphanumeric _
      projection: 'orthographic',
      orientation: '',
      topology: TOPOLOGY,
      overlayType: 'default',
      showGridPoints: false
    };
    (tokens[9] ?? '').split('/').forEach(function (segment) {
      if ((option = /^(\w+)(=([\d\-.,]*))?$/.exec(segment))) {
        if (projectionNames.has(option[1])) {
          result.projection = option[1]; // non-empty alphanumeric _
          result.orientation = option[3] ?? ''; // comma delimited string of numbers, or ""
        }
      } else if ((option = /^overlay=(\w+)$/.exec(segment))) {
        if (overlayTypes.has(option[1]) || option[1] === 'default') {
          result.overlayType = option[1];
        }
      } else if ((option = /^grid=(\w+)$/.exec(segment))) {
        if (option[1] === 'on') {
          result.showGridPoints = true;
        }
      }
    });
  }
  return result;
}

const utils = {
  isTruthy: isTruthy,
  isValue: isValue,
  floorMod: floorMod,
  distance: distance,
  clamp: clamp,
  proportion: proportion,
  spread: spread,
  zeroPad: zeroPad,
  capitalize: capitalize,
  isFF: isFF,
  isMobile: isMobile,
  isEmbeddedInIFrame: isEmbeddedInIFrame,
  toUTCISO: toUTCISO,
  toLocalISO: toLocalISO,
  ymdRedelimit: ymdRedelimit,
  dateToUTCymd: dateToUTCymd,
  dateToConfig: dateToConfig,
  log: log,
  view: view,
  removeChildren: removeChildren,
  clearCanvas: clearCanvas,
  sinebowColor: sinebowColor,
  extendedSinebowColor: extendedSinebowColor,
  windIntensityColorScale: windIntensityColorScale,
  segmentedColorScale: segmentedColorScale,
  formatCoordinates: formatCoordinates,
  formatScalar: formatScalar,
  formatVector: formatVector,
  loadJson: loadJson,
  distortion: distortion,
  parse: parse
};
export default utils;
