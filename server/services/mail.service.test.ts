import test from 'node:test';
import assert from 'node:assert/strict';
import { getSmtpConnectionOptions } from './mail.service.ts';

test('Gmail SMTP defaults to encrypted STARTTLS on port 587', () => {
  assert.deepEqual(getSmtpConnectionOptions(''), {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
});

test('Gmail SMTP supports implicit TLS on port 465', () => {
  const options = getSmtpConnectionOptions('465');
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.equal(options.requireTLS, false);
});

test('SMTP port rejects invalid values', () => {
  assert.throws(() => getSmtpConnectionOptions('not-a-port'), /SMTP_PORT/);
  assert.throws(() => getSmtpConnectionOptions('65536'), /SMTP_PORT/);
});
