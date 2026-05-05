/**
 * Usage :
 *   doppler run --project kr-global-agents --config dev -- \
 *     npx tsx scripts/create-admin.ts --email USER@example.com --password "MonMotDePasse123"
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function createAdmin(): Promise<void> {
  const email    = getArg('--email');
  const password = getArg('--password');
  const name     = getArg('--name');

  if (!email || !password) {
    console.error('Usage : npx tsx scripts/create-admin.ts --email EMAIL --password PASSWORD [--name NOM]');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('❌ Mot de passe trop court (minimum 8 caractères)');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { error } = await supabase
    .from('admins')
    .upsert(
      {
        email:         email.toLowerCase().trim(),
        password_hash: passwordHash,
        name:          name ?? email.split('@')[0],
      },
      { onConflict: 'email' }
    );

  if (error) {
    console.error(`❌ Erreur Supabase : ${error.message}`);
    process.exit(1);
  }

  console.log(`✅ Admin créé / mis à jour : ${email}`);
}

createAdmin().catch(err => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
