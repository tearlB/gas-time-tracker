const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

// 保存先フォルダ: 年次ファイル・関係ないファイル・「バックアップ」フォルダ（中にバックアップ2件）。
function createContext() {
  const trashed = [];
  function file(id, name, created, size) {
    return {
      getId: () => id, getName: () => name, getUrl: () => 'https://drive/' + id,
      getDateCreated: () => new Date(created), getSize: () => size, isTrashed: () => trashed.includes(id),
      setTrashed(value) { if (value) trashed.push(id); },
      getParents: () => iterator([storage])
    };
  }
  function iterator(items) { let i = 0; return { hasNext: () => i < items.length, next: () => items[i++] }; }
  const backups = [file('backup-old', '2026年（形式7→8 移行前）', '2026-09-01T00:00:00Z', 18000), file('backup-new', '2026年（形式8→9 移行前）', '2026-10-15T00:00:00Z', 20000)];
  const backupFolder = { getId: () => 'folder-backup', getFiles: () => iterator(backups) };
  const storage = { getFoldersByName: name => iterator(name === 'バックアップ' ? [backupFolder] : []) };
  const files = { sheet2026: file('sheet2026', '2026年 まとめて工数管理さん', '2026-01-01T00:00:00Z', 20000), other: file('other', '関係ないファイル', '2026-01-01T00:00:00Z', 10) };
  backups.forEach(item => { files[item.getId()] = item; });
  const context = {
    console,
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: date => date.toISOString().slice(0, 16).replace('T', ' ').replace(/-/g, '/') },
    DriveApp: { getFileById: id => { if (!files[id]) throw new Error('not found'); return files[id]; } },
    getAnnualStorageFileMap: () => ({ 2026: 'sheet2026' })
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/storage_schema.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/legacy.gs', 'utf8'), context);
  return { context, trashed };
}

test('バックアップの一覧は、バックアップフォルダの中だけを新しい順に返す', () => {
  const { context } = createContext();
  const items = JSON.parse(JSON.stringify(context.listSchemaBackups()));
  assert.deepEqual(items.map(item => item.id), ['backup-new', 'backup-old']);
  assert.equal(items[0].size, 20000);
});

test('バックアップはゴミ箱へ移し、残りの一覧を返す', () => {
  const { context, trashed } = createContext();
  const result = context.trashSchemaBackups(['backup-old']);
  assert.equal(result.trashed, 1);
  assert.deepEqual(trashed, ['backup-old']);
  assert.deepEqual(Array.from(result.backups, item => item.id), ['backup-new']);
});

test('年次ファイルやバックアップフォルダの外のファイルは削除できない', () => {
  const { context, trashed } = createContext();
  assert.throws(() => context.trashSchemaBackups(['sheet2026']), /バックアップフォルダにないファイルは削除できません/);
  assert.throws(() => context.trashSchemaBackups(['backup-new', 'other']), /バックアップフォルダにないファイルは削除できません/);
  assert.deepEqual(trashed, [], '1件でも対象外があれば、どれも削除しない');
});

test('移行のあと、その年次ファイルのバックアップは新しい3件だけ残し、古いものと他の年のものは区別する', () => {
  const trashed = [];
  function iterator(items) { let i = 0; return { hasNext: () => i < items.length, next: () => items[i++] }; }
  const made = [];
  function backup(id, name, day) {
    const item = { getId: () => id, getName: () => name, getDateCreated: () => new Date('2026-10-' + day + 'T00:00:00Z'), isTrashed: () => trashed.includes(id), setTrashed() { trashed.push(id); } };
    made.push(item);
    return item;
  }
  for (let day = 10; day <= 14; day++) backup('b' + day, '2026年 まとめて工数管理さん（形式' + day + '→' + (day + 1) + ' 移行前）', day);
  backup('other-year', '2025年 まとめて工数管理さん（形式1→2 移行前）', '01');
  const folder = { getFiles: () => iterator(made) };
  const storage = { getFoldersByName: () => iterator([folder]) };
  const sheet = { getId: () => 'sheet2026', getName: () => '2026年 まとめて工数管理さん', getParents: () => iterator([storage]) };
  const context = { console, Logger: { log() {} }, DriveApp: { getFileById: () => sheet } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/storage_schema.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/legacy.gs', 'utf8'), context);
  assert.equal(context.appDbSchemaPruneBackups('sheet2026'), 2);
  assert.deepEqual(trashed.sort(), ['b10', 'b11']);
});

test('片付けに失敗しても移行は止めない', () => {
  const context = { console, Logger: { log() {} }, DriveApp: { getFileById() { throw new Error('Drive に接続できません'); } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/storage_schema.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/legacy.gs', 'utf8'), context);
  assert.equal(context.appDbSchemaPruneBackups('sheet2026'), 0);
});
