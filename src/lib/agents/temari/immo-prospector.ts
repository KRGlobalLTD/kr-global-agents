import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const IMMO_FILTERS = {
  industries: [
    'real estate',
    'commercial real estate',
    'property management',
    'real estate investment trusts',
    'leasing real estate',
    'real estate agent',
  ],
  jobTitles: [
    'CEO', 'Co-Founder', 'Founder', 'Managing Director',
    'Head of Sales', 'Commercial Director', 'Head of Marketing',
    'Digital Marketing Manager', 'Head of Property', 'Operations Director',
  ],
  locations:      ['United Kingdom', 'France', 'Canada', 'Morocco'],
  employeeRanges: ['1,50', '50,200'],
} as const;

export interface ImmoProspect {
  id:        string;
  name:      string;
  email:     string;
  company:   string;
  job_title: string;
  industry:  string;
  location:  string;
  employees: number;
}

export async function findImmoProspects(
  campaignId: string,
  page = 1,
): Promise<{ saved: number; skipped: number; prospects: ImmoProspect[] }> {
  const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key':    process.env.APOLLO_API_KEY_!,
    },
    body: JSON.stringify({
      page,
      per_page:                          25,
      person_titles:                     IMMO_FILTERS.jobTitles,
      organization_industry_tag_ids:     IMMO_FILTERS.industries,
      person_locations:                  IMMO_FILTERS.locations,
      organization_num_employees_ranges: IMMO_FILTERS.employeeRanges,
      contact_email_status:              ['verified', 'likely to engage'],
    }),
  });

  if (!res.ok) throw new Error(`Apollo error ${res.status}`);
  const json = await res.json() as { people?: Record<string, unknown>[] };
  const people = json.people ?? [];

  const saved: ImmoProspect[] = [];
  let skipped = 0;

  for (const p of people) {
    const email = (p['email'] as string | undefined)?.trim();
    if (!email || email.includes('@apollo.io')) { skipped++; continue; }

    const org = p['organization'] as Record<string, unknown> | undefined;
    const record: Record<string, unknown> = {
      name:        [p['first_name'], p['last_name']].filter(Boolean).join(' '),
      email,
      company:     (org?.['name']                        as string | undefined) ?? '',
      job_title:   (p['title']                           as string | undefined) ?? '',
      industry:    (org?.['industry']                    as string | undefined) ?? '',
      location:    (p['city']                            as string | undefined) ?? '',
      employees:   (org?.['estimated_num_employees']     as number | undefined) ?? 0,
      status:      'FROID',
      source:      'TEMARI',
      campaign_id: campaignId,
    };

    const { error } = await supabase.from('prospects').insert(record);
    if (error?.code === '23505') { skipped++; continue; }
    if (error) { skipped++; continue; }
    saved.push(record as unknown as ImmoProspect);
  }

  return { saved: saved.length, skipped, prospects: saved };
}

export async function getImmoProspects(limit = 50): Promise<ImmoProspect[]> {
  const { data } = await supabase
    .from('prospects')
    .select('id, name, email, company, job_title, industry, location, employees')
    .eq('source', 'TEMARI')
    .eq('status', 'FROID')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as ImmoProspect[];
}
