/**
 * Copyright 2015 CANAL+ Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Subject, } from "rxjs";
import { mergeMap, takeUntil, } from "rxjs/operators";
import log from "../../log";
import RepresentationChooser from "./representation_chooser";
var defaultChooserOptions = {
    limitWidth: {},
    throttle: {},
    initialBitrates: {},
    manualBitrates: {},
    maxAutoBitrates: {},
};
/**
 * Create the right RepresentationChooser instance, from the given data.
 * @param {string} type
 * @param {Object} options
 * @returns {RepresentationChooser} - The RepresentationChooser instance
 */
var createChooser = function (type, options) {
    return new RepresentationChooser({
        limitWidth$: options.limitWidth[type],
        throttle$: options.throttle[type],
        initialBitrate: options.initialBitrates[type],
        manualBitrate: options.manualBitrates[type],
        maxAutoBitrate: options.maxAutoBitrates[type],
    });
};
/**
 * Adaptive BitRate Manager.
 *
 * Select the right representation from the network and buffer infos it
 * receives.
 * @class ABRManager
 */
var ABRManager = /** @class */ (function () {
    /**
     * @param {Observable} requests$ - Emit requests infos as they begin, progress
     * and end.
     * Allows to know if a request take too much time to be finished in
     * emergency times (e.g. when the user's bandwidth falls very quickly).
     *
     * The items emitted are Observables which each emit infos about a SINGLE
     * request. These infos are under the form of objects with the following keys:
     *   - type {string}: the buffer type (example: "video")
     *
     *   - event {string}: Wether the request started, is progressing or has
     *     ended. Should be either one of these three strings:
     *       1. "requestBegin": The request has just begun.
     *
     *       2. "progress": Informations about the request progress were received
     *          (basically the amount of bytes currently received).
     *
     *       2. "requestEnd": The request just ended (successfully/on error/was
     *          canceled)
     *
     *     Note that it should ALWAYS happen in the following order:
     *     1 requestBegin -> 0+ progress -> 1 requestEnd
     *
     *     Also note that EVERY requestBegin should eventually be followed by a
     *     requestEnd at some point. If that's not the case, a memory leak
     *     can happen.
     *
     *   - value {Object|undefined}: The value depends on the type of event
     *     received:
     *       - for "requestBegin" events, it should be an object with the
     *         following keys:
     *           - id {number|String}: The id of this particular request.
     *           - duration {number}: duration, in seconds of the asked segment.
     *           - time {number}: The start time, in seconds of the asked segment.
     *           - requestTimestamp {number}: the timestamp at which the request
     *             was sent, in ms.
     *
     *       - for "progress" events, it should be an object with the following
     *         keys:
     *           - id {number|String}: The id of this particular request.
     *           - size {number}: amount currently downloaded, in bytes
     *           - timestamp {number}: timestamp at which the progress event was
     *             received, in ms
     *         Those events SHOULD be received in order (that is, in increasing
     *         order for both size and timestamp).
     *
     *       - for "requestEnd" events:
     *           - id {number|String}: The id of this particular request.
     *
     * @param {Observable} metrics$ - Emit each times the network downloaded
     * a new segment for a given buffer type. Allows to obtain informations about
     * the user's bitrate.
     *
     * The items emitted are object with the following keys:
     *   - type {string}: the buffer type (example: "video")
     *   - value {Object}:
     *     - duration {number}: duration of the request, in seconds.
     *     - size {number}: size of the downloaded chunks, in bytes.
     *
     * @param {Object|undefined} options
     */
    function ABRManager(requests$, metrics$, options) {
        var _this = this;
        if (options === void 0) { options = defaultChooserOptions; }
        // Subject emitting and completing on dispose.
        // Used to clean up every created observables.
        this._dispose$ = new Subject();
        // Will contain every RepresentationChooser attached to the ABRManager,
        // by type ("audio"/"video" etc.)
        this._choosers = {};
        // -- OPTIONS --
        // Will contain options used when (lazily) instantiating a
        // RepresentationChooser
        this._chooserInstanceOptions = {
            initialBitrates: options.initialBitrates || {},
            manualBitrates: options.manualBitrates || {},
            maxAutoBitrates: options.maxAutoBitrates || {},
            throttle: options.throttle || {},
            limitWidth: options.limitWidth || {},
        };
        metrics$
            .pipe(takeUntil(this._dispose$))
            .subscribe(function (_a) {
            var type = _a.type, value = _a.value;
            var chooser = _this._lazilyCreateChooser(type);
            var duration = value.duration, size = value.size;
            chooser.addEstimate(duration, size);
        });
        requests$
            .pipe(
        // requests$ emits observables which are subscribed to
        mergeMap(function (request$) { return request$; }), takeUntil(this._dispose$))
            .subscribe(function (request) {
            var type = request.type, value = request.value;
            var chooser = _this._lazilyCreateChooser(type);
            switch (request.event) {
                case "requestBegin":
                    // use the id of the segment as in any case, we should only have at
                    // most one active download for the same segment.
                    // This might be not optimal if this changes however. The best I think
                    // for now is to just throw/warn in DEV mode when two pending ids
                    // are identical
                    chooser.addPendingRequest(value.id, request);
                    break;
                case "requestEnd":
                    chooser.removePendingRequest(value.id);
                    break;
                case "progress":
                    chooser.addRequestProgress(value.id, request);
                    break;
            }
        });
    }
    /**
     * Take type and an array of the available representations, spit out an
     * observable emitting the best representation (given the network/buffer
     * state).
     * @param {string} type
     * @param {Observable<Object>} clock$
     * @param {Array.<Representation>|undefined} representations
     * @returns {Observable}
     */
    ABRManager.prototype.get$ = function (type, clock$, representations) {
        if (representations === void 0) { representations = []; }
        return this._lazilyCreateChooser(type).get$(clock$, representations);
    };
    /**
     * Set manually the bitrate for a given type.
     *
     * The given number will act as a ceil.
     * If no representation is found with the given bitrate, we will consider:
     *   1. The representation just lower than it
     *   2. If no representation is found in the previous step, the representation
     *   with the lowest bitrate.
     *
     * @param {string} type
     * @param {number} bitrate
     */
    ABRManager.prototype.setManualBitrate = function (type, bitrate) {
        log.info("ABR: Setting manual bitrate");
        var chooser = this._choosers[type];
        if (!chooser) {
            // if no chooser yet, store as a chooser option for when it will be
            // effectively instantiated
            this._chooserInstanceOptions.initialBitrates[type] = bitrate;
        }
        else {
            chooser.manualBitrate$.next(bitrate);
        }
    };
    /**
     * Set a maximum bitrate a given type will be able to automatically switch to.
     * The chooser for the given type can still emit higher bitrates with the
     * setManualBitrate method.
     * @param {string} supportedBufferTypes
     * @param {number} bitrate
     */
    ABRManager.prototype.setMaxAutoBitrate = function (type, bitrate) {
        log.info("ABR: Setting maximum auto bitrate");
        var chooser = this._choosers[type];
        if (!chooser) {
            // if no chooser yet, store as a chooser option for when it will be
            // effectively instantiated
            this._chooserInstanceOptions.maxAutoBitrates[type] = bitrate;
        }
        else {
            chooser.maxAutoBitrate$.next(bitrate);
        }
    };
    /**
     * Returns the set (and active) manual bitrate for the given type.
     * @param {string} supportedBufferTypes
     * @returns {number|undefined}
     */
    ABRManager.prototype.getManualBitrate = function (type) {
        var chooser = this._choosers[type];
        return chooser ?
            chooser.manualBitrate$.getValue() :
            this._chooserInstanceOptions.manualBitrates[type];
    };
    /**
     * Returns the set (and active) maximum auto bitrate for the given type.
     * @param {string} supportedBufferTypes
     * @returns {number|undefined}
     */
    ABRManager.prototype.getMaxAutoBitrate = function (type) {
        var chooser = this._choosers[type];
        return chooser ?
            chooser.maxAutoBitrate$.getValue() :
            this._chooserInstanceOptions.maxAutoBitrates[type];
    };
    /**
     * Clean every ressources linked to the ABRManager.
     * The ABRManager is unusable after calling this method.
     */
    ABRManager.prototype.dispose = function () {
        var _this = this;
        log.debug("ABR: Freeing up ressources");
        Object.keys(this._choosers).forEach(function (type) {
            _this._choosers[type].dispose();
        });
        this._chooserInstanceOptions = defaultChooserOptions;
        this._choosers = {};
        this._dispose$.next();
        this._dispose$.complete();
    };
    /**
     * If it doesn't exist, create a RepresentationChooser under the
     * _choosers[bufferType] property.
     * @param {string} bufferType
     * @returns {Object}
     */
    ABRManager.prototype._lazilyCreateChooser = function (bufferType) {
        if (!this._choosers[bufferType]) {
            log.debug("ABR: Creating new buffer for ", bufferType);
            this._choosers[bufferType] =
                createChooser(bufferType, this._chooserInstanceOptions);
        }
        return this._choosers[bufferType];
    };
    return ABRManager;
}());
export default ABRManager;