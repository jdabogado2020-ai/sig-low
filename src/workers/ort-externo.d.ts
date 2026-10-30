// Tipos del build CPU de ORT-web sin el WebAssembly incrustado (4.6.1). Solo lo que usa el motor (src/core/ner/engine.ts).
declare module '*/ort.wasm.min.mjs' {
  export const env: import('../core/ner/engine').OrtModule['env'];
  export const InferenceSession: import('../core/ner/engine').OrtModule['InferenceSession'];
  export const Tensor: import('../core/ner/engine').OrtModule['Tensor'];
}
