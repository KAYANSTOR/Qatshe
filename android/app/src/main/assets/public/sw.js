/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-afac4cd2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "pwa-maskable-512x512.png",
    "revision": "5486228717ce54cd17ddfb43014cd8a0"
  }, {
    "url": "pwa-512x512.png",
    "revision": "fd59366d46f0c32c1c45d85d86300950"
  }, {
    "url": "pwa-192x192.png",
    "revision": "f3ec1229dc2f23cf329bd56cd60c14de"
  }, {
    "url": "index.html",
    "revision": "9978c9fd60d8fb34c405229281711fe1"
  }, {
    "url": "icon.svg",
    "revision": "67a8e4178c63e5efa16054febf2d656f"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "a83cfab71e713405948bbc138f4b6cdf"
  }, {
    "url": "assets/workbox-window.prod.es5-Bd17z0YL.js",
    "revision": null
  }, {
    "url": "assets/web-DIBfxWtk.js",
    "revision": null
  }, {
    "url": "assets/web-BwEseMzK.js",
    "revision": null
  }, {
    "url": "assets/shop_cover_luxury_1794643393777-C3qLFEaV.jpg",
    "revision": null
  }, {
    "url": "assets/readex-pro-vietnamese-700-normal-DWiQMDrn.woff",
    "revision": null
  }, {
    "url": "assets/readex-pro-vietnamese-700-normal-BOdn1JB1.woff2",
    "revision": null
  }, {
    "url": "assets/readex-pro-vietnamese-600-normal-CvqEbH36.woff2",
    "revision": null
  }, {
    "url": "assets/readex-pro-vietnamese-600-normal-BT-w1HBH.woff",
    "revision": null
  }, {
    "url": "assets/readex-pro-latin-ext-700-normal-C1QSodUR.woff",
    "revision": null
  }, {
    "url": "assets/readex-pro-latin-ext-700-normal-Bpf-iva7.woff2",
    "revision": null
  }, {
    "url": "assets/readex-pro-latin-ext-600-normal-DvstIQFU.woff2",
    "revision": null
  }, {
    "url": "assets/readex-pro-latin-ext-600-normal-DRKkFP2q.woff",
    "revision": null
  }, {
    "url": "assets/readex-pro-latin-700-normal-oqSerPEB.woff2",
    "revision": null
  }, {
    "url": "assets/readex-pro-latin-700-normal-L_HvUYJT.woff",
    "revision": null
  }, {
    "url": "assets/readex-pro-latin-600-normal-CeYg1m9V.woff",
    "revision": null
  }, {
    "url": "assets/readex-pro-latin-600-normal-C3IhmgOg.woff2",
    "revision": null
  }, {
    "url": "assets/readex-pro-arabic-700-normal-EXBdNfUG.woff2",
    "revision": null
  }, {
    "url": "assets/readex-pro-arabic-700-normal-CrhlwrkQ.woff",
    "revision": null
  }, {
    "url": "assets/readex-pro-arabic-600-normal-BHxn1TEo.woff2",
    "revision": null
  }, {
    "url": "assets/readex-pro-arabic-600-normal-9mhVJBMn.woff",
    "revision": null
  }, {
    "url": "assets/qatshi_brand_emblem_1794643391707-BaOPvelO.jpg",
    "revision": null
  }, {
    "url": "assets/purify.es-Dqk5qvad.js",
    "revision": null
  }, {
    "url": "assets/index.es-DXeJTsYz.js",
    "revision": null
  }, {
    "url": "assets/index-yXDejRPt.js",
    "revision": null
  }, {
    "url": "assets/index-CzeGWyPL.css",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-ext-700-normal-C7GcWn11.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-ext-700-normal-BSbyEp0V.woff2",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-ext-600-normal-DjDAeNQD.woff2",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-ext-600-normal-DT29Q8HW.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-ext-500-normal-eJxPnL1P.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-ext-500-normal-Ck_W4G78.woff2",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-ext-400-normal-BpLfq-63.woff2",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-ext-400-normal-BeVLg08x.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-700-normal-Cl4F7CZR.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-700-normal-BzSf6GNr.woff2",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-600-normal-KrqB56Mw.woff2",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-600-normal-Dk5eISD_.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-500-normal-Cd6jVIg7.woff2",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-500-normal-BletK1Hp.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-400-normal-CFZh1unN.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-latin-400-normal-Bo5KPYvw.woff2",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-arabic-700-normal-DrtBj6UE.woff2",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-arabic-700-normal-9rXc6cUL.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-arabic-600-normal-MJZ0liF5.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-arabic-600-normal-0pRdybE_.woff2",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-arabic-500-normal-DPXcppbm.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-arabic-500-normal-C4MQITzh.woff2",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-arabic-400-normal-EA1o-u_Q.woff",
    "revision": null
  }, {
    "url": "assets/ibm-plex-sans-arabic-arabic-400-normal-CyU-ddYS.woff2",
    "revision": null
  }, {
    "url": "assets/html2canvas-D_pl3m29.js",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "a83cfab71e713405948bbc138f4b6cdf"
  }, {
    "url": "icon.svg",
    "revision": "67a8e4178c63e5efa16054febf2d656f"
  }, {
    "url": "pwa-192x192.png",
    "revision": "f3ec1229dc2f23cf329bd56cd60c14de"
  }, {
    "url": "pwa-512x512.png",
    "revision": "fd59366d46f0c32c1c45d85d86300950"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "5486228717ce54cd17ddfb43014cd8a0"
  }, {
    "url": "manifest.webmanifest",
    "revision": "56bfe56337e37e46f179b679a0febe91"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 20,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
