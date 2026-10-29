// Ranura de PG-3b: gancho de medición. Solo en el build --mode medicion (nunca en dist/).
export function instalarGancho(): void {
  (globalThis as unknown as Record<string, unknown>)['__SIGLOW_GANCHO_MEDICION__'] = { version: 0 };
}
