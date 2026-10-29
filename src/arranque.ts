// Defensa adicional (3.6): la CSP no bloquea WebRTC. Se neutraliza antes de cargar la interfaz. PD-2 la completa.
export function neutralizarWebRTC(g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): void {
  for (const nombre of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) {
    try {
      Object.defineProperty(g, nombre, { value: undefined, writable: false, configurable: false });
    } catch {
      // Propiedad no configurable en este navegador: la cubre la prueba de cero red (STUN).
    }
  }
}
