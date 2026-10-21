// Выбор хранилища: PostgreSQL, если задан DATABASE_URL, иначе файлы на диске.
import path from 'path';
import { fileURLToPath } from 'url';
import { createPgStore } from './pg.js';
import { createFileStore } from './file.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(here, '..', '..', '..', 'data');

export const store = process.env.DATABASE_URL
    ? createPgStore(process.env.DATABASE_URL)
    : createFileStore(path.resolve(process.env.DATA_DIR || defaultDataDir));
