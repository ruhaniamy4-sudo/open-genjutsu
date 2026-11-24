// Run: npm test  (Node 22.6+ strips the TypeScript types natively)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileLocalDirectorPrompt, hasBanglishLeak, getEngine, getEffect } from '../src/lib/vfx-data.ts';
import { gpuHeaders, hostAllowed, resolveGpuTarget } from '../src/lib/server/gpu.ts';

test('Bangla script counts as a prompt leak', () => {
  assert.equal(hasBanglishLeak('a man walks in the rain'), false);
  assert.equal(hasBanglishLeak('a man walks in বৃষ্টি'), true);
});

test('local Director output never leaks Banglish', () => {
  const ideas = [
    'bristi te cyberpunk hero kore dao, tungsten rim light ar wet leather jacket',
    'gobhir pani te diver neme jacche, upor theke sunlight rays',
    'foreground man ekdom still thakbe, pichoner futuristic city bend hoye warp hobe',
  ];
  for (const idea of ideas) {
    const out = compileLocalDirectorPrompt(idea, 'world-morph');
    assert.equal(hasBanglishLeak(out.prompt), false, out.prompt);
    assert.match(out.prompt, /Negative:/);
  }
});

test('Banglish detector catches leaks but not plain English', () => {
  assert.equal(hasBanglishLeak('hero kore dao in the rain'), true);
  assert.equal(hasBanglishLeak('A hero stands in the rain at 16:9, AR locked, er... no'), false);
});

test('boosters change the compiled params', () => {
  const off = compileLocalDirectorPrompt('rain', 'character-swap', { fp16Vae: false, faceRefine: false, orionDctl: false });
  assert.equal(off.params.vae, 'standard');
  assert.equal(off.params.colorGrade, 'rec709');
  assert.doesNotMatch(off.prompt, /Orion4D/);
});

test('unknown ids fall back to defaults', () => {
  assert.equal(getEngine('nope').id, 'kinetix-pro');
  assert.equal(getEffect(null).id, 'character-swap');
});

test('GPU allowlist: suffix rules need a real subdomain', () => {
  assert.equal(hostAllowed('abc.trycloudflare.com', ['.trycloudflare.com']), true);
  assert.equal(hostAllowed('trycloudflare.com', ['.trycloudflare.com']), false);
  assert.equal(hostAllowed('eviltrycloudflare.com', ['.trycloudflare.com']), false);
  assert.equal(hostAllowed('gpu.example.com', ['gpu.example.com']), true);
});

test('GPU target guard blocks SSRF shapes', () => {
  delete process.env.KINETIX_GPU_URL;
  delete process.env.KINETIX_GPU_ALLOWED_HOSTS;
  assert.equal(resolveGpuTarget(''), null);
  const ok = resolveGpuTarget('https://abc-def.trycloudflare.com/some/path?x=1');
  assert.deepEqual(ok, { ok: true, base: 'https://abc-def.trycloudflare.com' });
  for (const bad of [
    'http://abc.trycloudflare.com',
    'https://169.254.169.254',
    'https://[::1]',
    'https://user:pw@abc.trycloudflare.com',
    'https://evil.com',
    'not a url',
  ]) {
    const r = resolveGpuTarget(bad);
    assert.ok(r && !r.ok, `${bad} should be rejected`);
  }
});

test('server GPU token only goes to the configured worker', () => {
  process.env.KINETIX_GPU_URL = 'https://mine.trycloudflare.com';
  process.env.KINETIX_GPU_TOKEN = 'server-secret';
  assert.equal(gpuHeaders('https://mine.trycloudflare.com').Authorization, 'Bearer server-secret');
  assert.equal(gpuHeaders('https://attacker.trycloudflare.com').Authorization, undefined);
  assert.equal(gpuHeaders('https://attacker.trycloudflare.com', 'their-own').Authorization, 'Bearer their-own');
  assert.equal(gpuHeaders('https://mine.trycloudflare.com', 'bad\ntoken').Authorization, 'Bearer server-secret');
  delete process.env.KINETIX_GPU_URL;
  delete process.env.KINETIX_GPU_TOKEN;
});
