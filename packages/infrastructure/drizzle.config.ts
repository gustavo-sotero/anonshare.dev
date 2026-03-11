import { defineConfig } from 'drizzle-kit';
import { db } from './src/config/index';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/**/*.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: db.url()
  }
});
