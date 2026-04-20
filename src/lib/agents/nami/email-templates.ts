import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

const FROM = 'NAMI · KR Global <agent@krglobalsolutionsltd.com>';

// ---- Type partagé ----

export interface NamiClient {
  id: string;
  name: string;
  email: string;
  company: string | null;
  product: string | null;
  amount_paid: number | null;
  currency: string;
  onboarded_at: string;
}

// ---- Helper interne ----

type EmailColumn =
  | 'email_welcome_sent'
  | 'email_brief_sent'
  | 'email_update_sent'
  | 'email_nps_sent';

async function markEmailSent(clientId: string, column: EmailColumn): Promise<void> {
  await supabase
    .from('clients')
    .update({ [column]: new Date().toISOString() })
    .eq('id', clientId);
}

async function logEmail(clientId: string, label: string): Promise<void> {
  await supabase.from('alerts').insert({
    agent_name: 'NAMI',
    level: 'INFO',
    message: `Email "${label}" envoyé au client id=${clientId}`,
  });
}

function greet(name: string): string {
  return `Bonjour ${name.split(' ')[0]},`;
}

function signature(): string {
  return `
    <p style="margin-top:32px;color:#666;font-size:13px;">
      L'équipe KR Global Solutions Ltd<br>
      <a href="mailto:agent@krglobalsolutionsltd.com">agent@krglobalsolutionsltd.com</a>
    </p>
  `;
}

// ---- J+0 : Email de bienvenue ----

export async function sendWelcomeEmail(client: NamiClient): Promise<void> {
  const amount = client.amount_paid != null
    ? ` de ${client.amount_paid.toFixed(2)} ${client.currency}`
    : '';

  const { error } = await resend.emails.send({
    from:    FROM,
    to:      client.email,
    subject: `Bienvenue chez KR Global Solutions ! 🎉`,
    html: `
      <p>${greet(client.name)}</p>
      <p>Nous avons bien reçu votre paiement${amount}. Merci de votre confiance !</p>
      <p>Voici ce qui va se passer dans les prochains jours :</p>
      <ul>
        <li><strong>Demain</strong> — vous recevrez le brief de votre projet</li>
        <li><strong>J+7</strong> — premier point d'avancement</li>
        <li><strong>J+30</strong> — bilan de satisfaction</li>
      </ul>
      <p>En cas de question, répondez directement à cet email. Nous répondons sous 24h.</p>
      ${signature()}
    `,
  });

  if (error) throw new Error(`Resend bienvenue : ${error.message}`);

  await markEmailSent(client.id, 'email_welcome_sent');
  await logEmail(client.id, 'bienvenue J+0');
}

// ---- J+1 : Email brief projet ----

export async function sendProjectBriefEmail(client: NamiClient): Promise<void> {
  const product = client.product ?? 'votre projet';

  const { error } = await resend.emails.send({
    from:    FROM,
    to:      client.email,
    subject: `Brief de projet — ${product}`,
    html: `
      <p>${greet(client.name)}</p>
      <p>Comme promis, voici le brief de démarrage pour <strong>${product}</strong>.</p>
      <h3>Ce que nous allons livrer</h3>
      <p>Conformément à votre commande, notre équipe va prendre en charge l'intégralité
         de la prestation convenue. Nous vous tiendrons informé à chaque étape clé.</p>
      <h3>Prochaines étapes</h3>
      <ol>
        <li>Validation du brief (cette semaine)</li>
        <li>Démarrage de la production</li>
        <li>Point d'avancement à J+7</li>
      </ol>
      <h3>Votre interlocuteur</h3>
      <p>Vous pouvez nous contacter à tout moment à
         <a href="mailto:agent@krglobalsolutionsltd.com">agent@krglobalsolutionsltd.com</a>.</p>
      ${signature()}
    `,
  });

  if (error) throw new Error(`Resend brief : ${error.message}`);

  await markEmailSent(client.id, 'email_brief_sent');
  await logEmail(client.id, 'brief projet J+1');
}

// ---- J+7 : Email update statut ----

export async function sendStatusUpdateEmail(client: NamiClient): Promise<void> {
  const product = client.product ?? 'votre projet';

  const { error } = await resend.emails.send({
    from:    FROM,
    to:      client.email,
    subject: `Point d'avancement — ${product} (J+7)`,
    html: `
      <p>${greet(client.name)}</p>
      <p>Cela fait une semaine que vous nous avez confié <strong>${product}</strong>.
         Voici un rapide point de situation.</p>
      <h3>Avancement</h3>
      <p>Le projet est en cours. Notre équipe travaille activement sur votre demande
         et respecte le calendrier prévu.</p>
      <h3>Des questions ?</h3>
      <p>Si vous souhaitez un appel de suivi ou avez des précisions à apporter,
         répondez simplement à cet email — nous organisons un créneau sous 24h.</p>
      ${signature()}
    `,
  });

  if (error) throw new Error(`Resend update : ${error.message}`);

  await markEmailSent(client.id, 'email_update_sent');
  await logEmail(client.id, 'update statut J+7');
}

// ---- J+30 : Email NPS satisfaction ----

export async function sendNpsEmail(client: NamiClient): Promise<void> {
  const appUrl = process.env.APP_URL ?? 'https://kr-global.com';
  const npsUrl = `${appUrl}/nps?client=${client.id}`;

  const { error } = await resend.emails.send({
    from:    FROM,
    to:      client.email,
    subject: `Votre avis nous importe — 2 minutes ⭐`,
    html: `
      <p>${greet(client.name)}</p>
      <p>Voilà un mois que nous travaillons ensemble. Nous aimerions connaître votre avis.</p>
      <p style="text-align:center;margin:32px 0;">
        <strong>Sur une échelle de 0 à 10, recommanderiez-vous KR Global Solutions à
        un collègue ou partenaire ?</strong>
      </p>
      <p style="text-align:center;">
        <a href="${npsUrl}" style="
          display:inline-block;padding:14px 28px;background:#1a1a1a;color:#fff;
          border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px;">
          Donner mon avis (2 min)
        </a>
      </p>
      <p style="color:#999;font-size:12px;text-align:center;">
        Votre retour nous aide à améliorer notre service. Merci !
      </p>
      ${signature()}
    `,
  });

  if (error) throw new Error(`Resend NPS : ${error.message}`);

  await markEmailSent(client.id, 'email_nps_sent');
  await logEmail(client.id, 'NPS satisfaction J+30');
}
