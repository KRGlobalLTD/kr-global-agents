import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types Apollo.io ----

interface ApolloOrganization {
  id: string;
  name: string | null;
  industry: string | null;
  num_employees: number | null;
}

interface ApolloPerson {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
  organization: ApolloOrganization | null;
  linkedin_url: string | null;
  city: string | null;
  country: string | null;
}

interface ApolloPagination {
  page: number;
  per_page: number;
  total_entries: number;
  total_pages: number;
}

interface ApolloSearchResponse {
  people: ApolloPerson[];
  pagination: ApolloPagination;
}

// ---- Types publics ----

export interface ProspectSearchFilters {
  industries?: string[];       // ex: ['software', 'fintech', 'e-commerce']
  jobTitles?: string[];        // ex: ['CEO', 'CTO', 'Founder', 'Directeur']
  locations?: string[];        // ex: ['France', 'United Kingdom', 'Belgium']
  employeeRanges?: string[];   // ex: ['1,50', '50,200', '200,500']
  keywords?: string;
  page?: number;
  perPage?: number;
}

export interface FindResult {
  found: number;
  saved: number;
  skipped: number;    // déjà en base ou sans email
}

// ---- Appel Apollo.io ----

async function searchApollo(filters: ProspectSearchFilters): Promise<ApolloPerson[]> {
  const body: Record<string, unknown> = {
    api_key:  process.env.APOLLO_API_KEY,
    page:     filters.page    ?? 1,
    per_page: filters.perPage ?? 25,
  };

  if (filters.jobTitles?.length)     body['person_titles']               = filters.jobTitles;
  if (filters.locations?.length)     body['person_locations']            = filters.locations;
  if (filters.industries?.length)    body['organization_industry_tag_ids'] = filters.industries;
  if (filters.employeeRanges?.length) body['organization_num_employees_ranges'] = filters.employeeRanges;
  if (filters.keywords)              body['q_keywords']                  = filters.keywords;

  const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Apollo.io ${response.status}: ${err}`);
  }

  const data = (await response.json()) as ApolloSearchResponse;
  return data.people ?? [];
}

// ---- Déduplication ----

async function isAlreadyInDb(apolloId: string, email: string): Promise<boolean> {
  const { data } = await supabase
    .from('prospects')
    .select('id')
    .or(`apollo_id.eq.${apolloId},email.eq.${email}`)
    .maybeSingle();

  return data !== null;
}

// ---- Point d'entrée principal ----

export async function findProspects(
  campaignId: string,
  filters: ProspectSearchFilters
): Promise<FindResult> {
  const people = await searchApollo(filters);

  let saved   = 0;
  let skipped = 0;

  for (const person of people) {
    // Ignorer les contacts sans email
    if (!person.email) {
      skipped++;
      continue;
    }

    const alreadyExists = await isAlreadyInDb(person.id, person.email);
    if (alreadyExists) {
      skipped++;
      continue;
    }

    const displayName = `${person.first_name} ${person.last_name}`.trim();

    const { error } = await supabase.from('prospects').insert({
      apollo_id:      person.id,
      campaign_id:    campaignId,
      name:           displayName,
      contact_name:   displayName,
      email:          person.email,
      company:        person.organization?.name ?? null,
      job_title:      person.title ?? null,
      industry:       person.organization?.industry ?? null,
      employee_count: person.organization?.num_employees ?? null,
      linkedin_url:   person.linkedin_url ?? null,
      status:         'FROID',
      urgency:        'normale',
      source:         'APOLLO',
      last_contact_at: new Date().toISOString(),
    });

    if (error) {
      if (error.code === '23505') {
        skipped++; // race condition dédup
      } else {
        await supabase.from('alerts').insert({
          agent_name: 'KILLUA',
          level: 'WARNING',
          message: `Erreur insertion prospect ${person.email} : ${error.message}`,
        });
      }
      continue;
    }

    saved++;
  }

  // Mettre à jour le compteur de la campagne
  await supabase.rpc('increment_campaign_prospects', {
    p_campaign_id: campaignId,
    p_count: saved,
  }).maybeSingle(); // RPC optionnel — pas bloquant si absent

  await supabase.from('alerts').insert({
    agent_name: 'KILLUA',
    level: 'INFO',
    message: `Apollo.io : ${people.length} trouvés, ${saved} sauvegardés, ${skipped} ignorés`,
  });

  return { found: people.length, saved, skipped };
}
