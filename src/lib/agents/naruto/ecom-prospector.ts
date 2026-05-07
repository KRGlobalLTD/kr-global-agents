import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const ECOM_FILTERS = {
  industries: [
    'retail',
    'consumer goods',
    'apparel & fashion',
    'cosmetics',
    'health, wellness and fitness',
    'food & beverages',
    'sporting goods',
    'luxury goods & jewelry',
    'online media',
  ],
  jobTitles: [
    'CEO', 'Co-Founder', 'Founder', 'CMO',
    'Head of E-Commerce', 'E-Commerce Director',
    'Head of Marketing', 'Digital Marketing Manager',
    'VP Marketing', 'Head of Growth',
  ],
  locations:      ['United Kingdom', 'France', 'Canada', 'Belgium', 'Switzerland'],
  employeeRanges: ['1,50', '50,200'],
} as const;

export interface EcomProspect {
  id:        string;
  name:      string;
  email:     string;
  company:   string;
  job_title: string;
  industry:  string;
  location:  string;
  employees: number;
}

export async function findEcomProspects(
  campaignId: string,
  page = 1,
): Promise<{ saved: number; skipped: number; prospects: EcomProspect[] }> {
  const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key':    process.env.APOLLO_API_KEY_!,
    },
    body: JSON.stringify({
      page,
      per_page:                         25,
      person_titles:                    ECOM_FILTERS.jobTitles,
      organization_industry_tag_ids:    ECOM_FILTERS.industries,
      person_locations:                 ECOM_FILTERS.locations,
      organization_num_employees_ranges: ECOM_FILTERS.employeeRanges,
      contact_email_status:             ['verified', 'likely to engage'],
    }),
  });

  if (!res.ok) throw new Error(`Apollo error ${res.status}`);
  const json = await res.json() as { people?: Record<string, unknown>[] };
  const people = json.people ?? [];

  const saved: EcomProspect[] = [];
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
      source:      'NARUTO',
      campaign_id: campaignId,
    };

    const { error } = await supabase.from('prospects').insert(record);
    if (error?.code === '23505') { skipped++; continue; }
    if (error) { skipped++; continue; }
    saved.push(record as unknown as EcomProspect);
  }

  return { saved: saved.length, skipped, prospects: saved };
}

export async function getEcomProspects(limit = 50): Promise<EcomProspect[]> {
  const { data } = await supabase
    .from('prospects')
    .select('id, name, email, company, job_title, industry, location, employees')
    .eq('source', 'NARUTO')
    .eq('status', 'FROID')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as EcomProspect[];
}
