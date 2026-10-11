import type { EmailDraft, EmailSection, EmailTable, EmailTableCell, SectionBlock, TypographyStyle } from '../types/email';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const safeUrl = (value: string) => /^https?:\/\//i.test(value.trim()) ? value.trim() : '#';
const text = (value: string) => escapeHtml(value).replace(/\n/g, '<br>');

// Strict rich-text sanitizer — strips unknown tags, normalises divs to p, handles links and font colour/size
const richText = (value: string) =>
  value
    .replace(/<!--.*?-->/gs, '')
    .replace(/<([^>]+)>/g, (tag, inside: string) => {
      const match = inside.trim().match(/^\/?([a-z0-9]+)/i);
      if (!match) return '';
      const rawName = match[1].toLowerCase();
      const name = rawName === 'div' ? 'p' : rawName;
      const closing = inside.trim().startsWith('/');
      if (!['strong', 'b', 'em', 'i', 'u', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span', 'font'].includes(name) && rawName !== 'div') return '';
      if (closing) return name === 'font' ? '</span>' : `</${name}>`;
      if (name === 'a') {
        const href = inside.match(/href\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1];
        return href ? `<a href="${escapeHtml(href)}" style="color:#000000;text-decoration:underline;">` : '';
      }
      if (name === 'font') {
        const color = inside.match(/color\s*=\s*["'](#[0-9a-f]{3,8})["']/i)?.[1];
        const size = inside.match(/size\s*=\s*["']([1-7])["']/i)?.[1];
        const px = size === '2' ? 12 : size === '4' ? 18 : size === '5' ? 22 : size === '6' ? 26 : 15;
        return `<span style="${color ? `color:${color};` : ''}${size ? `font-size:${px}px;` : ''}">`;
      }
      if (name === 'span') {
        // pass-through span with its inline style
        const style = inside.match(/style\s*=\s*["']([^"']*)["']/i)?.[1];
        return style ? `<span style="${escapeHtml(style)}">` : '<span>';
      }
      return `<${name}>`;
    });

const defaultStyle = (target: string): TypographyStyle => ({
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: target === 'title' ? 28 : 15,
  fontWeight: target === 'heading' || target === 'title' ? 700 : 400,
  lineHeight: 1.6,
  letterSpacing: 0,
  textAlign: 'left',
  color: '#1a1a1a',
  backgroundColor: 'transparent',
});

const styleFor = (draft: EmailDraft, target: keyof EmailDraft['typography']) => draft.typography?.[target] ?? defaultStyle(target);

const css = (s: TypographyStyle, extras = '') => {
  const bg = s.backgroundColor && s.backgroundColor !== 'transparent' ? `background-color:${s.backgroundColor};` : '';
  return `font-family:${s.fontFamily};font-size:${s.fontSize}px;font-weight:${s.fontWeight};line-height:${s.lineHeight};letter-spacing:${s.letterSpacing}px;text-align:${s.textAlign};color:${s.color};${bg}${extras}`;
};

const renderTable = (table: EmailTable, style: TypographyStyle) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${css(style)}"><tbody>${table.rows.map((row, ri) =>
    `<tr${table.rowHeights?.[ri] ? ` style="height:${table.rowHeights[ri]}px;"` : ''}>${row.map((rawCell, ci) => {
      const cell: EmailTableCell = typeof rawCell === 'string' ? { id: '', content: rawCell } : rawCell;
      const isHeader = ri === 0 && table.header;
      const cellStyle = [
        `padding:${cell.padding ?? table.cellPadding}px`,
        `border:${cell.borderWidth ?? table.borderWidth}px solid ${escapeHtml(cell.borderColor ?? table.borderColor)}`,
        `text-align:${cell.textAlign ?? table.align}`,
        `vertical-align:${cell.verticalAlign ?? 'top'}`,
        `font-size:${cell.fontSize ?? table.fontSize}px`,
        `font-weight:${cell.fontWeight ?? (isHeader ? 700 : table.fontWeight)}`,
        `font-style:${cell.italic ? 'italic' : 'normal'}`,
        `color:${escapeHtml(cell.color ?? table.color)}`,
        `background-color:${escapeHtml(cell.backgroundColor ?? (isHeader ? table.backgroundColor : '#ffffff'))}`,
        table.columnWidths?.[ci] ? `width:${table.columnWidths[ci]}px` : '',
      ].filter(Boolean).join(';');
      return `<td${(cell.colSpan ?? 1) > 1 ? ` colspan="${cell.colSpan}"` : ''}${(cell.rowSpan ?? 1) > 1 ? ` rowspan="${cell.rowSpan}"` : ''} style="${cellStyle}">${text(cell.content)}</td>`;
    }).join('')}</tr>`
  ).join('')}</tbody></table>`;

const renderBlock = (block: SectionBlock, draft: EmailDraft): string => {
  const bodyStyle = styleFor(draft, 'body');
  if (block.type === 'paragraph') return `<div style="margin:0 0 18px;${css(bodyStyle)}">${richText(block.content)}</div>`;
  if (block.type === 'list') {
    const tag = block.ordered ? 'ol' : 'ul';
    return `<${tag} style="margin:0 0 18px;padding-left:22px;${css(styleFor(draft, 'list'))}">${block.items.filter(Boolean).map((item) => `<li>${richText(item)}</li>`).join('')}</${tag}>`;
  }
  if (block.type === 'image' && block.imageUrl) return `<img src="${escapeHtml(safeUrl(block.imageUrl))}" alt="${escapeHtml(block.imageAlt)}" width="560" style="display:block;max-width:100%;height:auto;margin:0 0 20px;" />`;
  if (block.type === 'divider') return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:8px 0 22px;border-bottom:1px solid #dfe5df;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>`;
  if (block.type === 'cta' && block.ctaLabel && block.ctaUrl) {
    const btnStyle = styleFor(draft, 'button');
    return `<p style="margin:4px 0 22px;text-align:${btnStyle.textAlign};"><a href="${escapeHtml(safeUrl(block.ctaUrl))}" style="display:inline-block;padding:13px 22px;border-radius:3px;text-decoration:none;${css(btnStyle)}">${text(block.ctaLabel)}</a></p>`;
  }
  if (block.type === 'table' && block.table) return `<div style="margin:0 0 22px;">${renderTable(block.table, styleFor(draft, 'table'))}</div>`;
  return '';
};

const renderSection = (section: EmailSection, draft: EmailDraft) => {
  const blocks = section.blocks?.length
    ? section.blocks
    : [{ id: `${section.id}-legacy`, type: 'paragraph' as const, content: section.content, items: [], ordered: false, imageUrl: '', imageAlt: '', ctaLabel: '', ctaUrl: '' }];
  return `<tr><td style="padding:0 44px 22px;"><h2 style="margin:0 0 10px;${css(styleFor(draft, 'heading'))}">${text(section.heading)}</h2>${blocks.map((block) => renderBlock(block, draft)).join('')}</td></tr>`;
};

export function generateEmailHtml(draft: EmailDraft, logoSrc = ''): string {
  const accent = '#d4af37';
  const titleStyle = styleFor(draft, 'title');
  const bodyStyle = styleFor(draft, 'body');
  const signatureStyle = styleFor(draft, 'signature');
  const buttonStyle = styleFor(draft, 'button');

  // Logo: use provided src (data URL for preview, cid: for email) — never a dark fallback block
  const logo = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="JSN Designs" width="88" height="auto" style="display:block;width:88px;max-width:88px;height:auto;border:0;margin-bottom:22px;" />`
    : `<p style="margin:0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:3px;color:#000000;font-weight:800;">JSN DESIGNS</p>`;

  const greeting = `<p style="margin:0 0 18px;${css(bodyStyle)}">${text(draft.greeting || 'Hello,')}</p>`;
  const body = draft.body ? `<div style="margin:0 0 18px;${css(bodyStyle)}">${richText(draft.body)}</div>` : '';
  const legacyCta = draft.ctaLabel && draft.ctaUrl
    ? `<tr><td style="padding:2px 44px 28px;"><a href="${escapeHtml(safeUrl(draft.ctaUrl))}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:3px;${css(buttonStyle)}">${text(draft.ctaLabel)}</a></td></tr>`
    : '';

  // Title color must use the draft's configured color (not hardcoded dark)
  const titleColor = titleStyle.color && titleStyle.color !== 'transparent' ? titleStyle.color : '#000000';
  const titleBg = titleStyle.backgroundColor && titleStyle.backgroundColor !== 'transparent' ? titleStyle.backgroundColor : '#ffffff';

  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(draft.subject || 'Email')}</title></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;-webkit-text-size-adjust:100%;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;padding:32px 16px;"><tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#ffffff;"><tr><td style="background:${escapeHtml(titleBg)};padding:28px 44px 30px;border-bottom:1px solid #d4af37;">${logo}<h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:${titleStyle.fontSize}px;font-weight:${titleStyle.fontWeight};color:${escapeHtml(titleColor)};line-height:${titleStyle.lineHeight};letter-spacing:${titleStyle.letterSpacing}px;">${text(draft.title || 'A considered note')}</h1></td></tr><tr><td style="padding:34px 44px 12px;">${greeting}${body}</td></tr>${draft.sections.map((s) => renderSection(s, draft)).join('')}${legacyCta}<tr><td style="padding:4px 44px 34px;border-top:1px solid #d4af37;"><p style="margin:24px 0 8px;${css(bodyStyle)}">${text(draft.closing)}</p><p style="margin:0;white-space:pre-line;${css(signatureStyle)}">${text(draft.signature)}</p></td></tr></table></td></tr></table></body></html>`;
}
