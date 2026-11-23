const express = require('express');
const { randomBytes, randomUUID, scrypt, timingSafeEqual } = require('node:crypto');
const { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const RequestError = require('./request-error');

const router = express.Router();
const readCredentials = express.json({ limit: '4kb' });
const accountsFile = process.env.NOTHI_ACCOUNTS_FILE || path.join(__dirname, 'data', 'accounts.json');
const sessionCookie = 'nothi_session';
const sessionLifetime = 12 * 60 * 60 * 1000;
const sessions = new Map();
const deriveKey = promisify(scrypt);
const hashOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const fallbackSalt = randomBytes(16);
const fallbackHash = randomBytes(64);

function readAccounts() {
  try {
    const records = JSON.parse(readFileSync(accountsFile, 'utf8'));
    return new Map(records.map(account => [account.username, account]));
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw new Error('Could not read the local account store.', { cause: error });
  }
}

const accounts = readAccounts();

function saveAccount(account) {
  if (accounts.has(account.username)) throw new RequestError(409, 'That username is already taken.');

  mkdirSync(path.dirname(accountsFile), { recursive: true });
  const temporaryFile = accountsFile + '.' + randomUUID() + '.tmp';
  try {
    const records = [...accounts.values(), account];
    writeFileSync(temporaryFile, JSON.stringify(records), { mode: 0o600, flag: 'wx' });
    renameSync(temporaryFile, accountsFile);
  } finally {
    rmSync(temporaryFile, { force: true });
  }
  accounts.set(account.username, account);
}

function getCredentials(request) {
  const { username, password } = request.body ?? {};
  const normalized = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) {
    throw new RequestError(400, 'Use 3 to 32 letters, numbers, dots, underscores, or hyphens for the username.');
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new RequestError(400, 'Use a password between 8 and 128 characters.');
  }
  return { username: normalized, password };
}

function publicUser({ id, username }) {
  return { id, username };
}

function getSessionToken(request) {
  return /(?:^|;\s*)nothi_session=([A-Za-z0-9_-]{43})(?=;|$)/.exec(request.get('Cookie') ?? '')?.[1];
}

function currentUser(request) {
  const token = getSessionToken(request);
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.user;
}

function cookieOptions(request) {
  return { httpOnly: true, secure: request.secure, sameSite: 'strict', path: '/api' };
}

function startSession(request, response, account, status) {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }

  sessions.delete(getSessionToken(request));
  const token = randomBytes(32).toString('base64url');
  const user = publicUser(account);
  sessions.set(token, { user, expiresAt: now + sessionLifetime });
  response.cookie(sessionCookie, token, { ...cookieOptions(request), maxAge: sessionLifetime });
  response.status(status).json({ user });
}

function requireUser(request, response, next) {
  const user = currentUser(request);
  if (!user) return response.status(401).json({ error: 'Sign in to continue.' });
  response.locals.user = user;
  next();
}

router.get('/session', (request, response) => {
  response.json({ user: currentUser(request) });
});

router.post('/register', readCredentials, async (request, response) => {
  const { username, password } = getCredentials(request);
  if (accounts.has(username)) throw new RequestError(409, 'That username is already taken.');

  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt, 64, hashOptions);
  const account = { id: randomUUID(), username, salt: salt.toString('hex'), hash: hash.toString('hex') };
  saveAccount(account);
  startSession(request, response, account, 201);
});

router.post('/sign-in', readCredentials, async (request, response) => {
  const { username, password } = getCredentials(request);
  const account = accounts.get(username);
  const salt = account ? Buffer.from(account.salt, 'hex') : fallbackSalt;
  const expected = account ? Buffer.from(account.hash, 'hex') : fallbackHash;
  const hash = await deriveKey(password, salt, 64, hashOptions);
  if (!timingSafeEqual(hash, expected) || !account) {
    throw new RequestError(401, 'The username or password is incorrect.');
  }
  startSession(request, response, account, 200);
});

router.post('/sign-out', (request, response) => {
  sessions.delete(getSessionToken(request));
  response.clearCookie(sessionCookie, cookieOptions(request));
  response.json({ user: null });
});

router.use((error, _request, response, next) => {
  if (response.headersSent) return next(error);
  const message = error instanceof RequestError ? error.message
    : error.status === 400 ? 'Enter a valid username and password.'
      : error.status === 413 ? 'The sign-in details are too large.'
        : 'The account request could not be completed. Try again.';
  response.status(error.status || 500).json({ error: message });
});

module.exports = { authRouter: router, requireUser };
