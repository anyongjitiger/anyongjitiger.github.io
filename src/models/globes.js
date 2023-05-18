/**
 * globes - a set of models of the earth, each having their own kind of projection and onscreen behavior.
 */
import {
  geoGraticule,
  geoPath,
  geoAzimuthalEquidistant,
  geoConicEquidistant,
  geoEquirectangular,
  geoStereographic,
  geoOrthographic
} from 'd3-geo';
import { geoWinkel3, geoMollweide, geoPolyhedralWaterman } from 'd3-geo-projection';
import { isFinite, extend, debounce, random } from 'underscore';
import utils from '../utils/utils';
import * as d3 from 'd3';
import { useSetAtom } from 'jotai';
import { configurationAtom } from './configuration';
const setConf = useSetAtom(configurationAtom);

const MIN_MOVE = 4; // slack before a drag operation beings (pixels)
var MAX_TASK_TIME = 100; // amount of time before a task yields control (millis)
var MIN_SLEEP_TIME = 25; // amount of time a task waits before resuming (millis)
const MOVE_END_WAIT = 1000; // time to wait for a move operation to be considered done (millis)
const NULL_WIND_VECTOR = [NaN, NaN, null]; // singleton for undefined location outside the vector field [u, v, mag]
var HOLE_VECTOR = [NaN, NaN, null]; // singleton that signifies a hole in the vector field
const TRANSPARENT_BLACK = [0, 0, 0, 0]; // singleton 0 rgba
var OVERLAY_ALPHA = Math.floor(0.4 * 255); // overlay transparency (on scale [0, 255])

const log = utils.log();
const view = utils.view();
/**
 * @returns {Array} rotation of globe to current position of the user. Aside from asking for geolocation,
 *          which user may reject, there is not much available except timezone. Better than nothing.
 */
function currentPosition() {
  var λ = utils.floorMod(new Date().getTimezoneOffset() / 4, 360); // 24 hours * 60 min / 4 === 360 degrees
  return [λ, 0];
}

function ensureNumber(num, fallback) {
  return isFinite(num) || num === Infinity || num === -Infinity ? num : fallback;
}

/**
 * @param bounds the projection bounds: [[x0, y0], [x1, y1]]
 * @param view the view bounds {width:, height:}
 * @returns {Object} the projection bounds clamped to the specified view.
 */
function clampedBounds(bounds, view) {
  var upperLeft = bounds[0];
  var lowerRight = bounds[1];
  var x = Math.max(Math.floor(ensureNumber(upperLeft[0], 0)), 0);
  var y = Math.max(Math.floor(ensureNumber(upperLeft[1], 0)), 0);
  var xMax = Math.min(Math.ceil(ensureNumber(lowerRight[0], view.width)), view.width - 1);
  var yMax = Math.min(Math.ceil(ensureNumber(lowerRight[1], view.height)), view.height - 1);
  return { x: x, y: y, xMax: xMax, yMax: yMax, width: xMax - x + 1, height: yMax - y + 1 };
}

/**
 * Returns a globe object with standard behavior. At least the newProjection method must be overridden to
 * be functional.
 */
function standardGlobe() {
  return {
    /**
     * This globe's current d3 projection.
     */
    projection: null,

    /**
     * @param view the size of the view as {width:, height:}.
     * @returns {Object} a new d3 projection of this globe appropriate for the specified view port.
     */
    newProjection: function (view) {
      throw new Error('method must be overridden');
    },

    /**
     * @param view the size of the view as {width:, height:}.
     * @returns {{x: Number, y: Number, xMax: Number, yMax: Number, width: Number, height: Number}}
     *          the bounds of the current projection clamped to the specified view.
     */
    bounds: function (view) {
      return clampedBounds(geoPath().projection(this.projection).bounds({ type: 'Sphere' }), view);
    },

    /**
     * @param view the size of the view as {width:, height:}.
     * @returns {Number} the projection scale at which the entire globe fits within the specified view.
     */
    fit: function (view) {
      var defaultProjection = this.newProjection(view);
      var bounds = geoPath().projection(defaultProjection).bounds({ type: 'Sphere' });
      var hScale = (bounds[1][0] - bounds[0][0]) / defaultProjection.scale();
      var vScale = (bounds[1][1] - bounds[0][1]) / defaultProjection.scale();
      return Math.min(view.width / hScale, view.height / vScale) * 0.9;
    },

    /**
     * @param view the size of the view as {width:, height:}.
     * @returns {Array} the projection transform at which the globe is centered within the specified view.
     */
    center: function (view) {
      return [view.width / 2, view.height / 2];
    },

    /**
     * @returns {Array} the range at which this globe can be zoomed.
     */
    scaleExtent: function () {
      return [25, 3000];
    },

    /**
     * Returns the current orientation of this globe as a string. If the arguments are specified,
     * mutates this globe to match the specified orientation string, usually in the form "lat,lon,scale".
     *
     * @param [o] the orientation string
     * @param [view] the size of the view as {width:, height:}.
     */
    orientation: function (o, view) {
      var projection = this.projection,
        rotate = projection.rotate();
      if (utils.isValue(o)) {
        var parts = o.split(','),
          λ = +parts[0],
          φ = +parts[1],
          scale = +parts[2];
        var extent = this.scaleExtent();
        projection.rotate(
          isFinite(λ) && isFinite(φ) ? [-λ, -φ, rotate[2]] : this.newProjection(view).rotate()
        );
        projection.scale(
          isFinite(scale) ? utils.clamp(scale, extent[0], extent[1]) : this.fit(view)
        );
        projection.translate(this.center(view));
        return this;
      }
      return [
        (-rotate[0]).toFixed(2),
        (-rotate[1]).toFixed(2),
        Math.round(projection.scale())
      ].join(',');
    },

    /**
     * Returns an object that mutates this globe's current projection during a drag/zoom operation.
     * Each drag/zoom event invokes the move() method, and when the move is complete, the end() method
     * is invoked.
     *
     * @param startMouse starting mouse position.
     * @param startScale starting scale.
     */
    manipulator: function (startMouse, startScale) {
      var projection = this.projection;
      var sensitivity = 60 / startScale; // seems to provide a good drag scaling factor
      var rotation = [projection.rotate()[0] / sensitivity, -projection.rotate()[1] / sensitivity];
      var original = projection.precision();
      projection.precision(original * 10);
      return {
        move: function (mouse, scale) {
          if (mouse) {
            var xd = mouse[0] - startMouse[0] + rotation[0];
            var yd = mouse[1] - startMouse[1] + rotation[1];
            projection.rotate([xd * sensitivity, -yd * sensitivity, projection.rotate()[2]]);
          }
          projection.scale(scale);
        },
        end: function () {
          projection.precision(original);
        }
      };
    },

    /**
     * @returns {Array} the transform to apply, if any, to orient this globe to the specified coordinates.
     */
    locate: function (coord) {
      return null;
    },

    /**
     * Draws a polygon on the specified context of this globe's boundary.
     * @param context a Canvas element's 2d context.
     * @returns the context
     */
    defineMask: function (context) {
      geoPath().projection(this.projection).context(context)({ type: 'Sphere' });
      return context;
    },

    /**
     * Appends the SVG elements that render this globe.
     * @param mapSvg the primary map SVG container.
     * @param foregroundSvg the foreground SVG container.
     */
    defineMap: function (mapSvg, foregroundSvg) {
      var path = geoPath().projection(this.projection);
      var defs = mapSvg.append('defs');
      defs.append('path').attr('id', 'sphere').datum({ type: 'Sphere' }).attr('d', path);
      mapSvg.append('use').attr('xlink:href', '#sphere').attr('class', 'background-sphere');
      mapSvg.append('path').attr('class', 'graticule').datum(geoGraticule()).attr('d', path);
      mapSvg
        .append('path')
        .attr('class', 'hemisphere')
        .datum(geoGraticule().minorStep([0, 90]).majorStep([0, 90]))
        .attr('d', path);
      mapSvg.append('path').attr('class', 'coastline');
      mapSvg.append('path').attr('class', 'lakes');
      foregroundSvg.append('use').attr('xlink:href', '#sphere').attr('class', 'foreground-sphere');
    }
  };
}

function newGlobe(source, view) {
  var result = extend(standardGlobe(), source);
  result.projection = result.newProjection(view);
  return result;
}

// ============================================================================================

function atlantis() {
  return newGlobe({
    newProjection: function () {
      return geoMollweide().rotate([30, -45, 90]).precision(0.1);
    }
  });
}

function azimuthalEquidistant() {
  return newGlobe({
    newProjection: function () {
      return geoAzimuthalEquidistant()
        .precision(0.1)
        .rotate([0, -90])
        .clipAngle(180 - 0.001);
    }
  });
}

function conicEquidistant() {
  return newGlobe({
    newProjection: function () {
      return geoConicEquidistant().rotate(currentPosition()).precision(0.1);
    },
    center: function (view) {
      return [view.width / 2, view.height / 2 + view.height * 0.065];
    }
  });
}

function equirectangular() {
  return newGlobe({
    newProjection: function () {
      return geoEquirectangular().rotate(currentPosition()).precision(0.1);
    }
  });
}

function orthographic() {
  return newGlobe({
    newProjection: function () {
      return geoOrthographic().rotate(currentPosition()).precision(0.1).clipAngle(90);
    },
    defineMap: function (mapSvg, foregroundSvg) {
      var path = geoPath().projection(this.projection);
      var defs = mapSvg.append('defs');
      var gradientFill = defs
        .append('radialGradient')
        .attr('id', 'orthographic-fill')
        .attr('gradientUnits', 'objectBoundingBox')
        .attr('cx', '50%')
        .attr('cy', '49%')
        .attr('r', '50%');
      gradientFill.append('stop').attr('stop-color', '#303030').attr('offset', '69%');
      gradientFill.append('stop').attr('stop-color', '#202020').attr('offset', '91%');
      gradientFill.append('stop').attr('stop-color', '#000005').attr('offset', '96%');
      defs.append('path').attr('id', 'sphere').datum({ type: 'Sphere' }).attr('d', path);
      mapSvg.append('use').attr('xlink:href', '#sphere').attr('fill', 'url(#orthographic-fill)');
      mapSvg.append('path').attr('class', 'graticule').datum(geoGraticule()).attr('d', path);
      mapSvg
        .append('path')
        .attr('class', 'hemisphere')
        .datum(geoGraticule().minorStep([0, 90]).majorStep([0, 90]))
        .attr('d', path);
      mapSvg.append('path').attr('class', 'coastline');
      mapSvg.append('path').attr('class', 'lakes');
      foregroundSvg.append('use').attr('xlink:href', '#sphere').attr('class', 'foreground-sphere');
    },
    locate: function (coord) {
      return [-coord[0], -coord[1], this.projection.rotate()[2]];
    }
  });
}

function stereographic(view) {
  return newGlobe(
    {
      newProjection: function (view) {
        return geoStereographic()
          .rotate([-43, -20])
          .precision(1.0)
          .clipAngle(180 - 0.0001)
          .clipExtent([
            [0, 0],
            [view.width, view.height]
          ]);
      }
    },
    view
  );
}

function waterman() {
  return newGlobe({
    newProjection: function () {
      return geoPolyhedralWaterman().rotate([20, 0]).precision(0.1);
    },
    defineMap: function (mapSvg, foregroundSvg) {
      var path = geoPath().projection(this.projection);
      var defs = mapSvg.append('defs');
      defs.append('path').attr('id', 'sphere').datum({ type: 'Sphere' }).attr('d', path);
      defs.append('clipPath').attr('id', 'clip').append('use').attr('xlink:href', '#sphere');
      mapSvg.append('use').attr('xlink:href', '#sphere').attr('class', 'background-sphere');
      mapSvg
        .append('path')
        .attr('class', 'graticule')
        .attr('clip-path', 'url(#clip)')
        .datum(geoGraticule())
        .attr('d', path);
      mapSvg.append('path').attr('class', 'coastline').attr('clip-path', 'url(#clip)');
      mapSvg.append('path').attr('class', 'lakes').attr('clip-path', 'url(#clip)');
      foregroundSvg.append('use').attr('xlink:href', '#sphere').attr('class', 'foreground-sphere');
    }
  });
}

function winkel3() {
  return newGlobe({
    newProjection: function () {
      return geoWinkel3().precision(0.1);
    }
  });
}

export const globes = new Map([
  ['atlantis', atlantis],
  ['azimuthal_equidistant', azimuthalEquidistant],
  ['conic_equidistant', conicEquidistant],
  ['equirectangular', equirectangular],
  ['orthographic', orthographic],
  ['stereographic', stereographic],
  ['waterman', waterman],
  ['winkel3', winkel3]
]);

export function buildGlobe(projectionName) {
  var builder = globes.get(projectionName);
  if (!builder) {
    return Promise.reject('Unknown projection: ' + projectionName);
  }
  return new Promise(builder(view));
}

/**
 * Calculate distortion of the wind vector caused by the shape of the projection at point (x, y). The wind
 * vector is modified in place and returned by this function.
 */
function distort(projection, λ, φ, x, y, scale, wind) {
  var u = wind[0] * scale;
  var v = wind[1] * scale;
  var d = utils.distortion(projection, λ, φ, x, y);

  // Scale distortion vectors by u and v, then add.
  wind[0] = d[0] * u + d[2] * v;
  wind[1] = d[1] * u + d[3] * v;
  return wind;
}

function createMask(globe) {
  if (!globe) return null;

  log.time('render mask');

  // Create a detached canvas, ask the model to define the mask polygon, then fill with an opaque color.
  var width = view.width,
    height = view.height;
  var canvas = d3
    .select(document.createElement('canvas'))
    .attr('width', width)
    .attr('height', height)
    .node();
  var context = globe.defineMask(canvas.getContext('2d'));
  context.fillStyle = 'rgba(255, 0, 0, 1)';
  context.fill();
  // d3.select("#display").node().appendChild(canvas);  // make mask visible for debugging

  var imageData = context.getImageData(0, 0, width, height);
  var data = imageData.data; // layout: [r, g, b, a, r, g, b, a, ...]
  log.timeEnd('render mask');
  return {
    imageData: imageData,
    isVisible: function (x, y) {
      var i = (y * width + x) * 4;
      return data[i + 3] > 0; // non-zero alpha means pixel is visible
    },
    set: function (x, y, rgba) {
      var i = (y * width + x) * 4;
      data[i] = rgba[0];
      data[i + 1] = rgba[1];
      data[i + 2] = rgba[2];
      data[i + 3] = rgba[3];
      return this;
    }
  };
}

function createField(columns, bounds, mask) {
  /**
   * @returns {Array} wind vector [u, v, magnitude] at the point (x, y), or [NaN, NaN, null] if wind
   *          is undefined at that point.
   */
  function field(x, y) {
    var column = columns[Math.round(x)];
    return (column && column[Math.round(y)]) || NULL_WIND_VECTOR;
  }

  /**
   * @returns {boolean} true if the field is valid at the point (x, y)
   */
  field.isDefined = function (x, y) {
    return field(x, y)[2] !== null;
  };

  /**
   * @returns {boolean} true if the point (x, y) lies inside the outer boundary of the vector field, even if
   *          the vector field has a hole (is undefined) at that point, such as at an island in a field of
   *          ocean currents.
   */
  field.isInsideBoundary = function (x, y) {
    return field(x, y) !== NULL_WIND_VECTOR;
  };

  // Frees the massive "columns" array for GC. Without this, the array is leaked (in Chrome) each time a new
  // field is interpolated because the field closure's context is leaked, for reasons that defy explanation.
  field.release = function () {
    columns = [];
  };

  field.randomize = function (o) {
    // UNDONE: this method is terrible
    var x, y;
    var safetyNet = 0;
    do {
      x = Math.round(random(bounds.x, bounds.xMax));
      y = Math.round(random(bounds.y, bounds.yMax));
    } while (!field.isDefined(x, y) && safetyNet++ < 30);
    o.x = x;
    o.y = y;
    return o;
  };

  field.overlay = mask.imageData;

  return field;
}

function interpolateField(globe, grids) {
  if (!globe || !grids) return null;

  var mask = createMask(globe);
  var primaryGrid = grids.primaryGrid;
  var overlayGrid = grids.overlayGrid;

  log.time('interpolating field');
  // var cancel = this.cancel;
  var projection = globe.projection;
  var bounds = globe.bounds(view);
  // How fast particles move on the screen (arbitrary value chosen for aesthetics).
  var velocityScale = bounds.height * primaryGrid.particles.velocityScale;

  var columns = [];
  var point = [];
  var x = bounds.x;
  var interpolate = primaryGrid.interpolate;
  var overlayInterpolate = overlayGrid.interpolate;
  var hasDistinctOverlay = primaryGrid !== overlayGrid;
  var scale = overlayGrid.scale;

  function interpolateColumn(x) {
    var column = [];
    for (var y = bounds.y; y <= bounds.yMax; y += 2) {
      if (mask.isVisible(x, y)) {
        point[0] = x;
        point[1] = y;
        var coord = projection.invert(point);
        var color = TRANSPARENT_BLACK;
        var wind = null;
        if (coord) {
          var λ = coord[0],
            φ = coord[1];
          if (isFinite(λ)) {
            wind = interpolate(λ, φ);
            var scalar = null;
            if (wind) {
              wind = distort(projection, λ, φ, x, y, velocityScale, wind);
              scalar = wind[2];
            }
            if (hasDistinctOverlay) {
              scalar = overlayInterpolate(λ, φ);
            }
            if (utils.isValue(scalar)) {
              color = scale.gradient(scalar, OVERLAY_ALPHA);
            }
          }
        }
        column[y + 1] = column[y] = wind || HOLE_VECTOR;
        mask
          .set(x, y, color)
          .set(x + 1, y, color)
          .set(x, y + 1, color)
          .set(x + 1, y + 1, color);
      }
    }
    columns[x + 1] = columns[x] = column;
  }

  return new Promise((resolve, reject) => {
    (function batchInterpolate() {
      try {
        // if (!cancel.requested) {
        var start = Date.now();
        while (x < bounds.xMax) {
          interpolateColumn(x);
          x += 2;
          if (Date.now() - start > MAX_TASK_TIME) {
            // Interpolation is taking too long. Schedule the next batch for later and yield.
            setTimeout(batchInterpolate, MIN_SLEEP_TIME);
            return;
          }
        }
        // }
        resolve(createField(columns, bounds, mask));
      } catch (e) {
        reject(e);
      }
      log.timeEnd('interpolating field');
    })();
  });
}

function buildInputController() {
  var globe,
    op = null;

  /**
   * @returns {Object} an object to represent the state for one move operation.
   */
  function newOp(startMouse, startScale) {
    return {
      type: 'click', // initially assumed to be a click operation
      startMouse: startMouse,
      startScale: startScale,
      manipulator: globe.manipulator(startMouse, startScale)
    };
  }

  var zoom = d3
    .zoom()
    .on('zoomstart', function () {
      op = op || newOp(d3.pointer(this), d3.zoomIdentity.k); // a new operation begins
    })
    .on('zoom', function (event) {
      var currentMouse = d3.pointer(this),
        currentScale = event.scale;
      op = op || newOp(currentMouse, 1); // Fix bug on some browsers where zoomstart fires out of order.
      if (op.type === 'click' || op.type === 'spurious') {
        var distanceMoved = utils.distance(currentMouse, op.startMouse);
        if (currentScale === op.startScale && distanceMoved < MIN_MOVE) {
          // to reduce annoyance, ignore op if mouse has barely moved and no zoom is occurring
          op.type = distanceMoved > 0 ? 'click' : 'spurious';
          return;
        }
        dispatch.trigger('moveStart');
        op.type = 'drag';
      }
      if (currentScale != op.startScale) {
        op.type = 'zoom'; // whenever a scale change is detected, (stickily) switch to a zoom operation
      }

      // when zooming, ignore whatever the mouse is doing--really cleans up behavior on touch devices
      op.manipulator.move(op.type === 'zoom' ? null : currentMouse, currentScale);
      dispatch.trigger('move');
    })
    .on('zoomend', function () {
      op.manipulator.end();
      if (op.type === 'click') {
        dispatch.trigger('click', op.startMouse, globe.projection.invert(op.startMouse) || []);
      } else if (op.type !== 'spurious') {
        signalEnd();
      }
      op = null; // the drag/zoom/click operation is over
    });

  var signalEnd = debounce(function () {
    if (!op || (op.type !== 'drag' && op.type !== 'zoom')) {
      configuration.save({ orientation: globe.orientation() }, { source: 'moveEnd' });
      dispatch.trigger('moveEnd');
    }
  }, MOVE_END_WAIT); // wait for a bit to decide if user has stopped moving the globe

  d3.select('#display').call(zoom);
  d3.select('#show-location').on('click', function () {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function (pos) {
        var coord = [pos.coords.longitude, pos.coords.latitude],
          rotate = globe.locate(coord);
        if (rotate) {
          globe.projection.rotate(rotate);
          configuration.save({ orientation: globe.orientation() }); // triggers reorientation
        }
        dispatch.trigger('click', globe.projection(coord), coord);
      }, log.error);
    }
  });

  function reorient() {
    var options = arguments[3] || {};
    if (!globe || options.source === 'moveEnd') {
      // reorientation occurred because the user just finished a move operation, so globe is already
      // oriented correctly.
      return;
    }
    dispatch.trigger('moveStart');
    globe.orientation(configuration.get('orientation'), view);
    zoom.scale(globe.projection.scale());
    dispatch.trigger('moveEnd');
  }

  var dispatch = _.extend(
    {
      globe: function (_) {
        if (_) {
          globe = _;
          zoom.scaleExtent(globe.scaleExtent());
          reorient();
        }
        return _ ? this : globe;
      }
    },
    Backbone.Events
  );
  return dispatch.listenTo(configuration, 'change:orientation', reorient);
}
