import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { writeOutreachEmail, type EmailType } from './email-writer';
import type { ProspectSearchFilters } from './prospect-finder';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

const FROM    = 'KILLUA · KR Global <agent@krglobalsolutionsltd.com>';
const REPLYTO = 'agent@krglobalsolutionsltd.com';

// ---- Types ----

interface CampaignProspect {
  id: string;
  name: string;
  email: string;
  company: string | null;
  job_title: string | null;
  industry: string | null;
  status: string;
  outreach_initial_sent: string | null;
  outreach_followup1_sent: string | null;
  outreach_followup2_sent: string | null;
  outreach_replied_at: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  total_prospects: number;
  emails_sent: number;
  replies: number;
  conversions: number;
  created_at: string;
}

export interface CycleResult {
  processed: number;
  sent: number;
  converted: number;
  errors: number;
}

export interface CampaignStats {
  campaign: Campaign;
  conversionRate: number;
  replyRate: number;
}

// ---- Helpers ----

function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
}

function parseName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(' ');
  return {
    firstName: parts[0] ?? fullName,
    lastName:  parts.slice(1).join(' ') || '',
  };
}

type OutreachColumn =
  | 'outreach_initial_sent'
  | 'outreach_followup1_sent'
  | 'outreach_followup2_sent';

async function sendOutreachEmail(
  prospect: CampaignProspect,
  type: EmailType,
  column: OutreachColumn
): Promise<void> {
  const { firstName, lastName } = parseName(prospect.name);

  const { subject, html } = await writeOutreachEmail(
    {
      firstName,
      lastName,
      email:    prospect.email,
      jobTitle: prospect.job_title,
      company:  prospect.company,
      industry: prospect.industry,
    },
    type
  );

  const { error } = await resend.emails.send({
    from:    FROM,
    replyTo: REPLYTO,
    to:      prospect.email,
    subject,
    html,
  });

  if (error) throw new Error(`Resend ${prospect.email}: ${error.message}`);

  await supabase
    .from('prospects')
    .update({ [column]: new Date().toISOString() })
    .eq('id', prospect.id);

  // Incrémenter compteur emails_sent dans la campagne
  const { data: row } = await supabase
    .from('prospects')
    .select('campaign_id')
    .eq('id', prospect.id)
    .single();

  if (row?.campaign_id) {
    await supabase.rpc('increment_campaign_emails_sent', {
      p_campaign_id: row.campaign_id,
    }).maybeSingle();
  }
}

// ---- Logique de séquence ----

function resolveNextAction(
  p: CampaignProspect
): { type: EmailType; column: OutreachColumn } | null {
  // Si réponse détectée ou déjà converti → rien
  if (p.outreach_replied_at || p.status === 'CONVERTI' || p.status === 'PERDU') return null;

  // J+0 : pas encore contacté
  if (!p.outreach_initial_sent) {
    return { type: 'initial', column: 'outreach_initial_sent' };
  }

  const daysSinceInitial = daysSince(p.outreach_initial_sent);

  // J+3 : relance 1 si pas de réponse
  if (daysSinceInitial >= 3 && !p.outreach_followup1_sent) {
    return { type: 'followup1', column: 'outreach_followup1_sent' };
  }

  // J+7 : dernière relance
  if (p.outreach_followup1_sent) {
    const daysSinceF1 = daysSince(p.outreach_followup1_sent);
    if (daysSinceF1 >= 4 && !p.outreach_followup2_sent) {
      return { type: 'followup2', column: 'outreach_followup2_sent' };
    }
  }

  return null; // séquence terminée ou en attente
}

// ---- Détection des CONVERTI ----

async function markConverted(prospects: CampaignProspect[]): Promise<number> {
  let count = 0;

  for (const p of prospects) {
    if (p.outreach_replied_at && p.status !== 'CONVERTI') {
      await supabase
        .from('prospects')
        .update({ status: 'CHAUD' }) // LUFFY décidera CONVERTI après qualification
        .eq('id', p.id);

      await supabase.from('alerts').insert({
        agent_name: 'KILLUA',
        level: 'INFO',
        message: `Prospect ${p.email} a répondu → statut CHAUD`,
      });

      count++;
    }
  }

  return count;
}

// ---- Cycle principal ----

export async function runCampaignCycle(campaignId?: string): Promise<CycleResult> {
  let query = supabase
    .from('prospects')
    .select(
      'id, name, email, company, job_title, industry, status, ' +
      'outreach_initial_sent, outreach_followup1_sent, outreach_followup2_sent, outreach_replied_at'
    )
    .eq('source', 'APOLLO')
    .not('status', 'in', '("PERDU")');

  if (campaignId) query = query.eq('campaign_id', campaignId);

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture prospects campagne : ${error.message}`);

  const prospects = (data ?? []) as unknown as CampaignProspect[];

  let sent      = 0;
  let errors    = 0;
  const converted = await markConverted(prospects);

  for (const prospect of prospects) {
    const action = resolveNextAction(prospect);
    if (!action) continue;

    try {
      await sendOutreachEmail(prospect, action.type, action.column);
      sent++;

      await supabase.from('alerts').insert({
        agent_name: 'KILLUA',
        level: 'INFO',
        message: `Email ${action.type} envoyé à ${prospect.email} (${prospect.company ?? 'N/A'})`,
      });
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      await supabase.from('alerts').insert({
        agent_name: 'KILLUA',
        level: 'WARNING',
        message: `Erreur envoi ${action.type} → ${prospect.email} : ${msg.slice(0, 150)}`,
      });
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'KILLUA',
    level: 'INFO',
    message:
      `Cycle campagne : ${prospects.length} prospects, ` +
      `${sent} email(s) envoyé(s), ${converted} converti(s), ${errors} erreur(s)`,
  });

  return { processed: prospects.length, sent, converted, errors };
}

// ---- Création de campagne ----

export async function createCampaign(
  name: string,
  filters: ProspectSearchFilters
): Promise<string> {
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ name, filters, status: 'ACTIVE' })
    .select('id')
    .single();

  if (error) throw new Error(`Erreur création campagne : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'KILLUA',
    level: 'INFO',
    message: `Campagne créée : "${name}"`,
  });

  return (data as { id: string }).id;
}

// ---- Stats campagne ----

export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (error) throw new Error(`Campagne introuvable : ${error.message}`);

  const campaign = data as Campaign;
  const conversionRate = campaign.emails_sent > 0
    ? (campaign.conversions / campaign.emails_sent) * 100 : 0;
  const replyRate = campaign.emails_sent > 0
    ? (campaign.replies / campaign.emails_sent) * 100 : 0;

  return { campaign, conversionRate, replyRate };
}
