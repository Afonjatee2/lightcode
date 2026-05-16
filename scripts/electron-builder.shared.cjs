// Mirror of src/shared/channel.ts for use by electron-builder.config.cjs and
// scripts/build-desktop-artifact.mjs. Keep field names identical to the TS
// module; src/shared/channel.config-parity.test.ts asserts they don't drift.

const CHANNELS = ["stable", "nightly"];

function normalizeChannel(value) {
  return value === "nightly" ? "nightly" : "stable";
}

function productNameFor(channel) {
  return channel === "nightly" ? "Lightcode Nightly" : "Lightcode";
}

function appIdFor(channel) {
  return channel === "nightly" ? "com.lightcode.app.nightly" : "com.lightcode.app";
}

function userDataDirNameFor(channel) {
  return channel === "nightly" ? ".lightcode-nightly" : ".lightcode";
}

function updaterChannelFor(channel) {
  return channel === "nightly" ? "nightly" : undefined;
}

function artifactPrefixFor(channel) {
  return channel === "nightly" ? "Lightcode-Nightly" : "Lightcode";
}

module.exports = {
  CHANNELS,
  normalizeChannel,
  productNameFor,
  appIdFor,
  userDataDirNameFor,
  updaterChannelFor,
  artifactPrefixFor,
};
