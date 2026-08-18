import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getPayload, type Payload } from "payload"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import type { Media, Site, Tenant, User } from "../../src/payload-types"

const asUser = (user: User) => ({ overrideAccess: false as const, user, depth: 0 })

const REAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const pngBytes = (size = 64): Buffer => {
  const real = Buffer.from(REAL_PNG_BASE64, "base64")
  if (size >= real.length) {
    return Buffer.concat([real, Buffer.alloc(size - real.length)])
  }
  return real.subarray(0, size)
}

const uploadFile = { data: pngBytes(96), mimetype: "image/png", name: "fixture.png", size: 96 }

describe("tenant-isolated media storage integration", () => {
  let payload: Payload
  let tenantA: Tenant
  let tenantB: Tenant
  let superAdmin: User
  let tenantAAdmin: User
  let tenantBAdmin: User
  let editorA: User
  let editorB: User
  let siteA: Site
  let s3: S3Client
  let uploaded: Media

  const objectKeyOf = (media: Media): string => `objects/media/${media.prefix}/${media.filename}`

  beforeAll(async () => {
    payload = await getPayload({ config })
    for (const collection of [
      "media",
      "content-editions",
      "contents",
      "domains",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }

    superAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "boot@geo-foundry.test",
        password: "bootstrap-password-260818",
        role: "editor",
      },
    })) as User

    tenantA = await payload.create({
      collection: "tenants",
      data: { name: "media-tenant-a" },
      ...asUser(superAdmin),
    })
    tenantB = await payload.create({
      collection: "tenants",
      data: { name: "media-tenant-b" },
      ...asUser(superAdmin),
    })

    tenantAAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "admin-a@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenantA.id,
      },
      ...asUser(superAdmin),
    })) as User
    editorA = (await payload.create({
      collection: "users",
      data: {
        email: "editor-a@geo-foundry.test",
        password: "editor-password",
        role: "editor",
        tenant: tenantA.id,
      },
      ...asUser(superAdmin),
    })) as User
    editorB = (await payload.create({
      collection: "users",
      data: {
        email: "editor-b@geo-foundry.test",
        password: "editor-password",
        role: "editor",
        tenant: tenantB.id,
      },
      ...asUser(superAdmin),
    })) as User
    tenantBAdmin = (await payload.create({
      collection: "users",
      data: {
        email: "admin-b@geo-foundry.test",
        password: "tenant-admin-password",
        role: "tenant-admin",
        tenant: tenantB.id,
      },
      ...asUser(superAdmin),
    })) as User

    siteA = await payload.create({
      collection: "sites",
      data: {
        name: "Media Site",
        tenant: tenantA.id,
        locale: "en-US",
        timezone: "UTC",
        status: "active",
      },
      ...asUser(tenantAAdmin),
    })

    s3 = new S3Client({
      credentials: {
        accessKeyId: process.env["GEO_FOUNDRY_S3_ACCESS_KEY"] ?? "",
        secretAccessKey: process.env["GEO_FOUNDRY_S3_SECRET_KEY"] ?? "",
      },
      endpoint: "http://127.0.0.1:9000",
      forcePathStyle: true,
      region: "us-east-1",
    })

    uploaded = (await payload.create({
      collection: "media",
      data: { alt: "Tenant A fixture", tenant: tenantA.id },
      file: uploadFile,
      ...asUser(editorA),
    })) as Media
  })

  afterAll(async () => {
    for (const collection of [
      "media",
      "content-editions",
      "contents",
      "domains",
      "sites",
      "users",
      "tenants",
    ] as const) {
      await payload.delete({ collection, where: {}, overrideAccess: true })
    }
    s3?.destroy()
    await payload.destroy()
  })

  it("Given an editor upload, when stored, then the object key is tenant-partitioned and exists in RustFS", async () => {
    expect(uploaded.prefix).toBe(`tenants/${tenantA.id}`)
    expect(uploaded.filename).not.toContain("..")
    expect(uploaded.mediaPath).toBe(`/media/tenants/${tenantA.id}/fixture.png`)
    expect(uploaded.url).not.toContain("..")

    const head = await s3.send(
      new HeadObjectCommand({ Bucket: "geo-foundry", Key: objectKeyOf(uploaded) }),
    )
    expect(head.ContentLength).toBe(96)
  })

  it("Given a foreign tenant editor, when the media id is targeted, then access is denied", async () => {
    await expect(
      payload.findByID({ collection: "media", id: uploaded.id, ...asUser(editorB) }),
    ).rejects.toThrow()
  })

  it("Given anonymous sessions, when media is listed or fetched, then access is denied", async () => {
    await expect(payload.find({ collection: "media", overrideAccess: false })).rejects.toThrow()
    await expect(
      payload.findByID({ collection: "media", id: uploaded.id, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it("Given an edition body referencing own-tenant media, when written, then the image block passes the PageDocument contract", async () => {
    const content = await payload.create({
      collection: "contents",
      data: {
        topic: "Media reference",
        intent: "Prove release-safe derivative metadata",
        tenant: tenantA.id,
        createdBy: "human",
      },
      ...asUser(editorA),
    })
    const edition = await payload.create({
      collection: "content-editions",
      data: {
        content: content.id,
        site: siteA.id,
        tenant: tenantA.id,
        angle: "media-reference",
        title: "Edition with media",
        summary: "References a tenant-owned derivative.",
        body: [
          {
            blockType: "image" as const,
            src: uploaded.mediaPath as string,
            alt: uploaded.alt as string,
            caption: "Fixture",
          },
        ],
        primaryTopic: "media",
        creationOrigin: "human",
        workflowStatus: "draft",
      },
      ...asUser(editorA),
    })
    expect(String(edition.site)).toBe(String(siteA.id))
    await payload.delete({ collection: "content-editions", id: edition.id, overrideAccess: true })
    await payload.delete({ collection: "contents", id: content.id, overrideAccess: true })
  })

  it("Given an edition referencing a foreign tenant media url, when written, then it is rejected", async () => {
    const content = await payload.create({
      collection: "contents",
      data: {
        topic: "Foreign media",
        intent: "Cross-tenant reference",
        tenant: tenantB.id,
        createdBy: "human",
      },
      ...asUser(editorB),
    })
    const siteB = await payload.create({
      collection: "sites",
      data: {
        name: "Foreign Site",
        tenant: tenantB.id,
        locale: "en-US",
        timezone: "UTC",
        status: "active",
      },
      ...asUser(tenantBAdmin),
    })
    await expect(
      payload.create({
        collection: "content-editions",
        data: {
          content: content.id,
          site: siteB.id,
          tenant: tenantB.id,
          angle: "foreign-media",
          title: "Foreign media edition",
          summary: "Must be rejected.",
          body: [
            {
              blockType: "image" as const,
              src: uploaded.mediaPath as string,
              alt: "Stolen derivative",
            },
          ],
          primaryTopic: "media",
          creationOrigin: "human",
          workflowStatus: "draft",
        },
        ...asUser(editorB),
      }),
    ).rejects.toThrow(/CMS_MEDIA_TENANT_MISMATCH/)
    await payload.delete({ collection: "sites", id: siteB.id, overrideAccess: true })
    await payload.delete({ collection: "contents", id: content.id, overrideAccess: true })
  })

  it("Given a deleted source referenced by a draft, when written, then it is rejected", async () => {
    const doomed = (await payload.create({
      collection: "media",
      data: { alt: "Doomed fixture", tenant: tenantA.id },
      file: uploadFile,
      ...asUser(editorA),
    })) as Media
    const mediaRef = doomed.mediaPath as string
    await payload.delete({ collection: "media", id: doomed.id, overrideAccess: true })

    const content = await payload.create({
      collection: "contents",
      data: {
        topic: "Deleted media",
        intent: "Dangling reference",
        tenant: tenantA.id,
        createdBy: "human",
      },
      ...asUser(editorA),
    })
    await expect(
      payload.create({
        collection: "content-editions",
        data: {
          content: content.id,
          site: siteA.id,
          tenant: tenantA.id,
          angle: "deleted-media",
          title: "Dangling reference edition",
          summary: "Must be rejected.",
          body: [{ blockType: "image" as const, src: mediaRef, alt: "Dangling derivative" }],
          primaryTopic: "media",
          creationOrigin: "human",
          workflowStatus: "draft",
        },
        ...asUser(editorA),
      }),
    ).rejects.toThrow(/CMS_MEDIA_MISSING/)
    await payload.delete({ collection: "contents", id: content.id, overrideAccess: true })
  })

  it("Given an unsupported file type, when uploaded, then a structured policy failure is raised", async () => {
    await expect(
      payload.create({
        collection: "media",
        data: { alt: "Bad type", tenant: tenantA.id },
        file: {
          data: pngBytes(32),
          mimetype: "application/pdf",
          name: "doc.pdf",
          size: 32,
        },
        ...asUser(editorA),
      }),
    ).rejects.toThrow(/CMS_MEDIA_TYPE_UNSUPPORTED|file type/i)
  })

  it("Given an oversize file, when uploaded, then a structured policy failure is raised", async () => {
    await expect(
      payload.create({
        collection: "media",
        data: { alt: "Too large", tenant: tenantA.id },
        file: {
          data: pngBytes(6 * 1024 * 1024),
          mimetype: "image/png",
          name: "big.png",
          size: 6 * 1024 * 1024,
        },
        ...asUser(editorA),
      }),
    ).rejects.toThrow(/CMS_MEDIA_FILE_TOO_LARGE/)
  })

  it("Given an upload without alt text, when validated, then it is rejected", async () => {
    await expect(
      payload.create({
        collection: "media",
        data: { tenant: tenantA.id, alt: "" },
        file: uploadFile,
        ...asUser(editorA),
      }),
    ).rejects.toThrow(/alt/i)
  })

  it("Given a path-traversal filename, when uploaded, then the stored key is sanitized", async () => {
    const sneaky = (await payload.create({
      collection: "media",
      data: { alt: "Traversal attempt", tenant: tenantA.id },
      file: {
        data: pngBytes(96),
        mimetype: "image/png",
        name: "../../escape.png",
        size: 96,
      },
      ...asUser(editorA),
    })) as Media

    const key = objectKeyOf(sneaky)
    expect(key.startsWith(`objects/media/tenants/${tenantA.id}/`)).toBe(true)
    expect(key).not.toMatch(/\/\.\.\//)
    expect(sneaky.url).not.toMatch(/\/\.\.\//)
    expect(sneaky.mediaPath).not.toMatch(/\/\.\.\//)
    const head = await s3.send(new HeadObjectCommand({ Bucket: "geo-foundry", Key: key }))
    expect(head.ContentLength).toBe(96)
    await payload.delete({ collection: "media", id: sneaky.id, overrideAccess: true })
  })
})
