import { Router } from "express";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { z } from "zod";
import { generateEmailHtml } from "../services/html.service.ts";
import { gmailUser, isConfigured, sendMail } from "../services/mail.service.ts";
import type { EmailDraft } from "../../src/types/email.ts";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
});
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailPayloadSchema = z
  .object({
    to: z.string().max(2000),
    cc: z.string().max(2000).optional(),
    bcc: z.string().max(2000).optional(),
    subject: z.string().trim().min(1).max(200),
    greeting: z.string().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    closing: z.string().optional(),
    signature: z.string().optional(),
    sections: z.array(z.unknown()).optional(),
  })
  .passthrough();
const logoBuffer = readFileSync(
  fileURLToPath(new URL("../../src/assets/JSN DESIGN.png", import.meta.url)),
);
const list = (value: unknown) =>
  typeof value === "string"
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

router.get("/config", (_request, response) =>
  response.json({
    connected: isConfigured,
    gmailUser: isConfigured ? gmailUser : null,
  }),
);

router.post("/payment-link", (request, response) => {
  return createRazorpayPaymentLink(request, response);
});

async function createRazorpayPaymentLink(request: any, response: any) {
  const input = z.object({ amount: z.string().trim().regex(/^\d{1,6}(?:\.\d{1,2})?$/, "Enter a valid amount with up to two decimal places.") }).safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0]?.message || "Invalid payment amount." });
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || "";
  if (!keyId || !keySecret) return response.status(503).json({ error: "Hosted payment links are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the server .env file." });

  const [whole, fraction = ""] = input.data.amount.split(".");
  const amountMinor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (amountMinor <= 0n) return response.status(400).json({ error: "Payment amount must be greater than zero." });
  if (amountMinor > 10_000_000n) return response.status(400).json({ error: "Payment amount cannot exceed ₹1,00,000." });
  try {
    const providerResponse = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        upi_link: true,
        amount: Number(amountMinor),
        currency: "INR",
        accept_partial: false,
        description: "JSN Designs payment",
        reference_id: randomUUID(),
        expire_by: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        notify: { sms: false, email: false },
        reminder_enable: false,
      }),
    });
    const providerData = await providerResponse.json().catch(() => null) as {
      error?: { description?: unknown };
      short_url?: unknown;
    } | null;
    if (!providerResponse.ok) {
      const message = typeof providerData?.error?.description === "string"
        ? providerData.error.description
        : "Razorpay could not create the payment link.";
      return response.status(502).json({ error: message });
    }
    const paymentUrl = typeof providerData?.short_url === "string" ? new URL(providerData.short_url) : null;
    if (!paymentUrl || paymentUrl.protocol !== "https:" || !(paymentUrl.hostname === "rzp.io" || paymentUrl.hostname.endsWith(".rzp.io"))) {
      return response.status(502).json({ error: "Razorpay returned an invalid payment link." });
    }
    return response.json({
      paymentLink: paymentUrl.toString(),
      mode: keyId.startsWith("rzp_test_") ? "test" : "live",
    });
  } catch {
    return response.status(502).json({ error: "Could not connect to Razorpay. Check your internet connection and payment-link settings." });
  }
}

const handleSend = (test: boolean) => [
  upload.array("attachments", 10),
  async (request: any, response: any) => {
    let sending = false;
    try {
      const raw = JSON.parse(request.body.payload || "{}");
      const validation = emailPayloadSchema.safeParse(raw);
      if (!validation.success)
        return response.status(400).json({
          error:
            validation.error.issues[0]?.message || "Invalid email payload.",
        });
      const payload = validation.data as unknown as EmailDraft;
      if (test && !isConfigured)
        return response
          .status(503)
          .json({ error: "Gmail is not configured for test sending." });
      // A test message is always sent only to the configured sender account.
      // Do not allow stale To, CC, or BCC fields to leak it to other recipients.
      const recipients = test ? [gmailUser] : list(payload.to);
      const cc = test ? [] : list(payload.cc),
        bcc = test ? [] : list(payload.bcc);
      if (
        !recipients.length ||
        ![...recipients, ...cc, ...bcc].every((email) =>
          emailPattern.test(email),
        )
      )
        return response
          .status(400)
          .json({ error: "Enter valid email addresses for To, CC, and BCC." });
      const files: {
        filename: string;
        content: Buffer;
        contentType: string;
        cid?: string;
      }[] = (request.files || []).map((file: any) => ({
        filename: file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"),
        content: file.buffer,
        contentType: file.mimetype,
      }));
      // Logo embedded inline via CID reference — must include cid property for nodemailer to embed
      files.push({
        filename: "JSN-DESIGN.png",
        content: logoBuffer,
        contentType: "image/png",
        cid: "jsn-logo",
      });
      sending = true;
      await sendMail({
        to: recipients.join(", "),
        cc: cc.join(", ") || undefined,
        bcc: bcc.join(", ") || undefined,
        subject: payload.subject.trim(),
        html: generateEmailHtml(payload, "cid:jsn-logo"),
        attachments: files,
      });
      return response.json({ ok: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to send email";
      if (sending) console.error("Email delivery failed:", message);
      return response
        .status(
          message.startsWith("Gmail is not") ? 503 : sending ? 502 : 400,
        )
        .json({ error: message });
    }
  },
];

router.post("/test", ...(handleSend(true) as any));
router.post("/send", ...(handleSend(false) as any));
export default router;
