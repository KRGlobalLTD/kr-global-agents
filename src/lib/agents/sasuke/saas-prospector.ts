import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// SaaS-specific Apollo filters — industry tag IDs for software/SaaS
export const SAAS_FILTERS = {
  industries:     ['computer software', 'internet', 'information technology and services', 'saas'],
  jobTitles:      ['CEO', 'Co-Founder', 'Founder', 'CTO', 'Chief Technology Officer',
                   'VP Marketing', 'CMO', 'Head of Growth', 'VP Product', 'CPO'],
  locations:      ['United Kingdom', 'France', 'Canada', 'Belgium', 'Switzerland'],
  employeeRanges: ['1,50', '50,200'],
} as const;

interface ApolloOrg    { id: string; name: string | null; industry: string | null; num_employees: number | null; website_url: string | null }
interface ApolloPerson { id: string; first_name: string; last_name: string; email: string | null; title: string | null; organization: ApolloOrg | null; linkedin_url: string | null; city: string | null; country: string | null }

export interface SaasProspect {
  apollo_id:      string;
  name:           string;
  email:          string;
  job_title:      string | null;
  company:        string | null;
  industry:       string | null;
  employee_count: number | null;
  linkedin_url:   string | null;
  country:        string | null;
  website:        string | null;
}

export interface ProspectResult { saved: number; skipped: number; prospects: SaasProspect[] }

async function searchApollo(page = 1, perPage = 25): Promise<ApolloPerson[]> {
  const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': process.env.APOLLO_API_KEY_ ?? '' },
    body: JSON.stringify({
      page,
      per_page:                             perPage,
      person_titles:                        SAAS_FILTERS.jobTitles,
      person_locations:                     SAAS_FILTERS.locations,
      organization_num_employees_ranges:    SAAS_FILTERS.employeeRanges,
      q_keywords:                           'SaaS software startup',
    }),
  });
  if (!res.ok) throw new Error(`Apollo ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { people: ApolloPerson[] };
  return data.people ?? [];
}

async function alreadyExists(apolloId: string, email: string): Promise<boolean> {
  const { data } = await supabase.from('prospects').select('id').or(`apollo_id.eq.${apolloId},email.eq.${email}`).maybeSingle();
  return data !== null;
}

export async function findSaasProspects(campaignId: string, page = 1): Promise<ProspectResult> {
  const people = await searchApollo(page);
  let saved = 0; let skipped = 0;
  const saved_prospects: SaasProspect[] = [];

  for (const p of people) {
    if (!p.email) { skipped++; continue; }
    if (await alreadyExists(p.id, p.email)) { skipped++; continue; }

    const name = `${p.first_name} ${p.last_name}`.trim();
    const prospect: SaasProspect = {
      apollo_id:      p.id,
      name,
      email:          p.email,
      job_title:      p.title ?? null,
      company:        p.organization?.name ?? null,
      industry:       p.organization?.industry ?? null,
      employee_count: p.organization?.num_employees ?? null,
      linkedin_url:   p.linkedin_url ?? null,
      country:        p.country ?? null,
      website:        p.organization?.website_url ?? null,
    };

    const { error } = await supabase.from('prospects').insert({
      apollo_id:       prospect.apollo_id,
      campaign_id:     campaignId,
      name,
      contact_name:    name,
      email:           prospect.email,
      company:         prospect.company,
      job_title:       prospect.job_title,
      industry:        prospect.industry,
      employee_count:  prospect.employee_count,
      linkedin_url:    prospect.linkedin_url,
      status:          'FROID',
      urgency:         'normale',
      source:          'SASUKE',
      last_contact_at: new Date().toISOString(),
    });

    if (error) {
      if (error.code !== '23505') {
        void supabase.from('alerts').insert({ agent_name: 'SASUKE', level: 'WARNING', message: `Insertion prospect ${prospect.email} : ${error.message}` });
      }
      skipped++;
      continue;
    }
    saved++;
    saved_prospects.push(prospect);
  }

  return { saved, skipped, prospects: saved_prospects };
}

export async function getSaasProspects(limit = 50): Promise<SaasProspect[]> {
  const { data, error } = await supabase
    .from('prospects')
    .select('apollo_id, name, email, job_title, company, industry, employee_count, linkedin_url')
    .eq('source', 'SASUKE')
    .eq('status', 'FROID')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SaasProspect[];
}
