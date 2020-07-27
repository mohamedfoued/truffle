var command = {
  command: "publish",
  description: "Publish a package to the Ethereum Package Registry",
  builder: {},
  help: {
    usage: "truffle publish",
    options: [],
  },
  run: function (options, done) {
    var Config = require("@truffle/config");
    var PackageV1 = require("ethpm-v1");
    var PackageV3 = require("ethpm-v3");

    var config = Config.detect(options);

    if (config.ethpm.version == "1") {
      PackageV1.publish(config)
        .then(() => {
          return done();
        })
        .catch(done);
    } else if (config.ethpm.version == "3") {
      PackageV3.publish(config)
        .then(() => {
          return done();
        })
        .catch(done);
    } else {
      done(new Error(`Unsupported ethpm version: ${config.ethpm.version}.`));
    }
  },
};

module.exports = command;
