/**
 * Legal-page templates: the section structure of a privacy policy and of
 * terms of service, for `NeLegalPage` (narduk-libs#388).
 *
 * **These contain no legal wording, by decision.** Logan chose "Build, wording
 * later" on #388: the templates ship the headings and anchors a page needs,
 * and every body is a {@link legalPlaceholder} — an instruction for whoever
 * writes the approved text, not the text. No app ships a legal page live until
 * Logan approves its wording in a separate issue. An app's inputs (its name,
 * its company, its contact address, its processors) are interpolated only
 * inside those placeholders, quoted, so the draft says whose page it is and
 * nothing more.
 *
 * Every section returned has `placeholder: true`, so `NeLegalPage` renders
 * the page as a draft and `hasLegalPlaceholders` reports it until the app
 * replaces each section with approved wording of its own.
 *
 * Pure functions; no Vue import.
 */
import { legalPlaceholder } from '../components/ne-legal-page-types'

import type {
  NeLegalDocument,
  NeLegalSection,
  NeLegalTemplateOptions,
} from '../components/ne-legal-page-types'

function section(id: string, title: string, ...instructions: string[]): NeLegalSection {
  return { body: instructions.map(legalPlaceholder), id, placeholder: true, title }
}

function quoted(value: string): string {
  return `"${value}"`
}

/** A privacy policy's sections, every body a placeholder. */
export function privacyPolicyTemplate(options: NeLegalTemplateOptions): NeLegalDocument {
  const app = quoted(options.appName)
  const company = quoted(options.companyName)
  const processors = options.processors ?? []

  return {
    title: 'Privacy policy',
    sections: [
      section(
        'overview',
        'Overview',
        `identify the operator (${company}) and the service (${app}) this policy covers`,
      ),
      section(
        'information-collected',
        'Information collected',
        `describe what data ${app} collects, including data collected automatically`,
      ),
      section('how-information-is-used', 'How information is used', 'describe each purpose'),
      section(
        'processors',
        'Third-party processors',
        ...(processors.length === 0
          ? [`list every third party that receives data from ${app}, or state that none does`]
          : processors.map(
              (processor) =>
                `describe what ${quoted(processor.name)} (${processor.purpose}) receives and why`,
            )),
      ),
      section('retention', 'Retention', 'describe how long each kind of data is kept'),
      section('your-rights', 'Your rights', 'describe the rights users have and how to use them'),
      section(
        'contact',
        'Contact',
        `give ${quoted(options.contactEmail)} as the address for privacy questions to ${company}`,
      ),
      section('changes', 'Changes to this policy', 'describe how changes are announced'),
    ],
  }
}

/** Terms of service's sections, every body a placeholder. */
export function termsOfServiceTemplate(options: NeLegalTemplateOptions): NeLegalDocument {
  const app = quoted(options.appName)
  const company = quoted(options.companyName)

  return {
    title: 'Terms of service',
    sections: [
      section(
        'overview',
        'Overview',
        `identify the operator (${company}) and the service (${app}) these terms cover`,
      ),
      section('use-of-the-service', 'Use of the service', 'describe permitted and prohibited use'),
      section('accounts', 'Accounts', `describe account terms, if ${app} has accounts`),
      section(
        'third-party-data',
        'Third-party data',
        `describe the status of third-party data ${app} displays and its attribution`,
      ),
      section('intellectual-property', 'Intellectual property', 'describe ownership and licences'),
      section('disclaimers', 'Disclaimers', 'state the disclaimers that apply'),
      section('limitation-of-liability', 'Limitation of liability', 'state the limitation'),
      section('termination', 'Termination', 'describe how access can end'),
      section('governing-law', 'Governing law', 'name the governing law and venue'),
      section(
        'contact',
        'Contact',
        `give ${quoted(options.contactEmail)} as the address for questions to ${company}`,
      ),
      section('changes', 'Changes to these terms', 'describe how changes are announced'),
    ],
  }
}
