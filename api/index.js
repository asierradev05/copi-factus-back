const serverless = require('serverless-http');

let cachedHandler;

async function prepareHandler() {
  if (!cachedHandler) {
    const { createNestApp } = require('../dist/src/main');
    const app = await createNestApp();
    cachedHandler = serverless(app.getHttpAdapter().getInstance());
  }
  return cachedHandler;
}

module.exports = async function handler(req, res) {
  const h = await prepareHandler();
  return h(req, res);
};