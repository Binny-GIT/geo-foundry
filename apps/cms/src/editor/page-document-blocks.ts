import type { Block, Field } from "payload"

const extensionsField = (): Field => ({ name: "extensions", type: "json" })

export const PAGE_DOCUMENT_BLOCKS = [
  {
    slug: "paragraph",
    labels: { plural: "Paragraphs", singular: "Paragraph" },
    fields: [{ name: "text", type: "textarea", required: true }, extensionsField()],
  },
  {
    slug: "heading",
    labels: { plural: "Headings", singular: "Heading" },
    fields: [
      { name: "level", type: "select", options: ["2", "3", "4", "5", "6"], required: true },
      { name: "text", type: "text", required: true },
      extensionsField(),
    ],
  },
  {
    slug: "image",
    labels: { plural: "Images", singular: "Image" },
    fields: [
      { name: "src", type: "text", required: true },
      { name: "alt", type: "text", required: true },
      { name: "caption", type: "text" },
      { name: "width", type: "number", min: 1 },
      { name: "height", type: "number", min: 1 },
      extensionsField(),
    ],
  },
  {
    slug: "quote",
    labels: { plural: "Quotes", singular: "Quote" },
    fields: [
      { name: "text", type: "textarea", required: true },
      { name: "attribution", type: "text" },
      { name: "citeUrl", type: "text" },
      extensionsField(),
    ],
  },
  {
    slug: "list",
    labels: { plural: "Lists", singular: "List" },
    fields: [
      { name: "style", type: "select", options: ["ordered", "unordered"], required: true },
      {
        name: "items",
        type: "array",
        minRows: 1,
        required: true,
        fields: [{ name: "text", type: "text", required: true }],
      },
      extensionsField(),
    ],
  },
  {
    slug: "table",
    labels: { plural: "Tables", singular: "Table" },
    fields: [
      {
        name: "columns",
        type: "array",
        minRows: 1,
        required: true,
        fields: [{ name: "text", type: "text", required: true }],
      },
      {
        name: "rows",
        type: "array",
        minRows: 1,
        required: true,
        fields: [
          {
            name: "cells",
            type: "array",
            minRows: 1,
            required: true,
            fields: [{ name: "text", type: "text", required: true }],
          },
        ],
      },
      { name: "caption", type: "text" },
      extensionsField(),
    ],
  },
  {
    slug: "faq",
    labels: { plural: "FAQs", singular: "FAQ" },
    fields: [
      {
        name: "items",
        type: "array",
        minRows: 1,
        required: true,
        fields: [
          { name: "question", type: "text", required: true },
          { name: "answer", type: "textarea", required: true },
        ],
      },
      extensionsField(),
    ],
  },
  {
    slug: "callout",
    labels: { plural: "Callouts", singular: "Callout" },
    fields: [
      {
        name: "tone",
        type: "select",
        options: ["info", "success", "warning", "danger"],
        required: true,
      },
      { name: "title", type: "text" },
      { name: "text", type: "textarea", required: true },
      extensionsField(),
    ],
  },
  {
    slug: "code",
    labels: { plural: "Code", singular: "Code" },
    fields: [
      { name: "language", type: "text", required: true },
      { name: "code", type: "textarea", required: true },
      { name: "caption", type: "text" },
      extensionsField(),
    ],
  },
  {
    slug: "video",
    labels: { plural: "Videos", singular: "Video" },
    fields: [
      { name: "src", type: "text", required: true },
      { name: "title", type: "text", required: true },
      { name: "poster", type: "text" },
      { name: "transcript", type: "textarea" },
      extensionsField(),
    ],
  },
  {
    slug: "embed",
    labels: { plural: "Embeds", singular: "Embed" },
    fields: [
      { name: "provider", type: "text", required: true },
      { name: "url", type: "text", required: true },
      { name: "title", type: "text", required: true },
      extensionsField(),
    ],
  },
  {
    slug: "references",
    labels: { plural: "References", singular: "References" },
    fields: [
      {
        name: "items",
        type: "array",
        minRows: 1,
        required: true,
        fields: [
          { name: "citationId", type: "text", required: true },
          { name: "label", type: "text", required: true },
        ],
      },
      extensionsField(),
    ],
  },
] satisfies Block[]
