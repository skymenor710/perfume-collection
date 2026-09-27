import { describe, expect, it } from 'vitest';
import { MemoryImportJobStore } from '../apps/server/src/jobs/memory-store';
import { ImportJobRunner } from '../apps/server/src/jobs/runner';
import { Slots } from '../apps/server/src/jobs/slots';
import type { ImportJobInput } from '../apps/server/src/jobs/types';
import { fakeExecutor } from './helpers/import-fakes';

const input = (url: string, variantId: string | null = null): ImportJobInput => ({ url, identity: null, variantId });
const until = async (check: () => Promise<boolean>, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('condição não aconteceu a tempo');
};

function setup(slots = new Slots(2)) {
  const gates = new Map<string, () => void>();
  const runner = new ImportJobRunner(new MemoryImportJobStore(), fakeExecutor(gates), slots);
  return { runner, gates };
}

describe('jobs de importação', () => {
  it('queued → running → succeeded, com progresso e resultado', async () => {
    const { runner } = setup();
    const seen: string[] = [];
    const { job } = await runner.create('u1', input('https://ok.test/p'));
    expect(job.id).toMatch(/^imp_/);
    expect(job.status).toBe('queued');
    runner.subscribe(job.id, (j) => seen.push(`${j.status}:${j.progress.percent}`));
    await runner.idle();
    const done = await runner.get('u1', job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.progress).toEqual({ stage: 'done', percent: 100 });
    expect(done?.attempts).toBe(1);
    expect(done?.result?.ok).toBe(true);
    expect(done?.finishedAt).not.toBeNull();
    expect(seen.some((s) => s.startsWith('running:'))).toBe(true);
    expect(seen).toContain('running:15');
    expect(seen.at(-1)).toBe('succeeded:100');
  });

  it('o mesmo link ainda em andamento não vira dois jobs', async () => {
    const { runner, gates } = setup();
    const a = await runner.create('u1', input('https://gate.test/a'));
    const b = await runner.create('u1', input('https://gate.test/a'));
    expect(b.deduplicated).toBe(true);
    expect(b.job.id).toBe(a.job.id);
    const other = await runner.create('u2', input('https://gate.test/a'));
    expect(other.deduplicated).toBe(false); // outro dono, outro job
    await until(async () => gates.size === 2);
    for (const open of gates.values()) open();
    await runner.idle();
  });

  it('várias versões: espera a escolha e a nova tentativa com a versão termina', async () => {
    const { runner } = setup();
    const { job } = await runner.create('u1', input('https://choose.test/p'));
    await runner.idle();
    const waiting = await runner.get('u1', job.id);
    expect(waiting?.status).toBe('waiting_choice');
    expect(waiting?.result?.ok).toBe('choose');
    const retried = await runner.retry('u1', job.id, { variantId: '50' });
    expect(retried).not.toBe('not_retryable');
    await runner.idle();
    const done = await runner.get('u1', job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.input.variantId).toBe('50');
    expect(done?.attempts).toBe(2);
  });

  it('falha do resolvedor vira erro com código e frase para a pessoa', async () => {
    const { runner } = setup();
    const { job } = await runner.create('u1', input('https://fail.test/p'));
    await runner.idle();
    expect(await runner.get('u1', job.id)).toMatchObject({ status: 'failed', error: { code: 'unidentified', message: 'Não consegui identificar esse perfume.' } });
  });

  it('erro técnico nunca chega cru ao cliente', async () => {
    const { runner } = setup();
    const { job } = await runner.create('u1', input('https://boom.test/p'));
    await runner.idle();
    const failed = await runner.get('u1', job.id);
    expect(failed?.error).toEqual({ code: 'internal', message: 'Algo deu errado aqui. Tente de novo.' });
    expect(JSON.stringify(failed)).not.toContain('ECONNRESET');
  });

  it('cancelar um job em andamento', async () => {
    const { runner } = setup();
    const { job } = await runner.create('u1', input('https://slow.test/p'));
    await until(async () => (await runner.get('u1', job.id))?.status === 'running');
    const cancelled = await runner.cancel('u1', job.id);
    expect(cancelled?.status).toBe('cancelled');
    await runner.idle();
    // O trabalho que estava rodando não sobrescreve o cancelamento.
    expect((await runner.get('u1', job.id))?.status).toBe('cancelled');
    expect((await runner.get('u1', job.id))?.error?.code).toBe('cancelled');
  });

  it('cancelar um job que ainda espera vaga libera a fila', async () => {
    const slots = new Slots(1);
    const { runner, gates } = setup(slots);
    const first = await runner.create('u1', input('https://gate.test/1'));
    const second = await runner.create('u1', input('https://ok.test/2'));
    await until(async () => (await runner.get('u1', first.job.id))?.status === 'running');
    expect((await runner.get('u1', second.job.id))?.status).toBe('queued');
    await runner.cancel('u1', second.job.id);
    for (const open of gates.values()) open();
    await runner.idle();
    expect((await runner.get('u1', second.job.id))?.status).toBe('cancelled');
    expect(slots.inUse).toBe(0);
    expect(slots.waiting).toBe(0);
  });

  it('nova tentativa só para quem terminou sem sucesso', async () => {
    const { runner } = setup();
    const { job } = await runner.create('u1', input('https://ok.test/p'));
    await runner.idle();
    expect(await runner.retry('u1', job.id)).toBe('not_retryable');
    const failed = await runner.create('u1', input('https://fail.test/p'));
    await runner.idle();
    const again = await runner.retry('u1', failed.job.id);
    expect(again).toMatchObject({ status: 'queued', error: null, result: null });
    await runner.idle();
  });

  it('job de outro dono não existe para quem pergunta', async () => {
    const { runner } = setup();
    const { job } = await runner.create('dono', input('https://ok.test/p'));
    await runner.idle();
    expect(await runner.get('intruso', job.id)).toBeNull();
    expect(await runner.cancel('intruso', job.id)).toBeNull();
    expect(await runner.retry('intruso', job.id)).toBeNull();
    expect(await runner.list('intruso')).toEqual([]);
  });

  it('duas vagas no máximo, divididas com as rotas antigas', async () => {
    const slots = new Slots(2);
    const legacy = slots.tryAcquire(); // uma rota antiga pesquisando
    const { runner, gates } = setup(slots);
    const a = await runner.create('u1', input('https://gate.test/a'));
    const b = await runner.create('u1', input('https://gate.test/b'));
    await until(async () => (await runner.get('u1', a.job.id))?.status === 'running');
    expect((await runner.get('u1', b.job.id))?.status).toBe('queued');
    expect(slots.tryAcquire()).toBeNull(); // rota antiga recusaria com 429
    legacy?.();
    await until(async () => gates.size === 2);
    for (const open of gates.values()) open();
    await runner.idle();
    expect(slots.inUse).toBe(0);
  });
});

describe('MemoryImportJobStore', () => {
  it('declara que não persiste e limpa jobs terminados antigos', async () => {
    let now = Date.parse('2026-09-27T12:00:00Z');
    const store = new MemoryImportJobStore(60_000, 500, () => now);
    expect(store.persistent).toBe(false);
    const at = new Date(now).toISOString();
    const base = { ownerId: 'u', input: input('https://x.test'), progress: { stage: null, percent: 0 }, result: null, error: null, attempts: 1, createdAt: at, updatedAt: at, startedAt: at };
    await store.create({ ...base, id: 'velho', status: 'succeeded', finishedAt: at });
    await store.create({ ...base, id: 'ativo', status: 'running', finishedAt: null });
    now += 61_000;
    await store.create({ ...base, id: 'novo', status: 'queued', finishedAt: null });
    expect(await store.get('velho')).toBeNull();
    expect(await store.get('ativo')).not.toBeNull();
  });

  it('devolve cópias (quem lê não altera o que está guardado)', async () => {
    const store = new MemoryImportJobStore();
    const at = new Date().toISOString();
    await store.create({ id: 'j', ownerId: 'u', status: 'queued', input: input('https://x.test'), progress: { stage: null, percent: 0 }, result: null, error: null, attempts: 0, createdAt: at, updatedAt: at, startedAt: null, finishedAt: null });
    const copy = await store.get('j');
    copy!.status = 'failed';
    expect((await store.get('j'))?.status).toBe('queued');
  });
});
