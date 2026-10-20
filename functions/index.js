const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString, expr, projectID } = require('firebase-functions/params');
const { createHandler, createFirestoreStore } = require('./src/gmail');

initializeApp();
const clientId = defineSecret('GMAIL_OAUTH_CLIENT_ID');
const clientSecret = defineSecret('GMAIL_OAUTH_CLIENT_SECRET');
const encryptionKey = defineSecret('GMAIL_TOKEN_ENCRYPTION_KEY');
const origins = defineString('GMAIL_ALLOWED_ORIGINS', {
  default: expr`https://${projectID}.web.app`,
});
const redirectUri = defineString('GMAIL_OAUTH_REDIRECT_URI', {
  default: expr`https://${projectID}.web.app/api/gmail/callback`,
});

exports.gmailApi = onRequest({
  region: 'us-central1',
  secrets: [clientId, clientSecret, encryptionKey],
  timeoutSeconds: 300,
  memory: '512MiB',
  cors: false,
  invoker: 'public',
}, (req, res) => createHandler({
  auth: getAuth(),
  store: createFirestoreStore(getFirestore()),
  config: {
    clientId: clientId.value(),
    clientSecret: clientSecret.value(),
    encryptionKey: encryptionKey.value(),
    allowedOrigins: origins.value(),
    redirectUri: redirectUri.value(),
  },
})(req, res));
