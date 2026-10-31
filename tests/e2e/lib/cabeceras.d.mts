export interface ReglaCabeceras { patron: string; cabeceras: Array<[string, string]> }
export function parseHeaders(texto: string): ReglaCabeceras[];
export function cabecerasPara(reglas: ReglaCabeceras[], ruta: string): Map<string, string>;
export function conReporteCsp(valor: string): string;
