import { mockStore } from '../lib/mockStore';
import { schedulingService } from '../services/schedulingService';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('--- Starting Clean Re-import ---');
  
  // 1. Reset stored confessions
  mockStore.setConfessions([]);
  mockStore.updateGoogleSheetConfig({
    spreadsheet_id: '1S5HcRCh27paVdqyiCAqAI_1x-LCABtb73R6Fisn-QJs',
    sheet_name: 'Confessions',
    column_mapping: {
      timestampColumn: 'A',
      nameColumn: 'B',
      confessionColumn: 'E',
      statusColumn: 'D',
      postIdColumn: 'E',
      instagramUrlColumn: 'F',
      processedAtColumn: 'G',
      errorColumn: 'H',
    },
    rows_imported: 0,
    last_sync_status: 'PENDING',
  });

  console.log('Cleared old confessions. Running syncGoogleSheet...');
  const result = await schedulingService.syncGoogleSheet();
  console.log('Sync Result:', result);

  const confessions = mockStore.getConfessions();
  console.log(`Total confessions in database: ${confessions.length}`);

  // Inspect first 3 and last 3 confessions
  console.log('\n--- First 3 Confessions ---');
  confessions.slice(0, 3).forEach((c, idx) => {
    console.log(`[${idx + 1}] Row #${c.google_sheet_row} | Name: "${c.display_name}" | Anon: ${c.is_anonymous}`);
    console.log(`    Preview: "${c.original_text.slice(0, 80)}..."`);
    console.log(`    Risk: ${c.moderation_status}`);
  });

  console.log('\n--- Last 3 Confessions ---');
  confessions.slice(-3).forEach((c, idx) => {
    console.log(`[${idx + 1}] Row #${c.google_sheet_row} | Name: "${c.display_name}" | Anon: ${c.is_anonymous}`);
    console.log(`    Preview: "${c.original_text.slice(0, 80)}..."`);
    console.log(`    Risk: ${c.moderation_status}`);
  });
}

main().catch(console.error);
