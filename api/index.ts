import { createQatshiApp, initializeDatabase } from '../server';

const app = createQatshiApp();
let databaseReady: Promise<void> | undefined;

export default async function handler(req: any, res: any) {
  databaseReady ??= initializeDatabase();
  await databaseReady;
  const pathValue = typeof req.query.path === 'string' ? req.query.path : '';
  if (pathValue) req.url = `/api/${pathValue.replace(/^\/+/, '')}`;
  return app(req, res);
}
