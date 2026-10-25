import { Router } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { z } from "zod";
import { generateEmailHtml, generateEmailText } from "../services/html.service.ts";
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
      const renderPayload: EmailDraft = {
        ...payload,
        attachmentName:
          payload.attachmentName?.trim() ||
          files
            .filter((file) => !file.cid)
            .map((file) => file.filename)
            .join(", "),
      };
      sending = true;
      await sendMail({
        to: recipients.join(", "),
        cc: cc.join(", ") || undefined,
        bcc: bcc.join(", ") || undefined,
        subject: payload.subject.trim(),
        html: generateEmailHtml(renderPayload, "cid:jsn-logo"),
        text: generateEmailText(renderPayload),
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
