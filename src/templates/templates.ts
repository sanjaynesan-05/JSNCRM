import type { TemplateId } from '../types/email';

export const templates: { id: TemplateId; name: string; description: string; accent: string }[] = [
  { id: 'professional', name: 'Professional', description: 'Client and project delivery', accent: '#d4af37' },
  { id: 'minimal', name: 'Minimal', description: 'Simple communication', accent: '#000000' },
  { id: 'announcement', name: 'Announcement', description: 'Launches and events', accent: '#d4af37' },
];
