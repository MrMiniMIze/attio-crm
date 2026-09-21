import type { AttioClient, AttioMember } from '../attio/client';
import type { Store } from '../store/store';
import type { Config } from '../env';
import type { FormContext, ViewMetadata } from './views';

export interface ContextDeps { attio: AttioClient; store: Store; config: Config }

const HOUR = 3600;

export async function loadStages(deps: ContextDeps): Promise<string[]> {
  const cached = await deps.store.getCache<string[]>('stages');
  if (cached && cached.length > 0) return cached;
  const stages = (await deps.attio.listStageOptions()).filter((s) => !s.is_archived).map((s) => s.title);
  await deps.store.putCache('stages', stages, HOUR);
  return stages;
}

export async function loadMembers(deps: ContextDeps): Promise<AttioMember[]> {
  const cached = await deps.store.getCache<AttioMember[]>('members');
  if (cached && cached.length > 0) return cached;
  const members = (await deps.attio.listMembers()).filter((m) => m.email);
  await deps.store.putCache('members', members, HOUR);
  return members;
}

export async function loadFormContext(deps: ContextDeps, metadata: ViewMetadata): Promise<FormContext> {
  const [stages, members] = await Promise.all([loadStages(deps), loadMembers(deps)]);
  return {
    stages,
    members: members.map((m) => ({ email: m.email, name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email })),
    defaultOwnerEmail: deps.config.defaultOwnerEmail,
    metadata,
  };
}
