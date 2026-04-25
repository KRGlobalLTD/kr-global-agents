import { createClient } from '@supabase/supabase-js';
import type { ContentRequest, GeneratedContent } from './content-generator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export type ContentStatus = 'draft' | 'approuve' | 'publie' | 'archive';

export interface ScheduleInput {
  request:   ContentRequest;
  generated: GeneratedContent;
  statut?:   ContentStatus;
}

export interface ContentRow {
  id:               string;
  marque:           string;
  type:             string;
  sujet:            string;
  titre:            string | null;
  contenu:          string | null;
  hashtags:         string[];
  meta_description: string | null;
  statut:           ContentStatus;
  modele:           string | null;
  entite_nom:       string;
  published_at:     string | null;
  created_at:       string;
}

// ---- Slack #contenu helper ----

async function notifySlackContenu(message: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_CONTENU;
  if (!webhookUrl) return;

  const response = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text:        message,
      username:    'ITACHI',
      icon_emoji:  ':pencil:',
    }),
  });

  if (!response.ok) {
    await supabase.from('alerts').insert({
      agent_name: 'ITACHI',
      level:      'WARNING',
      message:    `Slack #contenu webhook échoué : ${response.status}`,
    });
  }
}

// ---- Save content (schedule) ----

export async function scheduleContent(input: ScheduleInput): Promise<string> {
  const { request, generated, statut = 'draft' } = input;

  const { data, error } = await supabase
    .from('content')
    .insert({
      marque:           request.marque,
      type:             request.type,
      sujet:            request.sujet,
      ton:              request.ton,
      langue:           request.langue,
      longueur:         request.longueur,
      entite_nom:       request.entite_nom,
      titre:            generated.titre,
      contenu:          generated.contenu,
      hashtags:         generated.hashtags,
      meta_description: generated.meta_description,
      statut,
      modele:           generated.modele,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Erreur sauvegarde contenu : ${error.message}`);

  const contentId = (data as { id: string }).id;

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Contenu planifié id=${contentId} statut=${statut} (${request.marque} / ${request.type})`,
  });

  // Notifier immédiatement si le contenu est prêt à publier
  if (statut === 'approuve') {
    await notifySlackContenu(
      `✅ *Contenu prêt à publier*\n` +
      `Marque : ${request.marque} | Type : ${request.type}\n` +
      `Titre : ${generated.titre}\n` +
      `ID : \`${contentId}\``
    );
  }

  return contentId;
}

// ---- Approve ----

export async function approveContent(contentId: string): Promise<void> {
  const { data, error } = await supabase
    .from('content')
    .update({ statut: 'approuve' })
    .eq('id', contentId)
    .select('titre, marque, type')
    .single();

  if (error) throw new Error(`Erreur approbation contenu id=${contentId} : ${error.message}`);

  const row = data as { titre: string | null; marque: string; type: string };

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Contenu id=${contentId} approuvé`,
  });

  await notifySlackContenu(
    `✅ *Contenu approuvé — prêt à publier*\n` +
    `Marque : ${row.marque} | Type : ${row.type}\n` +
    `Titre : ${row.titre ?? '(sans titre)'}\n` +
    `ID : \`${contentId}\``
  );
}

// ---- Publish ----

export async function publishContent(contentId: string): Promise<void> {
  const { error } = await supabase
    .from('content')
    .update({
      statut:       'publie',
      published_at: new Date().toISOString(),
    })
    .eq('id', contentId);

  if (error) throw new Error(`Erreur publication contenu id=${contentId} : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Contenu id=${contentId} marqué comme publié`,
  });
}

// ---- Archive ----

export async function archiveContent(contentId: string): Promise<void> {
  const { error } = await supabase
    .from('content')
    .update({ statut: 'archive' })
    .eq('id', contentId);

  if (error) throw new Error(`Erreur archivage contenu id=${contentId} : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Contenu id=${contentId} archivé`,
  });
}

// ---- Get pending approval (status = draft) ----

export async function getPendingApproval(): Promise<ContentRow[]> {
  const { data, error } = await supabase
    .from('content')
    .select(
      'id, marque, type, sujet, titre, contenu, hashtags, meta_description, ' +
      'statut, modele, entite_nom, published_at, created_at'
    )
    .eq('statut', 'draft')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Erreur lecture contenu en attente : ${error.message}`);
  return (data ?? []) as unknown as ContentRow[];
}
