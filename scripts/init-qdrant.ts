#!/usr/bin/env npx tsx
/**
 * init-qdrant.ts
 * Crée les 5 collections Qdrant pour KR Global (idempotent — skip si déjà existante).
 *
 * Usage :
 *   doppler run --project kr-global-agents --config dev -- npx tsx scripts/init-qdrant.ts
 */

import { ping } from '../src/lib/qdrant/client';
import {
  COLLECTIONS,
  ensureCollection,
  collectionExists,
  collectionInfo,
  type CollectionName,
} from '../src/lib/qdrant/collections';
import { VECTOR_DIM, activeProvider } from '../src/lib/qdrant/embeddings';

async function main() {
  console.log('\n🧠 Initialisation Qdrant — KR Global\n');
  console.log(`   URL      : ${process.env.QDRANT_URL ?? '(manquante)'}`);
  console.log(`   Embeddings : ${activeProvider()}`);
  console.log(`   Dimension  : ${VECTOR_DIM}d\n`);

  if (!process.env.QDRANT_URL || !process.env.QDRANT_API_KEY) {
    console.error('❌ QDRANT_URL ou QDRANT_API_KEY manquante.');
    console.error('   → doppler secrets set QDRANT_URL="..." QDRANT_API_KEY="..."');
    process.exit(1);
  }

  // Ping
  console.log('🔌 Connexion au cluster Qdrant...');
  try {
    const version = await ping();
    console.log(`   ✓ Qdrant v${version}\n`);
  } catch (err) {
    console.error(`   ✗ ${(err as Error).message}`);
    process.exit(1);
  }

  // Collections
  const names = Object.values(COLLECTIONS) as CollectionName[];
  const results: { name: string; action: 'created' | 'exists'; count?: number }[] = [];

  for (const name of names) {
    process.stdout.write(`📦 ${name}...`);

    try {
      const exists = await collectionExists(name);

      if (exists) {
        const info = await collectionInfo(name);
        results.push({ name, action: 'exists', count: info.vectors_count });
        console.log(` ⏭  déjà existante (${info.vectors_count ?? 0} vecteurs)`);
      } else {
        await ensureCollection(name);
        results.push({ name, action: 'created' });
        console.log(' ✅ créée');
      }
    } catch (err) {
      console.log(` ❌ ${(err as Error).message}`);
    }
  }

  // Résumé
  const created = results.filter(r => r.action === 'created').length;
  const skipped = results.filter(r => r.action === 'exists').length;

  console.log('\n─────────────────────────────────────────────────');
  console.log(`✅ ${created} créées, ${skipped} déjà existantes\n`);

  console.log('Collections disponibles :');
  for (const r of results) {
    const icon = r.action === 'created' ? '🆕' : '✓ ';
    console.log(`   ${icon} ${r.name}`);
  }

  console.log('\n💡 Pour tester la mémoire :');
  console.log('   curl -X POST https://kr-global-agents.vercel.app/api/memory \\');
  console.log('     -H "x-internal-token: <TOKEN>" \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"action":"remember","collection":"kr_knowledge","id":"test-1","text":"KR Global est une agence IA","payload":{"source":"init"}}\'\n');
}

main().catch(err => {
  console.error('\n💥 Erreur fatale :', err);
  process.exit(1);
});
