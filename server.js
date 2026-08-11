import app from './src/app.js';
import { env } from './src/config/env.js';
import { seedSuperAdmin } from './src/utils/seed.js';

async function start() {
  try {
    await seedSuperAdmin();
    app.listen(env.port, () => {
      console.log(`Flow API listening on port ${env.port}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
