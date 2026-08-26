import { ALLOWED_MEDIA_MIME_TYPES, MAX_MEDIA_BYTES } from "../../media/upload-policy"
import type { UiLang } from "../i18n/ui-lang"

const mimeLabel = (mimeType: string): string => {
  switch (mimeType) {
    case "image/jpeg":
      return "JPEG"
    case "image/gif":
      return "GIF"
    case "image/png":
      return "PNG"
    case "image/webp":
      return "WebP"
    default:
      return mimeType
  }
}

const fileSizeLabel = (bytes: number): string => `${bytes / (1024 * 1024)} MB`

const TEXT = {
  en: {
    alt: "Add meaningful alternative text before saving so the asset remains understandable when the image cannot be seen.",
    formats: "Supported formats",
    kicker: "Media upload",
    localOnly: "Upload from this device. Remote URL import is disabled.",
    size: "Maximum file size",
    title: "Prepare accessible, release-safe assets",
  },
  zh: {
    alt: "保存前请填写有意义的替代文本，以便图片无法显示时内容仍然可被理解。",
    formats: "支持的格式",
    kicker: "媒体上传",
    localOnly: "请从当前设备上传；远程 URL 导入已关闭。",
    size: "最大文件大小",
    title: "准备可访问、可安全发布的媒体资源",
  },
} as const

export type MediaUploadGuidance = {
  readonly alt: string
  readonly formats: string
  readonly formatsLabel: string
  readonly kicker: string
  readonly localOnly: string
  readonly size: string
  readonly sizeLabel: string
  readonly title: string
}

/** Static list guidance backed by the same policy constants as upload validation. */
export const mediaUploadGuidanceOf = (language: UiLang): MediaUploadGuidance => {
  const t = TEXT[language]
  return {
    alt: t.alt,
    formats: ALLOWED_MEDIA_MIME_TYPES.map(mimeLabel).join(" · "),
    formatsLabel: t.formats,
    kicker: t.kicker,
    localOnly: t.localOnly,
    size: fileSizeLabel(MAX_MEDIA_BYTES),
    sizeLabel: t.size,
    title: t.title,
  }
}
