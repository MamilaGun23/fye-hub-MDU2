'use strict';
const fs=require('node:fs');const path=require('node:path');const {ROOT}=require('./files.cjs');
const names=['20261019000000_academic_lifecycle.sql','20261019010000_demo_cohort_and_seeding.sql','20261019020000_academic_clients_and_analytics.sql','20261019030000_reviewed_programme_qualifications.sql','20261019040000_demo_workflows_and_schedule.sql','20261019050000_dashboard_read_performance.sql','20261020000000_update_titles.sql','20261020010000_natural_account_labels.sql'];
const body=names.map(name=>'\n-- SOURCE: '+name+'\n'+fs.readFileSync(path.join(ROOT,'database',name),'utf8').replace(/^BEGIN;\r?$/gm,'').replace(/^COMMIT;\r?$/gm,'').replace(/^NOTIFY pgrst.*$/gm,'')).join('\n');
fs.writeFileSync(path.join(ROOT,'database/DEMO_INSTALL.sql'),'-- Apply once in the EXISTING prototype Supabase SQL Editor as postgres.\n-- Atomic installation; preserves existing users/history. Requires installed pg_cron.\nBEGIN;\n'+body+"\nCOMMIT;\nNOTIFY pgrst,'reload schema';\n");
console.log(`Built database/DEMO_INSTALL.sql from ${names.length} migrations.`);
