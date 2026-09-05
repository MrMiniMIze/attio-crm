import { z } from 'zod';

const nullableString = z.string().nullable();

export const CompanyRef = z.object({
  record_id: nullableString,
  name: nullableString,
  domain: nullableString,
});

export const PersonRef = z.object({
  record_id: nullableString,
  first_name: nullableString,
  last_name: nullableString,
  email: nullableString,
});

export const ActorRef = z.object({
  member_id: nullableString,
  email: nullableString,
});

const Confidence = z.number().min(0).max(1);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const UpsertCompany = z.object({
  type: z.literal('upsert_company'),
  company: CompanyRef,
  confidence: Confidence,
});

export const UpsertPerson = z.object({
  type: z.literal('upsert_person'),
  person: PersonRef,
  company: CompanyRef.nullable(),
  confidence: Confidence,
});

export const SetDealStage = z
  .object({
    type: z.literal('set_deal_stage'),
    deal_record_id: nullableString,
    company: CompanyRef,
    person: PersonRef.nullable(),
    stage: z.string().min(1).nullable(),
    value: z.number().nullable(),
    owner: ActorRef,
    confidence: Confidence,
  })
  .refine((a) => a.deal_record_id !== null || a.stage !== null, {
    message: 'stage is required when creating a new deal',
    path: ['stage'],
  });

export const CreateTask = z.object({
  type: z.literal('create_task'),
  title: z.string().min(1),
  company: CompanyRef.nullable(),
  person: PersonRef.nullable(),
  due: IsoDate.nullable(),
  assignee: ActorRef,
  confidence: Confidence,
});

export const AddNote = z.object({
  type: z.literal('add_note'),
  company: CompanyRef.nullable(),
  person: PersonRef.nullable(),
  text: z.string().min(1),
  confidence: Confidence,
});

export const Action = z.discriminatedUnion('type', [UpsertCompany, UpsertPerson, SetDealStage, CreateTask, AddNote]);

export const Source = z.object({
  kind: z.enum(['modal', 'command', 'shortcut']),
  requester: z.string(),
  permalink: nullableString,
  received_at: z.string(),
  raw: z.string(),
});

export const ActionDocument = z.object({
  source: Source,
  actions: z.array(Action),
  needs_review: z.array(z.object({ fragment: z.string(), reason: z.string() })),
});

export type CompanyRef = z.infer<typeof CompanyRef>;
export type PersonRef = z.infer<typeof PersonRef>;
export type ActorRef = z.infer<typeof ActorRef>;
export type UpsertCompany = z.infer<typeof UpsertCompany>;
export type UpsertPerson = z.infer<typeof UpsertPerson>;
export type SetDealStage = z.infer<typeof SetDealStage>;
export type CreateTask = z.infer<typeof CreateTask>;
export type AddNote = z.infer<typeof AddNote>;
export type Action = z.infer<typeof Action>;
export type Source = z.infer<typeof Source>;
export type ActionDocument = z.infer<typeof ActionDocument>;

export function parseActionDocument(input: unknown): ActionDocument {
  return ActionDocument.parse(input);
}
