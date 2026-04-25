import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

const FROM    = 'CHOPPER · KR Global <agent@krglobalsolutionsltd.com>';
const REPLYTO = 'agent@krglobalsolutionsltd.com';

// ---- Types ----

export type ContractType = 'nda' | 'mission' | 'nda_mission';

export interface Contract {
  id:              string;
  contract_number: string;
  mission_id:      string | null;
  freelance_id:    string | null;
  type:            ContractType;
  content_html:    string;
  sent_at:         string | null;
  signed_at:       string | null;
  created_at:      string;
}

// ---- DB row types ----

interface MissionRow {
  id:              string;
  mission_number:  string;
  title:           string;
  description:     string;
  budget_min:      number | null;
  budget_max:      number | null;
  currency:        string;
  duration_weeks:  number | null;
}

interface FreelanceRow {
  id:    string;
  name:  string;
  email: string;
}

// ---- Numérotation ----

async function getNextContractNumber(): Promise<string> {
  const year   = new Date().getFullYear();
  const prefix = `CTR-${year}-`;

  const result = await supabase
    .from('contracts')
    .select('id', { count: 'exact', head: true })
    .like('contract_number', `${prefix}%`);

  const next = (result.count ?? 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// ---- Utilitaires ----

function today(): string {
  return new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function budgetLabel(m: MissionRow): string {
  if (m.budget_min && m.budget_max) return `${m.budget_min}–${m.budget_max} ${m.currency}`;
  if (m.budget_max) return `${m.budget_max} ${m.currency}`;
  return 'À négocier';
}

// ---- Template NDA ----

function buildNdaHtml(
  contractNumber: string,
  freelance:      FreelanceRow,
  mission:        MissionRow | null
): string {
  const missionRef = mission
    ? `dans le cadre de la mission <strong>${mission.mission_number} — ${mission.title}</strong>`
    : 'dans le cadre d\'une collaboration avec KR Global Solutions Ltd';

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8">
<style>
  body { font-family: Georgia, serif; max-width: 720px; margin: 0 auto; padding: 40px; color: #1a1a1a; line-height: 1.7; }
  h1   { font-size: 20px; text-align: center; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px; }
  h2   { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-top: 32px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .ref { text-align: center; color: #555; font-size: 13px; margin-bottom: 32px; }
  p    { font-size: 14px; }
  .sig { margin-top: 48px; display: flex; justify-content: space-between; }
  .sig-block { width: 45%; }
  .sig-line  { border-top: 1px solid #333; margin-top: 48px; padding-top: 4px; font-size: 12px; color: #555; }
</style>
</head>
<body>

<h1>Accord de Confidentialité (NDA)</h1>
<p class="ref">Référence : ${contractNumber} · En date du ${today()}</p>

<h2>1. Parties</h2>
<p>
  Le présent accord est conclu entre :<br><br>
  <strong>KR Global Solutions Ltd</strong>, société enregistrée en Angleterre et au Pays de Galles,
  dont le siège est à Londres, Royaume-Uni (ci-après « la Société »),<br><br>
  ET<br><br>
  <strong>${freelance.name}</strong> (${freelance.email}), freelance intervenant ${missionRef}
  (ci-après « le Prestataire »).
</p>

<h2>2. Définition des informations confidentielles</h2>
<p>
  Sont considérées comme confidentielles toutes les informations divulguées par la Société,
  notamment : l'architecture des agents IA, le code source, les listes clients, les tarifs,
  les stratégies commerciales, les données Supabase, les clés API, les processus internes,
  ainsi que tout document ou donnée désigné comme confidentiel.
</p>

<h2>3. Obligations du Prestataire</h2>
<p>
  Le Prestataire s'engage à :<br>
  (a) ne pas divulguer les informations confidentielles à des tiers sans accord écrit préalable ;<br>
  (b) n'utiliser ces informations qu'aux fins de la mission convenue ;<br>
  (c) protéger ces informations avec le même soin qu'il accorde à ses propres informations confidentielles ;<br>
  (d) notifier immédiatement la Société en cas de divulgation non autorisée.
</p>

<h2>4. Exclusions</h2>
<p>
  Les obligations ci-dessus ne s'appliquent pas aux informations qui sont ou deviennent
  publiques sans faute du Prestataire, ou dont ce dernier peut démontrer qu'elles étaient
  déjà en sa possession avant la signature du présent accord.
</p>

<h2>5. Propriété intellectuelle</h2>
<p>
  Tous les livrables produits dans le cadre de la mission sont la propriété exclusive
  de KR Global Solutions Ltd dès leur livraison (<em>work for hire</em>). Le Prestataire
  cède à titre exclusif l'ensemble des droits patrimoniaux sur ces livrables.
</p>

<h2>6. Durée</h2>
<p>
  Le présent accord prend effet à la date de signature et demeure en vigueur
  pendant <strong>deux (2) ans</strong> après la fin de la collaboration.
</p>

<h2>7. Droit applicable</h2>
<p>
  Le présent accord est soumis au droit d'Angleterre et du Pays de Galles.
  Tout litige sera soumis à la juridiction exclusive des tribunaux de Londres.
</p>

<div class="sig">
  <div class="sig-block">
    <p><strong>Pour KR Global Solutions Ltd</strong></p>
    <div class="sig-line">Signature · Date</div>
  </div>
  <div class="sig-block">
    <p><strong>${freelance.name}</strong></p>
    <div class="sig-line">Signature · Date</div>
  </div>
</div>

</body>
</html>`;
}

// ---- Template contrat de mission ----

function buildMissionContractHtml(
  contractNumber: string,
  freelance:      FreelanceRow,
  mission:        MissionRow
): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8">
<style>
  body { font-family: Georgia, serif; max-width: 720px; margin: 0 auto; padding: 40px; color: #1a1a1a; line-height: 1.7; }
  h1   { font-size: 20px; text-align: center; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px; }
  h2   { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-top: 32px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .ref { text-align: center; color: #555; font-size: 13px; margin-bottom: 32px; }
  p    { font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td    { padding: 6px 8px; border: 1px solid #ddd; vertical-align: top; }
  td:first-child { font-weight: bold; width: 35%; background: #f9f9f9; }
  .sig { margin-top: 48px; display: flex; justify-content: space-between; }
  .sig-block { width: 45%; }
  .sig-line  { border-top: 1px solid #333; margin-top: 48px; padding-top: 4px; font-size: 12px; color: #555; }
</style>
</head>
<body>

<h1>Contrat de Prestation de Services</h1>
<p class="ref">Référence : ${contractNumber} · Mission : ${mission.mission_number} · En date du ${today()}</p>

<h2>1. Parties</h2>
<p>
  <strong>KR Global Solutions Ltd</strong>, société enregistrée en Angleterre et au Pays de Galles
  (ci-après « le Client »),<br><br>
  ET<br><br>
  <strong>${freelance.name}</strong> (${freelance.email}), prestataire indépendant
  (ci-après « le Prestataire »).
</p>

<h2>2. Description de la mission</h2>
<table>
  <tr><td>Intitulé</td><td>${mission.title}</td></tr>
  <tr><td>Référence</td><td>${mission.mission_number}</td></tr>
  <tr><td>Description</td><td>${mission.description}</td></tr>
  <tr><td>Budget</td><td>${budgetLabel(mission)}</td></tr>
  ${mission.duration_weeks ? `<tr><td>Durée estimée</td><td>${mission.duration_weeks} semaine(s)</td></tr>` : ''}
</table>

<h2>3. Livrables et délais</h2>
<p>
  Le Prestataire s'engage à fournir les livrables convenus dans le délai indiqué ci-dessus,
  en respectant le cahier des charges communiqué par le Client. Toute modification substantielle
  fera l'objet d'un avenant signé.
</p>

<h2>4. Rémunération et modalités de paiement</h2>
<p>
  La rémunération s'élève à <strong>${budgetLabel(mission)}</strong>,
  payable dans les 30 jours suivant la livraison et l'acceptation des livrables par le Client,
  sous réserve de l'émission d'une facture conforme.
</p>

<h2>5. Propriété intellectuelle</h2>
<p>
  L'ensemble des livrables produits dans le cadre de la présente mission sont cédés
  au Client à titre exclusif, définitif et pour le monde entier, dès leur règlement intégral.
  Le Prestataire garantit qu'il est seul auteur des livrables et qu'ils ne violent aucun droit tiers.
</p>

<h2>6. Confidentialité</h2>
<p>
  Le Prestataire s'engage à maintenir la stricte confidentialité de toutes les informations
  obtenues dans le cadre de la présente mission (cf. NDA associé le cas échéant).
</p>

<h2>7. Résiliation</h2>
<p>
  Chaque partie peut résilier le présent contrat par notification écrite avec un préavis de
  7 jours ouvrés. En cas de résiliation, le Client règlera les travaux réalisés au prorata.
</p>

<h2>8. Droit applicable</h2>
<p>
  Le présent contrat est soumis au droit d'Angleterre et du Pays de Galles.
</p>

<div class="sig">
  <div class="sig-block">
    <p><strong>Pour KR Global Solutions Ltd</strong></p>
    <div class="sig-line">Signature · Date</div>
  </div>
  <div class="sig-block">
    <p><strong>${freelance.name}</strong></p>
    <div class="sig-line">Signature · Date</div>
  </div>
</div>

</body>
</html>`;
}

// ---- Génération du contrat ----

export async function generateContract(
  missionId:   string,
  freelanceId: string,
  type:        ContractType
): Promise<Contract> {
  // Récupérer mission et freelance
  const [missionRes, freelanceRes] = await Promise.all([
    supabase.from('missions').select('id, mission_number, title, description, budget_min, budget_max, currency, duration_weeks').eq('id', missionId).single(),
    supabase.from('freelances').select('id, name, email').eq('id', freelanceId).single(),
  ]);

  if (missionRes.error || !missionRes.data)   throw new Error(`Mission introuvable : ${missionId}`);
  if (freelanceRes.error || !freelanceRes.data) throw new Error(`Freelance introuvable : ${freelanceId}`);

  const mission  = missionRes.data  as unknown as MissionRow;
  const freelance = freelanceRes.data as unknown as FreelanceRow;

  const contractNumber = await getNextContractNumber();

  // Assembler le HTML selon le type
  let contentHtml: string;
  if (type === 'nda') {
    contentHtml = buildNdaHtml(contractNumber, freelance, mission);
  } else if (type === 'mission') {
    contentHtml = buildMissionContractHtml(contractNumber, freelance, mission);
  } else {
    // nda_mission : NDA + contrat de mission concaténés
    contentHtml =
      buildNdaHtml(contractNumber, freelance, mission) +
      '<div style="page-break-before:always;"></div>' +
      buildMissionContractHtml(`${contractNumber}-M`, freelance, mission);
  }

  const { data, error } = await supabase
    .from('contracts')
    .insert({
      contract_number: contractNumber,
      mission_id:      missionId,
      freelance_id:    freelanceId,
      type,
      content_html:    contentHtml,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Erreur sauvegarde contrat : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level:      'INFO',
    message:    `Contrat ${contractNumber} (${type}) généré pour ${freelance.name} / mission ${mission.mission_number}`,
  });

  return data as unknown as Contract;
}

// ---- Envoi via Resend ----

export async function sendContract(contractId: string): Promise<void> {
  const { data: contractData, error } = await supabase
    .from('contracts')
    .select('*, missions(mission_number, title), freelances(name, email)')
    .eq('id', contractId)
    .single();

  if (error || !contractData) throw new Error(`Contrat introuvable : ${contractId}`);

  const contract = contractData as unknown as Contract & {
    missions:   { mission_number: string; title: string } | null;
    freelances: { name: string; email: string } | null;
  };

  const freelanceName  = contract.freelances?.name  ?? 'Prestataire';
  const freelanceEmail = contract.freelances?.email;
  if (!freelanceEmail) throw new Error('Email freelance introuvable');

  const missionLabel = contract.missions
    ? `${contract.missions.mission_number} — ${contract.missions.title}`
    : 'Collaboration KR Global';

  const typeLabel: Record<ContractType, string> = {
    nda:         'Accord de confidentialité (NDA)',
    mission:     'Contrat de prestation de services',
    nda_mission: 'NDA + Contrat de prestation',
  };

  const emailHtml = `
    <!DOCTYPE html>
    <html lang="fr">
    <head><meta charset="UTF-8"></head>
    <body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
      <div style="border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:24px;">
        <strong style="font-size:18px;">KR Global Solutions Ltd</strong>
      </div>

      <p>Bonjour ${freelanceName.split(' ')[0]},</p>

      <p>Veuillez trouver ci-dessous votre <strong>${typeLabel[contract.type]}</strong>
      (réf. <strong>${contract.contract_number}</strong>) dans le cadre de la mission :<br>
      <em>${missionLabel}</em></p>

      <p>Pour confirmer votre acceptation, répondez simplement à cet email avec la mention
      <strong>« Lu et approuvé — ${contract.contract_number} »</strong> et votre signature électronique.</p>

      <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0;">

      ${contract.content_html}

      <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0;">

      <p style="font-size:13px;color:#64748b;">
        KR Global Solutions Ltd · Londres, UK<br>
        <a href="mailto:agent@krglobalsolutionsltd.com">agent@krglobalsolutionsltd.com</a>
      </p>
    </body>
    </html>
  `;

  const { error: sendError } = await resend.emails.send({
    from:    FROM,
    replyTo: REPLYTO,
    to:      freelanceEmail,
    subject: `[${contract.contract_number}] ${typeLabel[contract.type]} — KR Global Solutions Ltd`,
    html:    emailHtml,
  });

  if (sendError) throw new Error(`Resend contrat ${contract.contract_number} : ${sendError.message}`);

  await supabase
    .from('contracts')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', contractId);

  await supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level:      'INFO',
    message:    `Contrat ${contract.contract_number} envoyé à ${freelanceEmail} pour signature`,
  });
}

// ---- Signature reçue ----

export async function markContractSigned(contractId: string): Promise<void> {
  const { error } = await supabase
    .from('contracts')
    .update({ signed_at: new Date().toISOString() })
    .eq('id', contractId);

  if (error) throw new Error(`Erreur signature contrat : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level:      'INFO',
    message:    `Contrat id=${contractId} marqué comme signé`,
  });
}
