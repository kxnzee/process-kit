#!/usr/bin/env node
// Read-only three-way change inventory. Does not copy, commit, fetch or push.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { root } = require('../core/paths');
const { owner } = require('../entities/process-model');
function promotionPlan(cwd, targetRef) {
  if (!/^(?:origin\/)?(?:master|team-[a-z0-9]+)$/.test(targetRef)) throw new Error('Target must be master or team-<code>, optionally under origin/');
  const git = (...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
  const sourceCommit = git('rev-parse', '--verify', 'HEAD').toString().trim();
  const targetCommit = git('rev-parse', '--verify', `${targetRef}^{commit}`).toString().trim();
  const bases = git('merge-base', '--all', sourceCommit, targetCommit).toString().trim().split('\n').filter(Boolean);
  if (bases.length !== 1) throw new Error('A single merge base is required');
  const baseCommit = bases[0];
  const changed = git('diff', '--no-renames', '--name-only', '-z', baseCommit, '--').toString().split('\0').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').toString().split('\0').filter(Boolean);
  const team = targetRef.replace(/^origin\//, '').startsWith('team-') ? targetRef.replace(/^origin\/team-/, '').replace(/^team-/, '') : null;
  function version(commit, file) {
    const entry = git('--literal-pathspecs', 'ls-tree', '-z', commit, '--', file).toString().split('\0').find(Boolean);
    if (!entry) return null;
    const match = entry.match(/^(\d+) blob ([0-9a-f]+)\t/);
    if (!match) throw new Error(`Unsupported tree entry: ${file}`);
    return { mode: match[1], sha256: hash(git('cat-file', 'blob', match[2])) };
  }
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const candidates = [], excluded = [], conflicts = [];
  for (const file of [...new Set([...changed, ...untracked])].sort()) {
    const parts = file.split('/');
    const forbidden = file==='config/my/config.json'||parts.some(part => ['outputs', '.history', '.git', 'worktrees'].includes(part) || /^\.env(?:\.|$)/.test(part));
    const levels = file.startsWith('context/')?[]:parts.map(part => owner(part));
    const scopedContext=file.match(/^context\/(master|team|my)\/([^/]+)\//);
    const contextLevel=scopedContext&&scopedContext[2]!=='example'?scopedContext[1]:null;
    const personal = contextLevel==='my'||levels.some(item => item.level === 2);
    const teams = levels.filter(item => item.level === 1).map(item => item.team);
    if(contextLevel==='team'){let id;try{id=require('../config/config').loadConfig(cwd).teamId;}catch{}teams.push(id||'unresolved-context-owner');}
    const admin = file === 'config/team/config.json';
    if (forbidden || personal || (team ? (!admin && (!teams.length || teams.some(code => code !== team))) : (admin || teams.length))) {
      excluded.push({ path: file, reason: 'outside destination ownership or local data' }); continue;
    }
    const full = path.join(cwd, file);
    let source = null;
    const stat = fs.lstatSync(full, { throwIfNoEntry: false });
    if (stat) {
      if (!stat.isFile() || parts.some((_, i) => fs.lstatSync(path.join(cwd, ...parts.slice(0, i + 1))).isSymbolicLink())) {
        excluded.push({ path: file, reason: 'symlink or unsupported file' }); continue;
      }
      source = { mode: stat.mode & 0o111 ? '100755' : '100644', sha256: hash(fs.readFileSync(full)) };
    }
    const base = version(baseCommit, file), target = version(targetCommit, file);
    if (equal(source, base) || equal(source, target)) continue;
    const item = { path: file, operation: source ? target ? 'modify' : 'add' : 'delete', source, base, target, administrative: admin };
    if (!equal(base, target)) conflicts.push(item);
    else candidates.push(item);
  }
  return { sourceCommit, targetRef, targetCommit, baseCommit, candidates, conflicts, excluded };
}
module.exports = { promotionPlan };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--target') { console.error('Usage: node tools/kit.js promote-plan --target origin/master|origin/team-<code>'); process.exit(2); }
  try { console.log(JSON.stringify(promotionPlan(root(), args[1]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
