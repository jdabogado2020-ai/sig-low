// Política «default» de Trusted Types (3.6): solo createScriptURL del mismo origen y de rutas del build.
(function () {
  'use strict';
  if (!self.trustedTypes || !self.trustedTypes.createPolicy) return;
  self.trustedTypes.createPolicy('default', {
    createScriptURL: function (s) {
      var u = new URL(s, location.href);
      // Sin query ni fragmento (B-40): un dato en `?d=` llegaría al alojamiento, que lo registra, sin que la CSP lo vea (compara rutas).
      if (u.protocol === location.protocol && u.origin === location.origin && /^\/(assets|ort)\/|^\/sw\.js$/.test(u.pathname) && u.search === '' && u.hash === '') {
        return u.href;
      }
      throw new TypeError('URL_NO_PERMITIDA');
    },
  });
})();
