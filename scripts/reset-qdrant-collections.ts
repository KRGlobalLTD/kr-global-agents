#!/usr/bin/env npx tsx
import { qdrant } from '../src/lib/qdrant/client';
import { COLLECTIONS, ensureCollection, type CollectionName } from '../src/lib/qdrant/collections';
import { VECTOR_DIM, activeProvider } from '../src/lib/qdrant/embeddings';

async function main() {
  const names = Object.values(COLLECTIONS) as CollectionName[];

  console.log(`\n🔄 Reset collections Qdrant — ${activeProvider()} (${VECTOR_DIM}d)\n`);

  for (const name of names) {
    process.stdout.write(`  ${name}...`);
    try {
      await qdrant('DELETE', `/collections/${name}`);
      await ensureCollection(name);
      console.log(' ✅');
    } catch (err) {
      console.log(` ❌ ${(err as Error).message}`);
    }
  }

  console.log('\n✅ Terminé\n');
}

main().catch(err => { console.error(err); process.exit(1); });
