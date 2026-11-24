// clasp と同じ OAuth クライアントで、Apps Script の操作に必要な権限だけを求めてログインし、
// clasp の認証ファイル（.clasprc.json）と同じ形式で保存する。
//
// clasp 標準のログインは Google Cloud の権限（cloud-platform・service.management）も求めるため、
// Google Workspace の「Google Cloud セッション制御」の対象になり、一定時間ごとに再ログインが要る
// （invalid_rapt）。push・deploy などに必要なのは Apps Script の権限だけなので、Cloud の権限を外す。
// clasp logs など Cloud の権限が要るコマンドを使うときは `npm run gas:login -- --clasp` で従来どおりログインする。
//
// 使い方: node scripts/gas-login.js <認証ファイルのパス>
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const { OAuth2Client } = require(path.join(root, 'gas/node_modules/google-auth-library'));

const SCOPES = [
  'https://www.googleapis.com/auth/script.projects', // push・pull
  'https://www.googleapis.com/auth/script.deployments', // deploy・deployments
  'https://www.googleapis.com/auth/script.webapp.deploy', // ウェブアプリのデプロイ
  'https://www.googleapis.com/auth/drive.metadata.readonly', // プロジェクトの検索
  'https://www.googleapis.com/auth/drive.file', // create
  'https://www.googleapis.com/auth/userinfo.email' // ログイン中のアカウントの表示
];

async function claspClient() {
  // クライアントIDは手元の clasp 本体から読む（リポジトリには書き写さない）。
  const file = path.join(root, 'gas/node_modules/@google/clasp/build/src/auth/oauth_client.js');
  const clasp = await import(pathToFileURL(file).href);
  return { clientId: clasp.DEFAULT_CLASP_OAUTH_CLIENT_ID, clientSecret: clasp.DEFAULT_CLASP_OAUTH_CLIENT_SECRET };
}

function waitForCode(server) {
  return new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (!code && !error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(code ? 'ログインしました。このタブは閉じてかまいません。' : 'ログインできませんでした: ' + error);
      if (code) resolve(code); else reject(new Error(error));
    });
  });
}

// 長い scope を最後に回す。ターミナルの折り返しで途中までしかコピーされなくても、必須の項目は残るようにする。
function orderAuthUrl(rawUrl) {
  const url = new URL(rawUrl);
  const params = Array.from(url.searchParams.entries());
  const ordered = params.filter(([key]) => key !== 'scope').concat(params.filter(([key]) => key === 'scope'));
  url.search = new URLSearchParams(ordered).toString();
  return url.toString();
}

// WSL なら Windows のブラウザで、それ以外は既定のブラウザで開く。開けなければ false。
function openBrowser(url) {
  const { spawnSync } = require('node:child_process');
  const candidates = fs.existsSync('/mnt/c/Windows')
    ? [['powershell.exe', ['-NoProfile', '-Command', 'Start-Process', "'" + url.replace(/'/g, "''") + "'"]]]
    : [['xdg-open', [url]], ['open', [url]]];
  return candidates.some(([command, args]) => {
    const result = spawnSync(command, args, { stdio: 'ignore' });
    return !result.error && result.status === 0;
  });
}

function saveCredentials(authFile, credentials) {
  let store = {};
  try { store = JSON.parse(fs.readFileSync(authFile, 'utf8')) || {}; } catch (err) { store = {}; }
  store.tokens = Object.assign({}, store.tokens, { default: credentials });
  fs.writeFileSync(authFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.chmodSync(authFile, 0o600);
}

async function main() {
  const authFile = process.argv[2];
  if (!authFile) throw new Error('認証ファイルのパスを指定してください。');
  const { clientId, clientSecret } = await claspClient();
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, resolve));
  const redirectUri = 'http://localhost:' + server.address().port;
  const client = new OAuth2Client({ clientId, clientSecret, redirectUri });
  const authUrl = orderAuthUrl(client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES }));
  const opened = openBrowser(authUrl);
  console.log((opened ? 'ブラウザでログイン画面を開きました。開かない場合は、' : '') + '次のURLをブラウザで開いて、Googleアカウントでログインしてください:\n');
  console.log(authUrl + '\n');
  const code = await waitForCode(server).finally(() => server.close());
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error('リフレッシュトークンを受け取れませんでした。もう一度お試しください。');
  saveCredentials(authFile, {
    client_id: clientId,
    client_secret: clientSecret,
    type: 'authorized_user',
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token
  });
  console.log('ログインしました（Apps Script の権限のみ）: ' + authFile);
}

main().catch(err => {
  console.error('ログインに失敗しました: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
