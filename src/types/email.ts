export type TemplateId = 'professional' | 'minimal' | 'announcement';

export type TypographyTarget = 'title' | 'heading' | 'body' | 'list' | 'table' | 'button' | 'signature';
export type TypographyStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textAlign: 'left' | 'center' | 'right';
  color: string;
  backgroundColor: string;
};

export type EmailTable = {
  rows: EmailTableCell[][];
  columnWidths?: number[];
  rowHeights?: number[];
  header: boolean;
  align: 'left' | 'center' | 'right';
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  cellPadding: number;
};

export type EmailTableCell = {
  id: string;
  content: string;
  colSpan?: number;
  rowSpan?: number;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  color?: string;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  padding?: number;
  borderColor?: string;
  borderWidth?: number;
};

export type SectionBlock = {
  id: string;
  type: 'paragraph' | 'list' | 'image' | 'cta' | 'divider' | 'table';
  content: string;
  items: string[];
  ordered: boolean;
  imageUrl: string;
  imageAlt: string;
  ctaLabel: string;
  ctaUrl: string;
  table?: EmailTable;
};

export type EmailSection = {
  id: string;
  heading: string;
  content: string;
  bullets: string[];
  blocks?: SectionBlock[];
};

export type EmailDraft = {
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  greeting: string;
  title: string;
  body: string;
  sections: EmailSection[];
  closing: string;
  signature: string;
  ctaLabel: string;
  ctaUrl: string;
  template: TemplateId;
  typography: Record<TypographyTarget, TypographyStyle>;
  recipientName?: string;
  companyName?: string;
  documentReference?: string;
  issueDate?: string;
  attachmentName?: string;
  senderName?: string;
  businessName?: string;
  businessDescription?: string;
  businessContact?: string;
  footerContent?: string;
};

export type AttachmentItem = { id: string; file: File };
