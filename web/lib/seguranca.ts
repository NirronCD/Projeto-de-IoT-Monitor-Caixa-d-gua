import { createHash, timingSafeEqual } from "node:crypto";

export function iguaisSeguro(recebido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

export function ipCliente(headers: Headers): string {
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for") ?? "desconhecido";
}
