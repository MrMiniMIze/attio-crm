import type { SlackApi } from '../../src/slack/api';

export function fakeSlack() {
  const calls: { method: string; args: unknown[] }[] = [];
  let ts = 0;
  const api: SlackApi = {
    async viewsOpen(...args) { calls.push({ method: 'viewsOpen', args }); return { view_id: 'V-fake' }; },
    async viewsUpdate(...args) { calls.push({ method: 'viewsUpdate', args }); },
    async chatPostMessage(channel, ...rest) { calls.push({ method: 'chatPostMessage', args: [channel, ...rest] }); return { channel, ts: `1725.${++ts}` }; },
    async chatUpdate(...args) { calls.push({ method: 'chatUpdate', args }); },
    async chatGetPermalink(channel, t) { calls.push({ method: 'chatGetPermalink', args: [channel, t] }); return `https://slack.test/p/${t}`; },
    async usersInfo(userId) { calls.push({ method: 'usersInfo', args: [userId] }); return { name: 'Sagar', email: 'sagar@example.com' }; },
    async respond(...args) { calls.push({ method: 'respond', args }); },
  };
  return { api, calls };
}
