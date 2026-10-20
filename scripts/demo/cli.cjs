#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { ROOT, PRIVATE, save, read, privatePath, importAudit, csv } = require('./files.cjs');
const { validateAudit, findings, reviewTemplate, schemaFingerprint, catalogueFingerprint } = require('./audit.cjs');
const { batchName, generate, validatePlan, summary } = require('./identities.cjs');

const HELP = `FYE Hub demo tooling (Node.js 22 or newer)

  npm run demo:audit -- --input <Supabase SQL export.json or .csv>
  npm run demo:preview -- --batch presentation-2026
  npm run demo:check -- --batch presentation-2026
  npm run demo:seed -- --batch presentation-2026
  npm run demo:trial -- --batch presentation-2026 --programme 1
  npm run demo:verify -- --batch presentation-2026
  npm run demo:access -- --batch presentation-2026
  npm run demo:cleanup -- --batch presentation-2026 [--execute]

Run database/DEMO_READ_ONLY_AUDIT.sql in Supabase SQL Editor first.
Import writes private audit.json, audit-findings.json and qualification-review.json
inside .demo-seed/. Review qualification levels and valid study years there.
Set reviewed=true in qualification-review.json before generating the preview.

Preview creates an immutable named-batch plan, CSV and summary; check validates it.
Audit/preview/check are offline. Live commands require .env.demo.
Seed/trial/verify require all migrations; access reports missing installation steps.
Cleanup previews by default; --execute removes only the tracked named demo batch.
`;

function run(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true,
    options: { input: { type: 'string' }, batch: { type: 'string' }, programme:{type:'string'}, execute:{type:'boolean'}, help: { type: 'boolean', short: 'h' } } });
  if (values.help || !positionals.length) { process.stdout.write(HELP); return; }
  if (positionals.length !== 1) throw new Error('Choose one command. Use --help for options.');
  const command = positionals[0];
  if(['seed','trial','verify','access','cleanup'].includes(command)){
    if(values.input||(values.execute&&command!=='cleanup')||(values.programme&&command!=='trial'))throw new Error('Invalid live command options.');
    return require('./live.cjs').run(command,values);
  }
  if(values.execute||values.programme)throw new Error('Options are not applicable to this offline command.');
  if (command === 'audit') {
    if (!values.input || values.batch) throw new Error('Audit needs --input <export.json or .csv>.');
    const source = path.resolve(ROOT, values.input);
    const audit = validateAudit(importAudit(source));
    const report = findings(audit);
    let previous;
    if (fs.existsSync(privatePath('qualification-review.json'))) previous = read('qualification-review.json');
    // Preserve human review when the catalogue did not change. For a changed
    // catalogue, retain compatible per-programme values but require fresh review.
    const mapping = previous?.catalogue_hash === report.catalogue_hash ? previous : reviewTemplate(audit, previous);
    save('audit.json', audit);
    save('audit-findings.json', report);
    save('qualification-review.json', mapping);
    process.stdout.write(`Imported ${report.faculty_count} faculties and ${report.programme_count} programmes.\n`);
    process.stdout.write(`Private report: ${path.join(PRIVATE,'audit-findings.json')}\n`);
    process.stdout.write('Next: review qualification-review.json. No accounts or database records were changed.\n');
    return report;
  }
  if (!['preview','check'].includes(command) || values.input) throw new Error('Unknown command/options. Use --help.');
  const batch = batchName(values.batch);
  const audit = validateAudit(read('audit.json'));
  const mapping = read('qualification-review.json');
  const planName = `${batch}/plan.json`;
  let plan;
  if (fs.existsSync(privatePath(planName))) {
    plan = read(planName);
    const originalAudit = read(`${batch}/audit-snapshot.json`);
    const originalMapping = read(`${batch}/qualification-snapshot.json`);
    validatePlan(plan, originalAudit, originalMapping);
    if (schemaFingerprint(audit) !== plan.schema_hash || catalogueFingerprint(audit) !== plan.catalogue_hash) {
      throw new Error('Deployed schema/catalogue changed. Review before continuing this batch.');
    }
    // Do not overwrite an existing batch or silently accept revised academic mapping.
    validatePlan(plan, originalAudit, mapping);
  } else {
    if (command === 'check') throw new Error('No batch preview exists. Run demo:preview first.');
    plan = generate(audit, mapping, batch);
    save(`${batch}/audit-snapshot.json`, audit);
    save(`${batch}/qualification-snapshot.json`, mapping);
    save(planName, plan);
  }
  const report = summary(plan);
  if (command === 'preview') {
    save(`${batch}/preview.csv`, csv(plan.accounts));
    save(`${batch}/summary.json`, report);
    save(`${batch}/programme-counts.csv`, csv(report.by_programme));
    save(`${batch}/language-counts.csv`, csv(report.by_language));
    save(`${batch}/cohort-counts.csv`, csv(report.by_study_year));
  }
  process.stdout.write(`Validated batch ${batch}: ${report.students} students, ${report.mentors} additional mentors, ${report.eligible_mentees} eligible mentees.\n`);
  process.stdout.write(`Preview directory: ${path.join(PRIVATE,batch)}\n`);
  process.stdout.write('Preparation only: deployed academic-rule and demo-isolation migrations must be reviewed before live insertion.\n');
  return report;
}
if (require.main === module) {
  Promise.resolve().then(()=>run()).catch(error=>{process.stderr.write(`Demo operation stopped: ${error.message}\n`);process.exitCode=1;});
}
module.exports = { run };
