/**
 * `NeLegalPage`'s shapes and the placeholder vocabulary the legal templates
 * share (narduk-libs#388).
 *
 * Logan's decision on #388 was "Build, wording later": this package ships the
 * page layout and template *structure*, never legal wording. Every body the
 * templates produce is a {@link legalPlaceholder}, and no app goes live with a
 * legal page until Logan approves its wording in a separate issue. The helpers
 * here are how that stays checkable in code: the page reads them to decide
 * whether it is a draft, and an app's own test or CI can call
 * {@link hasLegalPlaceholders} on the sections it ships.
 *
 * A plain module, so the package root can re-export all of it without
 * compiling the SFC.
 */
import type { NeDateInput } from '../../format'

/** One section of a legal page. It is also one entry in the table of contents. */
export interface NeLegalSection {
  /** The section's anchor, e.g. `data-we-collect`. Unique within the page. */
  id: string
  /** The section heading, rendered as an `h2` and as the contents entry. */
  title: string
  /** Plain-text paragraphs. Rendered as text, never as HTML. */
  body: string | readonly string[]
  /**
   * `true` when the body is template placeholder text rather than approved
   * wording. The templates set it on every section they return.
   */
  placeholder?: boolean
}

/** A legal page's content, as the templates return it. */
export interface NeLegalDocument {
  title: string
  sections: NeLegalSection[]
}

export interface NeLegalPageProps {
  /** The page title, rendered as the page's `h1`. */
  title: string
  sections: readonly NeLegalSection[]
  /**
   * When the wording last changed. A `YYYY-MM-DD` calendar date needs no zone;
   * an instant is formatted in `timeZone` and is omitted without one, the
   * same rule `NeDetailView` applies.
   */
  lastUpdated?: NeDateInput
  /** IANA zone for an instant `lastUpdated`. */
  timeZone?: string
  /**
   * The app's acknowledgement that every section's wording has been approved
   * (for this estate: by Logan, in the issue that approves it). Defaults to
   * `false`, which keeps the draft banner up.
   *
   * It cannot switch a placeholder off: while any section is still a
   * placeholder the page stays a draft whatever this says.
   */
  wordingApproved?: boolean
  /** The table of contents' accessible name and visible heading. Defaults to `Contents`. */
  tocLabel?: string
}

/** A third party that receives user data, as the privacy template lists it. */
export interface NeLegalProcessor {
  /** e.g. `Cloudflare Web Analytics`. */
  name: string
  /** What it is used for, e.g. `analytics`, `sign-in`. */
  purpose: string
}

/**
 * The app-specific inputs the templates interpolate — only ever into a
 * placeholder, so the result says whose page it is without saying anything
 * legal on the app's behalf.
 */
export interface NeLegalTemplateOptions {
  /** The product name, e.g. `Buoys`. */
  appName: string
  /** The operating company's name. */
  companyName: string
  /** Where legal and privacy questions go. */
  contactEmail: string
  /** Third parties that receive data (analytics, auth, hosting, …). */
  processors?: readonly NeLegalProcessor[]
}

/**
 * The prefix every placeholder starts with. Searching a page, a bundle or a
 * rendered HTML file for it finds template text an app has not replaced.
 */
export const NE_LEGAL_PLACEHOLDER_MARK = '[PLACEHOLDER'

/**
 * One placeholder paragraph: an instruction for whoever writes the approved
 * wording, inside the unmistakable mark. This is the only text the templates
 * produce.
 */
export function legalPlaceholder(instruction: string): string {
  return `${NE_LEGAL_PLACEHOLDER_MARK} — legal wording pending Logan's review: ${instruction}]`
}

function paragraphsOf(section: NeLegalSection): readonly string[] {
  return typeof section.body === 'string' ? [section.body] : section.body
}

/** True when the section is flagged as a placeholder or any paragraph carries the mark. */
export function isLegalPlaceholder(section: NeLegalSection): boolean {
  return (
    section.placeholder === true ||
    paragraphsOf(section).some((paragraph) => paragraph.includes(NE_LEGAL_PLACEHOLDER_MARK))
  )
}

/**
 * True when anything in the page is still template text. Accepts a template's
 * whole result or just its sections, so an app's test can assert
 * `expect(hasLegalPlaceholders(privacySections)).toBe(false)` before launch.
 */
export function hasLegalPlaceholders(
  content: readonly NeLegalSection[] | { sections: readonly NeLegalSection[]; title?: string },
): boolean {
  const sections = Array.isArray(content)
    ? (content as readonly NeLegalSection[])
    : (content as { sections: readonly NeLegalSection[] }).sections
  return sections.some(isLegalPlaceholder)
}
