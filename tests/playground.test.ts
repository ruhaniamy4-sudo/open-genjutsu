import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileShotPrompt,
  duplicateShot,
  exportShotListCsv,
  exportShotListHtml,
  findShot,
  moveScene,
  moveShot,
  newProject,
  newScene,
  parseScript,
  sampleProject,
} from '../src/lib/playground.ts';

const SCRIPT = `EXT. OLD DHAKA ALLEY – NIGHT
Rafi walks through heavy rain.
RAFI: Ar ekta delivery. Tarpor shesh.
Mitu appears under a red lamp.
MITU: Tumi deri korle.

INT. TEA STALL – DAY
Steam rises from the kettle.`;

test('script parser builds scenes, shots, dialogue and cast', () => {
  const p = parseScript(SCRIPT, newProject());
  assert.equal(p.scenes.length, 2);
  assert.equal(p.scenes[0].heading, 'EXT. OLD DHAKA ALLEY – NIGHT');
  assert.equal(p.scenes[0].time, 'Night');
  assert.equal(p.scenes[1].time, 'Day');
  assert.equal(p.scenes[0].shots.length, 2);
  assert.equal(p.scenes[0].shots[0].dialogue[0].line, 'Ar ekta delivery. Tarpor shesh.');
  assert.deepEqual(p.characters.map((c) => c.name).sort(), ['MITU', 'RAFI']);
  // speaker is attached to the shot
  const rafi = p.characters.find((c) => c.name === 'RAFI')!;
  assert.ok(p.scenes[0].shots[0].characterIds.includes(rafi.id));
});

test('script parser reuses existing cast and never returns empty scenes', () => {
  const base = sampleProject();
  const p = parseScript('RAFI: hello', base);
  assert.equal(p.characters.filter((c) => c.name === 'RAFI').length, 1);
  assert.equal(parseScript('', newProject()).scenes.length, 1);
});

test('shot prompt carries camera, cast, dialogue verbatim and continuity', () => {
  const p = sampleProject();
  const second = p.scenes[0].shots[1];
  const found = findShot(p, second.id)!;
  assert.equal(found.prev?.id, p.scenes[0].shots[0].id);
  const prompt = compileShotPrompt(p, found.scene, found.shot, true);
  assert.match(prompt, /Close-up shot on ARRI Alexa 65, 85mm portrait lens/);
  assert.match(prompt, /RAFI: "Ar ekta delivery\. Tarpor shesh\."/);
  assert.match(prompt, /Continuity: start exactly from the previous shot/);
  assert.match(prompt, /Keep each face identical/);
  const first = compileShotPrompt(p, found.scene, p.scenes[0].shots[0], false);
  assert.doesNotMatch(first, /Continuity:/);
});

test('script parser handles Bangla headings, Bangla speakers, blank lines and filters stage directives', () => {
  const bangla = `দৃশ্য ১: পুরান ঢাকার গলি – রাত
বৃষ্টি পড়ছে।
রাফি: আর একটা ডেলিভারি।

মিতু: তুমি দেরি করলে।
SFX: thunder crack
CUT TO: tea stall

দৃশ্য ২: চায়ের দোকান – দিন
চায়ের কাপ থেকে ধোঁয়া উঠছে।`;
  const p = parseScript(bangla, newProject());
  assert.equal(p.scenes.length, 2);
  assert.equal(p.scenes[0].time, 'Night');
  assert.equal(p.scenes[0].location, 'পুরান ঢাকার গলি');
  assert.equal(p.scenes[1].time, 'Day');
  assert.equal(p.scenes[1].location, 'চায়ের দোকান');
  // Blank line splits MITU into a separate Close-up shot; SFX and CUT TO become actions, not characters.
  assert.deepEqual(p.characters.map((c) => c.name), ['রাফি', 'মিতু']);
  assert.equal(p.scenes[0].shots[0].dialogue[0].line, 'আর একটা ডেলিভারি।');
  assert.equal(p.scenes[0].shots[1].angle, 'Close-up');
  assert.equal(p.scenes[0].shots[1].dialogue[0].line, 'তুমি দেরি করলে।');
  assert.equal(p.scenes[0].shots[2].action, 'SFX: thunder crack');
});

test('findShot does not carry continuity prev across scene boundaries', () => {
  const p = sampleProject();
  const s2 = newScene(2, 'Day');
  p.scenes.push(s2);
  const found = findShot(p, s2.shots[0].id)!;
  assert.equal(found.prev, null);
});

test('moveShot and moveScene reorder items cleanly and keep first-shot continuity off', () => {
  const p = sampleProject();
  const [a, b, c] = p.scenes[0].shots;
  const moved = moveShot(p, p.scenes[0].id, 1, 0);
  assert.deepEqual(moved.scenes[0].shots.map((s) => s.id), [b.id, a.id, c.id]);
  assert.equal(moved.scenes[0].shots[0].continuity, false);
  // Out-of-bounds is a no-op
  assert.equal(moveShot(moved, p.scenes[0].id, 0, -1), moved);

  const s2 = newScene(2, 'Day');
  const twoScenes = { ...p, scenes: [p.scenes[0], s2] };
  const swapped = moveScene(twoScenes, 0, 1);
  assert.deepEqual(swapped.scenes.map((sc) => sc.id), [s2.id, p.scenes[0].id]);
  assert.equal(moveScene(swapped, 1, 5), swapped);
});

test('duplicateShot inserts an unshot clone immediately after the original', () => {
  const p = sampleProject();
  const orig = p.scenes[0].shots[1];
  orig.lastFrame = 'data:image/jpeg;base64,abc';
  orig.render = { jobToken: 'tok', status: 'completed', outputUrl: 'https://example.com/a.mp4', outputType: 'video', progress: 1, error: null, demo: false };

  const res = duplicateShot(p, p.scenes[0].id, orig.id)!;
  assert.equal(res.project.scenes[0].shots.length, 4);
  const copy = res.project.scenes[0].shots[2];
  assert.equal(copy.id, res.newShotId);
  assert.notEqual(copy.id, orig.id);
  assert.equal(copy.angle, orig.angle);
  assert.equal(copy.action, orig.action);
  assert.equal(copy.dialogue[0].line, orig.dialogue[0].line);
  assert.notEqual(copy.dialogue[0].id, orig.dialogue[0].id);
  assert.equal(copy.render, null);
  assert.equal(copy.lastFrame, null);
  assert.equal(copy.continuity, true);
});

test('shot list CSV and printable HTML exports escape fields and preserve Bangla text', () => {
  const p = sampleProject();
  p.title = 'Rain <Over> "Dhaka"';
  p.scenes[0].shots[0].action = 'Rafi walks, "slowly", through পুরান ঢাকা';
  p.scenes[0].shots[1].dialogue[0].line = '=SUM(A1:A2)';

  const csv = exportShotListCsv(p);
  assert.ok(csv.startsWith('\uFEFF'), 'includes UTF-8 BOM for Excel Bangla support');
  assert.match(csv, /Scene,Scene Heading,Location,Time,Shot,Camera,Lens,Angle,Movement,Duration,Cast,Action,Dialogue,Status/);
  assert.match(csv, /"Rafi walks, ""slowly"", through পুরান ঢাকা"/);
  assert.match(csv, /RAFI: =SUM\(A1:A2\)/);

  const html = exportShotListHtml(p);
  assert.match(html, /Rain &lt;Over&gt; &quot;Dhaka&quot;/);
  assert.doesNotMatch(html, /<Over>/);
  assert.match(html, /ARRI Alexa 65/);
  assert.match(html, /85mm portrait/);
  assert.match(html, /পুরান ঢাকা/);
});
