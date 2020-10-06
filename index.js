const fs = require('fs');
const slug = require('slug');
const path = require('path');
const jsdom = require('jsdom');
const pkg = require('./package.json');
const webdriverPkg = require('webdriverio/package.json');
const PercyAgent = require('@percy/agent').default;
const { postSnapshot } = require('@percy/agent/dist/utils/sdk-utils');

// Webdriver extension for taking Percy snapshots
//
// Usage:
//   percySnapshot(driver, 'My Snapshot', { options });
exports.percySnapshot = async function percySnapshot(driver, name, options = {}) {
  // Appends the device name to the snapshot name
  if (options.appendDeviceName) {
    const capabilities = await driver.sessionCapabilities();
    name = `${name} [${capabilities.deviceName}]`;
  }

  // Get the dimensions of the device so we can render the screenshot
  // at the correct size
  let dimensions = await driver.getWindowSize();
  
  
  // Get the base64-encoded screenshot of the app
  const rawBase64Data = await driver.takeScreenshot();

  // Strip out the spaces and newlines from the raw screenshot response
  const base64Data = rawBase64Data.replace(/([ \r\n]+)/g, '');

  // Create styles for a DOM element that will render the screenshot
  // `customCss` needs to be configured similar to below. (ex: `margin: 10px;`)
  const css = `
    background-image: url('data:image/png;base64,${base64Data}');
    background-repeat: no-repeat;
    background-size: cover;
    height: ${dimensions.height}px;
    width: ${dimensions.width}px;
    ${options.customCss?options.customCss:""}
  `;

  if (options.customCss) {
    console.warning(
      `The "customCss" option has been deprecated in favor of "percyCSS" (used in the ${name} snapshot). "customCss"" will be removed in future versions.`
    );
  }
  if (options.height){
    dimensions.height=options.height;
  }
  if(dimensions.height>2000) {
    dimensions.height=2000;
  }
  if (options.width){
    dimensions.width=options.width
  }

  // Percy Agent and JSDOM don't play nicely together if you try to use a
  // <style> tag in the document, but using inline styles seems to work
  const inlineStyle = css.replace(/([\s]*)\n([\s]*)/g, '');

  // Create a fake HTML document that just renders a single DOM node with
  // the screenshot
  const html = `
    <!DOCTYPE html>
    <html style="margin: 0;height: 100%;">
      <head>
        <title>${name}</title>
      </head>
      <body style="margin: 0;height: 100%;">
        <div style="${inlineStyle}"></div>
      </body>
    </html>
  `;
  //console.log(html)
  // Wrap the HTML in JSDOM
  const dom = new jsdom.JSDOM(html, {
    // The URL must be set or the Percy agent uploading it will fail
    url: 'http://localhost'
  });

  const clientInfo = `${pkg.name}/${pkg.version}`;
  const environmentInfo = `wd/${webdriverPkg.version}`;

  const percyClient = new PercyAgent({
    clientInfo,
    environmentInfo,
    handleAgentCommunication: false
  });

  // Capture the fake document
  const domSnapshot = percyClient.snapshot(name, {
    document: dom.window.document
  });

  // Post the fake document to Percy from the node process
  const postSuccess = await postSnapshot({
    name,
    clientInfo,
    domSnapshot,
    environmentInfo,
    url: 'http://localhost/',
    widths: [dimensions.width],
    minHeight: dimensions.height,
    percyCSS: options.percyCSS
  });

  if (!postSuccess) {
    console.log('[percy] Error posting snapshot to agent.');
  }

  // In debug mode, write the document to disk locally
  if (process.env.LOG_LEVEL === 'debug') {
    writePercyDebugSnapshot(name, dom.window.document);
  }
};

function writePercyDebugSnapshot(name, document) {
  const percyDebugDir = path.join(process.cwd(), '.percy-debug');

  if (!fs.existsSync(percyDebugDir)) {
    fs.mkdirSync(percyDebugDir);
  }

  const snapshotPath = path.join(percyDebugDir, `${slug(name)}.html`);
  fs.writeFileSync(snapshotPath, document.documentElement && document.documentElement.outerHTML);
  console.log(`Percy debug snapshot written to ${snapshotPath}`);
}
