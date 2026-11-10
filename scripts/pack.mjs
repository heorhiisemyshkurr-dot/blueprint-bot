/**
 * Собирает архив для заливки на хостинг.
 *
 * Формат — .tar.gz: PowerShell Compress-Archive пишет пути с обратными слешами
 * (src\index.js), и Linux-распаковщики на хостинге разбирают их неправильно.
 * node_modules не кладём: зависимости ставит сам хостинг через npm install.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const archive = path.join(dist, 'blueprint-bot.tar.gz');

const include = ['src', 'assets', 'scripts', 'config.json', 'package.json', 'package-lock.json', '.env'];

if (!fs.existsSync(path.join(root, '.env'))) {
  console.error('Нет .env — без него бот на хостинге не запустится. Создай его из .env.example.');
  process.exit(1);
}

fs.mkdirSync(dist, { recursive: true });
fs.rmSync(archive, { force: true });

// GNU tar принимает "C:\..." за адрес удалённой машины, поэтому работаем
// относительными путями из корня проекта.
const rel = 'dist/blueprint-bot.tar.gz';
const present = include.filter((f) => fs.existsSync(path.join(root, f)));
execFileSync('tar.exe', ['-czf', rel, ...present], { cwd: root, stdio: 'inherit' });

const entries = execFileSync('tar.exe', ['-tzf', rel], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const backslashes = entries.filter((e) => e.includes('\\'));

console.log(`Готово: ${archive}`);
console.log(`Размер: ${(fs.statSync(archive).size / 1024 / 1024).toFixed(2)} МБ`);
console.log(`Файлов внутри: ${entries.length}`);
console.log(backslashes.length ? `ОШИБКА: путей с обратным слешем: ${backslashes.length}` : 'Пути корректные (прямые слеши).');
console.log('Внутри лежит .env с токеном — архив никому не пересылай.');
