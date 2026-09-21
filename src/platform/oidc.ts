import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client();

/**
 * The /tasks/write route writes to Attio with no Slack signature to check,
 * so this token is its only protection. Both halves matter: a token that is
 * merely valid proves only that Google issued it to somebody.
 */
export async function verifyQueueToken(
  authorization: string | null,
  audience: string,
  invoker: string,
): Promise<boolean> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token || !audience || !invoker) return false;
  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience });
    return ticket.getPayload()?.email === invoker;
  } catch {
    return false;
  }
}
