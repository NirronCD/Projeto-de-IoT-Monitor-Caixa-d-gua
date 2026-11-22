import { leituraSchema, registrarLeitura } from "@/lib/estado";
import { iguaisSeguro, ipCliente } from "@/lib/seguranca";

export async function POST(req: Request) {
  const token = process.env.API_TOKEN;
  if (!token) {
    console.error("[leituras] API_TOKEN não configurado");
    return Response.json({ ok: false, erro: "servidor sem API_TOKEN" }, { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const recebido = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!iguaisSeguro(recebido, token)) {
    console.warn(`[leituras] token inválido vindo de ${ipCliente(req.headers)}`);
    return Response.json({ ok: false, erro: "token inválido" }, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ ok: false, erro: "corpo não é JSON" }, { status: 400 });
  }

  const resultado = leituraSchema.safeParse(corpo);
  if (!resultado.success) {
    return Response.json(
      { ok: false, erro: "leitura inválida", detalhes: resultado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  const config = registrarLeitura(resultado.data);
  return Response.json({ ok: true, config });
}
