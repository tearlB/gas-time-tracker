const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const serverPath = path.join(__dirname, 'preview-server.js');
const port = Number(process.env.PREVIEW_PORT || 4173);
const pidPath = path.join(os.tmpdir(), `matomete-kousu-kanri-san-preview-${port}.pid`);

function startServer() {
  const server = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore'
  });

  server.once('error', error => {
    console.error(`Could not start preview server: ${error.message}`);
    process.exitCode = 1;
  });

  server.once('spawn', () => {
    fs.writeFileSync(pidPath, String(server.pid));
    server.unref();
    console.log(`Preview started in background: http://127.0.0.1:${port}`);
  });
}

const probe = net.createConnection({ host: '127.0.0.1', port });
let checked = false;
probe.setTimeout(500);
probe.once('connect', () => {
  checked = true;
  probe.destroy();
  console.log(`Preview is already running: http://127.0.0.1:${port}`);
});
probe.once('error', () => {
  if (checked) return;
  checked = true;
  startServer();
});
probe.once('timeout', () => {
  checked = true;
  probe.destroy();
  startServer();
});
