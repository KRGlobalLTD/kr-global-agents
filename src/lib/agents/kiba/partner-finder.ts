import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const PARTNER_FILTERS = {
  industries: [
    'marketing and advertising',
    'internet',
    'computer software',
    'management consulting',
    'information technology and services',
    'design',
    'media production',
    'public relations and communications',
  ],
  jobTitles: [
    'CEO', 'Founder', 'Co-Founder', 'Managing Director', 'Agency Owner',
    'Head of Partnerships', 'Business Development Manager',
    'Head of Digital', 'Digital Director', 'Head of Strategy',
  ],
  locations:      ['United Kingdom', 'France', 'Canada', 'Morocco', 'Belgium'],
  employeeRanges: ['1,50', '50,200'],
} as const;

export interface PartnerCandidate {
  name:         string;
  email:        string;
  company:      string;
  company_type: string;
  job_title:    string;
  industry:     string;
  location:     string;
  employees:    number;
}

function inferCompanyType(industry: string): string {
  if (industry.includes('marketing') || industry.includes('advertising') || industry.includes('media') || industry.includes('public relations')) return 'agency';
  if (industry.includes('software') || industry.includes('internet') || industry.includes('design')) return 'studio';
  if (industry.includes('consulting') || industry.includes('management')) return 'consulting';
  return 'other';
}

export async function findPartnerCandidates(
  page = 1,
): Promise<{ saved: number; skipped: number; candidates: PartnerCandidate[] }> {
  const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key':    process.env.APOLLO_API_KEY_!,
    },
    body: JSON.stringify({
      page,
      per_page:                          25,
      person_titles:                     PARTNER_FILTERS.jobTitles,
      organization_industry_tag_ids:     PARTNER_FILTERS.industries,
      person_locations:                  PARTNER_FILTERS.locations,
      organization_num_employees_ranges: PARTNER_FILTERS.employeeRanges,
      contact_email_status:              ['verified', 'likely to engage'],
    }),
  });

  if (!res.ok) throw new Error(`Apollo error ${res.status}`);
  const json = await res.json() as { people?: Record<string, unknown>[] };
  const people = json.people ?? [];

  const saved: PartnerCandidate[] = [];
  let skipped = 0;

  for (const p of people) {
    const email = (p['email'] as string | undefined)?.trim();
    if (!email || email.includes('@apollo.io')) { skipped++; continue; }

    const org      = p['organization'] as Record<string, unknown> | undefined;
    const industry = (org?.['industry'] as string | undefined) ?? '';

    const record: Record<string, unknown> = {
      name:         [p['first_name'], p['last_name']].filter(Boolean).join(' '),
      email,
      company:      (org?.['name']                    as string | undefined) ?? '',
      company_type: inferCompanyType(industry),
      location:     (p['city']                        as string | undefined) ?? '',
      employees:    (org?.['estimated_num_employees'] as number | undefined) ?? 0,
      status:       'prospect',
    };

    const { error } = await supabase.from('partners').insert(record);
    if (error?.code === '23505') { skipped++; continue; }
    if (error) { skipped++; continue; }
    saved.push({
      name:         record['name']         as string,
      email,
      company:      record['company']      as string,
      company_type: record['company_type'] as string,
      job_title:    (p['title']            as string | undefined) ?? '',
      industry,
      location:     record['location']     as string,
      employees:    record['employees']    as number,
    });
  }

  return { saved: saved.length, skipped, candidates: saved };
}

export async function getPartnersByStatus(status?: string, limit = 50) {
  let query = supabase.from('partners').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
