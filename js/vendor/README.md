# Vendored libraries

Two files the app cannot sensibly write itself. Both are committed verbatim —
byte-identical to what npm publishes — so they can be diffed against upstream
without a build step, which is the same reason the rest of the app has no
build step either.

Neither is loaded on startup. `js/app.js` injects them with a `<script>` tag
the first time you open **Compartir por QR**, so opening the app costs exactly
what it cost before this feature existed. Both are precached by `sw.js`, so
that first open works with no signal.

| File | Package | Version | License |
|---|---|---|---|
| `qrcode.js` | [`qrcode-generator`](https://www.npmjs.com/package/qrcode-generator) | 1.4.4 | MIT |
| `jsQR.js` | [`jsqr`](https://www.npmjs.com/package/jsqr) | 1.4.0 | Apache-2.0 |

```
sha256  18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780  qrcode.js
sha256  bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859  jsQR.js
```

To refresh either one:

```sh
npm pack qrcode-generator@1.4.4 && tar xzf qrcode-generator-1.4.4.tgz
cp package/qrcode.js js/vendor/qrcode.js

npm pack jsqr@1.4.0 && tar xzf jsqr-1.4.0.tgz
cp package/dist/jsQR.js js/vendor/jsQR.js
cp package/LICENSE     js/vendor/jsQR-LICENSE.txt
```

Then re-run `node test/smoke.js` and bump `CACHE_VERSION` in `sw.js`.

## Licenses

`qrcode.js` carries its MIT notice in its own header (© 2009 Kazuhiko Arase).
The MIT text it points at:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

`jsQR.js` is Apache-2.0 (© Cosmo Wolfe). The full text is in
`jsQR-LICENSE.txt`, kept next to it as that license requires. The file is
unmodified, so there is no "changes made" notice to add.
