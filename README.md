# percy-appium-webdriverio
[percy-appium-webdriverio](https://github.com/meetmarakana/percy-appium-webdriverio) is a librabry that takes snapshots of the html pages and perform visual testing on it. This library can be used with appium and webdriverio. It takes the screenshot of the page and render a fake html page data and send that one to percy dashboard.


[Percy](https://percy.io) visual testing for [Appium](https://appium.io)
and [WebdriverIo](https://webdriver.io)


## Quick start

Assuming you have an existing Appium setup using WebdriverIO:

- Install the `percy-appium-webdriverio` package: `npm i -D percy-appium-webdriverio`
- `require` the SDK into the test suite (this can be done anywhere before the tests start): `require('percy-appium-webdriverio');`
- Call `await percySnapshot(driver, 'snapshot name')` in your tests (for
  example):
```js
test('Percy works', async () => {
  await percySnapshot(driver, 'test');
});
```
- Finally, when running your tests, wrap the test command with `percy exec`. For
  example: `percy exec -- jest`. Be sure your `PERCY_TOKEN` is set in the
  terminal you're running `percy exec` from (you can get your `PERCY_TOKEN` from
  your Percy projects settings).