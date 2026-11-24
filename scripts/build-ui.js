const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const uiComponents = require('../ui/components.js');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const template = read('ui/index.template.html').replace(
  /<!-- UI_COMPONENT (\w+) (.+?) -->/g,
  (_, name, json) => {
    if (!Object.prototype.hasOwnProperty.call(uiComponents, name)) throw new Error('Unknown UI component: ' + name);
    return uiComponents[name](JSON.parse(json));
  }
);
for (const marker of ['<!-- UI_STYLES -->', '<!-- UI_SCRIPT -->']) {
  if (template.split(marker).length !== 2) {
    throw new Error(`Expected one ${marker} marker in ui/index.template.html`);
  }
}
const styles = [read('ui/styles.css'), read('ui/views.css'), read('ui/material.css'), read('ui/quick_panel.css')].join('').replace(/\n$/, '');
const components = [read('ui/components.js'), read('ui/motion.js')].join('').replace(/\n$/, '');
const sourceFiles = [
  'core.js', 'planning_timeline.js', 'projects.js', 'settings.js', 'daily.js',
  'planning_data.js', 'planning_view.js', 'planning_dialog.js', 'planning_month.js',
  'events_daily.js', 'backlog.js', 'date_picker.js', 'legacy.js', 'quick_actual.js', 'plan_edit.js', 'bootstrap.js'
];
const app = sourceFiles.map(file => read(`ui/${file}`)).join('').replace(/\n$/, '');
const vendor = esbuild.buildSync({
  entryPoints: [path.join(root, 'ui/vendor.js')],
  bundle: true,
  minify: true,
  write: false,
  format: 'iife',
  target: 'es2020'
}).outputFiles[0].text.trimEnd()
  .replace(/<\/script/gi, '<\\/script')
  .replace(/<\?/g, '<\\?')
  .replace(/\t\n/g, '\\t\\n');
const output = template
  .replace('  <!-- UI_STYLES -->', () => `  <style>\n${styles}\n  </style>`)
  .replace('  <!-- UI_SCRIPT -->', () => `  <script>\n${vendor}\n${components}\n${app}\n  </script>`);

const target = path.join(root, 'gas/index.html');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== output) {
    throw new Error('gas/index.html is stale; run npm run ui:build');
  }
  console.log('gas/index.html is up to date');
} else {
  fs.writeFileSync(target, output);
  console.log('Built gas/index.html');
}
