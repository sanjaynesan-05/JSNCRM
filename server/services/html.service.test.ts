import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEmailHtml, generateEmailText } from '../../src/services/html.service.ts';
import type { EmailDraft } from '../../src/types/email.ts';

const draft = {
  from: '',
  to: '',
  cc: '',
  bcc: '',
  subject: 'Quotation for Reditus Labs',
  greeting: 'Dear Reditus Labs Team,',
  title: 'Quotation for Logo Design',
  body: 'Please find the attached quotation.',
  closing: 'Best regards,',
  signature: 'Sanjay Nesan J\nJSN DESIGNS',
  sections: [],
  ctaLabel: '',
  ctaUrl: '',
  template: 'professional',
  typography: {},
} as unknown as EmailDraft;

test('renders a compact, branded email with optional document details', () => {
  const html = generateEmailHtml({
    ...draft,
    companyName: 'Reditus Labs',
    documentReference: 'QT-001',
    issueDate: '22 October 2026',
    attachmentName: 'Quotation-QT-001.pdf',
  }, 'cid:jsn-logo');

  assert.match(html, /cid:jsn-logo/);
  assert.match(html, /#d4af37/);
  assert.match(html, /Attached document/);
  assert.match(html, /Reditus Labs/);
  assert.match(html, /role="presentation"/);
  assert.ok(html.length < 90 * 1024);
  assert.doesNotMatch(html, /undefined|null/);
});

test('omits optional blocks and escapes dynamic text', () => {
  const html = generateEmailHtml({
    ...draft,
    title: '<script>alert(1)</script>',
    body: 'Plain message',
  });

  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /Attached document/);
  assert.doesNotMatch(html, /Prepared for/);
});

test('provides a readable plain-text alternative', () => {
  const text = generateEmailText({
    ...draft,
    attachmentName: 'quote.pdf',
  });

  assert.match(text, /Dear Reditus Labs Team/);
  assert.match(text, /Attached document: quote.pdf/);
  assert.doesNotMatch(text, /<[^>]+>/);
});
