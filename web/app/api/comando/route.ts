import { alterarConfig, comandoSchema } from "@/lib/estado";

export async function POST(req: Request) {
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ ok: false, erro: "corpo não é JSON" }, { status: 400 });
  }

  const campos = comandoSchema.safeParse(corpo);
  const resultado = campos.success ? alterarConfig(campos.data) : campos;
  if (!resultado.success) {
    return Response.json({ ok: false, erro: resultado.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  return Response.json({ ok: true, config: resultado.data });
}
