import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export type MissionStatus = 'ouvert' | 'en_cours' | 'livre' | 'termine';

export interface MissionInput {
  title:            string;
  description:      string;
  skills_required:  string[];
  budget_min?:      number;
  budget_max?:      number;
  currency?:        string;
  duration_weeks?:  number;
}

export interface Mission {
  id:              string;
  mission_number:  string;
  title:           string;
  description:     string;
  skills_required: string[];
  budget_min:      number | null;
  budget_max:      number | null;
  currency:        string;
  duration_weeks:  number | null;
  status:          MissionStatus;
  freelance_id:    string | null;
  upwork_job_id:   string | null;
  fiverr_brief:    string | null;
  published_at:    string | null;
  started_at:      string | null;
  delivered_at:    string | null;
  completed_at:    string | null;
  created_at:      string;
}

export interface PublishResult {
  upwork:  { success: boolean; job_id?: string; error?: string };
  fiverr:  { success: boolean; brief?: string; error?: string };
}

// ---- Upwork GraphQL types ----

interface UpworkJobData {
  id:    string;
  title: string;
}

interface UpworkCreateJobResult {
  createJobV2: { job: UpworkJobData };
}

interface UpworkGraphQLResponse {
  data?:   UpworkCreateJobResult;
  errors?: Array<{ message: string }>;
}

// ---- Numérotation séquentielle ----

async function getNextMissionNumber(): Promise<string> {
  const year   = new Date().getFullYear();
  const prefix = `MSN-${year}-`;

  const result = await supabase
    .from('missions')
    .select('id', { count: 'exact', head: true })
    .like('mission_number', `${prefix}%`);

  const next = (result.count ?? 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// ---- Publication Upwork (GraphQL v3) ----

async function publishToUpwork(mission: Mission): Promise<{ job_id: string }> {
  const token = process.env.UPWORK_ACCESS_TOKEN;
  if (!token) throw new Error('UPWORK_ACCESS_TOKEN manquant');

  const budgetAmount = mission.budget_max ?? mission.budget_min ?? 500;

  const mutation = `
    mutation createJobV2($input: CreateJobInput!) {
      createJobV2(input: $input) {
        job { id title }
      }
    }
  `;

  const variables = {
    input: {
      title:       mission.title,
      description: mission.description,
      jobType:     'FIXED_PRICE',
      budget:      { amount: budgetAmount, currencyCode: mission.currency },
      skills:      (mission.skills_required as string[]).slice(0, 10).map(s => ({ name: s })),
      visibility:  'PUBLIC',
    },
  };

  const res = await fetch('https://api.upwork.com/graphql', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upwork API ${res.status}: ${err}`);
  }

  const data = (await res.json()) as UpworkGraphQLResponse;

  if (data.errors && data.errors.length > 0) {
    throw new Error(`Upwork GraphQL : ${data.errors[0]?.message ?? 'Erreur inconnue'}`);
  }

  const jobId = data.data?.createJobV2?.job?.id;
  if (!jobId) throw new Error('Upwork : ID de job absent dans la réponse');

  return { job_id: jobId };
}

// ---- Brief Fiverr (pas d'API de posting public — texte formaté) ----

function formatFiverrBrief(mission: Mission): string {
  const budget = mission.budget_min && mission.budget_max
    ? `${mission.budget_min}–${mission.budget_max} ${mission.currency}`
    : mission.budget_max
    ? `${mission.budget_max} ${mission.currency}`
    : 'À négocier';

  return (
    `**[KR Global Solutions Ltd] ${mission.title}**\n\n` +
    `**Description :**\n${mission.description}\n\n` +
    `**Compétences requises :** ${(mission.skills_required as string[]).join(', ')}\n` +
    `**Budget :** ${budget}\n` +
    (mission.duration_weeks ? `**Durée estimée :** ${mission.duration_weeks} semaine(s)\n` : '') +
    `\n_Postulez en envoyant votre portfolio et tarif à agent@krglobalsolutionsltd.com_`
  );
}

// ---- Création de mission ----

export async function createMission(input: MissionInput): Promise<Mission> {
  const missionNumber = await getNextMissionNumber();

  const { data, error } = await supabase
    .from('missions')
    .insert({
      mission_number:   missionNumber,
      title:            input.title,
      description:      input.description,
      skills_required:  input.skills_required,
      budget_min:       input.budget_min  ?? null,
      budget_max:       input.budget_max  ?? null,
      currency:         input.currency    ?? 'EUR',
      duration_weeks:   input.duration_weeks ?? null,
      status:           'ouvert',
    })
    .select('*')
    .single();

  if (error) throw new Error(`Erreur création mission : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level:      'INFO',
    message:    `Mission ${missionNumber} créée : "${input.title}"`,
  });

  return data as unknown as Mission;
}

// ---- Publication sur Upwork + Fiverr ----

export async function publishMission(missionId: string): Promise<PublishResult> {
  const { data: missionData, error } = await supabase
    .from('missions')
    .select('*')
    .eq('id', missionId)
    .single();

  if (error || !missionData) throw new Error(`Mission introuvable : ${missionId}`);
  const mission = missionData as unknown as Mission;

  const result: PublishResult = {
    upwork: { success: false },
    fiverr: { success: false },
  };

  // -- Upwork --
  try {
    const { job_id } = await publishToUpwork(mission);
    result.upwork = { success: true, job_id };

    await supabase
      .from('missions')
      .update({ upwork_job_id: job_id, published_at: new Date().toISOString() })
      .eq('id', missionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur Upwork';
    result.upwork = { success: false, error: msg };

    await supabase.from('alerts').insert({
      agent_name: 'CHOPPER',
      level:      'WARNING',
      message:    `Échec publication Upwork pour ${mission.mission_number} : ${msg.slice(0, 150)}`,
    });
  }

  // -- Fiverr (brief formaté pour publication manuelle) --
  try {
    const brief = formatFiverrBrief(mission);
    result.fiverr = { success: true, brief };

    await supabase
      .from('missions')
      .update({
        fiverr_brief: brief,
        published_at: new Date().toISOString(),
      })
      .eq('id', missionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur Fiverr';
    result.fiverr = { success: false, error: msg };
  }

  await supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level:      'INFO',
    message:
      `Mission ${mission.mission_number} publiée — ` +
      `Upwork: ${result.upwork.success ? 'OK' : 'ÉCHEC'}, ` +
      `Fiverr: ${result.fiverr.success ? 'brief prêt' : 'ÉCHEC'}`,
  });

  return result;
}

// ---- Assignation freelance ----

export async function assignFreelance(
  missionId:   string,
  freelanceId: string
): Promise<void> {
  const { error } = await supabase
    .from('missions')
    .update({
      freelance_id: freelanceId,
      status:       'en_cours',
      started_at:   new Date().toISOString(),
    })
    .eq('id', missionId);

  if (error) throw new Error(`Erreur assignation freelance : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level:      'INFO',
    message:    `Freelance id=${freelanceId} assigné à la mission id=${missionId}`,
  });
}

// ---- Mise à jour statut ----

export async function updateMissionStatus(
  missionId: string,
  status:    MissionStatus
): Promise<void> {
  const timestampCol: Partial<Record<MissionStatus, string>> = {
    livre:   'delivered_at',
    termine: 'completed_at',
  };

  const patch: Record<string, unknown> = { status };
  const col = timestampCol[status];
  if (col) patch[col] = new Date().toISOString();

  const { error } = await supabase
    .from('missions')
    .update(patch)
    .eq('id', missionId);

  if (error) throw new Error(`Erreur mise à jour statut mission : ${error.message}`);

  // Incrémenter missions_completed du freelance si mission terminée
  if (status === 'termine') {
    const { data: missionRow } = await supabase
      .from('missions')
      .select('freelance_id')
      .eq('id', missionId)
      .single();

    const freelanceId = (missionRow as { freelance_id: string | null } | null)?.freelance_id;
    if (freelanceId) {
      await supabase.rpc('increment', {
        table_name: 'freelances',
        column_name: 'missions_completed',
        row_id: freelanceId,
      }).maybeSingle();
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level:      'INFO',
    message:    `Mission id=${missionId} → statut "${status}"`,
  });
}

// ---- Lecture missions ouvertes ----

export async function getOpenMissions(): Promise<Mission[]> {
  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .in('status', ['ouvert', 'en_cours'])
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Erreur lecture missions : ${error.message}`);
  return (data ?? []) as unknown as Mission[];
}
