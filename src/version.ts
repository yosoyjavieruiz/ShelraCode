import packageManifest from "../package.json" with { type: "json" };

export { CLI_NAME, PRODUCT_NAME } from "./product/identity.js";
export const VERSION = packageManifest.version;
