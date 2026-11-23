const path = require('node:path');
const { loadEnvFile } = require('node:process');

try {
  loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const express = require('express');
const { askRouter } = require('./ask');
const { ocrRouter } = require('./ocr');
const { pdfRouter } = require('./pdf');
const chatRouter = require('./chats');

const app = express();
const host = '127.0.0.1';
const port = 3001;

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/api/ask', askRouter);
app.use('/api/ocr', ocrRouter);
app.use('/api/extract', pdfRouter);
app.use('/api/chats', chatRouter);

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API endpoint not found.' });
});

const clientBuild = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuild, { dotfiles: 'deny' }));

app.listen(port, host, error => {
  if (error) {
    console.error(`Could not start Nothi AI at http://${host}:${port} (${error.code ?? 'unknown error'}).`);
    process.exitCode = 1;
    return;
  }
  console.log(`Server listening at http://${host}:${port}`);
});
