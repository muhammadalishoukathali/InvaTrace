/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_RELEASE_ID: string
  readonly VITE_ENABLE_MOCKS: string
  readonly VITE_ENABLE_FAKE_MODEL: string
  readonly VITE_ENABLE_REAL_MODEL?: string
  readonly VITE_MODEL_BASE_URL?: string
  readonly VITE_MAP_STYLE_URL?: string
  readonly VITE_MAP_TILE_URL?: string
  readonly VITE_MAP_TILE_ATTRIBUTION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'virtual:reference-image-versions' {
  /** File name in public/reference-images/ -> short SHA-256 of its bytes. */
  const versions: Record<string, string>
  export default versions
}
