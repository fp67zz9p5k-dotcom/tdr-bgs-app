import { indexedDB, IDBKeyRange } from 'fake-indexeddb'
import { createServer } from 'vite'

globalThis.indexedDB = indexedDB
globalThis.IDBKeyRange = IDBKeyRange

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true } })
let databaseName
try {
  const module = await server.ssrLoadModule('/scripts/performance-test.ts')
  databaseName = module.performanceTestDatabaseName
  await module.performanceTestPromise
} finally {
  const request = indexedDB.deleteDatabase(databaseName)
  await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(undefined)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('性能計測DBの削除がブロックされました。'))
  })
  await server.close()
}
