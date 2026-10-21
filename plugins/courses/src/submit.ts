import type { CampusFilePart } from '@pku-harness/sdk';
import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Blackboard assignment submission, ported from pkucli crates/course/src/api.rs
 * (get_submit_formfields + submit_assignment). Pure: HTML in, request parts out; the network
 * side lives in api.ts. The live form could not be re-inspected while writing this (no signed-in
 * 教学网 session in the research browser), so the field set is pkucli's, which was checked
 * against the live site.
 */

export const SUBMIT_PATH = '/webapps/assignment/uploadAssignment?action=submit';

/**
 * Files per submission. The builder below writes Blackboard's file-picker layout for any number
 * of files (repeated `newFile_*` fields + `newFile_LocalFile<i>`), but only the one-file layout is
 * verified (pkucli). Raise this after checking a multi-file submission on the live site.
 */
export const MAX_FILES = 1;

/** Largest file we send (Blackboard's own limit is set per course; this guards the phone). */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

export type SubmitForm = {
  /** The submission form exists (deadline not closed, attempts left). */
  open: boolean;
  /** Hidden fields of `form#uploadAssignmentFormId` and `div.field` inputs (api.rs get_submit_formfields). */
  fields: Record<string, string>;
  /** Why there is no form, from the page's receipt/notice, if any. */
  message: string | null;
};

const text = (el: HTMLElement | null | undefined) => (el?.text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** Inputs with both a name and a value attribute, as pkucli's extract_field. */
function inputs(root: HTMLElement | null, selector: string, into: Record<string, string>) {
  if (!root) return;
  for (const input of root.querySelectorAll(selector)) {
    const name = input.getAttribute('name');
    const value = input.getAttribute('value');
    const type = (input.getAttribute('type') ?? '').toLowerCase();
    if (!name || value == null || type === 'file' || type === 'button' || type === 'submit') continue;
    into[name] = value;
  }
}

/** The `action=newAttempt` page → hidden form fields, or why it can't be submitted. */
export function parseSubmitForm(html: string): SubmitForm {
  const dom = parse(html);
  const form = dom.querySelector('form#uploadAssignmentFormId');
  const fields: Record<string, string> = {};
  inputs(form, 'input', fields);
  inputs(dom, 'div.field input', fields);
  const open = !!form && 'blackboard.platform.security.NonceUtil.nonce' in fields;
  const notice = dom.querySelector('#inlineReceipt_bad, .receipt.bad, #badMsg1, .noItems, #inlineReceipt_good, .receipt');
  return { open, fields, message: open ? null : text(notice) || null };
}

/** Fields copied from the page's form, in pkucli's order. Missing ones fail the build. */
const REQUIRED = [
  'attempt_id',
  'blackboard.platform.security.NonceUtil.nonce',
  'blackboard.platform.security.NonceUtil.nonce.ajax',
  'content_id',
  'course_id',
  'isAjaxSubmit',
  'lu_link_id',
  'mode',
  'recallUrl',
  'remove_file_id',
  'studentSubmission.text_f',
  'studentSubmission.text_w',
  'studentSubmission.type',
  'student_commentstext_f',
  'student_commentstext_w',
  'student_commentstype',
  'textbox_prefix',
] as const;

export type SubmitFile = { name: string; mime: string; uri: string; size?: number | null };
export type SubmitInput = { text?: string; comment?: string; files: SubmitFile[] };

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text for a Blackboard text box: HTML paragraphs when the box type is HTML ('H'), else as is. */
export function textboxValue(plain: string, type: string | undefined) {
  const s = plain.replace(/\r\n?/g, '\n').trim();
  if (!s) return '';
  if (type && type.toUpperCase() !== 'H') return s;
  return s
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * The multipart body of `uploadAssignment?action=submit` (api.rs submit_assignment): the form's
 * hidden fields, the text/comment boxes, `dispatch=submit` and one file-picker row per file.
 * Throws when the form lacks a field pkucli needs (page changed, or not a submission form).
 */
export function buildSubmission(form: Record<string, string>, input: SubmitInput): { fields: [string, string][]; files: CampusFilePart[] } {
  const text = input.text?.trim() ?? '';
  const comment = input.comment?.trim() ?? '';
  if (!input.files.length && !text) throw new Error('至少要提交一个文件或一段文字');
  if (input.files.length > MAX_FILES) throw new Error(`目前一次最多提交 ${MAX_FILES} 个文件（可以先打包成 zip）`);
  const missing = REQUIRED.filter((k) => !(k in form));
  if (missing.length) throw new Error(`教学网提交表单缺少字段：${missing.join(', ')}（页面可能已改版，请在网页上提交）`);

  const fields: [string, string][] = REQUIRED.map((k) => [k, form[k]]);
  fields.push(
    ['studentSubmission.text', textboxValue(text, form['studentSubmission.type'])],
    ['student_commentstext', textboxValue(comment, form.student_commentstype)],
    ['dispatch', 'submit'],
  );
  for (const f of input.files) {
    fields.push(
      ['newFile_artifactFileId', 'undefined'],
      ['newFile_artifactType', 'undefined'],
      ['newFile_artifactTypeResourceKey', 'undefined'],
      ['newFile_attachmentType', 'L'],
      ['newFile_fileId', 'new'],
      ['newFile_linkTitle', f.name],
    );
  }
  fields.push(['newFilefilePickerLastInput', 'dummyValue'], ['useless', '']);
  const files = input.files.map((f, i) => ({ field: `newFile_LocalFile${i}`, name: f.name, mime: f.mime || 'application/octet-stream', uri: f.uri }));
  return { fields, files };
}

/** The response page of the submit POST: Blackboard's receipt, or its error. */
export function parseSubmitResult(status: number, html: string): { ok: boolean; message: string | null } {
  if (html.includes('尝试呈现错误页面时发生严重的内部错误')) return { ok: false, message: '教学网服务器内部错误' };
  const dom = parse(html);
  const bad = text(dom.querySelector('#inlineReceipt_bad, .receipt.bad, #badMsg1'));
  if (status >= 400) return { ok: false, message: bad || `HTTP ${status}` };
  if (bad) return { ok: false, message: bad };
  const good = text(dom.querySelector('#inlineReceipt_good, .receipt.good, #goodMsg1, .receipt'));
  return { ok: true, message: good || null };
}

/**
 * What the user confirmed, as one string: the submit screen hashes it into a one-time token and
 * the tool recomputes it, so a submission only goes out with exactly what the user reviewed.
 */
export function confirmationPayload(input: { courseId: string; contentId: string; text?: string; comment?: string; files: SubmitFile[] }) {
  return JSON.stringify([input.courseId, input.contentId, input.text?.trim() ?? '', input.comment?.trim() ?? '', input.files.map((f) => [f.uri, f.name, f.mime])]);
}

export const CONFIRM_KEY = 'submit.confirm';
export const DRAFT_KEY = 'submit.draft';
/** How long a confirmation stays valid after the user taps 确认提交. */
export const CONFIRM_TTL_MS = 2 * 60_000;

export type Confirmation = { token: string; digest: string; exp: number };

/**
 * The submission gate: only a user-invoked call carrying the token the review screen just stored,
 * over exactly the reviewed content, before it expires. Agent and scheduler calls never pass.
 */
export function confirmationValid(
  actor: 'user' | 'agent' | 'scheduler',
  token: string | undefined,
  stored: Confirmation | undefined,
  digest: string | null,
  now: number,
): boolean {
  return actor === 'user' && !!token && !!stored && stored.token === token && digest != null && stored.digest === digest && stored.exp >= now;
}
export type SubmitDraft = { courseId: string; contentId: string; title?: string; text?: string; comment?: string; savedAt: number };

export const fileSize = (n: number | null | undefined) => {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
