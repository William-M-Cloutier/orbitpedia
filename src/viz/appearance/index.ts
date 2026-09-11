export {
  inferSurfaceFamily,
  defaultFamilyColor,
  type SurfaceFamily,
} from "./surfaceFamily";
export { getBodyAppearanceMaterial, appearancePoolSize } from "./materialPool";
export { proceduralMap } from "./proceduralTextures";
/** Registry stub kept for future map packs — not used by rendering this slice. */
export { lookupTextureId, TEXTURE_REGISTRY } from "./textureRegistry";
export type { TextureRegistryEntry } from "./textureRegistry";
