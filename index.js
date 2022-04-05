const fs = require('fs');
const slug = require('slug');
const path = require('path');
const jsdom = require('jsdom');
const pkg = require('./package.json');
const webdriverPkg = require('webdriverio/package.json');
const { postSnapshot, isPercyEnabled, logger, fetchPercyDOM } = require('@percy/sdk-utils');
const {PercyClient} = require('@percy/client');

// Collect client and environment information
const webdriverioPkg = require('webdriverio/package.json');
const CLIENT_INFO = `${pkg.name}/${pkg.version}`;
const ENV_INFO = `${webdriverioPkg.name}/${webdriverioPkg.version}`;

function uid() {
  return `_${Math.random().toString(36).substr(2, 9)}`;
} // Marks elements that are to be serialized later with a data attribute.


function prepareDOM(dom) {
  for (let elem of dom.querySelectorAll('input, textarea, select, iframe, canvas, video')) {
    if (!elem.getAttribute('data-percy-element-id')) {
      elem.setAttribute('data-percy-element-id', uid());
    }
  }
}

// Translates JavaScript properties of inputs into DOM attributes.
function serializeInputElements(dom, clone) {
  for (let elem of dom.querySelectorAll('input, textarea, select')) {
    let inputId = elem.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${inputId}"]`);

    switch (elem.type) {
      case 'checkbox':
      case 'radio':
        if (elem.checked) {
          cloneEl.setAttribute('checked', '');
        }

        break;

      case 'select-one':
        if (elem.selectedIndex !== -1) {
          cloneEl.options[elem.selectedIndex].setAttribute('selected', 'true');
        }

        break;

      case 'select-multiple':
        for (let option of elem.selectedOptions) {
          cloneEl.options[option.index].setAttribute('selected', 'true');
        }

        break;

      case 'textarea':
        cloneEl.innerHTML = elem.value;
        break;

      default:
        cloneEl.setAttribute('value', elem.value);
    }
  }
}

// embedded documents are serialized and their contents become root-relative.

function setBaseURI(dom) {
  if (!new URL(dom.baseURI).hostname) return;
  let $base = document.createElement('base');
  $base.href = dom.baseURI;
  dom.querySelector('head').prepend($base);
} // Recursively serializes iframe documents into srcdoc attributes.


function serializeFrames(dom, clone, _ref) {
  let {
    enableJavaScript
  } = _ref;

  for (let frame of dom.querySelectorAll('iframe')) {
    let percyElementId = frame.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);
    let builtWithJs = !frame.srcdoc && (!frame.src || frame.src.split(':')[0] === 'javascript'); // delete frames within the head since they usually break pages when
    // rerendered and do not effect the visuals of a page

    if (clone.head.contains(cloneEl)) {
      cloneEl.remove(); // if the frame document is accessible and not empty, we can serialize it
    } else if (frame.contentDocument && frame.contentDocument.documentElement) {
      // js is enabled and this frame was built with js, don't serialize it
      if (enableJavaScript && builtWithJs) continue; // the frame has yet to load and wasn't built with js, it is unsafe to serialize

      if (!builtWithJs && !frame.contentWindow.performance.timing.loadEventEnd) continue; // recersively serialize contents

      let serialized = serializeDOM({
        domTransformation: setBaseURI,
        dom: frame.contentDocument,
        enableJavaScript
      }); // assign to srcdoc and remove src

      cloneEl.setAttribute('srcdoc', serialized);
      cloneEl.removeAttribute('src'); // delete inaccessible frames built with js when js is disabled because they
      // break asset discovery by creating non-captured requests that hang
    } else if (!enableJavaScript && builtWithJs) {
      cloneEl.remove();
    }
  }
}

// Returns true if a stylesheet is a CSSOM-based stylesheet.
function isCSSOM(styleSheet) {
  var _styleSheet$ownerNode, _styleSheet$ownerNode2;

  // no href, has a rulesheet, and isn't already in the DOM
  return !styleSheet.href && styleSheet.cssRules && !((_styleSheet$ownerNode = styleSheet.ownerNode) !== null && _styleSheet$ownerNode !== void 0 && (_styleSheet$ownerNode2 = _styleSheet$ownerNode.innerText) !== null && _styleSheet$ownerNode2 !== void 0 && _styleSheet$ownerNode2.trim().length);
} // Outputs in-memory CSSOM into their respective DOM nodes.


function serializeCSSOM(dom, clone) {
  for (let styleSheet of dom.styleSheets) {
    if (isCSSOM(styleSheet)) {
      let style = clone.createElement('style');
      style.type = 'text/css';
      style.setAttribute('data-percy-cssom-serialized', 'true');
      style.innerHTML = Array.from(styleSheet.cssRules).reduce((prev, cssRule) => prev + cssRule.cssText, '');
      clone.head.appendChild(style);
    }
  }
}

// Serialize in-memory canvas elements into images.
function serializeCanvas(dom, clone) {
  for (let canvas of dom.querySelectorAll('canvas')) {
    // Note: the `.toDataURL` API requires WebGL canvas elements to use
    // `preserveDrawingBuffer: true`. This is because `.toDataURL` uses the
    // drawing buffer, which is cleared after each render for WebGL by default.
    let dataUrl = canvas.toDataURL(); // skip empty canvases

    if (!dataUrl || dataUrl === 'data:,') continue; // create an image element in the cloned dom

    let img = clone.createElement('img');
    img.src = dataUrl; // copy canvas element attributes to the image element such as style, class,
    // or data attributes that may be targeted by CSS

    for (let {
      name,
      value
    } of canvas.attributes) {
      img.setAttribute(name, value);
    } // mark the image as serialized (can be targeted by CSS)


    img.setAttribute('data-percy-canvas-serialized', ''); // set a default max width to account for canvases that might resize with JS

    img.style.maxWidth = img.style.maxWidth || '100%'; // insert the image into the cloned DOM and remove the cloned canvas element

    let percyElementId = canvas.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id=${percyElementId}]`);
    cloneEl.parentElement.insertBefore(img, cloneEl);
    cloneEl.remove();
  }
}

// Captures the current frame of videos and sets the poster image
function serializeVideos(dom, clone) {
  for (let video of dom.querySelectorAll('video')) {
    // If the video already has a poster image, no work for us to do
    if (video.getAttribute('poster')) continue;
    let videoId = video.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${videoId}"]`);
    let canvas = document.createElement('canvas');
    let width = canvas.width = video.videoWidth;
    let height = canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    let dataUrl = canvas.toDataURL(); // If the canvas produces a blank image, skip

    if (!dataUrl || dataUrl === 'data:,') continue;
    cloneEl.setAttribute('poster', dataUrl);
  }
}

function doctype(dom) {
  var _dom$doctype;

  let {
    name = 'html',
    publicId = '',
    systemId = ''
  } = (_dom$doctype = dom === null || dom === void 0 ? void 0 : dom.doctype) !== null && _dom$doctype !== void 0 ? _dom$doctype : {};
  let deprecated = '';

  if (publicId && systemId) {
    deprecated = ` PUBLIC "${publicId}" "${systemId}"`;
  } else if (publicId) {
    deprecated = ` PUBLIC "${publicId}"`;
  } else if (systemId) {
    deprecated = ` SYSTEM "${systemId}"`;
  }

  return `<!DOCTYPE ${name}${deprecated}>`;
} // Serializes a document and returns the resulting DOM string.


function serializeDOM(options) {
  let {
    dom = options.document,
    // allow snake_case or camelCase
    enableJavaScript = options === null || options === void 0 ? void 0 : options.enable_javascript,
    domTransformation = options === null || options === void 0 ? void 0 : options.dom_transformation
  } = options || {};
  prepareDOM(dom);
  let clone = dom.cloneNode(true);
  serializeInputElements(dom, clone);
  serializeFrames(dom, clone, {
    enableJavaScript
  });
  serializeVideos(dom, clone);

  if (!enableJavaScript) {
    serializeCSSOM(dom, clone);
    serializeCanvas(dom, clone);
  }

  let doc = clone.documentElement;

  if (domTransformation) {
    try {
      domTransformation(doc);
    } catch (err) {
      console.error('Could not transform the dom:', err.message);
    }
  }

  return doctype(dom) + doc.outerHTML;
}

// Take a DOM snapshot and post it to the snapshot endpoint
exports.percySnapshot = async function percySnapshot(b, name, options) {
  // allow working with or without standalone mode
  if (!b || typeof b === 'string') [b, name, options] = [browser, b, name];
  if (!b) throw new Error('The WebdriverIO `browser` object is required.');
  if (!name) throw new Error('The `name` argument is required.');

  return b.call(async () => {
    if (!(await isPercyEnabled())) return;
    let log = logger('webdriverio');

    try {
      // Inject the DOM serialization script
      await b.execute(await fetchPercyDOM());

      // Serialize and capture the DOM
      /* istanbul ignore next: no instrumenting injected code */
      let { domSnapshot, url } = await b.execute(options => ({
        /* eslint-disable-next-line no-undef */
        domSnapshot: PercyDOM.serialize(options),
        url: document.URL
      }), options);

      // Post the DOM to the snapshot endpoint with snapshot options and other info
      await postSnapshot({
        ...options,
        environmentInfo: ENV_INFO,
        clientInfo: CLIENT_INFO,
        domSnapshot,
        name,
        url
      });
    } catch (error) {
      // Handle errors
      log.error(`Could not take DOM snapshot "${name}"`);
      log.error(error);
    }
  });
};

// Webdriver extension for taking Percy snapshots
//
// Usage:
//   percyAppiumSnapshot(driver, 'My Snapshot', { options });

exports.percyAppiumSnapshot = async function percyAppiumSnapshot(driver, name, options = {}) {
  // Appends the device name to the snapshot name
  if (options.appendDeviceName) {
    const capabilities = await driver.sessionCapabilities();
    name = `${name} [${capabilities.deviceName}]`;
  }
  if (!(await isPercyEnabled())) return;
  // Get the dimensions of the device so we can render the screenshot
  // at the correct size
  let dimensions = await driver.getWindowSize();
  
  
  // Get the base64-encoded screenshot of the app
  const rawBase64Data = await driver.takeScreenshot();

  // Strip out the spaces and newlines from the raw screenshot response
  const base64Data = rawBase64Data.replace(/([ \r\n]+)/g, '');

  // Create styles for a DOM element that will render the screenshot
  // `customCss` needs to be configured similar to below. (ex: `margin: 10px;`)
  const css = `data:image/png;base64,${base64Data}`;

  // if (options.customCss) {
  //   console.warning(
  //     `The "customCss" option has been deprecated in favor of "percyCSS" (used in the ${name} snapshot). "customCss"" will be removed in future versions.`
  //   );
  // }
  // if (options.height){
  //   dimensions.height=options.height;
  // }
  // if(dimensions.height>2000) {
  //   dimensions.height=2000;
  // }
  // if (options.width){
  //   dimensions.width=options.width
  // }

  // Percy Agent and JSDOM don't play nicely together if you try to use a
  // <style> tag in the document, but using inline styles seems to work
  const inlineStyle = css.replace(/([\s]*)\n([\s]*)/g, '');

  // Create a fake HTML document that just renders a single DOM node with
  // the screenshot
  const html = `
    <!DOCTYPE html>
    <html style="margin: 0px; width: 100%;">
      <head>
        <title>${name}</title>
      </head>
      <body style="margin: 0px; width: 100%;">
        <img src="${inlineStyle}" style="margin: 0px; width: 100%;">
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

  const percyClient = new PercyClient({
    clientInfo,
    environmentInfo,
    handleAgentCommunication: false
  });

  // Capture the fake document

  const domSnapshot = serializeDOM({
      document: dom.window.document
    });  

  // Post the fake document to Percy from the node process
  const postSuccess = await postSnapshot({
    name,
    clientInfo,
    domSnapshot,
    environmentInfo,
    url: 'http://localhost/',
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
