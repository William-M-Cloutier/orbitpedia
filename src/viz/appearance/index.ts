export {
  inferSurfaceFamily,
  defaultFamilyColor,
  type SurfaceFamily,
} from "./surfaceFamily";
export {
  getBodyAppearanceMaterial,
  appearancePoolSize,
  getSatSharedMaterial,
  getSatPointsMaterial,
  satAppearancePoolSize,
  type SatMaterialRole,
} from "./materialPool";
export { proceduralMap } from "./proceduralTextures";
export { lookupTextureId, TEXTURE_REGISTRY } from "./textureRegistry";
export type { TextureRegistryEntry } from "./textureRegistry";
export { useRegistryTexture, requestRegistryTexture } from "./textureLoader";
export {
  getSmallBodyGeometry,
  hashBodyId,
  smallBodyGeometryCacheSize,
} from "./smallBodyGeometry";
