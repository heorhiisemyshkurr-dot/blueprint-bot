import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.js';

const file = path.join(dataDir, 'tickets.json');
const empty = { counter: 0, tickets: {} };

function read() {
  try {
    const db = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { counter: db.counter ?? 0, tickets: db.tickets ?? {} };
  } catch {
    return { ...empty, tickets: {} };
  }
}

function write(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(db, null, 2) + '\n', 'utf8');
}

export function nextNumber() {
  const db = read();
  db.counter += 1;
  write(db);
  return db.counter;
}

export function addTicket(ticket) {
  const db = read();
  db.tickets[ticket.channelId] = ticket;
  write(db);
  return ticket;
}

export function getTicket(channelId) {
  return read().tickets[channelId] ?? null;
}

export function updateTicket(channelId, patch) {
  const db = read();
  if (!db.tickets[channelId]) return null;
  db.tickets[channelId] = { ...db.tickets[channelId], ...patch };
  write(db);
  return db.tickets[channelId];
}

export function removeTicket(channelId) {
  const db = read();
  delete db.tickets[channelId];
  write(db);
}

export function openTicketsOf(userId) {
  return Object.values(read().tickets).filter((t) => t.userId === userId && t.status === 'open');
}
