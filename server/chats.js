const express = require('express');
const { randomUUID } = require('node:crypto');
const { win32 } = require('node:path');
const { answerChatQuestion, getQuestion } = require('./ask');
const { extractPdf } = require('./pdf');
const { extractPhoto } = require('./ocr');
const RequestError = require('./request-error');

const router = express.Router();
const chats = new Map();
const readFile = express.raw({
  type: ['application/pdf', 'image/jpeg', 'image/png'],
  limit: '5mb',
  inflate: false,
});
const readJson = express.json({ limit: '256kb' });

function summarize({ id, title, updatedAt }) {
  return { id, title, updatedAt };
}

function requireIdle(chat) {
  if (chat.busy) throw new RequestError(409, 'Wait for the current operation to finish.');
}

function resetAttachmentContext(chat) {
  const title = Object.values(chat.attachments).filter(Boolean).map(attachment => attachment.name).join(' + ');
  chat.title = title.length > 72 ? title.slice(0, 71) + '…' : title || 'New chat';
  chat.messages = [];
  chat.updatedAt = Date.now();
}

router.use((_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});

router.get('/', (_request, response) => {
  response.json([...chats.values()].reverse().sort((a, b) => b.updatedAt - a.updatedAt).map(summarize));
});

router.post('/', (_request, response) => {
  const chat = {
    id: randomUUID(),
    title: 'New chat',
    updatedAt: Date.now(),
    attachments: { pdf: null, photo: null },
    uploads: { pdf: null, photo: null },
    messages: [],
    busy: null,
  };
  chats.set(chat.id, chat);
  response.status(201).json(chat);
});

router.param('chatId', (_request, response, next, id) => {
  const chat = chats.get(id);
  if (!chat) return next(new RequestError(404, 'This chat is no longer available. Chats are kept while the server is running.'));
  response.locals.chat = chat;
  next();
});

router.get('/:chatId', (_request, response) => response.json(response.locals.chat));

router.delete('/:chatId', (_request, response) => {
  const { chat } = response.locals;
  requireIdle(chat);
  chats.delete(chat.id);
  response.json({ id: chat.id });
});

router.post('/:chatId/document', readFile, async (request, response) => {
  const { chat } = response.locals;
  requireIdle(chat);
  if (!Buffer.isBuffer(request.body) || !request.body.length) {
    throw new RequestError(400, 'Choose one PDF, JPG, JPEG, or PNG.');
  }

  let name;
  try {
    name = win32.basename(decodeURIComponent(request.get('X-File-Name') || '')).trim();
  } catch {
    throw new RequestError(400, 'Choose a file with a valid name.');
  }
  if (!name || name.length > 255 || /[\x00-\x1f\x7f]/u.test(name)) {
    throw new RequestError(400, 'Choose a file with a valid name.');
  }

  const kind = request.is('application/pdf') ? 'pdf' : 'photo';
  chat.busy = 'extracting';
  chat.uploads[kind] = { name, status: 'processing' };
  let failure;
  try {
    const pages = kind === 'pdf'
      ? await extractPdf(request.body)
      : [{ pageNumber: 1, text: await extractPhoto(request.body) }];
    chat.attachments[kind] = { name, kind, pages };
    chat.uploads[kind] = null;
    resetAttachmentContext(chat);
  } catch (error) {
    failure = error instanceof RequestError ? error : new RequestError(500, 'Could not extract text from this file. Try again.');
    chat.uploads[kind] = { name, status: 'failed', error: failure.message };
  } finally {
    chat.busy = null;
  }
  if (failure) return response.status(failure.status).json({ error: failure.message, chat });
  response.json(chat);
});

router.delete('/:chatId/document/:kind', (request, response) => {
  const { chat } = response.locals;
  const { kind } = request.params;
  requireIdle(chat);
  if (kind !== 'pdf' && kind !== 'photo') throw new RequestError(400, 'Choose the PDF or photo to remove.');

  const hadAttachment = Boolean(chat.attachments[kind]);
  chat.attachments[kind] = null;
  chat.uploads[kind] = null;
  if (hadAttachment) resetAttachmentContext(chat);
  response.json(chat);
});

router.patch('/:chatId/document', readJson, (request, response) => {
  const { chat } = response.locals;
  requireIdle(chat);
  if (!chat.attachments.photo) {
    throw new RequestError(400, 'Attach a photo before editing extracted text.');
  }
  const { text } = request.body ?? {};
  if (typeof text !== 'string' || !text.trim() || text.length > 24000) {
    throw new RequestError(400, 'Enter between 1 and 24,000 characters of reviewed text.');
  }

  const page = chat.attachments.photo.pages[0];
  if (page.text !== text.trim()) {
    page.text = text.trim();
    resetAttachmentContext(chat);
  }
  response.json(chat);
});

router.post('/:chatId/messages', readJson, async (request, response) => {
  const { chat } = response.locals;
  requireIdle(chat);
  const question = getQuestion(request.body?.question);

  chat.busy = 'answering';
  try {
    const attachments = Object.values(chat.attachments).filter(Boolean);
    const answer = await answerChatQuestion(question, attachments, chat.messages);
    if (!chat.messages.length) {
      chat.title = question.length > 55 ? question.slice(0, 54).trimEnd() + '…' : question;
    }
    chat.messages.push(
      { id: randomUUID(), role: 'user', content: question },
      { id: randomUUID(), role: 'assistant', ...answer },
    );
    chat.updatedAt = Date.now();
  } finally {
    chat.busy = null;
  }
  response.json(chat);
});

router.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (error.type === 'entity.too.large') {
    const message = request.is('application/json') ? 'The text is too large.' : 'The file must be 5 MB or smaller.';
    return response.status(413).json({ error: message });
  }
  const message = error instanceof RequestError ? error.message : 'The chat request could not be completed. Try again.';
  response.status(error.status || 500).json({ error: message });
});

module.exports = router;
