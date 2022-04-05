# percy-appium-webdriverio
[percy-appium-webdriverio](https://github.com/meetmarakana/percy-appium-webdriverio) is a librabry that takes snapshots of the html pages and perform visual testing on it. This library can be used with appium and webdriverio. It takes the screenshot of the page and render a fake html page data and send that one to percy dashboard.


[Percy](https://percy.io) visual testing for [Appium](https://appium.io)
and [WebdriverIo](https://webdriver.io)


## Quick start

To use for WebdriverIO:

- Install the `percy-appium-webdriverio` package: `npm i -D percy-appium-webdriverio`
- `require` the SDK into the test suite (this can be done anywhere before the tests start): `require('percy-appium-webdriverio');`
- Call `await percySnapshot(driver, 'snapshot name')` in your tests (for
  example):
```js
test('Percy works', async () => {
  await percyAppiumSnapshot(driver, 'test');
});
```

To use for Appium setup with WebdriverIO:

- Install the `percy-appium-webdriverio` package: `npm i -D percy-appium-webdriverio`
- `require` the SDK into the test suite (this can be done anywhere before the tests start): `require('percy-appium-webdriverio');`
- Call `await percyAppiumSnapshot(driver, 'snapshot name')` in your tests (for
  example):
```js
test('Percy works', async () => {
  await percyAppiumSnapshot(driver, 'test');
});
```

To execute percy:

- First step is to set up PERCY_TOKEN as environment variable.

  For Ubuntu and Mac devices,
  ```
  export PERCY_TOKEN=<your_token here>
  ```
  For Windows devices,
  ```
  set PERCY_TOKEN=<your_token here>
  ```

- Finally, when running your tests, wrap the test command with `percy exec`. Be sure your `PERCY_TOKEN` is set in the
  terminal (you can get your `PERCY_TOKEN` from your Percy projects settings). For example:
  ```
  percy exec -- testScript.js
  ```
