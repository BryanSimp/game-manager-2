// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// @gm/shared and @gm/api-client ship TS source with ESM ".js" specifiers
// (compiled by tsc for the API). Metro resolves literally, so retry
// "./constants.js" as "./constants" (→ .ts) when the literal path misses.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  try {
    return resolve(context, moduleName, platform);
  } catch (error) {
    if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
      return resolve(context, moduleName.slice(0, -3), platform);
    }
    throw error;
  }
};

module.exports = config;
