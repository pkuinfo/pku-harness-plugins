/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { buildSubmission, confirmationPayload, parseSubmitForm, parseSubmitResult, textboxValue } from './submit';

// Anonymized newAttempt form, field names as pkucli api.rs get_submit_formfields reads them.
const FORM = `<form id="uploadAssignmentFormId" action="/webapps/assignment/uploadAssignment?action=submit" method="post" enctype="multipart/form-data">
  <input type="hidden" name="attempt_id" value="">
  <input type="hidden" name="blackboard.platform.security.NonceUtil.nonce" value="nonce-1">
  <input type="hidden" name="blackboard.platform.security.NonceUtil.nonce.ajax" value="nonce-2">
  <input type="hidden" name="content_id" value="_11_1">
  <input type="hidden" name="course_id" value="_8001_1">
  <input type="hidden" name="isAjaxSubmit" value="false">
  <input type="hidden" name="lu_link_id" value="">
  <input type="hidden" name="mode" value="">
  <input type="hidden" name="recallUrl" value="/webapps/blackboard/content/listContent.jsp?content_id=_5_1&amp;course_id=_8001_1">
  <input type="hidden" name="remove_file_id" value="">
  <input type="file" name="newFile_LocalFile0" value="">
  <input type="submit" name="bottom_Submit" value="提交">
  <div class="field">
    <input type="hidden" name="studentSubmission.text_f" value="">
    <input type="hidden" name="studentSubmission.text_w" value="">
    <input type="hidden" name="studentSubmission.type" value="H">
    <input type="hidden" name="student_commentstext_f" value="">
    <input type="hidden" name="student_commentstext_w" value="">
    <input type="hidden" name="student_commentstype" value="H">
    <input type="hidden" name="textbox_prefix" value="studentSubmission.text">
    <input type="text" name="no_value">
  </div>
</form>`;

describe('parseSubmitForm', () => {
  test('hidden fields, file/submit inputs skipped', () => {
    const f = parseSubmitForm(FORM);
    expect(f.open).toBe(true);
    expect(f.fields.course_id).toBe('_8001_1');
    expect(f.fields.recallUrl).toBe('/webapps/blackboard/content/listContent.jsp?content_id=_5_1&course_id=_8001_1');
    expect(f.fields['studentSubmission.type']).toBe('H');
    expect('newFile_LocalFile0' in f.fields).toBe(false);
    expect('bottom_Submit' in f.fields).toBe(false);
    expect('no_value' in f.fields).toBe(false);
  });

  test('closed assignment: no form, the page notice', () => {
    const f = parseSubmitForm('<div id="inlineReceipt_bad"><span>该作业已过截止日期，不能再提交。</span></div>');
    expect(f.open).toBe(false);
    expect(f.message).toBe('该作业已过截止日期，不能再提交。');
  });
});

describe('buildSubmission', () => {
  const form = parseSubmitForm(FORM).fields;

  test('pkucli field set, one file row, file part', () => {
    const b = buildSubmission(form, { files: [{ name: '作业1.pdf', mime: 'application/pdf', uri: 'file:///data/user/0/app/cache/x.pdf' }] });
    const map = new Map(b.fields);
    expect(map.get('blackboard.platform.security.NonceUtil.nonce')).toBe('nonce-1');
    expect(map.get('dispatch')).toBe('submit');
    expect(map.get('newFile_linkTitle')).toBe('作业1.pdf');
    expect(map.get('newFile_attachmentType')).toBe('L');
    expect(map.get('studentSubmission.text')).toBe('');
    expect(b.fields.at(-1)).toEqual(['useless', '']);
    expect(b.files).toEqual([{ field: 'newFile_LocalFile0', name: '作业1.pdf', mime: 'application/pdf', uri: 'file:///data/user/0/app/cache/x.pdf' }]);
  });

  test('text only, as HTML paragraphs, escaped', () => {
    const b = buildSubmission(form, { text: '第一段 <b>\n续行\n\n第二段 & 完', comment: '谢谢', files: [] });
    const map = new Map(b.fields);
    expect(map.get('studentSubmission.text')).toBe('<p>第一段 &lt;b&gt;<br>续行</p><p>第二段 &amp; 完</p>');
    expect(map.get('student_commentstext')).toBe('<p>谢谢</p>');
    expect(map.has('newFile_linkTitle')).toBe(false);
    expect(b.files).toEqual([]);
  });

  test('refuses empty, too many files, missing fields', () => {
    expect(() => buildSubmission(form, { files: [], text: '  ' })).toThrow('至少');
    const f = { name: 'a', mime: 'text/plain', uri: 'file:///a' };
    expect(() => buildSubmission(form, { files: [f, f] })).toThrow('最多');
    const { 'blackboard.platform.security.NonceUtil.nonce': _n, ...noNonce } = form;
    expect(() => buildSubmission(noNonce, { files: [f] })).toThrow('NonceUtil.nonce');
  });

  test('textboxValue keeps plain text for non-HTML boxes', () => {
    expect(textboxValue('a<b', 'P')).toBe('a<b');
    expect(textboxValue('   ', 'H')).toBe('');
  });
});

describe('parseSubmitResult', () => {
  test('receipt, error receipt, server error, HTTP error', () => {
    expect(parseSubmitResult(200, '<div id="inlineReceipt_good">作业已成功提交</div>')).toEqual({ ok: true, message: '作业已成功提交' });
    expect(parseSubmitResult(200, '<div id="inlineReceipt_bad">文件过大</div>')).toEqual({ ok: false, message: '文件过大' });
    expect(parseSubmitResult(500, '尝试呈现错误页面时发生严重的内部错误').ok).toBe(false);
    expect(parseSubmitResult(403, '<html></html>')).toEqual({ ok: false, message: 'HTTP 403' });
    expect(parseSubmitResult(200, '<html><body>复查提交历史记录</body></html>')).toEqual({ ok: true, message: null });
  });
});

test('confirmationPayload changes with any reviewed detail', () => {
  const base = { courseId: '_1_1', contentId: '_2_1', text: 'x', files: [{ name: 'a.pdf', mime: 'application/pdf', uri: 'file:///a' }] };
  const p = confirmationPayload(base);
  expect(confirmationPayload({ ...base, text: ' x ' })).toBe(p);
  expect(confirmationPayload({ ...base, text: 'y' })).not.toBe(p);
  expect(confirmationPayload({ ...base, files: [{ ...base.files[0], uri: 'file:///b' }] })).not.toBe(p);
  expect(confirmationPayload({ ...base, contentId: '_3_1' })).not.toBe(p);
});

test('confirmationValid: user + matching token + digest + unexpired only', async () => {
  const { confirmationValid } = await import('./submit');
  const stored = { token: 'tok', digest: 'dig', exp: 1000 };
  expect(confirmationValid('user', 'tok', stored, 'dig', 999)).toBe(true);
  expect(confirmationValid('agent', 'tok', stored, 'dig', 999)).toBe(false);
  expect(confirmationValid('scheduler', 'tok', stored, 'dig', 999)).toBe(false);
  expect(confirmationValid('user', 'other', stored, 'dig', 999)).toBe(false);
  expect(confirmationValid('user', 'tok', stored, 'changed', 999)).toBe(false);
  expect(confirmationValid('user', 'tok', stored, 'dig', 1001)).toBe(false);
  expect(confirmationValid('user', 'tok', undefined, 'dig', 999)).toBe(false);
  expect(confirmationValid('user', undefined, stored, 'dig', 999)).toBe(false);
});
