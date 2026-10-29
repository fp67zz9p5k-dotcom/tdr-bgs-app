import { indexedDB, IDBKeyRange } from 'fake-indexeddb'
import { createServer } from 'vite'

globalThis.indexedDB = indexedDB
globalThis.IDBKeyRange = IDBKeyRange
globalThis.document = { querySelector: () => ({ textContent: '' }) }

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true } })
try {
  const module = await server.ssrLoadModule('/scripts/backup-test.ts')
  await module.backupTestPromise
  console.log('PASS: backup-test.ts completed on fake-indexeddb')
} finally {
  const { backupTestDatabaseName } = await server.ssrLoadModule('/scripts/backup-test.ts')
  const { __closeTestDatabaseConnections } = await server.ssrLoadModule('/src/db.ts')
  __closeTestDatabaseConnections()
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(backupTestDatabaseName)
    request.onsuccess = () => resolve(undefined)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('テストDBの削除がブロックされました。'))
  })
  await server.close()
}
