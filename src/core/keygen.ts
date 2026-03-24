let wasmModule: any = null;

async function loadWasm() {
  if (!wasmModule) {
    const mod = await import('../../wasm/pkg/ssh_terminal_wasm');
    await mod.default();  // init wasm
    wasmModule = mod;
  }
  return wasmModule;
}

export async function generateEd25519KeyPair(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  const wasm = await loadWasm();
  const keypair = wasm.generate_ed25519_keypair();
  return {
    privateKey: keypair.private_key,
    publicKey: keypair.public_key,
  };
}

export async function searchBuffer(
  buffer: string,
  pattern: string,
  caseSensitive: boolean,
): Promise<Array<{ line: number; start: number; end: number; text: string }>> {
  const wasm = await loadWasm();
  const results = wasm.search_buffer(buffer, pattern, caseSensitive);
  return Array.from(results).map((r: any) => ({
    line: r.line,
    start: r.start,
    end: r.end,
    text: r.text,
  }));
}
