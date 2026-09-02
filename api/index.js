let appPromise;
let initialized = false;

module.exports = async function handler(req, res) {
  if (!appPromise) {
    const { createNestApp } = require('../dist/src/main');
    appPromise = createNestApp();
  }
  const app = await appPromise;
  if (!initialized) {
    initialized = true;
    await app.init();
  }
  return app.getHttpAdapter().getInstance()(req, res);
};