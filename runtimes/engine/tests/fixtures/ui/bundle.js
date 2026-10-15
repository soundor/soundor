(function (exports, require, module) {
  // A stand-in for a built plugin bundle, embedded by the native tests: in the
  // runtime's module form, as the CLI bundles a plugin's UI.
  const { plugin } = require('soundor:host');
  const { describe } = require('./lib.js');

  globalThis.started = describe(plugin.name);
});
