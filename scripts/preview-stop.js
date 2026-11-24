const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = Number(process.env.PREVIEW_PORT || 4173);
const pidPath = path.join(os.tmpdir(), `matomete-kousu-kanri-san-preview-${port}.pid`);

if (!fs.existsSync(pidPath)) {
  console.log('No background preview PID was found.');
  process.exit(0);
}

const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
if (!Number.isInteger(pid) || pid <= 0) {
  fs.rmSync(pidPath, { force: true });
  console.log('Removed an invalid preview PID file.');
  process.exit(0);
}

try {
  process.kill(pid, 'SIGTERM');
  console.log('Stopped the background preview server.');
} catch (error) {
  if (error.code !== 'ESRCH') throw error;
  console.log('The background preview server was already stopped.');
}
fs.rmSync(pidPath, { force: true });
