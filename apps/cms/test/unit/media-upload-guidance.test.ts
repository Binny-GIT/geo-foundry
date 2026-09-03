import { describe, expect, it } from "vitest"

import { ALLOWED_MEDIA_MIME_TYPES, MAX_MEDIA_BYTES } from "../../src/collections/Media"
import { mediaUploadGuidanceOf } from "../../src/components/media/media-upload-guidance-model"

describe("mediaUploadGuidanceOf", () => {
  it("derives visible upload constraints from the authoritative media policy", () => {
    expect(MAX_MEDIA_BYTES).toBe(5 * 1024 * 1024)
    expect(ALLOWED_MEDIA_MIME_TYPES).toEqual(["image/png", "image/jpeg", "image/webp", "image/gif"])

    const guidance = mediaUploadGuidanceOf("en")
    expect(guidance.formats).toBe("PNG · JPEG · WebP · GIF")
    expect(guidance.size).toBe("5 MB")
    expect(guidance.localOnly).toContain("Remote URL import is disabled")
  })

  it("uses Chinese product copy when Chinese is selected", () => {
    const guidance = mediaUploadGuidanceOf("zh")
    expect(guidance.kicker).toBe("媒体上传")
    expect(guidance.title).toContain("可访问")
    expect(guidance.alt).toContain("替代文本")
  })
})
