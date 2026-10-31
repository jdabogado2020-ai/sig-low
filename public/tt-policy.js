// Política «default» de Trusted Types (3.6): solo createScriptURL del mismo origen y de rutas del build.
(function () {
  'use strict';
  if (!self.trustedTypes || !self.trustedTypes.createPolicy) return;
  self.trustedTypes.createPolicy('default', {
    // El tercer argumento es el sumidero (Chromium: «ServiceWorkerContainer register», «Worker constructor»…).
    createScriptURL: function (s, tipo, sumidero) {
      var u = new URL(s, location.href);
      // Sin query, fragmento ni usuario (B-40): un dato en `?d=` llegaría al alojamiento, que lo registra, sin que la CSP lo vea (compara rutas).
      if (u.protocol === location.protocol && u.origin === location.origin && u.search === '' && u.hash === '' && u.username === '' && u.password === '') {
        // B-50: el registro del service worker es solo `/sw.js` exacto. La petición del script de un SW no pasa por el SW, y una ruta
        // como `/assets/<dato>.js` (que la CSP admite por prefijo) llevaría el dato al registro del alojamiento.
        if (typeof sumidero === 'string' && /^ServiceWorkerContainer\b/.test(sumidero)) {
          if (u.pathname === '/sw.js') return u.href;
        } else if (/^\/(assets|ort)\/|^\/sw\.js$/.test(u.pathname)) {
          return u.href;
        }
      }
      throw new TypeError('URL_NO_PERMITIDA');
    },
  });
})();
