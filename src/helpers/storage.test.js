import test from 'node:test';
import assert from 'node:assert/strict';

const local = new Map();
globalThis.localStorage = {
  getItem: (key) => local.get(key) ?? null,
  setItem: (key, value) => local.set(key, value),
  removeItem: (key) => local.delete(key),
};

test('saveAmendment waits for server success before updating the local cache', async () => {
  local.clear();
  let resolveRequest;
  globalThis.fetch = async () => new Promise((resolve) => {
    resolveRequest = () => resolve({
      ok: true,
      json: async () => ({ record: { id: 'a1', status: 'QUOTED', server_saved: true } }),
    });
  });
  const { getAmendments, saveAmendment } = await import(`./storage.js?test=${Date.now()}`);
  const pending = saveAmendment({ id: 'a1', status: 'QUOTED' });

  assert.deepEqual(getAmendments(), []);
  resolveRequest();
  const saved = await pending;

  assert.equal(saved.server_saved, true);
  assert.deepEqual(getAmendments(), [saved]);
});

test('saveAmendment rejects server errors and leaves the local cache unchanged', async () => {
  local.clear();
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: 'Record changed; refresh and retry.' }),
  });
  const { getAmendments, saveAmendment } = await import(`./storage.js?test=${Date.now()}`);

  await assert.rejects(
    saveAmendment({ id: 'a2', status: 'DRAFT' }),
    /refresh and retry/i,
  );
  assert.deepEqual(getAmendments(), []);
});
