import { recall, remember } from '@/lib/qdrant/memory';
import { COLLECTIONS }      from '@/lib/qdrant/collections';

export async function getMemory(clientEmail: string): Promise<string> {
  if (!clientEmail) return '';

  try {
    const results = await recall(COLLECTIONS.clients, clientEmail, {
      limit:    3,
      minScore: 0.5,
    });

    if (!results.length) return '';

    return results
      .map(r => `[Contexte client — score ${r.score.toFixed(2)}]\n${r.text}`)
      .join('\n\n');
  } catch {
    return '';
  }
}

export async function saveMemory(
  clientEmail: string,
  interaction: string,
): Promise<void> {
  if (!clientEmail || !interaction) return;

  const id = `client-${clientEmail}-${Date.now()}`;

  try {
    await remember(COLLECTIONS.clients, {
      id,
      text:    interaction,
      payload: {
        email:     clientEmail,
        savedAt:   new Date().toISOString(),
        type:      'interaction',
      },
    });
  } catch {
    // non-bloquant
  }
}

export async function getEmailHistory(fromEmail: string): Promise<string> {
  if (!fromEmail) return '';

  try {
    const results = await recall(COLLECTIONS.emails, fromEmail, {
      limit:    5,
      minScore: 0.4,
    });

    if (!results.length) return '';

    return results
      .map(r => `[Email — ${(r.payload['receivedAt'] as string | undefined) ?? 'date inconnue'}]\n${r.text}`)
      .join('\n\n');
  } catch {
    return '';
  }
}

export async function saveEmailMemory(
  fromEmail: string,
  subject: string,
  body: string,
): Promise<void> {
  if (!fromEmail) return;

  const id = `email-${fromEmail}-${Date.now()}`;

  try {
    await remember(COLLECTIONS.emails, {
      id,
      text:    `Sujet: ${subject}\n${body}`,
      payload: {
        from:       fromEmail,
        subject,
        receivedAt: new Date().toISOString(),
      },
    });
  } catch {
    // non-bloquant
  }
}

export async function getProspectContext(query: string): Promise<string> {
  if (!query) return '';

  try {
    const results = await recall(COLLECTIONS.prospects, query, {
      limit:    3,
      minScore: 0.45,
    });

    if (!results.length) return '';

    return results
      .map(r => `[Prospect similaire]\n${r.text}`)
      .join('\n\n');
  } catch {
    return '';
  }
}

export async function saveProspectMemory(
  email: string,
  company: string,
  summary: string,
): Promise<void> {
  if (!email) return;

  const id = `prospect-${email}-${Date.now()}`;

  try {
    await remember(COLLECTIONS.prospects, {
      id,
      text:    summary,
      payload: { email, company, savedAt: new Date().toISOString() },
    });
  } catch {
    // non-bloquant
  }
}

export async function getContentHistory(sujet: string): Promise<string> {
  if (!sujet) return '';

  try {
    const results = await recall(COLLECTIONS.content, sujet, {
      limit:    3,
      minScore: 0.5,
    });

    if (!results.length) return '';

    return results
      .map(r => `[Contenu précédent — ${(r.payload['plateforme'] as string | undefined) ?? ''}]\n${r.text}`)
      .join('\n\n');
  } catch {
    return '';
  }
}

export async function saveContentMemory(
  contentId: string,
  plateforme: string,
  titre: string,
  contenu: string,
): Promise<void> {
  if (!contentId) return;

  try {
    await remember(COLLECTIONS.content, {
      id:      `content-${contentId}`,
      text:    `${titre}\n\n${contenu}`,
      payload: { contentId, plateforme, savedAt: new Date().toISOString() },
    });
  } catch {
    // non-bloquant
  }
}
