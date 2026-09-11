import { loadEnvConfig } from "@next/env";
import { databaseUrlSchema } from "@shared/environment/database-url";
import { createEnv } from "@t3-oss/env-nextjs";

loadEnvConfig(process.cwd());

export const dbMigrationEnv = createEnv({
  server: {
    DATABASE_URL_UNPOOLED: databaseUrlSchema,
  },
  experimental__runtimeEnv: {},
});
