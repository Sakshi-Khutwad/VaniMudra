const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('html');

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
};

module.exports = config;
