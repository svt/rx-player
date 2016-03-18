const EventEmitter = require("canal-js-utils/eventemitter");
const { Observable } = require("rxjs/Observable");
const { BufferedRanges } = require("./ranges");
const assert = require("canal-js-utils/assert");
const castToObservable = require("../utils/to-observable");

class AbstractSourceBuffer extends EventEmitter {
  constructor(codec) {
    super();
    this.codec = codec;
    this.updating = false;
    this.readyState = "opened";
    this.buffered = new BufferedRanges();
  }

  appendBuffer(data) {
    this._lock(() => this._append(data));
  }

  remove(from, to) {
    this._lock(() => this._remove(from, to));
  }

  abort() {
    this.remove(0, Infinity);
    this.updating = false;
    this.readyState = "closed";
    this._abort();
  }

  _append(/* data */) {}
  _remove(/* from, to */) {}
  _abort() {}

  _lock(func) {
    assert(!this.updating, "updating");
    this.updating = true;
    this.trigger("updatestart");
    let result;
    try {
      result = castToObservable(func());
    } catch(e) {
      result = Observable.throw(e);
    }
    result.subscribe(
      ()  => this._unlock("update"),
      (e) => this._unlock("error", e)
    );
  }

  _unlock(eventName, value) {
    this.updating = false;
    this.trigger(eventName, value);
    this.trigger("updateend");
  }
}

module.exports = {
  AbstractSourceBuffer,
};
