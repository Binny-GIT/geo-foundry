import type { ReactNode } from "react"

import type {
  RenderBlock,
  RenderContent,
  RenderFigureImage,
  RenderListing,
  RenderPage,
  RenderSlotName,
} from "@geo/render-core"

import { useGeoPage } from "./context.js"

const assertNever = (value: never): never => {
  throw new TypeError(`Unsupported render discriminator: ${String(value)}`)
}

const ImageFigure = ({ image, id }: Readonly<{ readonly id?: string; readonly image: RenderFigureImage }>): ReactNode => (
  <figure id={id}>
    <img
      alt={image.alt}
      height={image.height}
      loading="lazy"
      src={image.src}
      width={image.width}
    />
    {image.caption === undefined ? null : <figcaption>{image.caption}</figcaption>}
  </figure>
)

export const DefaultHero = ({
  hero,
  title,
}: Readonly<{ readonly hero: RenderContent["hero"]; readonly title: string }>): ReactNode => {
  if (hero === undefined) {
    return <h1>{title}</h1>
  }
  return (
    <header>
      <h1>{title}</h1>
      {hero.title === title ? null : <p>{hero.title}</p>}
      {hero.summary === undefined ? null : <p>{hero.summary}</p>}
      {hero.image === undefined ? null : <ImageFigure image={hero.image} />}
    </header>
  )
}

export const DefaultBreadcrumbs = ({ content }: Readonly<{ readonly content: RenderContent }>): ReactNode => (
  <nav aria-label="Breadcrumb">
    <ol>
      {content.breadcrumbs.map((breadcrumb) => (
        <li key={breadcrumb.pathname}>
          <a href={breadcrumb.pathname}>{breadcrumb.title}</a>
        </li>
      ))}
    </ol>
  </nav>
)

const DefaultBlock = ({ block }: Readonly<{ readonly block: RenderBlock }>): ReactNode => {
  switch (block.kind) {
    case "paragraph":
      return <p id={block.id}>{block.text}</p>
    case "heading": {
      const Heading = `h${block.level}` as "h2" | "h3" | "h4" | "h5" | "h6"
      return <Heading id={block.id}>{block.text}</Heading>
    }
    case "figure-image":
      return <ImageFigure {...(block.id === undefined ? {} : { id: block.id })} image={block} />
    case "quote":
      return (
        <blockquote id={block.id}>
          <p>{block.text}</p>
          {block.attribution === undefined ? null : (
            <footer>
              {block.citeUrl === undefined ? block.attribution : <cite>{block.attribution}</cite>}
            </footer>
          )}
        </blockquote>
      )
    case "ordered-list":
      return (
        <ol id={block.id}>
          {block.items.map((item, index) => <li key={`${block.id ?? "ordered"}-${index}`}>{item}</li>)}
        </ol>
      )
    case "unordered-list":
      return (
        <ul id={block.id}>
          {block.items.map((item, index) => <li key={`${block.id ?? "unordered"}-${index}`}>{item}</li>)}
        </ul>
      )
    case "table":
      return (
        <table id={block.id}>
          {block.caption === undefined ? null : <caption>{block.caption}</caption>}
          <thead>
            <tr>{block.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${block.id ?? "table"}-${rowIndex}`}>
                {row.map((cell, cellIndex) => <td key={`${block.id ?? "table"}-${rowIndex}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case "faq":
      return (
        <section id={block.id}>
          {block.items.map((item, index) => (
            <details key={`${block.id ?? "faq"}-${index}`}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </section>
      )
    case "callout":
      return (
        <aside data-tone={block.tone} id={block.id}>
          {block.title === undefined ? null : <strong>{block.title}</strong>}
          <p>{block.text}</p>
        </aside>
      )
    case "code":
      return (
        <figure id={block.id}>
          {block.caption === undefined ? null : <figcaption>{block.caption}</figcaption>}
          <pre><code data-language={block.language}>{block.code}</code></pre>
        </figure>
      )
    case "video":
      return (
        <figure id={block.id}>
          {/* biome-ignore lint/a11y/useMediaCaption: The semantic model supplies transcript text but no caption-track URL. */}
          <video controls poster={block.poster} src={block.src} title={block.title}>
            <a href={block.src}>{block.title}</a>
          </video>
          {block.transcript === undefined ? null : <figcaption>{block.transcript}</figcaption>}
        </figure>
      )
    case "embed":
      return <p id={block.id}><a href={block.url}>{block.title} ({block.provider})</a></p>
    case "references":
      return (
        <section id={block.id}>
          <h2>References</h2>
          <ol>
            {block.items.map((item) => (
              <li key={item.citation.id}>
                <a href={item.citation.url}>{item.label}</a>
              </li>
            ))}
          </ol>
        </section>
      )
    default:
      return assertNever(block)
  }
}

export const DefaultAuthor = ({ content }: Readonly<{ readonly content: RenderContent }>): ReactNode => {
  if (content.author === undefined) {
    return null
  }
  return <p>By {content.author.url === undefined ? content.author.name : <a href={content.author.url}>{content.author.name}</a>}</p>
}

export const DefaultRelatedPages = ({ content }: Readonly<{ readonly content: RenderContent }>): ReactNode => {
  if (content.relatedPages.length === 0) {
    return null
  }
  return (
    <section>
      <h2>Related pages</h2>
      <ul>
        {content.relatedPages.map((page) => <li key={page.pageId}><a href={page.pathname}>{page.title}</a></li>)}
      </ul>
    </section>
  )
}

export const DefaultListing = ({ listing }: Readonly<{ readonly listing: RenderListing }>): ReactNode => (
  <>
    <section aria-label="Page listing">
      <ul>{listing.items.map((item) => <li key={item.pageId}><a href={item.pathname}>{item.title}</a></li>)}</ul>
    </section>
    {listing.pagination === undefined ? null : (
      <nav aria-label="Pagination">
        {listing.pagination.previousPathname === undefined ? null : <a href={listing.pagination.previousPathname}>Previous</a>}
        <span>Page {listing.pagination.page} of {listing.pagination.totalPages}</span>
        {listing.pagination.nextPathname === undefined ? null : <a href={listing.pagination.nextPathname}>Next</a>}
      </nav>
    )}
  </>
)

export const ContentBody = ({ page }: Readonly<{ readonly page: Exclude<RenderPage, { readonly kind: "redirect" }> }>): ReactNode => {
  const { components, slots, tokens } = useGeoPage()
  const Slot = ({ name }: Readonly<{ readonly name: RenderSlotName }>): ReactNode => {
    const payload = page.content.slots.find((candidate) => candidate.name === name)
    const slot = slots[name]
    return payload === undefined || slot === undefined ? null : slot({ page, payload, tokens })
  }
  const content = page.content
  const Breadcrumbs = components.Breadcrumbs ?? ((props) => <DefaultBreadcrumbs content={props.content} />)
  const Hero = components.Hero ?? ((props) => <DefaultHero hero={props.hero} title={props.page.head.metadata.title} />)
  const Author = components.Author ?? ((props) => <DefaultAuthor content={props.content} />)
  const Block = components.Block ?? ((props) => <DefaultBlock block={props.block} />)
  const RelatedPages = components.RelatedPages ?? ((props) => <DefaultRelatedPages content={props.content} />)
  const Listing = components.Listing ?? ((props) => <DefaultListing listing={props.listing} />)
  return (
    <article style={{ color: tokens.foregroundColor, fontFamily: tokens.fontFamily, maxWidth: tokens.contentWidth }}>
      <Breadcrumbs content={content} page={page} tokens={tokens} />
      {content.hero === undefined ? <h1>{page.head.metadata.title}</h1> : <Hero hero={content.hero} page={page} tokens={tokens} />}
      <Slot name="after-hero" />
      <Author content={content} page={page} tokens={tokens} />
      {page.pageType === "article-list" || page.pageType === "category" || page.pageType === "tag" ? <Listing listing={page.listing} page={page} tokens={tokens} /> : null}
      <Slot name="before-body" />
      {content.blocks.map((block, index) => <Block block={block} key={block.id ?? `${block.kind}-${index}`} page={page} tokens={tokens} />)}
      <Slot name="after-body" />
      <RelatedPages content={content} page={page} tokens={tokens} />
    </article>
  )
}
