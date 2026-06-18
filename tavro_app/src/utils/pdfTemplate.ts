/**
 * Single source of truth for the Tavro PDF document template.
 *
 * This module re-exports the master markdown template file directly so that
 * every PDF generation path in the frontend references ONE file:
 *   copilot-server/templates/pdf-document-template.md
 *
 * The copilot server (server.js) reads the same file at runtime.
 * When the template changes, update only that .md file — no other edits needed.
 */

// Vite ?raw import — bundles the .md file contents as a string at build time.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import templateContent from '../../copilot-server/templates/pdf-document-template.md?raw';

export const PDF_DOCUMENT_TEMPLATE: string = templateContent as string;
