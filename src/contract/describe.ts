import type { Action, ActionDocument, CompanyRef, PersonRef } from './action-document';

const companyNameOnly = (c: CompanyRef | null): string => {
  if (!c) return '';
  return c.name ?? c.domain ?? c.record_id ?? 'company';
};
const companyText = (c: CompanyRef | null): string => {
  if (!c) return '';
  const name = companyNameOnly(c);
  return c.domain && c.name ? `${c.name} (${c.domain})` : name;
};
const personText = (p: PersonRef): string => {
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
  return [name, p.email ? `<${p.email}>` : ''].filter(Boolean).join(' ') || p.record_id || 'person';
};
const oneLine = (s: string): string => s.replace(/\s*\r?\n\s*/g, ' ').trim();

function line(a: Action): string {
  switch (a.type) {
    case 'upsert_company': return `- Company: ${companyText(a.company)}`;
    case 'upsert_person': return `- Person: ${personText(a.person)}${a.company ? ` at ${companyNameOnly(a.company)}` : ''}`;
    case 'set_deal_stage': {
      const parts = [a.stage ? `stage ${a.stage}` : null, a.value !== null ? `value ${a.value}` : null, a.owner.email ? `owner ${a.owner.email}` : null].filter(Boolean);
      return `- Deal: ${companyNameOnly(a.company)} ${parts.join(', ')}`.trimEnd();
    }
    case 'create_task': {
      const parts = [oneLine(a.title), a.due ? `due ${a.due}` : null, a.assignee.email ? `assigned to ${a.assignee.email}` : null].filter(Boolean);
      return `- Task: ${parts.join(', ')}`;
    }
    case 'add_note': return `- Note: ${oneLine(a.text)}`;
  }
}

export function describeDocument(doc: ActionDocument): string {
  return doc.actions.map(line).join('\n');
}
