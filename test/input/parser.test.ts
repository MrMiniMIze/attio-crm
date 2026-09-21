import { describe, it, expect } from 'vitest';
import { parseCommandText, ruleParser } from '../../src/input/parser.ts';

const today = '2026-09-04';

describe('parseCommandText', () => {
  it('ruleParser.parse delegates to parseCommandText', () => {
    expect(ruleParser.parse('note hi', today)).toEqual(parseCommandText('note hi', today));
  });

  it('empty or unknown text opens the chooser', () => {
    expect(parseCommandText('', today)).toEqual({ kind: 'chooser', prefill: {} });
    expect(parseCommandText('   ', today)).toEqual({ kind: 'chooser', prefill: {} });
    expect(parseCommandText('frobnicate x', today)).toEqual({ kind: 'chooser', prefill: {} });
  });

  it('lead with person @ company', () => {
    expect(parseCommandText('lead Jane Doe @ cozeva.com', today)).toEqual({
      kind: 'lead',
      prefill: { person_name: { value: 'Jane Doe' }, company: { value: 'new:cozeva.com', label: 'Create new: "cozeva.com"' } },
    });
  });

  it('lead with only a domain or only a name', () => {
    expect(parseCommandText('LEAD cozeva.com', today).prefill).toEqual({ company: { value: 'new:cozeva.com', label: 'Create new: "cozeva.com"' } });
    expect(parseCommandText('lead Jane Doe', today).prefill).toEqual({ person_name: { value: 'Jane Doe' } });
    expect(parseCommandText('lead', today)).toEqual({ kind: 'lead', prefill: {} });
  });

  it('hunt splits on commas into lines', () => {
    expect(parseCommandText('hunt Ensora, acme.com ,  Beta Health', today)).toEqual({
      kind: 'hunt', prefill: { companies: { value: 'Ensora\nacme.com\nBeta Health' } },
    });
  });

  it('deal opens the form without prefill', () => {
    expect(parseCommandText('deal Cozeva to in progress', today)).toEqual({ kind: 'deal', prefill: {} });
  });

  it('task parses a trailing due clause', () => {
    expect(parseCommandText('task Follow up with Cozeva due tomorrow', today)).toEqual({
      kind: 'task', prefill: { task_title: { value: 'Follow up with Cozeva' }, task_due: { value: '2026-09-05' } },
    });
    expect(parseCommandText('task Call Jane due 2026-09-10', today).prefill.task_due).toEqual({ value: '2026-09-10' });
    expect(parseCommandText('task Call Jane', today).prefill).toEqual({ task_title: { value: 'Call Jane' } });
  });

  it('note prefills the note text', () => {
    expect(parseCommandText('note Met them at HLTH', today)).toEqual({ kind: 'note', prefill: { note: { value: 'Met them at HLTH' } } });
  });
});
