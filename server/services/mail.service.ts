import nodemailer from 'nodemailer';

const user = process.env.GMAIL_USER || '';
const password = process.env.GMAIL_APP_PASSWORD || '';

export function getSmtpConnectionOptions(portValue = process.env.SMTP_PORT) {
  const smtpPort = portValue?.trim() ? Number(portValue) : 587;
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port number.');
  }

  return {
    host: 'smtp.gmail.com',
    port: smtpPort,
    secure: smtpPort === 465,
    requireTLS: smtpPort !== 465,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  };
}

export const isConfigured = Boolean(user && password);
export const gmailUser = user;

export const smtpConnectionOptions = getSmtpConnectionOptions();

const transporter = nodemailer.createTransport({
  ...smtpConnectionOptions,
  auth: { user, pass: password },
});

export async function sendMail(options: { to: string; cc?: string; bcc?: string; subject: string; html: string; text?: string; attachments?: { filename: string; content: Buffer; contentType?: string; cid?: string }[] }) {
  if (!isConfigured) throw new Error('Gmail is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to .env.');
  return transporter.sendMail({ from: user, to: options.to, cc: options.cc, bcc: options.bcc, subject: options.subject, html: options.html, text: options.text, attachments: options.attachments });
}
