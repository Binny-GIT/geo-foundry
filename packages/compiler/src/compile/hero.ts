import { assetUrlOf } from "../seo/urls.js"
import type { GraphHeroImage } from "../structured-data/graph.js"
import { COMPILER_ERROR, CompilerError } from "./errors.js"
import type { CompileEdition, CompileSite } from "./snapshot.js"

const firstImageMediaId = (body: readonly unknown[]): string | undefined => {
  for (const block of body) {
    if (
      block !== null &&
      typeof block === "object" &&
      (block as Record<string, unknown>)["blockType"] === "image" &&
      typeof (block as Record<string, unknown>)["mediaId"] === "string"
    ) {
      return (block as Record<string, string>)["mediaId"]
    }
  }
  return undefined
}

/**
 * Hero image selection is fully deterministic: the explicit heroMediaId
 * wins, otherwise the first image block of the body. The chosen media must
 * exist in the snapshot and carry alt text - the hero is visible content,
 * so it obeys the same media/alt gates as body blocks.
 */
export const heroImageOf = (
  edition: CompileEdition,
  site: CompileSite,
): GraphHeroImage | undefined => {
  const mediaId = edition.heroMediaId ?? firstImageMediaId(edition.body)
  if (mediaId === undefined) {
    return undefined
  }
  const media = edition.media.find((entry) => entry.id === mediaId)
  if (media === undefined) {
    throw new CompilerError(
      COMPILER_ERROR.MEDIA_MISSING,
      `hero media ${mediaId} of edition ${edition.editionId} has no snapshot entry`,
    )
  }
  if (media.alt === undefined || media.alt.length === 0) {
    throw new CompilerError(
      COMPILER_ERROR.MEDIA_ALT_MISSING,
      `hero media ${mediaId} of edition ${edition.editionId} has no alt text`,
    )
  }
  return {
    caption: media.alt,
    ...(media.height === undefined ? {} : { height: media.height }),
    url: assetUrlOf(site, media.path, `media ${mediaId} path`),
    ...(media.width === undefined ? {} : { width: media.width }),
  }
}
