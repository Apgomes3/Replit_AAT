// Microsoft Planner export → drafting plans (one plan per project code).
//
//   npm run import:planner -- --file "<Planner export.xlsx>"          dry run: shows what would be created
//   npm run import:planner -- --file "<Planner export.xlsx>" --apply  imports in one transaction (safe to re-run)
//
// Uses DATABASE_URL from .env.
import path from 'path';
import pool, { withTransaction } from '../../../db';
import { logAudit } from '../../../db/audit';
import { applyImport, ImportOptions, unknownAssignees } from './apply';
import { readPlannerFile } from './plannerFile';
import { buildImport } from './plannerPlan';

// Fabrication drawing plan settings (agreed 2026-11-13).
const OPTIONS: ImportOptions = {
  teamName: 'Drafting - Fabrication',
  planOverrides: { '001-033': 'DP-2026-0001' },
  createdProjectNote: 'Created by the Planner import (Fabrication Drawing Plan 2026). Complete the project details.',
};
const ALIASES: Record<string, string> = { 'David Dai': 'Davey Dai' };
const INTERNAL_PROJECTS = { 'AAT General Products': { code: 'AAT-GEN', name: 'AAT General Products' } };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = arg('--file');
  if (!file) throw new Error('--file "<Planner export.xlsx>" is required');
  const plans = buildImport(readPlannerFile(file), { aliases: ALIASES, internalProjects: INTERNAL_PROJECTS });

  console.log(`${plans.length} projects, ${plans.reduce((n, p) => n + p.tasks.length, 0)} tasks in ${path.basename(file)}\n`);
  for (const p of plans) {
    const done = p.tasks.filter(t => t.status === 'done').length;
    const groups = new Set(p.tasks.map(t => t.group).filter(Boolean)).size;
    console.log(`  ${p.project.code.padEnd(8)} ${p.project.name.slice(0, 40).padEnd(40)} ${String(p.tasks.length).padStart(3)} tasks (${done} done)${groups ? `, ${groups} groups` : ''}  ${p.startDate ?? '?'} → ${p.targetDate ?? '?'}`);
  }

  if (!process.argv.includes('--apply')) {
    const missing = await unknownAssignees(pool, plans);
    const existing = (await pool.query(`SELECT project_code FROM projects WHERE UPPER(project_code) = ANY($1)`, [plans.map(p => p.project.code)])).rows.map(r => r.project_code.toUpperCase());
    console.log(`\nProjects to create: ${plans.filter(p => !existing.includes(p.project.code)).map(p => p.project.code).join(', ') || 'none'}`);
    console.log(`Assignees without a Shark OS user (left unassigned): ${missing.join(', ') || 'none'}`);
    console.log('\nDry run only — add --apply to import.');
    return;
  }

  const report = await withTransaction(db => applyImport(db, plans, OPTIONS, null));
  await logAudit(null, 'drafting', 'planner-import', 'IMPORT', { summary: 'Planner import', file: path.basename(file), ...report });
  console.log(`\nProjects created (${report.projectsCreated.length}): ${report.projectsCreated.join('; ') || 'none'}`);
  console.log(`Plans created (${report.plansCreated.length}), reused: ${report.plansReused.join(', ') || 'none'}`);
  console.log(`Groups created: ${report.groupsCreated}; tasks created: ${report.tasksCreated}; already imported (skipped): ${report.tasksSkipped}`);
  if (report.unknownAssignees.length) console.log(`Unassigned (no matching user): ${report.unknownAssignees.join(', ')}`);
}

main().catch(e => { console.error(e.message || e); process.exitCode = 1; }).finally(() => pool.end());
