'use strict';
// Normalize preselected demo records; this does not perform the live Jira selection.
function normalizeFixture(fixture) {
  if (fixture.query !== 'sdd-stories-report') throw new Error('фикстура не соответствует запросу sdd-stories-report');
  if (!Array.isArray(fixture.stories) || !Array.isArray(fixture.excluded) || !Array.isArray(fixture.unverified)) throw new Error('в фикстуре нужны stories/excluded/unverified');
  const meta = { ...(fixture.meta || {}), demo: true };
  const label = String(meta.label || 'SDD').toLowerCase();
  const prefix = String(meta.watchPath || 'openspec/changes').replace(/\/$/, '') + '/';
  const sddStories = [], plainStories = [], unverified = [...fixture.unverified];
  let labelCount = 0, commitCount = 0;
  for (const story of fixture.stories) {
    const labelsKnown = Array.isArray(story.labels);
    const tagged = labelsKnown && story.labels.some(item => String(item).toLowerCase() === label);
    const merged = (Array.isArray(story.prs) ? story.prs : []).filter(pr => pr.state === 'MERGED');
    const hasPr = merged.some(pr => Array.isArray(pr.changedPaths) && pr.changedPaths.some(file => String(file).startsWith(prefix)));
    const complete = Array.isArray(story.prs) && story.prsComplete !== false && merged.every(pr => Array.isArray(pr.changedPaths));
    if (!tagged && !hasPr && (!complete || !labelsKnown)) {
      unverified.push({ key: story.key, summary: story.summary, reason: 'метки или список файлов PR не подтверждены полностью' }); continue;
    }
    const row = { ...story, responsible: story.responsible || story.assignee || '—' };
    delete row.labels; delete row.prs; delete row.prsComplete;
    if (tagged || hasPr) {
      row.via = tagged && hasPr ? 'метка и PR' : tagged ? 'метка' : 'PR с артефактами';
      row.commit = story.commit || '—';
      if (!complete && !hasPr) row.prVerification = 'не проверено';
      if (!labelsKnown) row.labelVerification = 'не проверено';
      sddStories.push(row); labelCount += Number(tagged); commitCount += Number(hasPr);
    } else plainStories.push(row);
  }
  const storyCount = sddStories.length + plainStories.length;
  return { meta, sddStories, plainStories, unverified, excluded: fixture.excluded,
    counters: { storyCount, sddCount: sddStories.length, plainCount: plainStories.length,
      labelCount, commitCount, unverifiedCount: unverified.length,
      sddShare: storyCount ? (100 * sddStories.length / storyCount).toFixed(1).replace('.', ',') : '0' } };
}
module.exports = { normalizeFixture };
