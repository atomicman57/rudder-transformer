const stats = require("../../util/stats");

function ResponseBuilder() {
  this.response = {};

  this.setMessage = message => {
    this.response.message = message;
    return this;
  };
  this.setStatus = status => {
    this.response.status = status;
    return this;
  };

  this.setDestinationResponse = destinationResponse => {
    this.response.destinationResponse = destinationResponse;
    return this;
  };

  this.setApiInfo = apiLimit => {
    this.response.apiLimit = apiLimit;
    return this;
  };

  this.setMetadata = metadata => {
    this.response.metadata = metadata;
    return this;
  };

  this.isFailure = arg => {
    this.response.isFailure = arg;
    return this;
  };

  this.setFailureAt = arg => {
    this.response.failureAt = arg;
    return this;
  };

  this.setresponseorResponse = () => {
    this.response.response = {
      status: this.response.status,
      message: this.response.message
    };
    return this;
  };

  this.isExplicit = arg => {
    this.response.isExplicit = arg;
    return this;
  };

  this.statsTiming = (name, start, tags = {}) => {
    stats.timing(name, start, tags);
    return this;
  };

  this.statsIncrement = (name, delta = 1, tags = {}) => {
    stats.increment(name, delta, tags);
    return this;
  };

  this.statsDecrement = (name, delta = -1, tags = {}) => {
    stats.decrement(name, delta, tags);
    return this;
  };

  this.statsCounter = (name, delta, tags = {}) => {
    stats.counter(name, delta, tags);
    return this;
  };

  this.statsGauge = (name, value, tags = {}) => {
    stats.gauge(name, value, tags);
    return this;
  };

  this.setStatTags = (statsObj = {}) => {
    this.response.statTags = { ...statsObj };
    return this;
  };

  this.setAuthErrorCategory = errorCat => {
    this.response.authErrorCategory = errorCat;
    return this;
  };

  this.setStatName = name => {
    this.response.statName = name;
    return this;
  };

  this.build = () => this.response;
}



module.exports = ResponseBuilder;
