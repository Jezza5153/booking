import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const serverDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(serverDir, '..');

const envFiles = [
    resolve(serverDir, '.env'),
    resolve(projectRoot, '.env'),
    resolve(projectRoot, '.env.local'),
];

for (const envFile of envFiles) {
    dotenv.config({ path: envFile, override: false });
}
